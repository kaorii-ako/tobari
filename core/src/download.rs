use anyhow::Context;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::Path;

use crate::models::ModelEntry;

pub fn fresh_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn sha256_file(path: &Path) -> anyhow::Result<String> {
    let mut file = std::fs::File::open(path)
        .with_context(|| format!("open {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1 << 20];
    loop {
        use std::io::Read;
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub async fn download_verified(m: &ModelEntry) -> anyhow::Result<()> {
    if m.sha256.trim().is_empty() {
        anyhow::bail!(
            "refusing to download {}: no sha256 pinned in models.toml",
            m.id
        );
    }
    let dest = crate::models::model_file_path(m);
    if dest.is_file() {
        let actual = sha256_file(&dest)?;
        if actual.eq_ignore_ascii_case(m.sha256.trim()) {
            println!("model already present and verified: {}", dest.display());
            return Ok(());
        }
        anyhow::bail!(
            "checksum mismatch on existing file {}: refusing to load",
            dest.display()
        );
    }
    std::fs::create_dir_all(dest.parent().unwrap())?;
    let url = crate::models::download_url(m);
    println!("downloading {} from {}", m.id, url);
    let mut resp = reqwest::get(&url)
        .await
        .with_context(|| format!("GET {}", url))?;
    if !resp.status().is_success() {
        anyhow::bail!("download failed: HTTP {}", resp.status());
    }
    let total = resp.content_length().unwrap_or(0);
    let tmp = dest.with_extension("part");
    let mut out = std::fs::File::create(&tmp)?;
    let mut hasher = Sha256::new();
    let mut done: u64 = 0;
    loop {
        match resp.chunk().await? {
            None => break,
            Some(chunk) => {
                hasher.update(&chunk);
                out.write_all(&chunk)?;
                done += chunk.len() as u64;
                if total > 0 {
                    eprint!("\r  {}/{} MB", done / 1_048_576, total / 1_048_576);
                } else {
                    eprint!("\r  {} MB", done / 1_048_576);
                }
            }
        }
    }
    eprintln!();
    out.flush()?;
    drop(out);
    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(m.sha256.trim()) {
        let _ = std::fs::remove_file(&tmp);
        anyhow::bail!("checksum mismatch after download: refusing to keep file");
    }
    std::fs::rename(&tmp, &dest)?;
    println!("verified: {}", dest.display());
    Ok(())
}

