use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const HOST_ID: &str = "dev.tobari.core";

#[cfg(target_os = "linux")]
const NATIVE_BROWSERS: &[(&str, &str)] = &[
    ("Google Chrome", ".config/google-chrome"),
    ("Chromium", ".config/chromium"),
    ("Brave", ".config/BraveSoftware/Brave-Browser"),
];

#[cfg(target_os = "macos")]
const NATIVE_BROWSERS: &[(&str, &str)] = &[
    ("Google Chrome", "Library/Application Support/Google/Chrome"),
    ("Chromium", "Library/Application Support/Chromium"),
    (
        "Brave",
        "Library/Application Support/BraveSoftware/Brave-Browser",
    ),
];

#[cfg(target_os = "linux")]
const FLATPAK_BROWSERS: &[(&str, &str, &str)] = &[
    ("Google Chrome", "com.google.Chrome", "google-chrome"),
    ("Chromium", "org.chromium.Chromium", "chromium"),
    (
        "Ungoogled Chromium",
        "io.github.ungoogled_software.ungoogled_chromium",
        "chromium",
    ),
    (
        "Brave",
        "com.brave.Browser",
        "BraveSoftware/Brave-Browser",
    ),
];

#[cfg(not(target_os = "linux"))]
const FLATPAK_BROWSERS: &[(&str, &str, &str)] = &[];

#[derive(Debug, Clone)]
pub struct Target {
    pub label: String,
    pub manifest_path: PathBuf,
    pub host_path: PathBuf,
    pub flatpak: Option<FlatpakTarget>,
}

#[derive(Debug, Clone)]
pub struct FlatpakTarget {
    pub app_id: String,
    pub shim_path: PathBuf,
    pub extension_dir: PathBuf,
    pub can_spawn_host: bool,
}

impl FlatpakTarget {
    pub fn override_command(&self) -> String {
        format!(
            "flatpak override --user --talk-name=org.freedesktop.Flatpak {}",
            self.app_id
        )
    }
}

fn sidecar_path() -> Result<PathBuf> {
    Ok(std::env::current_exe()?.canonicalize()?)
}

fn parse_session_bus_talk(text: &str, name: &str) -> bool {
    let mut in_section = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_section = line == "[Session Bus Policy]";
            continue;
        }
        if !in_section {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            if key.trim() == name && value.trim() == "talk" {
                return true;
            }
        }
    }
    false
}

fn flatpak_can_spawn_host(app_id: &str) -> bool {
    let metadata = std::process::Command::new("flatpak")
        .args(["info", "--show-permissions", app_id])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    if parse_session_bus_talk(&metadata, "org.freedesktop.Flatpak") {
        return true;
    }
    let mut roots = Vec::new();
    if let Some(data) = dirs::data_dir() {
        roots.push(data.join("flatpak/overrides"));
    }
    roots.push(PathBuf::from("/var/lib/flatpak/overrides"));
    for root in roots {
        for name in [app_id, "global"] {
            let path = root.join(name);
            if let Ok(text) = std::fs::read_to_string(&path) {
                if parse_session_bus_talk(&text, "org.freedesktop.Flatpak") {
                    return true;
                }
            }
        }
    }
    false
}

pub fn targets() -> Result<Vec<Target>> {
    let home = dirs::home_dir().context("cannot resolve home dir")?;
    let sidecar = sidecar_path()?;
    let mut found = Vec::new();

    for (label, profile_root) in NATIVE_BROWSERS {
        let root = home.join(profile_root);
        if !root.exists() {
            continue;
        }
        found.push(Target {
            label: (*label).to_string(),
            manifest_path: root
                .join("NativeMessagingHosts")
                .join(format!("{HOST_ID}.json")),
            host_path: sidecar.clone(),
            flatpak: None,
        });
    }

    for (label, app_id, profile_dir) in FLATPAK_BROWSERS {
        let app_root = home.join(".var/app").join(app_id);
        if !app_root.exists() {
            continue;
        }
        let shim_path = app_root.join("data/tobari/tobari-core-host");
        found.push(Target {
            label: format!("{label} (Flatpak)"),
            manifest_path: app_root
                .join("config")
                .join(profile_dir)
                .join("NativeMessagingHosts")
                .join(format!("{HOST_ID}.json")),
            host_path: shim_path.clone(),
            flatpak: Some(FlatpakTarget {
                app_id: (*app_id).to_string(),
                shim_path,
                extension_dir: app_root.join("data/tobari/extension"),
                can_spawn_host: flatpak_can_spawn_host(app_id),
            }),
        });
    }

    Ok(found)
}

