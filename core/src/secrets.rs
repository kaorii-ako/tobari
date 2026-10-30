use std::io::Write;
use std::process::{Command, Stdio};

const SERVICE: &str = "tobari";

fn env_override(provider: &str) -> Option<String> {
    let var = format!(
        "TOBARI_KEY_{}",
        provider
            .to_uppercase()
            .replace(|c: char| !c.is_ascii_alphanumeric(), "_")
    );
    std::env::var(var).ok().filter(|v| !v.is_empty())
}

pub fn lookup(provider: &str) -> anyhow::Result<Option<String>> {
    if let Some(v) = env_override(provider) {
        return Ok(Some(v));
    }
    let out = match Command::new("secret-tool")
        .args(["lookup", "service", SERVICE, "provider", provider])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            anyhow::bail!("secret-tool not found: install libsecret tools to store API keys")
        }
        Err(e) => return Err(e.into()),
    };
    let key = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    Ok(if out.status.success() && !key.is_empty() {
        Some(key)
    } else {
        None
    })
}

pub fn store(provider: &str, key: &str) -> anyhow::Result<()> {
    let mut child = Command::new("secret-tool")
        .args([
            "store",
            "--label",
            &format!("Tobari API key: {provider}"),
            "service",
            SERVICE,
            "provider",
            provider,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("cannot run secret-tool: {e}"))?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(key.trim().as_bytes())?;
    let out = child.wait_with_output()?;
    if !out.status.success() {
        anyhow::bail!(
            "secret-tool store failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

pub fn clear(provider: &str) -> anyhow::Result<()> {
    Command::new("secret-tool")
        .args(["clear", "service", SERVICE, "provider", provider])
        .status()?;
    Ok(())
}
