use std::collections::HashSet;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

pub struct Running {
    child: Child,
    pub port: u16,
    pub token: String,
    pub model_id: String,
    last_used: Instant,
}

#[derive(Clone)]
pub struct Sidecar {
    inner: Arc<Mutex<Option<Running>>>,
    verified: Arc<Mutex<HashSet<String>>>,
    idle: Duration,
}

#[derive(Debug, Serialize)]
pub struct SidecarStatus {
    pub running: bool,
    pub model: String,
    pub backend: String,
    pub idle_unload_secs: u64,
    pub llama_server: bool,
    pub model_downloaded: bool,
}

impl Sidecar {
    pub fn new(idle: Duration) -> Self {
        let s = Sidecar {
            inner: Arc::new(Mutex::new(None)),
            verified: Arc::new(Mutex::new(HashSet::new())),
            idle,
        };
        let reaper = s.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(10)).await;
                reaper.reap().await;
            }
        });
        s
    }

    async fn reap(&self) {
        let mut g = self.inner.lock().await;
        let expired = match g.as_mut() {
            Some(r) => {
                r.last_used.elapsed() >= self.idle || r.child.try_wait().ok().flatten().is_some()
            }
            None => false,
        };
        if expired {
            if let Some(mut r) = g.take() {
                let _ = r.child.kill().await;
            }
        }
    }

    pub async fn stop(&self) {
        if let Some(mut r) = self.inner.lock().await.take() {
            let _ = r.child.kill().await;
        }
    }

    pub async fn status(&self) -> SidecarStatus {
        let models = crate::models::load_manifest().unwrap_or_default();
        let selected = crate::models::selected_model(&models).ok().cloned();
        let g = self.inner.lock().await;
        SidecarStatus {
            running: g.is_some(),
            model: g
                .as_ref()
                .map(|r| r.model_id.clone())
                .or_else(|| selected.as_ref().map(|m| m.id.clone()))
                .unwrap_or_default(),
            backend: crate::backend::detect().as_str().to_owned(),
            idle_unload_secs: self.idle.as_secs(),
            llama_server: crate::paths::llama_bin().is_file(),
            model_downloaded: selected
                .map(|m| crate::models::model_file_path(&m).is_file())
                .unwrap_or(false),
        }
    }

    pub async fn ensure(&self) -> anyhow::Result<(u16, String)> {
        let models = crate::models::load_manifest()?;
        let entry = crate::models::selected_model(&models)?.clone();
        let mut g = self.inner.lock().await;
        if let Some(r) = g.as_mut() {
            let alive = r.child.try_wait().ok().flatten().is_none();
            if alive && r.model_id == entry.id {
                r.last_used = Instant::now();
                return Ok((r.port, r.token.clone()));
            }
            let _ = r.child.kill().await;
            *g = None;
        }
        let path = crate::models::model_file_path(&entry);
        if !path.is_file() {
            anyhow::bail!(
                "model {} is not downloaded. Run `tobari models download`.",
                entry.id
            );
        }
        {
            let mut v = self.verified.lock().await;
            if !v.contains(&entry.id) {
                let e = entry.clone();
                tokio::task::spawn_blocking(move || crate::download::verify(&e)).await??;
                v.insert(entry.id.clone());
            }
        }
        let bin = crate::paths::llama_bin();
        if !bin.is_file() {
            anyhow::bail!(
                "llama-server not found at {}. Run `tobari setup`.",
                bin.display()
            );
        }
        let token = crate::download::fresh_token();
        let port = free_loopback_port()?;
        let mut cmd = Command::new(&bin);
        cmd.arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--api-key")
            .arg(&token)
            .arg("-m")
            .arg(&path)
            .arg("-c")
            .arg(entry.ctx_default.to_string())
            .arg("--n-gpu-layers")
            .arg(gpu_layers().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log_file())
            .kill_on_drop(true);
        unsafe {
            cmd.pre_exec(|| {
                libc::prctl(
                    libc::PR_SET_PDEATHSIG,
                    libc::SIGKILL as libc::c_ulong,
                    0,
                    0,
                    0,
                );
                Ok(())
            });
        }
        let child = cmd.spawn()?;
        let mut running = Running {
            child,
            port,
            token: token.clone(),
            model_id: entry.id.clone(),
            last_used: Instant::now(),
        };
        if let Err(e) = wait_healthy(port, &token, &mut running.child).await {
            let _ = running.child.kill().await;
            return Err(e);
        }
        *g = Some(running);
        Ok((port, token))
    }

    pub async fn touch(&self) {
        if let Some(r) = self.inner.lock().await.as_mut() {
            r.last_used = Instant::now();
        }
    }
}

fn gpu_layers() -> u32 {
    if crate::backend::detect().is_gpu() {
        99
    } else {
        0
    }
}

fn log_file() -> Stdio {
    let dir = crate::paths::state_dir();
    let _ = std::fs::create_dir_all(&dir);
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("llama-server.log"))
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null())
}

pub fn free_loopback_port() -> anyhow::Result<u16> {
    let l = std::net::TcpListener::bind("127.0.0.1:0")?;
    Ok(l.local_addr()?.port())
}

async fn wait_healthy(port: u16, token: &str, child: &mut Child) -> anyhow::Result<()> {
    let client = reqwest::Client::builder().no_proxy().build()?;
    for _ in 0..240 {
        if let Some(status) = child.try_wait()? {
            anyhow::bail!("llama-server exited during startup ({status}); see llama-server.log");
        }
        if let Ok(r) = client
            .get(format!("http://127.0.0.1:{port}/health"))
            .bearer_auth(token)
            .send()
            .await
        {
            if r.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    anyhow::bail!("llama-server did not become healthy in 60 s")
}
