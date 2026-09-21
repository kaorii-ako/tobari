use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::PathBuf;

pub const HOST_ID: &str = "dev.tobari.core";

#[cfg(target_os = "linux")]
const MANIFEST_DIRS: &[&str] = &[
    ".config/google-chrome/NativeMessagingHosts",
    ".config/chromium/NativeMessagingHosts",
    ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
];

#[cfg(target_os = "macos")]
const MANIFEST_DIRS: &[&str] = &[
    "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    "Library/Application Support/Chromium/NativeMessagingHosts",
    "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
];

pub fn manifest_payload() -> Result<String> {
    let exe = std::env::current_exe()?.canonicalize()?;
    let manifest = json!({
        "name": HOST_ID,
        "path": exe,
        "type": "stdio",
        "allowed_origins": [crate::native_host::EXPECTED_ORIGIN],
    });
    Ok(serde_json::to_string_pretty(&manifest)?)
}

pub fn install_manifests() -> Result<()> {
    let home = dirs::home_dir().context("cannot resolve home dir")?;
    let payload = manifest_payload()?;
    let mut installed = 0;
    for dir in MANIFEST_DIRS {
        let browser_root = home.join(dir.split("/NativeMessagingHosts").next().unwrap());
        if !browser_root.exists() {
            continue;
        }
        let target = home.join(dir).join(format!("{HOST_ID}.json"));
        std::fs::create_dir_all(target.parent().unwrap())?;
        std::fs::write(&target, &payload)?;
        installed += 1;
    }
    if installed == 0 {
        anyhow::bail!("no supported browser installation found; nothing to register");
    }
    println!("installed native messaging manifest into {installed} browser(s)");
    Ok(())
}

pub fn uninstall_manifests() -> Result<()> {
    let home = dirs::home_dir().context("cannot resolve home dir")?;
    let mut removed = 0;
    for dir in MANIFEST_DIRS {
        let target = home.join(dir).join(format!("{HOST_ID}.json"));
        if target.exists() {
            std::fs::remove_file(&target)?;
            removed += 1;
        }
    }
    println!("removed {removed} manifest file(s)");
    Ok(())
}

pub fn llama_server_path() -> Result<PathBuf> {
    if let Ok(path) = std::env::var("TOBARI_LLAMA_SERVER") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
        anyhow::bail!("TOBARI_LLAMA_SERVER points at a missing file: {path:?}");
    }
    if let Some(path) = std::env::current_exe()?.parent().map(|d| d.join("llama-server")) {
        if path.exists() {
            return Ok(path);
        }
    }
    let path = dirs::data_dir()
        .context("cannot resolve data dir")?
        .join("tobari/bin/llama-server");
    if path.exists() {
        return Ok(path);
    }
    anyhow::bail!(
        "llama-server not found: set TOBARI_LLAMA_SERVER, place it next to tobari-core, or install to {}",
        path.display()
    )
}

pub fn status_json(state_name: &str, error: Option<&str>, extra: Value) -> Value {
    let info = crate::gpu::detect();
    let warning = if info.backend == crate::gpu::Backend::Cpu {
        Some(crate::gpu::cpu_fallback_reason())
    } else {
        None
    };
    let mut object = json!({
        "type": "status",
        "state": state_name,
        "backend": info.backend.as_str(),
        "vram_gb": info.vram_gb,
        "device_name": info.device_name,
        "error": error,
        "warning": warning,
    });
    if let (Some(base), Some(extra_map)) = (object.as_object_mut(), extra.as_object()) {
        for (key, value) in extra_map {
            base.insert(key.clone(), value.clone());
        }
    }
    object
}

#[cfg(test)]
mod tests {
    #[test]
    fn pinned_extension_origin_matches_the_extension_key() {
        assert_eq!(
            crate::native_host::EXPECTED_ORIGIN,
            "chrome-extension://82e4bde19a6dc64c34b92da4c9c7ec21/"
        );
    }
}

