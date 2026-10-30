use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Family {
    Chromium,
    Firefox,
}

#[derive(Debug, Clone, Serialize)]
pub struct Profile {
    pub browser: String,
    pub name: String,
    pub path: PathBuf,
    pub family: Family,
}

#[derive(Debug, Serialize)]
pub struct Bookmark {
    pub title: String,
    pub url: String,
    pub folder: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct Visit {
    pub url: String,
    pub title: String,
    pub visits: i64,
    pub last_visit_unix: i64,
}

#[derive(Debug, Serialize)]
pub struct Extension {
    pub id: String,
    pub name: String,
    pub store_url: String,
}

#[derive(Debug, Default, Serialize)]
pub struct Settings {
    pub homepage: Option<String>,
    pub search_engine: Option<String>,
    pub startup_urls: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportData {
    pub profile: Profile,
    pub bookmarks: Vec<Bookmark>,
    pub history: Vec<Visit>,
    pub extensions: Vec<Extension>,
    pub settings: Settings,
    pub warnings: Vec<String>,
}

pub fn detect(home: &Path) -> Vec<Profile> {
    let cfg = home.join(".config");
    let var = home.join(".var/app");
    let chromium_roots: Vec<(&str, PathBuf)> = vec![
        ("Chrome", cfg.join("google-chrome")),
        ("Chromium", cfg.join("chromium")),
        ("Brave", cfg.join("BraveSoftware/Brave-Browser")),
        ("Edge", cfg.join("microsoft-edge")),
        ("Vivaldi", cfg.join("vivaldi")),
        (
            "Chrome (Flatpak)",
            var.join("com.google.Chrome/config/google-chrome"),
        ),
        (
            "Chromium (Flatpak)",
            var.join("org.chromium.Chromium/config/chromium"),
        ),
        (
            "Brave (Flatpak)",
            var.join("com.brave.Browser/config/BraveSoftware/Brave-Browser"),
        ),
        (
            "Edge (Flatpak)",
            var.join("com.microsoft.Edge/config/microsoft-edge"),
        ),
    ];
    let mut out = Vec::new();
    for (browser, root) in chromium_roots {
        let names = chromium_profile_names(&root);
        let Ok(rd) = std::fs::read_dir(&root) else {
            continue;
        };
        let mut dirs: Vec<_> = rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.join("Preferences").is_file())
            .collect();
        dirs.sort();
        for d in dirs {
            let key = d.file_name().unwrap().to_string_lossy().into_owned();
            out.push(Profile {
                browser: browser.to_owned(),
                name: names.get(&key).cloned().unwrap_or(key),
                path: d,
                family: Family::Chromium,
            });
        }
    }
    let firefox_roots: Vec<(&str, PathBuf)> = vec![
        ("Firefox", home.join(".mozilla/firefox")),
        (
            "Firefox (Flatpak)",
            var.join("org.mozilla.firefox/.mozilla/firefox"),
        ),
        ("Zen", home.join(".zen")),
        ("Zen (Flatpak)", var.join("app.zen_browser.zen/.zen")),
    ];
    for (browser, root) in firefox_roots {
        let Ok(rd) = std::fs::read_dir(&root) else {
            continue;
        };
        let mut dirs: Vec<_> = rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.join("places.sqlite").is_file())
            .collect();
        dirs.sort();
        for d in dirs {
            out.push(Profile {
                browser: browser.to_owned(),
                name: d.file_name().unwrap().to_string_lossy().into_owned(),
                path: d,
                family: Family::Firefox,
            });
        }
    }
    out
}

fn chromium_profile_names(root: &Path) -> HashMap<String, String> {
    let mut m = HashMap::new();
    if let Ok(t) = std::fs::read_to_string(root.join("Local State")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
            if let Some(cache) = v.pointer("/profile/info_cache").and_then(|c| c.as_object()) {
                for (k, info) in cache {
                    if let Some(n) = info["name"].as_str() {
                        m.insert(k.clone(), n.to_owned());
                    }
                }
            }
        }
    }
    m
}

