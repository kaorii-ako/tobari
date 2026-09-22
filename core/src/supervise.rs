use std::process::{Child, Command, Stdio};

use crate::backend::Backend;

pub struct Supervised {
    child: Option<Child>,
    pub port: u16,
    pub token: String,
}

impl Supervised {
    pub fn spawn(
        llama_bin: &std::path::Path,
        model_path: &std::path::Path,
        port: u16,
        token: &str,
        backend: Backend,
        ctx: u32,
        ngl: u32,
    ) -> anyhow::Result<Self> {
        if !llama_bin.is_file() {
            anyhow::bail!(
                "llama-server not found at {}. Build or install it next to tobari-core.",
                llama_bin.display()
            );
        }
        let mut cmd = Command::new(llama_bin);
        cmd.arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--api-key")
            .arg(token)
            .arg("-m")
            .arg(model_path)
            .arg("-c")
            .arg(ctx.to_string())
            .arg("--n-gpu-layers")
            .arg(ngl.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        let flag = crate::backend::llama_backend_flag(backend);
        if !flag.is_empty() {
            cmd.arg(flag);
        }
        #[cfg(target_os = "linux")]
        unsafe {
            use std::os::unix::process::CommandExt;
            cmd.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as u64, 0, 0, 0);
                Ok(())
            });
        }
        let child = cmd.spawn()?;
        Ok(Supervised {
            child: Some(child),
            port,
            token: token.to_owned(),
        })
    }

    pub fn wait_or_restart(
        &mut self,
        make: &dyn Fn() -> anyhow::Result<Child>,
    ) -> anyhow::Result<()> {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait()? {
                None => return Ok(()),
                Some(status) => {
                    eprintln!("llama-server exited ({status}); restarting with backoff");
                }
            }
        }
        let mut delay = std::time::Duration::from_millis(500);
        for _ in 0..5 {
            std::thread::sleep(delay);
            match make() {
                Ok(c) => {
                    self.child = Some(c);
                    return Ok(());
                }
                Err(e) => {
                    eprintln!("restart failed: {e:#}");
                    delay *= 2;
                }
            }
        }
        anyhow::bail!("llama-server would not stay up after 5 restarts")
    }

    pub fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn loopback_check(port: u16) -> anyhow::Result<()> {
        let addr: std::net::SocketAddr = format!("127.0.0.1:{port}").parse()?;
        match std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(2)) {
            Ok(_) => Ok(()),
            Err(e) => anyhow::bail!("cannot reach llama-server on 127.0.0.1:{port}: {e}"),
        }
    }

    pub async fn wait_healthy(port: u16, token: &str) -> anyhow::Result<()> {
        let client = reqwest::Client::new();
        for _ in 0..60 {
            let res = client
                .get(format!("http://127.0.0.1:{port}/health"))
                .bearer_auth(token)
                .send()
                .await;
            if let Ok(r) = res {
                if r.status().is_success() {
                    return Ok(());
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        anyhow::bail!("llama-server did not become healthy in 30s")
    }
}

impl Drop for Supervised {
    fn drop(&mut self) {
        self.kill();
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("pkill")
                .args(["-P", &std::process::id().to_string(), "llama-server"])
                .output();
        }
    }
}

pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8080)
}

pub fn guess_gpu_layers(model_size_mb: u64, ctx: u32) -> u32 {
    let _ = model_size_mb;
    let _ = ctx;
    99
}
