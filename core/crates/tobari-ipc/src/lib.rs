use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientToSidecar {
    GetStatus,
    GetCatalog,
    DownloadModel { id: String },
    #[serde(rename = "chat")]
    Chat {
        req_id: String,
        mode: String,
        #[serde(default)]
        prompt: String,
        #[serde(default)]
        page: Option<PageContext>,
        #[serde(default)]
        selection: Option<String>,
        #[serde(default)]
        target_lang: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageContext {
    pub origin: String,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarToClient {
    Status {
        state: String,
        backend: Option<String>,
        model_id: Option<String>,
        model_label: Option<String>,
        verified: Option<String>,
        vram_gb: Option<f64>,
        gpu_layers: Option<u32>,
        total_layers: Option<u32>,
        error: Option<String>,
    },
    Catalog {
        models: Vec<CatalogEntry>,
    },
    DownloadProgress {
        id: String,
        downloaded_bytes: u64,
        total_bytes: u64,
        done: Option<bool>,
        error: Option<String>,
    },
    StreamDelta {
        req_id: String,
        delta: String,
    },
    Done {
        req_id: String,
    },
    Error {
        req_id: Option<String>,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogEntry {
    pub id: String,
    pub display_name: String,
    pub tier: String,
    pub license: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub min_vram_gb: Option<f64>,
    pub recommended: Option<bool>,
}
