//! Import from other browsers: Chromium-family browsers (Chrome, Chromium,
//! Brave, Edge, Vivaldi; native or Flatpak) and Firefox.
//!
//! Everything here reads another browser's profile and returns plain data
//! (JSON) to Tobari, which writes it into its own profile. Nothing is ever
//! written to the other browser's profile; its databases are copied to a
//! private temporary directory first, because the browser may be running and
//! holding locks.
//!
//! Cookie values in Chromium browsers are encrypted. The keys are read from
//! the user's keyring only when an import of cookies is requested, used for
//! that import, and dropped:
//! - "v10" (Linux): a fixed key ("peanuts"), the fallback without a keyring.
//! - "v11" (Linux): PBKDF2 of the browser's "Safe Storage" password from the
//!   Secret Service; AES-128-CBC.
//! - "v12" (Linux, Flatpak browsers): HKDF of the per-app secret the desktop
//!   portal keeps in the keyring; AES-256-GCM. (Chromium's
//!   secret_portal_key_provider.cc.)
//! - "v10" (macOS): PBKDF2 (1003 rounds) of the "Safe Storage" password from
//!   the macOS Keychain; AES-128-CBC.
//! Since cookie database version 24 the plaintext starts with the SHA-256 of
//! the cookie's host, which is checked and removed.

// Key sources are per platform (keyring and Flatpak portal on Linux, the
// Keychain on macOS); each build leaves the other's fields and variants unused.
#![allow(dead_code)]

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Chromium,
    Firefox,
}

#[derive(Clone)]
struct Source {
    id: String,
    browser: &'static str,
    family: &'static str,
    kind: Kind,
    flatpak_app: Option<&'static str>,
    keyring_app: &'static str,
    mac_service: &'static str,
    profile_name: String,
    profile_dir: PathBuf,
}

struct Family {
    id: &'static str,
    name: &'static str,
    linux_config: &'static str,
    flatpak: Option<(&'static str, &'static str)>,
    mac_dir: &'static str,
    keyring_app: &'static str,
    mac_service: &'static str,
}

const CHROMIUM_FAMILIES: &[Family] = &[
    Family { id: "chrome", name: "Google Chrome", linux_config: ".config/google-chrome",
             flatpak: Some(("com.google.Chrome", "config/google-chrome")),
             mac_dir: "Library/Application Support/Google/Chrome", keyring_app: "chrome",
             mac_service: "Chrome Safe Storage" },
    Family { id: "chromium", name: "Chromium", linux_config: ".config/chromium",
             flatpak: Some(("org.chromium.Chromium", "config/chromium")),
             mac_dir: "Library/Application Support/Chromium", keyring_app: "chromium",
             mac_service: "Chromium Safe Storage" },
    Family { id: "brave", name: "Brave", linux_config: ".config/BraveSoftware/Brave-Browser",
             flatpak: Some(("com.brave.Browser", "config/BraveSoftware/Brave-Browser")),
             mac_dir: "Library/Application Support/BraveSoftware/Brave-Browser", keyring_app: "brave",
             mac_service: "Brave Safe Storage" },
    Family { id: "edge", name: "Microsoft Edge", linux_config: ".config/microsoft-edge",
             flatpak: Some(("com.microsoft.Edge", "config/microsoft-edge")),
             mac_dir: "Library/Application Support/Microsoft Edge", keyring_app: "microsoft-edge",
             mac_service: "Microsoft Edge Safe Storage" },
    Family { id: "vivaldi", name: "Vivaldi", linux_config: ".config/vivaldi",
             flatpak: Some(("com.vivaldi.Vivaldi", "config/vivaldi")),
             mac_dir: "Library/Application Support/Vivaldi", keyring_app: "vivaldi",
             mac_service: "Vivaldi Safe Storage" },
];

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

// ------------------------------------------------------------------ discovery

fn chromium_profiles(root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let names: HashMap<String, String> = fs::read_to_string(root.join("Local State"))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v["profile"]["info_cache"].as_object().cloned())
        .map(|m| {
            m.into_iter()
                .map(|(dir, info)| {
                    let name = info["name"].as_str().unwrap_or(&dir).to_string();
                    (dir, name)
                })
                .collect()
        })
        .unwrap_or_default();
    let mut dirs: Vec<String> = names.keys().cloned().collect();
    if dirs.is_empty() && root.join("Default").is_dir() {
        dirs.push("Default".into());
    }
    dirs.sort();
    for dir in dirs {
        let path = root.join(&dir);
        if path.join("Preferences").is_file() {
            let name = names.get(&dir).cloned().unwrap_or_else(|| dir.clone());
            out.push((name, path));
        }
    }
    out
}

