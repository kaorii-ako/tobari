use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::path::PathBuf;

pub fn paths() -> Result<Paths> {
    let config = dirs::config_dir().context("cannot resolve config dir")?;
    let data = dirs::data_dir().context("cannot resolve data dir")?;
    let cache = dirs::cache_dir().context("cannot resolve cache dir")?;
    let state = dirs::state_dir().unwrap_or_else(|| data.join("state"));
    Ok(Paths {
        config: config.join("tobari"),
        models: data.join("tobari/models"),
        cache: cache.join("tobari/models"),
        logs: state.join("tobari/logs"),
    })
}

#[derive(Debug, Clone)]
pub struct Paths {
    pub config: PathBuf,
    pub models: PathBuf,
    pub cache: PathBuf,
    pub logs: PathBuf,
}

impl Paths {
    pub fn ensure(&self) -> Result<()> {
        for dir in [&self.config, &self.models, &self.cache, &self.logs] {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("cannot create {}", dir.display()))?;
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub struct Catalog {
    pub llama_cpp_tag: String,
    pub llama_cpp_repo: String,
    #[serde(default)]
    pub models: Vec<CatalogModel>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CatalogModel {
    pub id: String,
    #[serde(rename = "display_name")]
    pub display_name: String,
    pub tier: String,
    pub license: String,
    pub context_size: u32,
    #[serde(default)]
    pub min_vram_gb: Option<f64>,
    pub hf_repo: String,
    pub hf_file: String,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    pub sha256: String,
}

pub fn resolve_catalog_path(paths: &Paths) -> Result<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from));
    let candidates = [
        std::env::var("TOBARI_CATALOG").ok().map(PathBuf::from),
        exe_dir.as_ref().map(|d| d.join("models.toml")),
        Some(paths.config.join("models.toml")),
    ];
    for candidate in candidates.iter().flatten() {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }
    let dev_fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../models.toml");
    if dev_fallback.exists() {
        return Ok(dev_fallback);
    }
    anyhow::bail!(
        "no models.toml found (checked TOBARI_CATALOG, sidecar dir, {}); copy core/models.toml there or set TOBARI_CATALOG",
        paths.config.join("models.toml").display()
    )
}

impl Catalog {
    pub fn load(path: &std::path::Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("cannot read manifest at {}", path.display()))?;
        let catalog: Catalog = toml::from_str(&raw).context("cannot parse models.toml")?;
        if catalog.models.is_empty() {
            bail!("models.toml contains no models");
        }
        Ok(catalog)
    }

    pub fn default_model(&self) -> Result<&CatalogModel> {
        for model in &self.models {
            if model.tier == "default" {
                return Ok(model);
            }
        }
        self.models
            .first()
            .context("models.toml has no default-tier model")
    }

    pub fn by_id(&self, id: &str) -> Option<&CatalogModel> {
        self.models.iter().find(|m| m.id == id)
    }
}

