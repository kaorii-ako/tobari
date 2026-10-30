use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub role: String,
    pub tools: Vec<String>,
    pub sites: Vec<String>,
    pub context: Vec<String>,
    pub instructions: String,
    pub dir: PathBuf,
    pub scripts: Vec<String>,
}

pub const BUNDLED: &[(&str, &str)] = &[
    (
        "summarize-page",
        include_str!("../../skills/summarize-page/SKILL.md"),
    ),
    (
        "extract-pdf-tables",
        include_str!("../../skills/extract-pdf-tables/SKILL.md"),
    ),
    (
        "explain-github-pr",
        include_str!("../../skills/explain-github-pr/SKILL.md"),
    ),
    (
        "triage-feed",
        include_str!("../../skills/triage-feed/SKILL.md"),
    ),
    (
        "save-to-memory",
        include_str!("../../skills/save-to-memory/SKILL.md"),
    ),
    (
        "cross-tab-search",
        include_str!("../../skills/cross-tab-search/SKILL.md"),
    ),
    (
        "cluster-tabs",
        include_str!("../../skills/cluster-tabs/SKILL.md"),
    ),
    (
        "translate-page",
        include_str!("../../skills/translate-page/SKILL.md"),
    ),
    (
        "daily-digest",
        include_str!("../../skills/daily-digest/SKILL.md"),
    ),
    (
        "find-free-pdf",
        include_str!("../../skills/find-free-pdf/SKILL.md"),
    ),
];

pub fn install_bundled(dir: &Path) -> anyhow::Result<usize> {
    let mut n = 0;
    for (name, body) in BUNDLED {
        let d = dir.join(name);
        let f = d.join("SKILL.md");
        if f.exists() {
            continue;
        }
        std::fs::create_dir_all(&d)?;
        std::fs::write(f, body)?;
        n += 1;
    }
    Ok(n)
}

pub fn parse(text: &str, dir: PathBuf) -> anyhow::Result<Skill> {
    let text = text.trim_start_matches('\u{feff}');
    let rest = text
        .strip_prefix("---")
        .ok_or_else(|| anyhow::anyhow!("SKILL.md must start with a --- frontmatter block"))?;
    let (front, body) = rest
        .split_once("\n---")
        .ok_or_else(|| anyhow::anyhow!("frontmatter is not closed with ---"))?;
    let mut s = Skill {
        name: String::new(),
        description: String::new(),
        role: String::new(),
        tools: vec![],
        sites: vec![],
        context: vec![],
        instructions: body.trim_start_matches(['-', '\r', '\n']).trim().to_owned(),
        dir: dir.clone(),
        scripts: vec![],
    };
    for line in front.lines() {
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let v = v.trim().trim_matches('"').to_owned();
        let list = || {
            v.trim_matches(['[', ']'])
                .split(',')
                .map(|x| x.trim().trim_matches('"').to_owned())
                .filter(|x| !x.is_empty())
                .collect::<Vec<_>>()
        };
        match k.trim() {
            "name" => s.name = v.clone(),
            "description" => s.description = v.clone(),
            "role" => s.role = v.clone(),
            "tools" => s.tools = list(),
            "sites" => s.sites = list(),
            "context" => s.context = list(),
            _ => {}
        }
    }
    if s.name.is_empty() {
        anyhow::bail!("skill has no name");
    }
    if !s
        .name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        anyhow::bail!(
            "skill name {} must be lowercase letters, digits and dashes",
            s.name
        );
    }
    let scripts_dir = dir.join("scripts");
    if let Ok(rd) = std::fs::read_dir(scripts_dir) {
        s.scripts = rd
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        s.scripts.sort();
    }
    Ok(s)
}

pub fn load_all(dir: &Path) -> (Vec<Skill>, Vec<String>) {
    let mut skills = Vec::new();
    let mut errors = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return (skills, errors);
    };
    for e in rd.flatten() {
        let f = e.path().join("SKILL.md");
        if !f.is_file() {
            continue;
        }
        match std::fs::read_to_string(&f)
            .map_err(anyhow::Error::from)
            .and_then(|t| parse(&t, e.path()))
        {
            Ok(s) => skills.push(s),
            Err(err) => errors.push(format!("{}: {err}", f.display())),
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    (skills, errors)
}

pub fn find(dir: &Path, name: &str) -> anyhow::Result<Skill> {
    let (all, _) = load_all(dir);
    all.into_iter()
        .find(|s| s.name == name)
        .ok_or_else(|| anyhow::anyhow!("no skill named {name} in {}", dir.display()))
}

pub fn matches_site(skill: &Skill, host: &str) -> bool {
    skill.sites.is_empty()
        || skill.sites.iter().any(|p| {
            p == "*"
                || host == p
                || p.strip_prefix("*.")
                    .map(|d| host.ends_with(&format!(".{d}")) || host == d)
                    .unwrap_or(false)
        })
}

pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').chars().take(48).collect()
}

pub fn create_from_prompt(
    dir: &Path,
    name: &str,
    description: &str,
    prompt: &str,
    sites: &[String],
) -> anyhow::Result<PathBuf> {
    let slug = slug(name);
    if slug.is_empty() {
        anyhow::bail!("skill name needs at least one letter or digit");
    }
    let d = dir.join(&slug);
    if d.exists() {
        anyhow::bail!("a skill named {slug} already exists");
    }
    std::fs::create_dir_all(&d)?;
    let sites = if sites.is_empty() {
        "*".to_owned()
    } else {
        sites.join(", ")
    };
    let body = format!(
        "---\nname: {slug}\ndescription: {}\nrole: research\ntools: read_page\nsites: {sites}\ncontext: page\n---\n\n{}\n",
        description.replace('\n', " "),
        prompt.trim()
    );
    std::fs::write(d.join("SKILL.md"), body)?;
    Ok(d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_bundled_skill_parses() {
        for (name, body) in BUNDLED {
            let s = parse(body, PathBuf::from(name)).unwrap();
            assert_eq!(&s.name, name);
            assert!(!s.description.is_empty(), "{name} lacks a description");
            assert!(!s.instructions.is_empty(), "{name} has no body");
        }
        assert_eq!(BUNDLED.len(), 10);
    }

    #[test]
    fn site_patterns() {
        let s = parse(
            "---\nname: x\nsites: github.com, *.reddit.com\n---\nbody",
            PathBuf::new(),
        )
        .unwrap();
        assert!(matches_site(&s, "github.com"));
        assert!(matches_site(&s, "old.reddit.com"));
        assert!(!matches_site(&s, "gitlab.com"));
    }

    #[test]
    fn prompt_to_skill_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let d = create_from_prompt(
            tmp.path(),
            "Price Watch!",
            "Track prices",
            "Find the price.",
            &[],
        )
        .unwrap();
        let s = find(tmp.path(), "price-watch").unwrap();
        assert_eq!(s.dir, d);
        assert_eq!(s.instructions, "Find the price.");
        assert!(create_from_prompt(tmp.path(), "Price Watch", "", "x", &[]).is_err());
    }

    #[test]
    fn rejects_bad_names() {
        assert!(parse("---\nname: Bad Name\n---\nx", PathBuf::new()).is_err());
        assert!(parse("no frontmatter", PathBuf::new()).is_err());
    }
}