fn firefox_profiles(root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(ini) = fs::read_to_string(root.join("profiles.ini")) else { return out };
    let mut name = String::new();
    let mut path = String::new();
    let mut relative = true;
    let mut flush = |name: &mut String, path: &mut String, relative: &mut bool| {
        if !path.is_empty() {
            let full = if *relative { root.join(&*path) } else { PathBuf::from(&*path) };
            if full.join("places.sqlite").is_file() || full.join("cookies.sqlite").is_file() {
                out.push((if name.is_empty() { path.clone() } else { name.clone() }, full));
            }
        }
        name.clear();
        path.clear();
        *relative = true;
    };
    for line in ini.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            flush(&mut name, &mut path, &mut relative);
        } else if let Some(v) = line.strip_prefix("Name=") {
            name = v.to_string();
        } else if let Some(v) = line.strip_prefix("Path=") {
            path = v.to_string();
        } else if let Some(v) = line.strip_prefix("IsRelative=") {
            relative = v == "1";
        }
    }
    flush(&mut name, &mut path, &mut relative);
    out
}

fn discover() -> Vec<Source> {
    let home = home();
    let mut out = Vec::new();
    for f in CHROMIUM_FAMILIES {
        let mut roots: Vec<(&str, PathBuf, Option<&'static str>)> = Vec::new();
        if cfg!(target_os = "macos") {
            roots.push(("native", home.join(f.mac_dir), None));
        } else {
            roots.push(("native", home.join(f.linux_config), None));
            if let Some((app, rel)) = f.flatpak {
                roots.push(("flatpak", home.join(".var/app").join(app).join(rel), Some(app)));
            }
        }
        for (install, root, app) in roots {
            for (name, dir) in chromium_profiles(&root) {
                let dir_name = dir.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                out.push(Source {
                    id: format!("{}:{}:{}", f.id, install, dir_name),
                    browser: f.name,
                    family: f.id,
                    kind: Kind::Chromium,
                    flatpak_app: app,
                    keyring_app: f.keyring_app,
                    mac_service: f.mac_service,
                    profile_name: name,
                    profile_dir: dir,
                });
            }
        }
    }
    let ff_roots: Vec<(&str, PathBuf)> = if cfg!(target_os = "macos") {
        vec![("native", home.join("Library/Application Support/Firefox"))]
    } else {
        vec![
            ("native", home.join(".mozilla/firefox")),
            ("flatpak", home.join(".var/app/org.mozilla.firefox/.mozilla/firefox")),
        ]
    };
    for (install, root) in ff_roots {
        for (name, dir) in firefox_profiles(&root) {
            let dir_name = dir.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            out.push(Source {
                id: format!("firefox:{}:{}", install, dir_name),
                browser: "Firefox",
                family: "firefox",
                kind: Kind::Firefox,
                flatpak_app: if install == "flatpak" { Some("org.mozilla.firefox") } else { None },
                keyring_app: "",
                mac_service: "",
                profile_name: name,
                profile_dir: dir,
            });
        }
    }
    out
}

fn find(id: &str) -> Result<Source, String> {
    discover().into_iter().find(|s| s.id == id).ok_or_else(|| format!("unknown source {id}"))
}

// ------------------------------------------------------------------ sqlite

/// A private copy of a database (and its WAL), so the source browser's locks
/// and in-progress writes do not matter. Removed when dropped.
struct DbCopy {
    dir: PathBuf,
    conn: Connection,
}

impl DbCopy {
    fn open(path: &Path) -> Result<DbCopy, String> {
        if !path.is_file() {
            return Err(format!("{} not found", path.display()));
        }
        let dir = std::env::temp_dir().join(format!(
            "tobari-import-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
        }
        let name = path.file_name().ok_or("bad path")?;
        let copy = dir.join(name);
        fs::copy(path, &copy).map_err(|e| e.to_string())?;
        for suffix in ["-wal", "-journal"] {
            let mut side = path.as_os_str().to_owned();
            side.push(suffix);
            let side = PathBuf::from(side);
            if side.is_file() {
                let mut dest = copy.as_os_str().to_owned();
                dest.push(suffix);
                let _ = fs::copy(&side, PathBuf::from(dest));
            }
        }
        let conn = Connection::open_with_flags(&copy, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|e| e.to_string())?;
        Ok(DbCopy { dir, conn })
    }
}

impl Drop for DbCopy {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

// ------------------------------------------------------------------ keys

enum Keys {
    Linux { v11: Option<[u8; 16]>, v12: Option<[u8; 32]> },
    Mac { v10: Option<[u8; 16]> },
}

fn pbkdf2_key(password: &[u8], rounds: u32) -> [u8; 16] {
    let mut key = [0u8; 16];
    pbkdf2::pbkdf2_hmac::<sha1::Sha1>(password, b"saltysalt", rounds, &mut key);
    key
}

#[cfg(target_os = "linux")]
fn keyring_secret(attrs: &[(&str, &str)]) -> Option<Vec<u8>> {
    use secret_service::blocking::SecretService;
    use secret_service::EncryptionType;
    let ss = SecretService::connect(EncryptionType::Dh).ok()?;
    let map: HashMap<&str, &str> = attrs.iter().cloned().collect();
    let found = ss.search_items(map).ok()?;
    if let Some(item) = found.unlocked.first() {
        return item.get_secret().ok();
    }
    if let Some(item) = found.locked.first() {
        // Locked keyring: this asks the user to unlock it, as the source
        // browser itself would.
        if ss.unlock_all(&[item]).is_ok() {
            return item.get_secret().ok();
        }
    }
    None
}

fn load_keys(src: &Source) -> Keys {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("/usr/bin/security")
            .args(["find-generic-password", "-w", "-s", src.mac_service])
            .output();
        let v10 = out
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|p| !p.is_empty())
            .map(|p| pbkdf2_key(p.as_bytes(), 1003));
        return Keys::Mac { v10 };
    }
    #[cfg(target_os = "linux")]
    {
        let v11 = keyring_secret(&[("application", src.keyring_app)])
            .map(|pw| pbkdf2_key(&pw, 1));
        let v12 = src.flatpak_app.and_then(|app| keyring_secret(&[("app_id", app)])).map(|secret| {
            let hk = hkdf::Hkdf::<sha2::Sha256>::new(Some(b"fdo_portal_secret_salt"), &secret);
            let mut key = [0u8; 32];
            let _ = hk.expand(b"HKDF-SHA-256 AES-256-GCM", &mut key);
            key
        });
        Keys::Linux { v11, v12 }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = src;
        Keys::Linux { v11: None, v12: None }
    }
}

fn cbc_decrypt(key: &[u8; 16], data: &[u8]) -> Option<Vec<u8>> {
    use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
    let iv = [b' '; 16];
    let mut buf = data.to_vec();
    let len = cbc::Decryptor::<aes::Aes128>::new(key.into(), &iv.into())
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .ok()?
        .len();
    buf.truncate(len);
    Some(buf)
}

fn gcm_decrypt(key: &[u8; 32], data: &[u8]) -> Option<Vec<u8>> {
    use aes_gcm::aead::{Aead, KeyInit};
    if data.len() < 12 + 16 {
        return None;
    }
    let cipher = aes_gcm::Aes256Gcm::new(key.into());
    cipher.decrypt(aes_gcm::Nonce::from_slice(&data[..12]), &data[12..]).ok()
}

fn decrypt(keys: &Keys, enc: &[u8], host: &str, db_version: i64) -> Option<String> {
    if enc.len() < 3 {
        return None;
    }
    let (tag, body) = enc.split_at(3);
    let plain = match (keys, tag) {
        (Keys::Linux { .. }, b"v10") => cbc_decrypt(&pbkdf2_key(b"peanuts", 1), body)?,
        (Keys::Linux { v11: Some(k), .. }, b"v11") => cbc_decrypt(k, body)?,
        (Keys::Linux { v12: Some(k), .. }, b"v12") => gcm_decrypt(k, body)?,
        (Keys::Mac { v10: Some(k) }, b"v10") => cbc_decrypt(k, body)?,
        _ => return None,
    };
    // Version 24+: the value is prefixed with SHA-256(host_key).
    let value = if db_version >= 24 && plain.len() >= 32 {
        use sha2::Digest;
        let digest = sha2::Sha256::digest(host.as_bytes());
        if plain[..32] == digest[..] { plain[32..].to_vec() } else { plain }
    } else {
        plain
    };
    String::from_utf8(value).ok()
}

// ------------------------------------------------------------------ cookies

#[derive(Serialize)]
struct Cookie {
    domain: String,
    name: String,
    value: String,
    path: String,
    secure: bool,
    #[serde(rename = "httpOnly")]
    http_only: bool,
    /// Chromium's values: -1 unspecified, 0 none, 1 lax, 2 strict.
    #[serde(rename = "sameSite")]
    same_site: i64,
    /// Microseconds since 1601-01-01 (Chromium and CEF time); 0 = session.
    expires: i64,
}

const UNIX_TO_1601_SECS: i64 = 11_644_473_600;

fn now_1601_us() -> i64 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    (secs + UNIX_TO_1601_SECS) * 1_000_000
}

