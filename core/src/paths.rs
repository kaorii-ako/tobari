use std::path::{Path, PathBuf};

pub fn home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/root"))
}

fn xdg(var: &str, fallback: &str) -> PathBuf {
    std::env::var(var)
        .ok()
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(fallback))
}

pub fn config_dir() -> PathBuf {
    xdg("XDG_CONFIG_HOME", ".config").join("tobari")
}

pub fn data_dir() -> PathBuf {
    xdg("XDG_DATA_HOME", ".local/share").join("tobari")
}

pub fn state_dir() -> PathBuf {
    xdg("XDG_STATE_HOME", ".local/state").join("tobari")
}

pub fn runtime_dir() -> PathBuf {
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d).join("tobari"),
        _ => std::env::temp_dir().join(format!("tobari-{}", unsafe { libc::getuid() })),
    }
}

pub fn skills_dir() -> PathBuf {
    config_dir().join("skills")
}

pub fn memory_dir() -> PathBuf {
    data_dir().join("memory")
}

pub fn models_dir() -> PathBuf {
    data_dir().join("models")
}

pub fn llama_dir() -> PathBuf {
    data_dir().join("llama")
}

pub fn crash_dir() -> PathBuf {
    state_dir().join("crashes")
}

pub fn providers_path() -> PathBuf {
    config_dir().join("providers.toml")
}

pub fn settings_path() -> PathBuf {
    config_dir().join("settings.toml")
}

pub fn selection_path() -> PathBuf {
    config_dir().join("model")
}

pub fn control_socket() -> PathBuf {
    runtime_dir().join("control.sock")
}

pub fn ensure_private_dir(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
}

pub fn llama_bin() -> PathBuf {
    if let Ok(p) = std::env::var("TOBARI_LLAMA_SERVER") {
        return PathBuf::from(p);
    }
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("tobari"));
    let beside = exe
        .parent()
        .map(|d| d.join("llama-server"))
        .unwrap_or_else(|| PathBuf::from("llama-server"));
    if beside.is_file() {
        return beside;
    }
    find_file(&llama_dir(), "llama-server", 3).unwrap_or(beside)
}

fn find_file(dir: &Path, name: &str, depth: u32) -> Option<PathBuf> {
    let entries: Vec<_> = std::fs::read_dir(dir).ok()?.flatten().collect();
    if let Some(e) = entries
        .iter()
        .find(|e| e.file_name() == name && e.path().is_file())
    {
        return Some(e.path());
    }
    if depth == 0 {
        return None;
    }
    entries
        .iter()
        .filter(|e| e.path().is_dir())
        .find_map(|e| find_file(&e.path(), name, depth - 1))
}

pub struct BrowserTarget {
    pub name: &'static str,
    pub dir: PathBuf,
}

pub fn native_manifest_dirs() -> Vec<BrowserTarget> {
    let cfg = xdg("XDG_CONFIG_HOME", ".config");
    let var = home().join(".var/app");
    let candidates: [(&str, PathBuf); 8] = [
        ("tobari", cfg.join("tobari/browser")),
        ("chrome", cfg.join("google-chrome")),
        ("chromium", cfg.join("chromium")),
        ("brave", cfg.join("BraveSoftware/Brave-Browser")),
        ("edge", cfg.join("microsoft-edge")),
        (
            "chrome-flatpak",
            var.join("com.google.Chrome/config/google-chrome"),
        ),
        (
            "chromium-flatpak",
            var.join("org.chromium.Chromium/config/chromium"),
        ),
        (
            "brave-flatpak",
            var.join("com.brave.Browser/config/BraveSoftware/Brave-Browser"),
        ),
    ];
    candidates
        .into_iter()
        .filter(|(name, dir)| *name == "tobari" || dir.is_dir())
        .map(|(name, dir)| BrowserTarget {
            name,
            dir: dir.join("NativeMessagingHosts"),
        })
        .collect()
}
