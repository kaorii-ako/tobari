use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Report {
    pub name: String,
    pub bytes: u64,
    pub created: i64,
}

fn safe(name: &str) -> anyhow::Result<std::path::PathBuf> {
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        anyhow::bail!("bad report name");
    }
    Ok(crate::paths::crash_dir().join(name))
}

pub fn list() -> anyhow::Result<Vec<Report>> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(crate::paths::crash_dir()) else {
        return Ok(out);
    };
    for e in rd.flatten() {
        let m = e.metadata()?;
        if !m.is_file() {
            continue;
        }
        out.push(Report {
            name: e.file_name().to_string_lossy().into_owned(),
            bytes: m.len(),
            created: m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        });
    }
    out.sort_by_key(|r| std::cmp::Reverse(r.created));
    Ok(out)
}

pub fn read(name: &str) -> anyhow::Result<String> {
    let bytes = std::fs::read(safe(name)?)?;
    Ok(String::from_utf8_lossy(&bytes[..bytes.len().min(256 * 1024)]).into_owned())
}

pub fn delete(name: &str) -> anyhow::Result<()> {
    Ok(std::fs::remove_file(safe(name)?)?)
}
