use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

pub const HOST_ID: &str = "dev.tobari.core";

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum HostRequest {
    #[serde(rename = "status")]
    Status,
    #[serde(rename = "chat")]
    Chat {
        messages: Vec<ChatMessage>,
        #[serde(default)]
        stream: bool,
    },
    #[serde(rename = "models")]
    Models,
    #[serde(rename = "set_model")]
    SetModel { id: String },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum HostResponse {
    #[serde(rename = "status")]
    Status {
        backend: String,
        model: String,
        port: u16,
        healthy: bool,
    },
    #[serde(rename = "chunk")]
    Chunk { content: String, done: bool },
    #[serde(rename = "models")]
    Models { models: Vec<ModelInfo> },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Debug, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub downloaded: bool,
    pub active: bool,
}

pub fn read_message() -> anyhow::Result<Option<HostRequest>> {
    let mut len_buf = [0u8; 4];
    let mut stdin = std::io::stdin();
    match stdin.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_ne_bytes(len_buf) as usize;
    if len == 0 || len > 8 * 1024 * 1024 {
        anyhow::bail!("native message length out of range: {len}");
    }
    let mut buf = vec![0u8; len];
    stdin.read_exact(&mut buf)?;
    let req: HostRequest = serde_json::from_slice(&buf)?;
    Ok(Some(req))
}

pub fn write_message(resp: &HostResponse) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(resp)?;
    let len = bytes.len() as u32;
    let mut stdout = std::io::stdout();
    stdout.write_all(&len.to_ne_bytes())?;
    stdout.write_all(&bytes)?;
    stdout.flush()?;
    Ok(())
}

pub fn manifest_json(host_path: &str) -> String {
    format!(
        concat!(
            "{{\n",
            "  \"name\": \"dev.tobari.core\",\n",
            "  \"description\": \"Tobari local AI core\",\n",
            "  \"path\": \"{path}\",\n",
            "  \"type\": \"stdio\",\n",
            "  \"allowed_origins\": [\"chrome-extension://__TOBARI_EXT_ID__/\" ]\n",
            "}}\n"
        ),
        path = host_path.replace('\\', "\\\\").replace('"', "\\\"")
    )
}