pub fn read(profile: &Profile, history_limit: usize) -> ImportData {
    let mut warnings = Vec::new();
    let mut warn = |what: &str, r: anyhow::Error| warnings.push(format!("{what}: {r:#}"));
    let (bookmarks, history, extensions, settings) = match profile.family {
        Family::Chromium => (
            chromium_bookmarks(&profile.path).unwrap_or_else(|e| {
                warn("bookmarks", e);
                vec![]
            }),
            chromium_history(&profile.path, history_limit).unwrap_or_else(|e| {
                warn("history", e);
                vec![]
            }),
            chromium_extensions(&profile.path).unwrap_or_else(|e| {
                warn("extensions", e);
                vec![]
            }),
            chromium_settings(&profile.path).unwrap_or_else(|e| {
                warn("settings", e);
                Settings::default()
            }),
        ),
        Family::Firefox => {
            let (b, h) = firefox_places(&profile.path, history_limit).unwrap_or_else(|e| {
                warn("places", e);
                (vec![], vec![])
            });
            (
                b,
                h,
                firefox_extensions(&profile.path).unwrap_or_else(|e| {
                    warn("extensions", e);
                    vec![]
                }),
                firefox_settings(&profile.path),
            )
        }
    };
    ImportData {
        profile: profile.clone(),
        bookmarks,
        history,
        extensions,
        settings,
        warnings,
    }
}

fn chromium_bookmarks(dir: &Path) -> anyhow::Result<Vec<Bookmark>> {
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("Bookmarks"))?)?;
    let mut out = Vec::new();
    fn walk(node: &serde_json::Value, path: &mut Vec<String>, out: &mut Vec<Bookmark>) {
        match node["type"].as_str() {
            Some("url") => out.push(Bookmark {
                title: node["name"].as_str().unwrap_or("").to_owned(),
                url: node["url"].as_str().unwrap_or("").to_owned(),
                folder: path.clone(),
            }),
            Some("folder") => {
                path.push(node["name"].as_str().unwrap_or("").to_owned());
                for c in node["children"].as_array().into_iter().flatten() {
                    walk(c, path, out);
                }
                path.pop();
            }
            _ => {}
        }
    }
    if let Some(roots) = v["roots"].as_object() {
        for key in ["bookmark_bar", "other", "synced"] {
            if let Some(r) = roots.get(key) {
                walk(r, &mut vec![], &mut out);
            }
        }
    }
    Ok(out)
}

fn copy_db(src: &Path) -> anyhow::Result<(tempfile_dir::Dir, PathBuf)> {
    let d = tempfile_dir::Dir::new()?;
    let dst = d.path().join("db.sqlite");
    std::fs::copy(src, &dst)?;
    for ext in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{ext}", src.display()));
        if side.is_file() {
            let _ = std::fs::copy(&side, PathBuf::from(format!("{}{ext}", dst.display())));
        }
    }
    Ok((d, dst))
}

