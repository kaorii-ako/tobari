use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct Note {
    pub name: String,
    pub bytes: u64,
    pub modified: i64,
}

#[derive(Debug, Serialize)]
pub struct Hit {
    pub name: String,
    pub line: usize,
    pub text: String,
    pub score: f32,
}

pub struct Memory {
    dir: PathBuf,
}

impl Memory {
    pub fn new(dir: PathBuf) -> Self {
        Memory { dir }
    }

    pub fn open() -> anyhow::Result<Self> {
        let dir = crate::paths::memory_dir();
        crate::paths::ensure_private_dir(&dir)?;
        Ok(Self::new(dir))
    }

    fn path(&self, name: &str) -> anyhow::Result<PathBuf> {
        let base = name.trim().trim_end_matches(".md");
        if base.is_empty()
            || base.starts_with('.')
            || base.contains(['/', '\\', '\0'])
            || base.len() > 120
        {
            anyhow::bail!("bad note name {name:?}");
        }
        Ok(self.dir.join(format!("{base}.md")))
    }

    pub fn list(&self) -> anyhow::Result<Vec<Note>> {
        let mut out = Vec::new();
        let Ok(rd) = std::fs::read_dir(&self.dir) else {
            return Ok(out);
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "md").unwrap_or(false) {
                let m = e.metadata()?;
                out.push(Note {
                    name: p.file_stem().unwrap().to_string_lossy().into_owned(),
                    bytes: m.len(),
                    modified: m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0),
                });
            }
        }
        out.sort_by_key(|n| std::cmp::Reverse(n.modified));
        Ok(out)
    }

    pub fn read(&self, name: &str) -> anyhow::Result<String> {
        Ok(std::fs::read_to_string(self.path(name)?)?)
    }

    pub fn write(&self, name: Option<&str>, content: &str, append: bool) -> anyhow::Result<String> {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let name = name
            .filter(|n| !n.trim().is_empty())
            .unwrap_or(&today)
            .to_owned();
        let p = self.path(&name)?;
        std::fs::create_dir_all(&self.dir)?;
        if append && p.exists() {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().append(true).open(&p)?;
            write!(f, "\n{}\n", content.trim_end())?;
        } else {
            std::fs::write(&p, format!("{}\n", content.trim_end()))?;
        }
        Ok(p.file_stem().unwrap().to_string_lossy().into_owned())
    }

    pub fn delete(&self, name: &str) -> anyhow::Result<()> {
        Ok(std::fs::remove_file(self.path(name)?)?)
    }

    pub fn search(&self, query: &str, limit: usize) -> anyhow::Result<Vec<Hit>> {
        let terms = terms(query);
        if terms.is_empty() {
            return Ok(vec![]);
        }
        let mut hits = Vec::new();
        for n in self.list()? {
            let text = self.read(&n.name)?;
            let name_l = n.name.to_lowercase();
            for (i, line) in text.lines().enumerate() {
                let l = line.to_lowercase();
                let matched = terms.iter().filter(|t| l.contains(t.as_str())).count();
                if matched == 0 {
                    continue;
                }
                let mut score = matched as f32 / terms.len() as f32;
                if l.contains(&query.to_lowercase()) {
                    score += 1.0;
                }
                if terms.iter().any(|t| name_l.contains(t.as_str())) {
                    score += 0.25;
                }
                hits.push(Hit {
                    name: n.name.clone(),
                    line: i + 1,
                    text: line.chars().take(240).collect(),
                    score,
                });
            }
        }
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        hits.truncate(limit);
        Ok(hits)
    }

    pub fn export(&self) -> anyhow::Result<String> {
        let mut notes = self.list()?;
        notes.sort_by(|a, b| a.name.cmp(&b.name));
        let mut out = format!(
            "# Tobari memory export\n\nExported {} from {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M"),
            self.dir.display()
        );
        for n in notes {
            out.push_str(&format!(
                "\n---\n\n## {}\n\n{}\n",
                n.name,
                self.read(&n.name)?.trim_end()
            ));
        }
        Ok(out)
    }
}

fn is_cjk_or_thai(c: char) -> bool {
    matches!(c as u32,
        0x0E00..=0x0E7F | 0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF)
}

fn terms(query: &str) -> Vec<String> {
    let mut out = Vec::new();
    for w in query.to_lowercase().split_whitespace() {
        let chars: Vec<char> = w.chars().collect();
        if chars.len() >= 3 && chars.iter().all(|c| is_cjk_or_thai(*c)) {
            for pair in chars.windows(2) {
                out.push(pair.iter().collect());
            }
        } else if !w.is_empty() {
            out.push(
                w.trim_matches(|c: char| c.is_ascii_punctuation())
                    .to_owned(),
            );
        }
    }
    out.retain(|t| !t.is_empty());
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> (tempfile::TempDir, Memory) {
        let t = tempfile::tempdir().unwrap();
        let m = Memory::new(t.path().to_path_buf());
        (t, m)
    }

    #[test]
    fn write_search_export() {
        let (_t, m) = mem();
        m.write(
            Some("osaka-trip"),
            "# Osaka\nHotel near Namba, check-in 15:00\n帳簿の確認",
            false,
        )
        .unwrap();
        m.write(Some("rust"), "tokio select needs cancel safety", false)
            .unwrap();
        let hits = m.search("namba hotel", 5).unwrap();
        assert_eq!(hits[0].name, "osaka-trip");
        assert_eq!(hits[0].line, 2);
        let ja = m.search("帳簿の", 5).unwrap();
        assert_eq!(ja[0].name, "osaka-trip");
        let all = m.export().unwrap();
        assert!(all.contains("## osaka-trip") && all.contains("## rust"));
    }

    #[test]
    fn append_and_daily_default() {
        let (_t, m) = mem();
        let name = m.write(None, "first", true).unwrap();
        m.write(None, "second", true).unwrap();
        let body = m.read(&name).unwrap();
        assert!(body.contains("first") && body.contains("second"));
        assert_eq!(name.len(), 10);
    }

    #[test]
    fn refuses_path_traversal() {
        let (_t, m) = mem();
        assert!(m.write(Some("../evil"), "x", false).is_err());
        assert!(m.write(Some(".hidden"), "x", false).is_err());
    }
}
