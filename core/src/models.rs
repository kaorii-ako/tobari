use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    pub repo: String,
    pub file: String,
    pub sha256: String,
    pub license: String,
    pub size_mb: u64,
    pub ctx_default: u32,
    #[serde(default)]
    pub default: bool,
}

#[derive(Debug, Deserialize)]
struct ManifestFile {
    #[serde(rename = "models")]
    models: Vec<ModelEntry>,
}

pub fn load_manifest() -> anyhow::Result<(PathBuf, Vec<ModelEntry>)> {
    let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models.toml");
    let user = crate::paths::manifest_path();
    let path = if user.is_file() { user } else { bundled };
    let text = std::fs::read_to_string(&path)?;
    let parsed: ManifestFile = toml::from_str(&text)?;
    Ok((path, parsed.models))
}

pub fn default_model(models: &[ModelEntry]) -> anyhow::Result<&ModelEntry> {
    models
        .iter()
        .find(|m| m.default)
        .or_else(|| models.first())
        .ok_or_else(|| anyhow::anyhow!("models.toml contains no models"))
}

pub fn model_file_path(m: &ModelEntry) -> PathBuf {
    crate::paths::models_dir().join(&m.file)
}

pub fn download_url(m: &ModelEntry) -> String {
    format!(
        "https://huggingface.co/{}/resolve/main/{}",
        m.repo, m.file
    )
}