fn chromium_cookies(src: &Source) -> Result<Value, String> {
    let path = [src.profile_dir.join("Network/Cookies"), src.profile_dir.join("Cookies")]
        .into_iter()
        .find(|p| p.is_file())
        .ok_or("no cookie database in this profile")?;
    let db = DbCopy::open(&path)?;
    let version: i64 = db
        .conn
        .query_row("SELECT value FROM meta WHERE key = 'version'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut stmt = db
        .conn
        .prepare(
            "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, \
             is_httponly, samesite, has_expires FROM cookies",
        )
        .map_err(|e| e.to_string())?;
    let now = now_1601_us();
    let mut keys: Option<Keys> = None;
    let mut cookies = Vec::new();
    let (mut total, mut expired, mut undecryptable) = (0, 0, 0);
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Vec<u8>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, i64>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows.flatten() {
        let (host, name, plain, enc, path, expires, secure, http_only, same_site, has_expires) = row;
        total += 1;
        if has_expires != 0 && expires != 0 && expires < now {
            expired += 1;
            continue;
        }
        let value = if !plain.is_empty() || enc.is_empty() {
            Some(plain)
        } else {
            let keys = keys.get_or_insert_with(|| load_keys(src));
            decrypt(keys, &enc, &host, version)
        };
        let Some(value) = value else {
            undecryptable += 1;
            continue;
        };
        cookies.push(Cookie {
            domain: host,
            name,
            value,
            path,
            secure: secure != 0,
            http_only: http_only != 0,
            same_site,
            expires: if has_expires != 0 { expires } else { 0 },
        });
    }
    Ok(json!({
        "cookies": cookies,
        "total": total,
        "expired": expired,
        "undecryptable": undecryptable,
    }))
}

fn firefox_cookies(src: &Source) -> Result<Value, String> {
    let db = DbCopy::open(&src.profile_dir.join("cookies.sqlite"))?;
    let mut stmt = db
        .conn
        .prepare(
            "SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes \
             FROM moz_cookies",
        )
        .map_err(|e| e.to_string())?;
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut cookies = Vec::new();
    let (mut total, mut expired, mut skipped) = (0, 0, 0);
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, String>(8)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows.flatten() {
        let (host, name, value, path, expiry, secure, http_only, same_site, origin_attrs) = row;
        total += 1;
        // Container tabs and partitioned cookies have no equivalent here.
        if !origin_attrs.is_empty() {
            skipped += 1;
            continue;
        }
        // Newer Firefox stores expiry in milliseconds.
        let expiry_secs = if expiry > 100_000_000_000 { expiry / 1000 } else { expiry };
        if expiry_secs < now_unix {
            expired += 1;
            continue;
        }
        cookies.push(Cookie {
            domain: host,
            name,
            value,
            path,
            secure: secure != 0,
            http_only: http_only != 0,
            // Firefox stores both "None" and "not set" as 0; Chromium would
            // reject "None" on a non-secure cookie, so 0 is only kept as
            // "None" when the cookie is secure.
            same_site: match same_site {
                0 if secure != 0 => 0,
                1 => 1,
                2 => 2,
                _ => -1,
            },
            expires: (expiry_secs + UNIX_TO_1601_SECS) * 1_000_000,
        });
    }
    Ok(json!({
        "cookies": cookies,
        "total": total,
        "expired": expired,
        "undecryptable": 0,
        "skipped": skipped,
    }))
}

// ------------------------------------------------------------------ bookmarks

fn chromium_node(v: &Value) -> Option<Value> {
    match v["type"].as_str()? {
        "url" => Some(json!({"title": v["name"], "url": v["url"]})),
        "folder" => {
            let children: Vec<Value> =
                v["children"].as_array()?.iter().filter_map(chromium_node).collect();
            Some(json!({"title": v["name"], "children": children}))
        }
        _ => None,
    }
}

fn chromium_bookmarks(src: &Source) -> Result<Value, String> {
    let text = fs::read_to_string(src.profile_dir.join("Bookmarks")).map_err(|_| "no bookmarks file")?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let roots = &v["roots"];
    let mut out = Vec::new();
    for (key, title) in [("bookmark_bar", "Bookmarks bar"), ("other", "Other bookmarks"), ("synced", "Mobile bookmarks")] {
        if let Some(node) = chromium_node(&roots[key]) {
            if node["children"].as_array().map(|c| !c.is_empty()).unwrap_or(false) {
                out.push(json!({"title": title, "children": node["children"]}));
            }
        }
    }
    Ok(json!({"roots": out}))
}

fn firefox_bookmarks(src: &Source) -> Result<Value, String> {
    let db = DbCopy::open(&src.profile_dir.join("places.sqlite"))?;
    struct Row { id: i64, kind: i64, parent: i64, title: Option<String>, url: Option<String> }
    let mut stmt = db
        .conn
        .prepare(
            "SELECT b.id, b.type, b.parent, b.title, p.url FROM moz_bookmarks b \
             LEFT JOIN moz_places p ON b.fk = p.id ORDER BY b.parent, b.position",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<Row> = stmt
        .query_map([], |r| {
            Ok(Row { id: r.get(0)?, kind: r.get(1)?, parent: r.get(2)?, title: r.get(3)?, url: r.get(4)? })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    let mut children: HashMap<i64, Vec<&Row>> = HashMap::new();
    for r in &rows {
        children.entry(r.parent).or_default().push(r);
    }
    fn build(id: i64, children: &HashMap<i64, Vec<&Row>>) -> Vec<Value> {
        children
            .get(&id)
            .map(|kids| {
                kids.iter()
                    .filter_map(|r| match r.kind {
                        1 => {
                            let url = r.url.clone()?;
                            if url.starts_with("place:") { return None; }
                            Some(json!({"title": r.title.clone().unwrap_or_default(), "url": url}))
                        }
                        2 => Some(json!({"title": r.title.clone().unwrap_or_default(), "children": build(r.id, children)})),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
    let guid_id = |guid: &str| -> Option<i64> {
        db.conn.query_row("SELECT id FROM moz_bookmarks WHERE guid = ?1", [guid], |r| r.get(0)).ok()
    };
    let mut out = Vec::new();
    for (guid, title) in [("toolbar_____", "Bookmarks bar"), ("menu________", "Bookmarks menu"),
                          ("unfiled_____", "Other bookmarks"), ("mobile______", "Mobile bookmarks")] {
        if let Some(id) = guid_id(guid) {
            let kids = build(id, &children);
            if !kids.is_empty() {
                out.push(json!({"title": title, "children": kids}));
            }
        }
    }
    Ok(json!({"roots": out}))
}

// ------------------------------------------------------------------ history

fn history(src: &Source, limit: i64) -> Result<Value, String> {
    let (path, sql) = match src.kind {
        Kind::Chromium => (src.profile_dir.join("History"),
            "SELECT url, title, visit_count FROM urls WHERE hidden = 0 AND url LIKE 'http%' \
             ORDER BY last_visit_time DESC LIMIT ?1"),
        Kind::Firefox => (src.profile_dir.join("places.sqlite"),
            "SELECT url, COALESCE(title, ''), visit_count FROM moz_places WHERE visit_count > 0 \
             AND hidden = 0 AND url LIKE 'http%' ORDER BY last_visit_date DESC LIMIT ?1"),
    };
    let db = DbCopy::open(&path)?;
    let mut stmt = db.conn.prepare(sql).map_err(|e| e.to_string())?;
    let entries: Vec<Value> = stmt
        .query_map([limit], |r| {
            Ok(json!({"url": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)?, "visits": r.get::<_, i64>(2)?}))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(json!({"entries": entries}))
}

// ------------------------------------------------------------------ extensions

fn extension_name(profile: &Path, id: &str, settings: &Value) -> String {
    let manifest_from_disk = || -> Option<(Value, PathBuf)> {
        let version = settings["manifest"]["version"].as_str().map(str::to_string).or_else(|| {
            fs::read_dir(profile.join("Extensions").join(id)).ok()?
                .flatten().map(|e| e.file_name().to_string_lossy().to_string()).max()
        })?;
        let dir = profile.join("Extensions").join(id).join(format!("{version}_0"));
        let dir = if dir.is_dir() { dir } else { profile.join("Extensions").join(id).join(&version) };
        let m: Value = serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).ok()?).ok()?;
        Some((m, dir))
    };
    let (manifest, dir) = match settings["manifest"]["name"].as_str() {
        Some(_) => (settings["manifest"].clone(), None),
        None => match manifest_from_disk() {
            Some((m, d)) => (m, Some(d)),
            None => return id.to_string(),
        },
    };
    let name = manifest["name"].as_str().unwrap_or(id).to_string();
    if let (Some(key), Some(dir)) = (name.strip_prefix("__MSG_").and_then(|s| s.strip_suffix("__")), dir) {
        let locale = manifest["default_locale"].as_str().unwrap_or("en");
        if let Some(msgs) = fs::read_to_string(dir.join("_locales").join(locale).join("messages.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        {
            if let Some(obj) = msgs.as_object() {
                for (k, v) in obj {
                    if k.eq_ignore_ascii_case(key) {
                        if let Some(m) = v["message"].as_str() {
                            return m.to_string();
                        }
                    }
                }
            }
        }
    }
    name
}

fn chromium_extensions(src: &Source) -> Result<Value, String> {
    let mut seen = HashMap::new();
    for file in ["Secure Preferences", "Preferences"] {
        let Ok(text) = fs::read_to_string(src.profile_dir.join(file)) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
        let Some(settings) = v["extensions"]["settings"].as_object() else { continue };
        for (id, s) in settings {
            let from_store = s["from_webstore"].as_bool().unwrap_or(false)
                || s["manifest"]["update_url"].as_str().map(|u| u.contains("clients2.google.com")).unwrap_or(false);
            // Location 1 is "internal" (installed by the user); component and
            // policy installs are left out.
            if !from_store || s["location"].as_i64().unwrap_or(1) != 1 || seen.contains_key(id) {
                continue;
            }
            let name = extension_name(&src.profile_dir, id, s);
            seen.insert(id.clone(), json!({
                "id": id,
                "name": name,
                "store": format!("https://chromewebstore.google.com/detail/{id}"),
            }));
        }
    }
    let mut list: Vec<Value> = seen.into_values().collect();
    list.sort_by(|a, b| a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase()));
    Ok(json!({"extensions": list, "chromeStore": true}))
}

fn firefox_extensions(src: &Source) -> Result<Value, String> {
    let text = fs::read_to_string(src.profile_dir.join("extensions.json")).map_err(|_| "no extensions list")?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    for a in v["addons"].as_array().cloned().unwrap_or_default() {
        if a["type"] != "extension" || a["location"] != "app-profile" {
            continue;
        }
        let name = a["defaultLocale"]["name"].as_str().unwrap_or("").to_string();
        if name.is_empty() { continue; }
        let query: String = name.chars().map(|c| if c.is_alphanumeric() { c } else { '+' }).collect();
        list.push(json!({
            "id": a["id"],
            "name": name,
            "store": format!("https://chromewebstore.google.com/search/{query}"),
        }));
    }
    Ok(json!({"extensions": list, "chromeStore": false}))
}

// ------------------------------------------------------------------ entry

fn sources_json() -> Value {
    let list: Vec<Value> = discover()
        .into_iter()
        .map(|s| {
            json!({
                "id": s.id,
                "browser": s.browser,
                "family": s.family,
                "profile": s.profile_name,
                "flatpak": s.flatpak_app.is_some(),
                "firefox": s.kind == Kind::Firefox,
            })
        })
        .collect();
    json!({"sources": list})
}

/// One import operation. Returns a JSON object; failures are {"error": ...}.
pub fn run(op: &str, arg: &str) -> Value {
    let result = match op {
        "sources" => Ok(sources_json()),
        "cookies" | "bookmarks" | "history" | "extensions" => find(arg).and_then(|src| match (op, src.kind) {
            ("cookies", Kind::Chromium) => chromium_cookies(&src),
            ("cookies", Kind::Firefox) => firefox_cookies(&src),
            ("bookmarks", Kind::Chromium) => chromium_bookmarks(&src),
            ("bookmarks", Kind::Firefox) => firefox_bookmarks(&src),
            ("history", _) => history(&src, 5000),
            ("extensions", Kind::Chromium) => chromium_extensions(&src),
            ("extensions", Kind::Firefox) => firefox_extensions(&src),
            _ => Err("unsupported".into()),
        }),
        _ => Err(format!("unknown operation {op}")),
    };
    result.unwrap_or_else(|e| json!({"error": e}))
}
