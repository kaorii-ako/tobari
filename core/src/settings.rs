use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub idle_unload_secs: u64,
    pub tab_discard_minutes: u32,
    pub second_check: bool,
    pub auto_approve_hosts: Vec<String>,
    pub adblock: bool,
    pub crash_reports_ask: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            idle_unload_secs: 300,
            tab_discard_minutes: 30,
            second_check: true,
            auto_approve_hosts: vec![],
            adblock: true,
            crash_reports_ask: true,
        }
    }
}

impl Settings {
    pub fn load() -> Self {
        std::fs::read_to_string(crate::paths::settings_path())
            .ok()
            .and_then(|t| toml::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let p = crate::paths::settings_path();
        std::fs::create_dir_all(p.parent().unwrap())?;
        std::fs::write(p, toml::to_string_pretty(self)?)?;
        Ok(())
    }
}
