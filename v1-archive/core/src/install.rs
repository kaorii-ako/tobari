use std::fs;
use std::os::unix::fs::PermissionsExt;

fn host_binary_path() -> anyhow::Result<std::path::PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe
        .parent()
        .ok_or_else(|| anyhow::anyhow!("no parent dir for exe"))?;
    Ok(dir.join("tobari-core"))
}

pub fn install(ext_id: &str) -> anyhow::Result<()> {
    let targets = crate::paths::native_manifest_dirs();
    if targets.is_empty() {
        anyhow::bail!("no supported browser config dir found (chrome, chromium, brave)");
    }
    let host_path = host_binary_path()?;
    for t in &targets {
        fs::create_dir_all(&t.dir)?;
        let template = crate::host::manifest_json(&host_path.to_string_lossy());
        let body = template.replace("__TOBARI_EXT_ID__", ext_id);
        let dest = t.dir.join("dev.tobari.core.json");
        fs::write(&dest, body)?;
        #[cfg(unix)]
        {
            let mut perms = fs::metadata(&dest)?.permissions();
            perms.set_mode(0o644);
            fs::set_permissions(&dest, perms)?;
        }
        println!("installed {} for {}", dest.display(), t.name);
    }
    Ok(())
}

pub fn uninstall() -> anyhow::Result<()> {
    let targets = crate::paths::native_manifest_dirs();
    let mut removed = 0;
    for t in &targets {
        let dest = t.dir.join("dev.tobari.core.json");
        if dest.is_file() {
            fs::remove_file(&dest)?;
            println!("removed {}", dest.display());
            removed += 1;
        }
    }
    if removed == 0 {
        println!("nothing to remove");
    }
    Ok(())
}
