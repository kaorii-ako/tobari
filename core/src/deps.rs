use anyhow::Context;
use sha2::{Digest, Sha256};
use std::io::Write;

const RELEASES: &str = "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10";

/// Human-readable names of what is missing before `serve` can run.
pub fn missing() -> Vec<String> {
    let mut out = Vec::new();
    if !crate::paths::llama_bin().is_file() {
        out.push("llama-server".to_owned());
    }
    if let Ok((_, manifest)) = crate::models::load_manifest() {
        if let Ok(m) = crate::models::selected_model(&manifest) {
            if !crate::models::model_file_path(m).is_file() {
                out.push(format!("model {} (~{} MB)", m.id, m.size_mb));
            }
        }
    }
    out
}

/// CLI flow: pick a model, list what is missing, ask, install.
/// `model` skips the menu; `assume_yes` skips both questions.
pub fn setup_interactive(model: Option<String>, assume_yes: bool) -> anyhow::Result<()> {
    let model = match model {
        Some(id) => Some(id),
        None if assume_yes => None,
        None => Some(pick_model()?),
    };
    if let Some(id) = &model {
        crate::models::save_selection(id)?;
    }
    let need = missing();
    if need.is_empty() {
        println!("all dependencies present");
        return Ok(());
    }
    eprintln!("Tobari needs:");
    for n in &need {
        eprintln!("  - {n}");
    }
    if !assume_yes {
        print!("Download and install now? [Y/n] ");
        std::io::stdout().flush()?;
        let mut answer = String::new();
        std::io::stdin().read_line(&mut answer)?;
        if answer.trim().to_lowercase().starts_with('n') {
            eprintln!("skipped");
            return Ok(());
        }
    }
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(install_missing(model.as_deref()))
}

/// Installs llama-server if needed and downloads `model` (or the current
/// selection), remembering it as the model `serve` loads.
pub async fn install_missing(model: Option<&str>) -> anyhow::Result<()> {
    let (_, manifest) = crate::models::load_manifest()?;
    let m = match model {
        Some(id) => manifest
            .iter()
            .find(|m| m.id == id)
            .ok_or_else(|| anyhow::anyhow!("unknown model id {id}"))?,
        None => crate::models::selected_model(&manifest)?,
    };
    if !crate::paths::llama_bin().is_file() {
        install_llama().await?;
    }
    crate::download::download_verified(m).await?;
    crate::models::save_selection(&m.id)
}

/// Numbered model menu on the terminal; Enter keeps the current pick.
fn pick_model() -> anyhow::Result<String> {
    let (_, manifest) = crate::models::load_manifest()?;
    let current = crate::models::selected_model(&manifest)?.id.clone();
    eprintln!("Choose a model:");
    for (i, m) in manifest.iter().enumerate() {
        let mark = if m.id == current { "*" } else { " " };
        let have = if crate::models::model_file_path(m).is_file() {
            ", downloaded"
        } else {
            ""
        };
        eprintln!(
            "{mark} {}) {}  ~{} MB, {}{have}  {}",
            i + 1,
            m.id,
            m.size_mb,
            m.license,
            m.about
        );
    }
    loop {
        print!("Model [Enter = {current}]: ");
        std::io::stdout().flush()?;
        let mut answer = String::new();
        if std::io::stdin().read_line(&mut answer)? == 0 {
            return Ok(current);
        }
        let answer = answer.trim();
        if answer.is_empty() {
            return Ok(current);
        }
        if let Some(m) = answer
            .parse::<usize>()
            .ok()
            .and_then(|n| manifest.get(n.wrapping_sub(1)))
            .or_else(|| manifest.iter().find(|m| m.id == answer))
        {
            return Ok(m.id.clone());
        }
        eprintln!("not a choice: {answer}");
    }
}

fn asset_suffix() -> anyhow::Result<String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => anyhow::bail!("no prebuilt llama-server for {other}"),
    };
    if cfg!(target_os = "macos") {
        return Ok(format!("bin-macos-{arch}.tar.gz"));
    }
    // ponytail: CUDA prebuilts need a matching cudart; Vulkan runs on NVIDIA too.
    let flavor = if crate::backend::detect() == crate::backend::Backend::Cpu {
        ""
    } else {
        "vulkan-"
    };
    Ok(format!("bin-ubuntu-{flavor}{arch}.tar.gz"))
}

async fn install_llama() -> anyhow::Result<()> {
    let suffix = asset_suffix()?;
    let client = reqwest::Client::builder()
        .user_agent("tobari-core")
        .build()?;
    let releases: serde_json::Value = client.get(RELEASES).send().await?.json().await?;
    let asset = releases
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|r| r["assets"].as_array().into_iter().flatten())
        .find(|a| {
            let name = a["name"].as_str().unwrap_or("");
            name.starts_with("llama-") && name.ends_with(&suffix)
        })
        .ok_or_else(|| anyhow::anyhow!("no llama.cpp release asset matching {suffix}"))?;
    let name = asset["name"].as_str().unwrap_or_default();
    let url = asset["browser_download_url"].as_str().unwrap_or_default();
    let want = asset["digest"]
        .as_str()
        .and_then(|d| d.strip_prefix("sha256:"))
        .ok_or_else(|| anyhow::anyhow!("release asset {name} has no sha256 digest: refusing"))?;

    eprintln!("downloading {name}");
    let bytes = client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    if !hex::encode(Sha256::digest(&bytes)).eq_ignore_ascii_case(want) {
        anyhow::bail!("checksum mismatch on {name}: refusing to install");
    }

    let dir = crate::paths::llama_dir();
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    let tarball = dir.join(name);
    std::fs::write(&tarball, &bytes)?;
    let ok = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(&tarball)
        .arg("-C")
        .arg(&dir)
        .status()
        .context("run tar")?
        .success();
    let _ = std::fs::remove_file(&tarball);
    if !ok || !crate::paths::llama_bin().is_file() {
        anyhow::bail!("extracted {name} but llama-server was not found inside");
    }
    eprintln!("installed {}", crate::paths::llama_bin().display());
    Ok(())
}
