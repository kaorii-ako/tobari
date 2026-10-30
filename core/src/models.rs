use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelEntry {
    pub id: String,
    #[serde(default)]
    pub about: String,
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
    models: Vec<ModelEntry>,
}

const BUNDLED: &str = include_str!("../models.toml");

pub fn load_manifest() -> anyhow::Result<Vec<ModelEntry>> {
    let user = crate::paths::models_dir().join("models.toml");
    let text = match std::fs::read_to_string(&user) {
        Ok(t) => t,
        Err(_) => BUNDLED.to_owned(),
    };
    let parsed: ManifestFile = toml::from_str(&text)?;
    Ok(parsed.models)
}

pub fn default_model(models: &[ModelEntry]) -> anyhow::Result<&ModelEntry> {
    models
        .iter()
        .find(|m| m.default)
        .or_else(|| models.first())
        .ok_or_else(|| anyhow::anyhow!("models.toml contains no models"))
}

pub fn selected_model(models: &[ModelEntry]) -> anyhow::Result<&ModelEntry> {
    let picked = std::fs::read_to_string(crate::paths::selection_path()).unwrap_or_default();
    match models.iter().find(|m| m.id == picked.trim()) {
        Some(m) => Ok(m),
        None => default_model(models),
    }
}

pub fn save_selection(id: &str) -> anyhow::Result<()> {
    let models = load_manifest()?;
    if !models.iter().any(|m| m.id == id) {
        anyhow::bail!("unknown model id {id}");
    }
    let path = crate::paths::selection_path();
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(path, id)?;
    Ok(())
}

pub fn model_file_path(m: &ModelEntry) -> PathBuf {
    crate::paths::models_dir().join(&m.file)
}

pub fn download_url(m: &ModelEntry) -> String {
    format!("https://huggingface.co/{}/resolve/main/{}", m.repo, m.file)
}

pub fn delete(id: &str) -> anyhow::Result<()> {
    let models = load_manifest()?;
    let m = models
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| anyhow::anyhow!("unknown model id {id}"))?;
    let p = model_file_path(m);
    if p.is_file() {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub about: String,
    pub size_mb: u64,
    pub license: String,
    pub downloaded: bool,
    pub active: bool,
}

pub fn infos() -> anyhow::Result<Vec<ModelInfo>> {
    let models = load_manifest()?;
    let active = selected_model(&models)?.id.clone();
    Ok(models
        .iter()
        .map(|m| ModelInfo {
            id: m.id.clone(),
            about: m.about.clone(),
            size_mb: m.size_mb,
            license: m.license.clone(),
            downloaded: model_file_path(m).is_file(),
            active: m.id == active,
        })
        .collect())
}

impl ModelEntry {
    pub fn sha256_pinned(&self) -> bool {
        let s = self.sha256.trim();
        s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn bundled_manifest_has_pinned_default() {
        let parsed: super::ManifestFile = toml::from_str(super::BUNDLED).unwrap();
        let d = super::default_model(&parsed.models).unwrap();
        assert!(d.id.starts_with("qwen3-4b-instruct"));
        assert!(parsed.models.iter().all(|m| m.sha256_pinned()));
    }
}
