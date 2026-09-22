use crate::config::Paths;
use crate::gpu;
use crate::llama::{self, Offload, SpawnParams};
use crate::models;
use anyhow::Result;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use crate::config::Catalog;

pub const HEALTH_TIMEOUT: Duration = Duration::from_secs(120);

pub struct LlamaHandle {
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

async fn start_llama(state: &AppState) -> Result<tokio::process::Child> {
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
    let llama::Running { child, port, token } = llama::spawn_server(&params)?;
    let mut child = child;

    if !llama::wait_healthy(port, &token, HEALTH_TIMEOUT).await? {
        let _ = child.start_kill();
        anyhow::bail!(
            "llama-server did not become healthy within {}s; see log at {}",
            HEALTH_TIMEOUT.as_secs(),
            params.log_path.display()
        );
    }

    let offload = llama::offload_report(&params.log_path, params.gpu_layers, info.backend);
    let mut detail = json!({
        "model_id": model.id.clone(),
        "model_label": model.display_name.clone(),
        "verified": "pinned",
        "offload": offload.kind_str(),
    });
    if let Some(map) = detail.as_object_mut() {
        map.insert("gpu_layers".into(), offload.gpu_layers_json());
        map.insert("total_layers".into(), offload.total_layers_json());
    }

    let warning = match offload.kind {
        Offload::None => Some(format!(
            "running on CPU — no GPU offload; responses will be slow ({})",
            info.device_name
        )),
        _ => None,
    };

    *state.llama.lock().await = Some(LlamaHandle { port, token });
    send(
        state,
        &crate::manifests::status_json("ready", None, detail),
    );
    if let Some(warning) = warning {
        send(
            state,
            &crate::manifests::status_json("ready", None, json!({ "warning": warning })),
        );
    }
    Ok(child)
}

pub async fn supervise(state: Arc<AppState>) {
    let mut backoff_secs: u64 = 2;
    loop {
        match start_llama(&state).await {
            Ok(mut child) => {
                backoff_secs = 2;
                let exit = child.wait().await;
                *state.llama.lock().await = None;
                match exit {
                    Ok(status) => send_status(
                        &state,
                        "starting",
                        Some(&format!("llama-server exited ({status}); restarting")),
                    ),
                    Err(err) => {
                        send_status(&state, "starting", Some(&format!("wait failed: {err}")))
                    }
                }
            }
            Err(err) => {
                *state.llama.lock().await = None;
                send_status(&state, "error", Some(&err.to_string()));
            }
        }
        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
        backoff_secs = (backoff_secs * 2).min(60);
    }
}
