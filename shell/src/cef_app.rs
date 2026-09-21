use anyhow::Result;

pub async fn run() -> Result<()> {
    anyhow::bail!(
        "cef-ui requested but CEF binaries are not provisioned yet; see shell/CEF_PIN and docs/PACKAGING.md"
    )
}
