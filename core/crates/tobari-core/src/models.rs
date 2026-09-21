use crate::config::{CatalogModel, Paths};
use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub fn verify_sha256(path: &Path, expected: &str) -> Result<()> {
    let mut file =
        std::fs::File::open(path).with_context(|| format!("cannot open {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let got = hex::encode(hasher.finalize());
    if !got.eq_ignore_ascii_case(expected) {
        std::fs::remove_file(path).ok();
        bail!(
            "SHA-256 mismatch for {}: expected {expected}, got {got} — refusing to load",
            path.display()
        );
    }
    Ok(())
}

pub fn model_path(paths: &Paths, model: &CatalogModel) -> PathBuf {
    paths.models.join(&model.hf_file)
}

pub async fn ensure_downloaded(
    paths: &Paths,
    model: &CatalogModel,
    progress: impl Fn(u64, u64) + Send + 'static,
) -> Result<PathBuf> {
    let dest = model_path(paths, model);
    if dest.exists() {
        verify_sha256(&dest, &model.sha256)?;
        return Ok(dest);
    }
    download(paths, model, progress).await
}

async fn download(
    paths: &Paths,
    model: &CatalogModel,
    progress: impl Fn(u64, u64) + Send + 'static,
) -> Result<PathBuf> {
    if model.sha256.is_empty() {
        bail!("model {} has no pinned SHA-256; refusing to download", model.id);
    }
    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        model.hf_repo, model.hf_file
    );
    let tmp = paths.models.join(format!(
        "{}.part.{}",
        model.hf_file,
        std::process::id()
    ));
    if tmp.exists() {
        std::fs::remove_file(&tmp).ok();
    }
    let response = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .context("model download request failed")?
        .error_for_status()
        .context("model download rejected by server")?;
    let total = response.content_length().unwrap_or(0);
    if let Some(pinned) = model.size_bytes {
        if total != 0 && total != pinned {
            bail!(
                "downloaded size {total} does not match pinned size {pinned} for {} — refusing",
                model.id
            );
        }
    }
    let mut file = std::fs::File::create(&tmp)
        .with_context(|| format!("cannot create {}", tmp.display()))?;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_report: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("model download interrupted")?;
        file.write_all(&chunk)?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        if downloaded - last_report >= (1 << 23) {
            last_report = downloaded;
            progress(downloaded, total);
        }
    }
    file.flush()?;
    file.sync_all()?;
    progress(downloaded, total);
    if let Some(pinned) = model.size_bytes {
        if downloaded != pinned {
            std::fs::remove_file(&tmp).ok();
            bail!(
                "downloaded {downloaded} bytes but manifest pins {pinned} for {} — refusing",
                model.id
            );
        }
    }
    let got = hex::encode(hasher.finalize());
    if !got.eq_ignore_ascii_case(&model.sha256) {
        std::fs::remove_file(&tmp).ok();
        bail!(
            "SHA-256 mismatch for {}: expected {}, got {got} — download discarded",
            model.id,
            model.sha256
        );
    }
    let dest = model_path(paths, model);
    std::fs::rename(&tmp, &dest)
        .with_context(|| format!("cannot finalize {}", dest.display()))?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::verify_sha256;
    use std::io::Write;

    #[test]
    fn mismatch_is_a_hard_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.gguf");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(b"tobari test bytes").unwrap();
        drop(file);
        assert!(verify_sha256(&path, "deadbeef").is_err());
        assert!(!path.exists(), "mismatched file must be removed");
    }

    #[test]
    fn matching_hash_passes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.gguf");
        std::fs::write(&path, b"tobari test bytes").unwrap();
        let digest = {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(b"tobari test bytes");
            hex::encode(hasher.finalize())
        };
        assert!(verify_sha256(&path, &digest).is_ok());
    }
}