mod tempfile_dir {
    pub struct Dir(std::path::PathBuf);
    impl Dir {
        pub fn new() -> std::io::Result<Self> {
            let p = std::env::temp_dir()
                .join(format!("tobari-import-{}", crate::download::fresh_token()));
            crate::paths::ensure_private_dir(&p)?;
            Ok(Dir(p))
        }
        pub fn path(&self) -> &std::path::Path {
            &self.0
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

fn chromium_history(dir: &Path, limit: usize) -> anyhow::Result<Vec<Visit>> {
    let (_guard, db) = copy_db(&dir.join("History"))?;
    let conn =
        rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut st = conn.prepare(
        "SELECT url, title, visit_count, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?1",
    )?;
    let rows = st.query_map([limit as i64], |r| {
        let t: i64 = r.get(3)?;
        Ok(Visit {
            url: r.get(0)?,
            title: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            visits: r.get(2)?,
            last_visit_unix: if t > 0 {
                t / 1_000_000 - 11_644_473_600
            } else {
                0
            },
        })
    })?;
    Ok(rows
        .filter_map(Result::ok)
        .filter(|v| v.url.starts_with("http"))
        .collect())
}

fn chromium_extensions(dir: &Path) -> anyhow::Result<Vec<Extension>> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir.join("Extensions")) else {
        return Ok(out);
    };
    for e in rd.flatten() {
        let id = e.file_name().to_string_lossy().into_owned();
        if id.len() != 32 {
            continue;
        }
        let mut versions: Vec<_> = std::fs::read_dir(e.path())?
            .flatten()
            .map(|v| v.path())
            .collect();
        versions.sort();
        let Some(ver) = versions.last() else { continue };
        let Ok(t) = std::fs::read_to_string(ver.join("manifest.json")) else {
            continue;
        };
        let Ok(m) = serde_json::from_str::<serde_json::Value>(&t) else {
            continue;
        };
        let mut name = m["name"].as_str().unwrap_or(&id).to_owned();
        if let Some(key) = name
            .strip_prefix("__MSG_")
            .and_then(|k| k.strip_suffix("__"))
        {
            name =
                localized(ver, m["default_locale"].as_str().unwrap_or("en"), key).unwrap_or(name);
        }
        if m["update_url"]
            .as_str()
            .map(|u| u.contains("google.com"))
            .unwrap_or(true)
        {
            out.push(Extension {
                store_url: format!("https://chromewebstore.google.com/detail/{id}"),
                id,
                name,
            });
        }
    }
    out.sort_by_key(|e| e.name.to_lowercase());
    Ok(out)
}

fn localized(ver: &Path, locale: &str, key: &str) -> Option<String> {
    let t =
        std::fs::read_to_string(ver.join("_locales").join(locale).join("messages.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&t).ok()?;
    let obj = v.as_object()?;
    obj.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .and_then(|(_, m)| m["message"].as_str().map(str::to_owned))
}

fn chromium_settings(dir: &Path) -> anyhow::Result<Settings> {
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("Preferences"))?)?;
    Ok(Settings {
        homepage: v["homepage"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
        search_engine: v
            .pointer("/default_search_provider_data/template_url_data/short_name")
            .and_then(|s| s.as_str())
            .map(str::to_owned),
        startup_urls: v
            .pointer("/session/startup_urls")
            .and_then(|a| a.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|u| u.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default(),
    })
}

fn firefox_places(dir: &Path, limit: usize) -> anyhow::Result<(Vec<Bookmark>, Vec<Visit>)> {
    let (_guard, db) = copy_db(&dir.join("places.sqlite"))?;
    let conn =
        rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut folders: HashMap<i64, (i64, String)> = HashMap::new();
    {
        let mut st = conn
            .prepare("SELECT id, parent, COALESCE(title,'') FROM moz_bookmarks WHERE type = 2")?;
        for r in st.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (id, parent, title) = r?;
            folders.insert(id, (parent, title));
        }
    }
    let path_of = |mut id: i64| {
        let mut parts = Vec::new();
        for _ in 0..32 {
            match folders.get(&id) {
                Some((parent, title)) if *parent != 0 => {
                    if !title.is_empty() && *parent != 1 {
                        parts.push(title.clone());
                    } else if *parent == 1 {
                        parts.push(match title.as_str() {
                            "toolbar" => "Bookmarks Toolbar".to_owned(),
                            "menu" => "Bookmarks Menu".to_owned(),
                            "unfiled" => "Other Bookmarks".to_owned(),
                            t => t.to_owned(),
                        });
                    }
                    id = *parent;
                }
                _ => break,
            }
        }
        parts.reverse();
        parts
    };
    let mut bookmarks = Vec::new();
    {
        let mut st = conn.prepare(
            "SELECT COALESCE(b.title, p.title, ''), p.url, b.parent FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1",
        )?;
        for r in st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })? {
            let (title, url, parent) = r?;
            if url.starts_with("place:") {
                continue;
            }
            bookmarks.push(Bookmark {
                title,
                url,
                folder: path_of(parent),
            });
        }
    }
    let mut st = conn.prepare(
        "SELECT url, COALESCE(title,''), visit_count, COALESCE(last_visit_date,0) FROM moz_places WHERE hidden = 0 AND visit_count > 0 ORDER BY last_visit_date DESC LIMIT ?1",
    )?;
    let history = st
        .query_map([limit as i64], |r| {
            Ok(Visit {
                url: r.get(0)?,
                title: r.get(1)?,
                visits: r.get(2)?,
                last_visit_unix: r.get::<_, i64>(3)? / 1_000_000,
            })
        })?
        .filter_map(Result::ok)
        .filter(|v| v.url.starts_with("http"))
        .collect();
    Ok((bookmarks, history))
}

