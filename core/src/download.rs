use anyhow::Context;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::Path;

use crate::models::ModelEntry;

pub fn fresh_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn sha256_file(path: &Path) -> anyhow::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn verify(m: &ModelEntry) -> anyhow::Result<()> {
    if !m.sha256_pinned() {
        anyhow::bail!("refusing to load {}: no sha256 pinned", m.id);
    }
    let actual = sha256_file(&crate::models::model_file_path(m))?;
    if !actual.eq_ignore_ascii_case(m.sha256.trim()) {
        anyhow::bail!("checksum mismatch on {}: refusing to load", m.id);
    }
    Ok(())
}

pub async fn download_verified(
    m: &ModelEntry,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> anyhow::Result<()> {
    if !m.sha256_pinned() {
        anyhow::bail!("refusing to download {}: no sha256 pinned", m.id);
    }
    let dest = crate::models::model_file_path(m);
    if dest.is_file() {
        return verify(m);
    }
    std::fs::create_dir_all(dest.parent().unwrap())?;
    let url = crate::models::download_url(m);
    let mut resp = reqwest::get(&url)
        .await
        .with_context(|| format!("GET {url}"))?;
    if !resp.status().is_success() {
        anyhow::bail!("download failed: HTTP {}", resp.status());
    }
    let total = resp.content_length().unwrap_or(0);
    let tmp = dest.with_extension("part");
    let mut out = std::fs::File::create(&tmp)?;
    let mut hasher = Sha256::new();
    let mut done: u64 = 0;
    while let Some(chunk) = resp.chunk().await? {
        hasher.update(&chunk);
        out.write_all(&chunk)?;
        done += chunk.len() as u64;
        progress(done, total);
    }
    out.flush()?;
    drop(out);
    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(m.sha256.trim()) {
        let _ = std::fs::remove_file(&tmp);
        anyhow::bail!("checksum mismatch after download: refusing to keep file");
    }
    std::fs::rename(&tmp, &dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn tokens_are_unique_and_long() {
        let a = super::fresh_token();
        let b = super::fresh_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }
}