fn write_shim(shim_path: &Path, sidecar: &Path) -> Result<()> {
    let parent = shim_path.parent().context("shim has no parent dir")?;
    std::fs::create_dir_all(parent)?;
    let body = format!(
        "#!/bin/sh\nexec /usr/bin/flatpak-spawn --host {} \"$@\"\n",
        shell_quote(&sidecar.display().to_string())
    );
    std::fs::write(shim_path, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(shim_path, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

pub fn manifest_payload_for(host_path: &Path) -> Result<String> {
    let manifest = json!({
        "name": HOST_ID,
        "path": host_path,
        "type": "stdio",
        "allowed_origins": [crate::native_host::EXPECTED_ORIGIN],
    });
    Ok(serde_json::to_string_pretty(&manifest)?)
}

pub fn stage_extension(target: &Target) -> Result<()> {
    let Some(flatpak) = target.flatpak.as_ref() else {
        return Ok(());
    };
    let source = extension_source().context(
        "no built extension found; run `npm run build` in extension/ first",
    )?;
    std::fs::create_dir_all(&flatpak.extension_dir)?;
    for entry in std::fs::read_dir(&source)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            std::fs::copy(entry.path(), flatpak.extension_dir.join(entry.file_name()))?;
        }
    }
    Ok(())
}

fn extension_source() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("TOBARI_EXTENSION_DIST") {
        let path = PathBuf::from(dir);
        if path.join("manifest.json").exists() {
            return Some(path);
        }
    }
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let candidates = [
        exe_dir.join("../share/tobari/extension"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../extension/dist"),
    ];
    candidates
        .into_iter()
        .find(|p| p.join("manifest.json").exists())
        .and_then(|p| p.canonicalize().ok())
}

pub fn install_manifests() -> Result<()> {
    let sidecar = sidecar_path()?;
    let found = targets()?;
    if found.is_empty() {
        anyhow::bail!(
            "no supported browser installation found (looked for Chrome, Chromium, Brave — native and Flatpak); nothing to register"
        );
    }

    let mut blocked = Vec::new();
    for target in &found {
        if let Some(flatpak) = target.flatpak.as_ref() {
            write_shim(&flatpak.shim_path, &sidecar)?;
            if let Err(err) = stage_extension(target) {
                eprintln!("note: {} — extension not staged: {err}", target.label);
            }
            if !flatpak.can_spawn_host {
                blocked.push(flatpak.clone());
            }
        }
        let payload = manifest_payload_for(&target.host_path)?;
        std::fs::create_dir_all(target.manifest_path.parent().unwrap())?;
        std::fs::write(&target.manifest_path, &payload)?;
        println!(
            "registered {} -> {}",
            target.label,
            target.manifest_path.display()
        );
    }

    for flatpak in &blocked {
        eprintln!();
        eprintln!(
            "BLOCKED: {} cannot start the sidecar. A Flatpak browser reaches a host binary only",
            flatpak.app_id
        );
        eprintln!(
            "through flatpak-spawn, which needs the org.freedesktop.Flatpak session-bus name. Run:"
        );
        eprintln!();
        eprintln!("    {}", flatpak.override_command());
        eprintln!();
        eprintln!("then restart the browser. This grants the browser the ability to run host");
        eprintln!("commands as you; it is the same trust you give any native-messaging host.");
    }

    if !blocked.is_empty() {
        anyhow::bail!(
            "{} Flatpak browser(s) registered but cannot spawn the sidecar until the override above is applied",
            blocked.len()
        );
    }
    Ok(())
}

pub fn uninstall_manifests() -> Result<()> {
    let mut removed = 0;
    for target in targets()? {
        if target.manifest_path.exists() {
            std::fs::remove_file(&target.manifest_path)?;
            removed += 1;
        }
        if let Some(flatpak) = target.flatpak {
            if flatpak.shim_path.exists() {
                std::fs::remove_file(&flatpak.shim_path)?;
            }
            if flatpak.extension_dir.exists() {
                std::fs::remove_dir_all(&flatpak.extension_dir)?;
            }
        }
    }
    println!("removed {removed} manifest file(s) and any Flatpak shims");
    Ok(())
}

pub fn report_targets() -> Result<()> {
    let found = targets()?;
    if found.is_empty() {
        println!("browsers: none detected");
        return Ok(());
    }
    for target in &found {
        let registered = if target.manifest_path.exists() {
            "registered"
        } else {
            "not registered"
        };
        match target.flatpak.as_ref() {
            Some(flatpak) if !flatpak.can_spawn_host => println!(
                "browser: {} — {registered}, BLOCKED (run: {})",
                target.label,
                flatpak.override_command()
            ),
            _ => println!("browser: {} — {registered}", target.label),
        }
    }
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
    use super::*;

    #[test]
    fn pinned_extension_origin_matches_the_extension_key() {
        assert_eq!(
            crate::native_host::EXPECTED_ORIGIN,
            "chrome-extension://icoelnobjkgnmgemdeljcnkemjmhomcb/"
        );
    }

    #[test]
    fn manifest_never_contains_a_wildcard_origin() {
        let payload = manifest_payload_for(Path::new("/tmp/tobari-core")).unwrap();
        assert!(payload.contains("chrome-extension://icoelnobjkgnmgemdeljcnkemjmhomcb/"));
        assert!(!payload.contains('*'));
    }

    #[test]
    fn session_bus_talk_is_parsed_only_inside_its_section() {
        let granted = "[Context]\nshared=ipc;\n\n[Session Bus Policy]\norg.freedesktop.Flatpak=talk\n";
        let elsewhere = "[System Bus Policy]\norg.freedesktop.Flatpak=talk\n";
        let denied = "[Session Bus Policy]\norg.freedesktop.Notifications=talk\n";
        assert!(parse_session_bus_talk(granted, "org.freedesktop.Flatpak"));
        assert!(!parse_session_bus_talk(elsewhere, "org.freedesktop.Flatpak"));
        assert!(!parse_session_bus_talk(denied, "org.freedesktop.Flatpak"));
    }

    #[test]
    fn shim_quotes_paths_containing_spaces_and_quotes() {
        assert_eq!(shell_quote("/a b/c"), "'/a b/c'");
        assert_eq!(shell_quote("/a'b"), r"'/a'\''b'");
    }
}
