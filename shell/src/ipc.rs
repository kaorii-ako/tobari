use anyhow::Result;

pub async fn sidecar_status() -> Result<tobari_ipc::SidecarToClient> {
    anyhow::bail!("shell IPC: spawn tobari-core as a child and speak tobari-ipc over stdio (not yet wired)")
}
