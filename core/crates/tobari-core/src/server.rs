use crate::config::Paths;
use crate::gpu;
use crate::llama::{self, SpawnParams};
use crate::models;
use anyhow::Result;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use crate::config::Catalog;

pub const HEALTH_TIMEOUT: Duration = Duration::from_secs(120);

pub struct LlamaHandle {
    pub child: tokio::process::Child,
    pub port: u16,
    pub token: String,
}

pub struct AppState {
    pub catalog: Catalog,
    pub paths: Paths,
    pub llama: Mutex<Option<LlamaHandle>>,
    pub out: std::sync::Mutex<std::io::Stdout>,
}

pub fn send(state: &AppState, value: &Value) {
    let mut out = state.out.lock().expect("stdout mutex poisoned");
    if let Err(err) = crate::native_host::write_message(&mut *out, value) {
        eprintln!("cannot write to extension: {err}");
    }
}

pub fn send_status(state: &AppState, state_name: &str, error: Option<&str>) {
    send(state, &crate::manifests::status_json(state_name, error, json!({})));
}

pub fn send_error(state: &AppState, req_id: Option<&str>, message: &str) {
    send(state, &json!({ "type": "error", "req_id": req_id, "message": message }));
}

async fn start_llama(state: &AppState) -> Result<()> {
    let binary = crate::manifests::llama_server_path()?;
    let model = state.catalog.default_model()?;
    let model_path = models::model_path(&state.paths, model);
    anyhow::ensure!(
        model_path.exists(),
        "model not downloaded: {} — open the Tobari panel and download it first",
        model_path.display()
    );
    models::verify_sha256(&model_path, &model.sha256)?;
    let info = gpu::detect();
    let layers = gpu::gpu_layer_budget(model.size_bytes.unwrap_or(0), info.vram_gb);
    let params = SpawnParams {
        binary,
        model_path,
        context_size: model.context_size,
        gpu_layers: layers,
        threads: llama::threads_for_backend(info.backend, &info),
        log_path: state.paths.logs.join("llama-server.log"),
    };
    let running = llama::spawn_server(&params)?;
    let port = running.port;
    let token = running.token;
    let healthy = llama::wait_healthy(port, &token, HEALTH_TIMEOUT).await?;
    let (gpu_layers, total_layers) =
        llama::parse_layer_split(&params.log_path).unwrap_or((params.gpu_layers, 0));
    let model_label = model.display_name.clone();
    let model_id = model.id.clone();
    if healthy {
        *state.llama.lock().await = Some(LlamaHandle { child: running.child, port, token });
        send(
            state,
            &crate::manifests::status_json(
                "ready",
                None,
                json!({
                    "model_id": model_id,
                    "model_label": model_label,
                    "verified": "pinned",
                    "gpu_layers": gpu_layers,
                    "total_layers": total_layers,
                }),
            ),
        );
        Ok(())
    } else {
        let mut child = running.child;
        let _ = child.start_kill();
        anyhow::bail!(
            "llama-server did not become healthy within 120s; see log at {}",
            params.log_path.display()
        )
    }
}

pub async fn supervise(state: Arc<AppState>) {
    let mut backoff_secs: u64 = 2;
    loop {
        if let Err(err) = start_llama(&state).await {
            send_status(&state, "error", Some(&err.to_string()));
        }
        let exited = {
            let mut guard = state.llama.lock().await;
            match guard.take() {
                Some(mut handle) => {
                    let result = handle.child.wait().await;
                    drop(guard);
                    result
                }
                None => {
                drop(guard);
                Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "no handle",
                ))
            }
            }
        };
        match exited {
            Ok(_) => send_status(&state, "starting", Some("llama-server exited; restarting")),
            Err(err) if err.kind() == std::io::ErrorKind::BrokenPipe => {}
            Err(err) => send_status(&state, "starting", Some(&format!("wait failed: {err}"))),
        }
        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
        backoff_secs = (backoff_secs * 2).min(60);
    }
}