fn firefox_extensions(dir: &Path) -> anyhow::Result<Vec<Extension>> {
    let Ok(t) = std::fs::read_to_string(dir.join("extensions.json")) else {
        return Ok(vec![]);
    };
    let v: serde_json::Value = serde_json::from_str(&t)?;
    Ok(v["addons"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|a| a["type"] == "extension" && a["location"] == "app-profile")
        .map(|a| {
            let name = a
                .pointer("/defaultLocale/name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_owned();
            Extension {
                id: a["id"].as_str().unwrap_or("").to_owned(),
                store_url: format!(
                    "https://chromewebstore.google.com/search/{}",
                    name.replace(' ', "%20")
                ),
                name,
            }
        })
        .collect())
}

fn firefox_settings(dir: &Path) -> Settings {
    let prefs = std::fs::read_to_string(dir.join("prefs.js")).unwrap_or_default();
    let get = |key: &str| {
        prefs.lines().find_map(|l| {
            let rest = l.strip_prefix(&format!("user_pref(\"{key}\", \""))?;
            rest.rsplit_once("\");").map(|(v, _)| v.to_owned())
        })
    };
    let homepage = get("browser.startup.homepage");
    Settings {
        startup_urls: homepage
            .as_deref()
            .map(|h| h.split('|').map(str::to_owned).collect())
            .unwrap_or_default(),
        homepage: homepage.map(|h| h.split('|').next().unwrap_or("").to_owned()),
        search_engine: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_chrome_profile() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join(".config/google-chrome/Default");
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(
            t.path().join(".config/google-chrome/Local State"),
            r#"{"profile":{"info_cache":{"Default":{"name":"Kao"}}}}"#,
        )
        .unwrap();
        std::fs::write(p.join("Preferences"), r#"{"homepage":"https://example.org","default_search_provider_data":{"template_url_data":{"short_name":"DuckDuckGo"}}}"#).unwrap();
        std::fs::write(
            p.join("Bookmarks"),
            r#"{"roots":{"bookmark_bar":{"type":"folder","name":"Bookmarks bar","children":[{"type":"folder","name":"日本","children":[{"type":"url","name":"帳","url":"https://ja.wikipedia.org/wiki/帳"}]}]},"other":{"type":"folder","name":"Other","children":[]}}}"#,
        )
        .unwrap();
        let conn = rusqlite::Connection::open(p.join("History")).unwrap();
        conn.execute_batch(
            "CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0);
             INSERT INTO urls(url,title,visit_count,last_visit_time) VALUES('https://example.org/','Example',3,13370000000000000);",
        )
        .unwrap();
        drop(conn);
        let ext = p.join("Extensions/abcdefghijklmnopabcdefghijklmnop/1.0");
        std::fs::create_dir_all(ext.join("_locales/en")).unwrap();
        std::fs::write(
            ext.join("manifest.json"),
            r#"{"name":"__MSG_app__","default_locale":"en"}"#,
        )
        .unwrap();
        std::fs::write(
            ext.join("_locales/en/messages.json"),
            r#"{"app":{"message":"uBlock Origin Lite"}}"#,
        )
        .unwrap();

        let found = detect(t.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Kao");
        let d = read(&found[0], 100);
        assert!(d.warnings.is_empty(), "{:?}", d.warnings);
        assert_eq!(d.bookmarks[0].folder, vec!["Bookmarks bar", "日本"]);
        assert_eq!(d.history[0].visits, 3);
        assert_eq!(d.history[0].last_visit_unix, 13370000000 - 11644473600);
        assert_eq!(d.extensions[0].name, "uBlock Origin Lite");
        assert_eq!(d.settings.search_engine.as_deref(), Some("DuckDuckGo"));
    }

    #[test]
    fn reads_a_firefox_profile() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join(".mozilla/firefox/abc.default-release");
        std::fs::create_dir_all(&p).unwrap();
        let conn = rusqlite::Connection::open(p.join("places.sqlite")).unwrap();
        conn.execute_batch(
            "CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER, hidden INTEGER DEFAULT 0);
             CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, title TEXT);
             INSERT INTO moz_places VALUES(1,'https://www.mozilla.org/','Mozilla',2,1700000000000000,0);
             INSERT INTO moz_bookmarks VALUES(1,2,NULL,0,'');
             INSERT INTO moz_bookmarks VALUES(2,2,NULL,1,'toolbar');
             INSERT INTO moz_bookmarks VALUES(3,2,NULL,2,'Dev');
             INSERT INTO moz_bookmarks VALUES(4,1,1,3,'Moz');",
        )
        .unwrap();
        drop(conn);
        std::fs::write(
            p.join("prefs.js"),
            "user_pref(\"browser.startup.homepage\", \"https://a.example|https://b.example\");\n",
        )
        .unwrap();
        let found = detect(t.path());
        assert_eq!(found[0].family, Family::Firefox);
        let d = read(&found[0], 10);
        assert!(d.warnings.is_empty(), "{:?}", d.warnings);
        assert_eq!(d.bookmarks[0].folder, vec!["Bookmarks Toolbar", "Dev"]);
        assert_eq!(d.history[0].last_visit_unix, 1700000000);
        assert_eq!(d.settings.startup_urls.len(), 2);
    }
}
