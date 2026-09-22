use crate::gpu::{Backend, GpuInfo};
use anyhow::{Context, Result};
use base64::Engine;
use rand::RngCore;
use std::net::TcpListener;
use std::path::PathBuf;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::Duration;
use tokio::process::Child;

pub struct SpawnParams {
    pub binary: PathBuf,
    pub model_path: PathBuf,
    pub context_size: u32,
    pub gpu_layers: u32,
    pub threads: u32,
    pub log_path: PathBuf,
}

pub struct Running {
    pub child: Child,
    pub port: u16,
    pub token: String,
}

pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn pick_port() -> Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).context("cannot bind loopback port")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

#[cfg(target_os = "linux")]
fn pre_exec_setup() -> std::io::Result<()> {
    unsafe {
        if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0) != 0 {
            return Err(std::io::Error::last_os_error());
        }
        if libc::setpgid(0, 0) != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn pre_exec_setup() -> std::io::Result<()> {
    unsafe {
        if libc::setpgid(0, 0) != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}

pub fn spawn_server(params: &SpawnParams) -> Result<Running> {
    let port = pick_port()?;
    let token = generate_token();
    let log = std::fs::File::create(&params.log_path)
        .with_context(|| format!("cannot open llama-server log {}", params.log_path.display()))?;
    let mut command = Command::new(&params.binary);
    command
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--model")
        .arg(&params.model_path)
        .arg("--ctx-size")
        .arg(params.context_size.to_string())
        .arg("--n-gpu-layers")
        .arg(params.gpu_layers.to_string())
        .arg("--threads")
        .arg(params.threads.to_string())
        .arg("--api-key")
        .arg(&token)
        .arg("--no-webui")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log))
        .env_clear()
        .env("PATH", "/usr/bin:/usr/local/bin:/bin")
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .env(
            "LD_LIBRARY_PATH",
            std::env::var("LD_LIBRARY_PATH").unwrap_or_default(),
        );
    unsafe {
        command.pre_exec(pre_exec_setup);
    }
    let child = tokio::process::Command::from(command)
        .spawn()
        .with_context(|| format!("cannot spawn {}", params.binary.display()))?;
    Ok(Running { child, port, token })
}

pub async fn wait_healthy(port: u16, token: &str, timeout: Duration) -> Result<bool> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/health");
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        let attempt = client
            .get(&url)
            .bearer_auth(token)
            .timeout(Duration::from_secs(2))
            .send()
            .await;
        if let Ok(response) = attempt {
            if response.status().is_success() {
                return Ok(true);
            }
            if response.status().as_u16() == 503 {
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Ok(false)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Offload {
    All,
    Partial,
    None,
}

#[derive(Debug, Clone)]
pub struct OffloadReport {
    pub kind: Offload,
    pub gpu_layers: Option<u32>,
    pub total_layers: Option<u32>,
}

impl OffloadReport {
    pub fn kind_str(&self) -> &'static str {
        match self.kind {
            Offload::All => "all",
            Offload::Partial => "partial",
            Offload::None => "none",
        }
    }

    pub fn gpu_layers_json(&self) -> serde_json::Value {
        match self.gpu_layers {
            Some(n) => serde_json::Value::from(n),
            None => serde_json::Value::Null,
        }
    }

    pub fn total_layers_json(&self) -> serde_json::Value {
        match self.total_layers {
            Some(n) => serde_json::Value::from(n),
            None => serde_json::Value::Null,
        }
    }
}

pub fn parse_layer_split(log_path: &PathBuf) -> Option<(u32, u32)> {
    let text = std::fs::read_to_string(log_path).ok()?;
    for line in text.lines().rev() {
        let Some(idx) = line.find("offloaded") else {
            continue;
        };
        let rest = &line[idx + "offloaded".len()..];
        let tokens: Vec<&str> = rest.split_whitespace().collect();
        if let Some(first) = tokens.first() {
            if let Some((gpu, total)) = first.split_once('/') {
                if let (Ok(gpu), Ok(total)) = (gpu.trim().parse(), total.trim().parse()) {
                    return Some((gpu, total));
                }
            }
        }
        let numbers: Vec<u32> = tokens
            .iter()
            .filter(|t| **t != "/")
            .filter_map(|t| t.trim_end_matches('/').parse().ok())
            .take(2)
            .collect();
        if numbers.len() == 2 {
            return Some((numbers[0], numbers[1]));
        }
    }
    None
}

pub fn offload_report(log_path: &PathBuf, requested: u32, backend: Backend) -> OffloadReport {
    if let Some((gpu, total)) = parse_layer_split(log_path) {
        let kind = if gpu == 0 {
            Offload::None
        } else if total > 0 && gpu >= total {
            Offload::All
        } else {
            Offload::Partial
        };
        return OffloadReport {
            kind,
            gpu_layers: Some(gpu),
            total_layers: Some(total).filter(|t| *t > 0),
        };
    }

    if backend == Backend::Cpu || requested == 0 {
        return OffloadReport {
            kind: Offload::None,
            gpu_layers: Some(0),
            total_layers: None,
        };
    }

    if requested >= crate::gpu::ALL_LAYERS {
        return OffloadReport {
            kind: Offload::All,
            gpu_layers: None,
            total_layers: None,
        };
    }

    OffloadReport {
        kind: Offload::Partial,
        gpu_layers: Some(requested),
        total_layers: None,
    }
}

pub fn threads_for_backend(backend: Backend, info: &GpuInfo) -> u32 {
    match backend {
        Backend::Cpu => std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4),
        _ => {
            let _ = info;
            4
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{offload_report, parse_layer_split, Offload};
    use crate::gpu::Backend;
    use std::io::Write;
    use std::path::PathBuf;

    fn temp_log(name: &str, contents: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("tobari-test-{}-{name}.log", std::process::id()));
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(contents.as_bytes()).unwrap();
        path
    }

    #[test]
    fn parses_slash_joined_offload_line() {
        let path = temp_log("slash", "load_tensors: offloaded 37/37 layers to GPU\n");
        assert_eq!(parse_layer_split(&path), Some((37, 37)));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn parses_spaced_offload_line() {
        let path = temp_log("spaced", "llm_load_tensors: offloaded 20 / 37 layers to GPU\n");
        assert_eq!(parse_layer_split(&path), Some((20, 37)));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn silent_log_with_full_request_reports_all() {
        let path = temp_log("silent", "srv llama_server: model loaded\n");
        let report = offload_report(&path, crate::gpu::ALL_LAYERS, Backend::Vulkan);
        assert_eq!(report.kind, Offload::All);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn cpu_backend_reports_no_offload() {
        let path = temp_log("cpu", "srv llama_server: model loaded\n");
        let report = offload_report(&path, 0, Backend::Cpu);
        assert_eq!(report.kind, Offload::None);
        let _ = std::fs::remove_file(&path);
    }
}
