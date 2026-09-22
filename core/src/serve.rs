use crate::models::ModelEntry;

pub async fn serve_async() -> anyhow::Result<()> {
    let (_, manifest) = crate::models::load_manifest()?;
    let entry = crate::models::default_model(&manifest)?.clone();
    let model_path = crate::models::model_file_path(&entry);
    if !model_path.is_file() {
        anyhow::bail!("model file missing. Run `tobari-core download` first.");
    }
    if entry.sha256.trim().is_empty() {
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
