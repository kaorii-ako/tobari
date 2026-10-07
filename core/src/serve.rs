use crate::models::ModelEntry;

pub async fn serve_async() -> anyhow::Result<()> {
    let missing = crate::deps::missing();
    if !missing.is_empty() {
        return setup_loop(missing).await;
    }
    let (_, manifest) = crate::models::load_manifest()?;
    let entry = crate::models::default_model(&manifest)?.clone();
    let model_path = crate::models::model_file_path(&entry);
    if !model_path.is_file() {
        anyhow::bail!("model file missing. Run `tobari-core download` first.");
    }
    if !entry.sha256_pinned() {
        anyhow::bail!("refusing to load: no sha256 pinned");
    }
    let actual = crate::download::sha256_file(&model_path)?;
    if !actual.eq_ignore_ascii_case(entry.sha256.trim()) {
        anyhow::bail!("checksum mismatch: refusing to load");
    }
    serve_loaded(&entry, &manifest, &model_path).await
}

async fn serve_loaded(
    entry: &ModelEntry,
    manifest: &[ModelEntry],
    model_path: &std::path::Path,
) -> anyhow::Result<()> {
    let backend = crate::backend::detect();
    let token = crate::download::fresh_token();
    let port = crate::supervise::free_port();
    let ngl = crate::supervise::guess_gpu_layers(entry.size_mb, entry.ctx_default);
    let llama_bin = crate::paths::llama_bin();
    let mut supervised = crate::supervise::Supervised::spawn(
        &llama_bin,
        model_path,
        port,
        &token,
        backend,
        entry.ctx_default,
        ngl,
    )?;
    crate::supervise::Supervised::wait_healthy(port, &token).await?;
    crate::chat::chat_loop(port, &token, backend, &entry.id, manifest).await?;
    supervised.kill();
    Ok(())
}

/// Dependencies are missing: tell the extension what, install on request,
/// then exit so the extension's reconnect starts a fully set-up host.
async fn setup_loop(missing: Vec<String>) -> anyhow::Result<()> {
    use crate::host::{HostRequest, HostResponse};
    while let Some(req) = crate::host::read_message()? {
        let resp = match req {
            HostRequest::Status => HostResponse::Status {
                backend: crate::backend::detect().as_str().to_owned(),
                model: String::new(),
                port: 0,
                healthy: false,
                missing: missing.clone(),
            },
            HostRequest::InstallDeps => match crate::deps::install_missing().await {
                Ok(()) => {
                    crate::host::write_message(&HostResponse::Installed)?;
                    return Ok(());
                }
                Err(e) => HostResponse::Error {
                    message: format!("install failed: {e:#}"),
                },
            },
            _ => HostResponse::Error {
                message: format!("setup required: missing {}", missing.join(", ")),
            },
        };
        crate::host::write_message(&resp)?;
    }
    Ok(())
}
