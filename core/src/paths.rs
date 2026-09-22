use std::path::PathBuf;

fn home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/root"))
}

fn xdg(var: &str, fallback: &str) -> PathBuf {
    std::env::var(var)
        .map(PathBuf::from)
        .unwrap_or_else(|_| home().join(fallback))
}

#[cfg(target_os = "macos")]
pub fn config_dir() -> PathBuf {
    home().join("Library/Application Support/Tobari")
}

#[cfg(not(target_os = "macos"))]
pub fn config_dir() -> PathBuf {
    xdg("XDG_CONFIG_HOME", ".config").join("tobari")
}

#[cfg(target_os = "macos")]
pub fn models_dir() -> PathBuf {
    home().join("Library/Application Support/Tobari/models")
}

#[cfg(not(target_os = "macos"))]
pub fn models_dir() -> PathBuf {
    xdg("XDG_DATA_HOME", ".local/share").join("tobari/models")
}

#[cfg(target_os = "macos")]
pub fn cache_dir() -> PathBuf {
    home().join("Library/Caches/dev.tobari.browser")
}

#[cfg(not(target_os = "macos"))]
pub fn cache_dir() -> PathBuf {
    xdg("XDG_CACHE_HOME", ".cache").join("tobari")
}

#[cfg(target_os = "macos")]
pub fn log_dir() -> PathBuf {
    home().join("Library/Logs/Tobari")
}

#[cfg(not(target_os = "macos"))]
pub fn log_dir() -> PathBuf {
    xdg("XDG_STATE_HOME", ".local/state").join("tobari/logs")
}

pub fn manifest_path() -> PathBuf {
    models_dir().join("models.toml")
}

pub fn llama_bin() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("tobari-core"));
    exe.parent()
        .map(|d| d.join("llama-server"))
        .unwrap_or_else(|| PathBuf::from("llama-server"))
}

pub struct BrowserTarget {
    pub name: &'static str,
    pub dir: PathBuf,
}

pub fn native_manifest_dirs() -> Vec<BrowserTarget> {
    #[cfg(target_os = "macos")]
    let base = home().join("Library/Application Support");
    #[cfg(not(target_os = "macos"))]
    let base = home().join(".config");
    let candidates = [
        ("chrome", "google-chrome", "Google/Chrome"),
        ("chromium", "chromium", "Chromium"),
        ("brave", "BraveSoftware/Brave-Browser", "BraveSoftware/Brave-Browser"),
    ];
    let mut out = Vec::new();
    for (name, linux_rel, mac_rel) in candidates {
        #[cfg(target_os = "macos")]
        let dir = base.join(mac_rel);
        #[cfg(not(target_os = "macos"))]
        let dir = base.join(linux_rel);
        if dir.is_dir() {
            out.push(BrowserTarget {
                name,
                dir: dir.join("NativeMessagingHosts"),
            });
        }
    }
    out
}
