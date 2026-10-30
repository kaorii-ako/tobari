use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};

use crate::guard;
use crate::memory::Memory;
use crate::providers::{self, Config, Message};
use crate::sidecar::Sidecar;

pub const HOST_ID: &str = "dev.tobari.core";
pub const EXTENSION_ID: &str = "dbpaojilndlchffoodnamfgjccblnpoe";
const MAX_IN: usize = 32 * 1024 * 1024;
const MAX_OUT: usize = 900 * 1024;

#[derive(Clone)]
pub struct Out {
    lock: Arc<Mutex<()>>,
}

impl Out {
    fn new() -> Self {
        Out {
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn send(&self, v: &Value) {
        let bytes = serde_json::to_vec(v).unwrap_or_default();
        if bytes.len() > MAX_OUT {
            let id = v.get("id").cloned().unwrap_or(Value::Null);
            let text = String::from_utf8_lossy(&bytes).into_owned();
            let mut parts = Vec::new();
            let mut cur = String::new();
            for c in text.chars() {
                if cur.len() + c.len_utf8() > MAX_OUT / 2 {
                    parts.push(std::mem::take(&mut cur));
                }
                cur.push(c);
            }
            parts.push(cur);
            let n = parts.len();
            for (i, p) in parts.into_iter().enumerate() {
                self.raw(&json!({"id": id, "type": "part", "seq": i, "count": n, "data": p}));
            }
            return;
        }
        self.raw(v);
    }

    fn raw(&self, v: &Value) {
        let bytes = serde_json::to_vec(v).unwrap_or_default();
        let _g = self.lock.lock().unwrap();
        let mut o = std::io::stdout().lock();
        let _ = o.write_all(&(bytes.len() as u32).to_ne_bytes());
        let _ = o.write_all(&bytes);
        let _ = o.flush();
    }
}

fn read_frame(stdin: &mut impl Read) -> anyhow::Result<Option<Value>> {
    let mut len = [0u8; 4];
    match stdin.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let n = u32::from_ne_bytes(len) as usize;
    if n == 0 || n > MAX_IN {
        anyhow::bail!("native message length out of range: {n}");
    }
    let mut buf = vec![0u8; n];
    stdin.read_exact(&mut buf)?;
    Ok(Some(serde_json::from_slice(&buf)?))
}

type Pending = Arc<AsyncMutex<HashMap<String, oneshot::Sender<Value>>>>;

pub struct Host {
    out: Out,
    sidecar: Sidecar,
    pending: Pending,
    seq: AtomicU64,
}

pub async fn run(origin: &str) -> anyhow::Result<()> {
    if !origin.starts_with("chrome-extension://") {
        anyhow::bail!("unexpected native messaging origin {origin}");
    }
    let settings = crate::settings::Settings::load();
    let host = Arc::new(Host {
        out: Out::new(),
        sidecar: Sidecar::new(std::time::Duration::from_secs(settings.idle_unload_secs)),
        pending: Arc::new(AsyncMutex::new(HashMap::new())),
        seq: AtomicU64::new(0),
    });
    let _ = crate::skills::install_bundled(&crate::paths::skills_dir());
    let (tx, mut rx) = mpsc::channel::<Value>(64);
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        while let Ok(Some(v)) = read_frame(&mut stdin) {
            if tx.blocking_send(v).is_err() {
                break;
            }
        }
    });
    let ctl = host.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::control::serve(ctl).await {
            eprintln!("control socket disabled: {e:#}");
        }
    });
    while let Some(msg) = rx.recv().await {
        let h = host.clone();
        tokio::spawn(async move { h.handle(msg).await });
    }
    host.sidecar.stop().await;
    let _ = std::fs::remove_file(crate::paths::control_socket());
    Ok(())
}

impl Host {
    pub async fn browser(&self, op: &str, args: Value) -> anyhow::Result<Value> {
        let id = format!("ctl-{}", self.seq.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), tx);
        self.out
            .send(&json!({"type": "browser", "id": id, "op": op, "args": args}));
        match tokio::time::timeout(std::time::Duration::from_secs(20), rx).await {
            Ok(Ok(v)) => Ok(v),
            _ => {
                self.pending.lock().await.remove(&id);
                anyhow::bail!("the browser did not answer {op}")
            }
        }
    }

    async fn handle(&self, msg: Value) {
        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let ty = msg["type"].as_str().unwrap_or("").to_owned();
        if ty == "browser_result" {
            if let Some(key) = id.as_str() {
                if let Some(tx) = self.pending.lock().await.remove(key) {
                    let _ = tx.send(msg.get("data").cloned().unwrap_or(Value::Null));
                }
            }
            return;
        }
        match self.dispatch(&ty, &msg, &id).await {
            Ok(Some(data)) => self
                .out
                .send(&json!({"id": id, "type": "result", "data": data})),
            Ok(None) => {}
            Err(e) => self
                .out
                .send(&json!({"id": id, "type": "error", "message": format!("{e:#}")})),
        }
    }

    async fn dispatch(&self, ty: &str, m: &Value, id: &Value) -> anyhow::Result<Option<Value>> {
        let s = |k: &str| m[k].as_str().unwrap_or("").to_owned();
        let v = match ty {
            "status" => {
                let cfg = Config::load();
                let p = cfg.get(None)?;
                json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "sidecar": self.sidecar.status().await,
                    "provider": p,
                    "destination": p.destination(),
                })
            }
            "providers.list" => {
                let cfg = Config::load();
                let list: Vec<Value> = cfg
                    .providers
                    .iter()
                    .map(|p| {
                        let has_key = !p.needs_key()
                            || crate::secrets::lookup(&p.id).ok().flatten().is_some();
                        json!({"provider": p, "destination": p.destination(), "has_key": has_key})
                    })
                    .collect();
                json!({"active": cfg.active, "providers": list})
            }
            "providers.save" => {
                let p: providers::Provider = serde_json::from_value(m["provider"].clone())?;
                if p.id.is_empty() || !p.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                    anyhow::bail!("provider id must be letters, digits and dashes");
                }
                let mut cfg = Config::load();
                cfg.upsert(p);
                cfg.save()?;
                json!(true)
            }
            "providers.remove" => {
                let mut cfg = Config::load();
                cfg.remove(&s("provider"))?;
                cfg.save()?;
                json!(true)
            }
            "providers.use" => {
                let mut cfg = Config::load();
                cfg.get(Some(&s("provider")))?;
                cfg.active = s("provider");
                cfg.save()?;
                json!(cfg.get(None)?.destination())
            }
            "providers.set_key" => {
                crate::secrets::store(&s("provider"), &s("key"))?;
                json!(true)
            }
            "providers.models" => {
                let cfg = Config::load();
                json!(providers::list_models(cfg.get(Some(&s("provider")))?).await?)
            }
            "models.list" => json!(crate::models::infos()?),
            "models.select" => {
                crate::models::save_selection(&s("model"))?;
                self.sidecar.stop().await;
                json!(true)
            }
            "models.delete" => {
                self.sidecar.stop().await;
                crate::models::delete(&s("model"))?;
                json!(true)
            }
            "models.download" => {
                let models = crate::models::load_manifest()?;
                let want = s("model");
                let entry = models
                    .iter()
                    .find(|x| x.id == want)
                    .ok_or_else(|| anyhow::anyhow!("unknown model {want}"))?
                    .clone();
                let out = self.out.clone();
                let pid = id.clone();
                let last = Arc::new(AtomicU64::new(0));
                crate::download::download_verified(&entry, &move |done, total| {
                    let mb = done / 1_048_576;
                    if mb != last.swap(mb, Ordering::Relaxed) {
                        out.send(
                            &json!({"id": pid, "type": "progress", "done": done, "total": total}),
                        );
                    }
                })
                .await?;
                if !crate::paths::llama_bin().is_file() {
                    crate::deps::install_llama().await?;
                }
                json!(true)
            }
            "sidecar.stop" => {
                self.sidecar.stop().await;
                json!(true)
            }
            "chat" => {
                let cfg = Config::load();
                let pid = m["provider"].as_str().filter(|x| !x.is_empty());
                let p = cfg.get(pid)?.clone();
                let messages: Vec<Message> = serde_json::from_value(m["messages"].clone())?;
                let max_tokens = m["max_tokens"].as_u64().unwrap_or(2048) as u32;
                let out = self.out.clone();
                let did = id.clone();
                self.out
                    .send(&json!({"id": id, "type": "destination", "data": p.destination()}));
                let text =
                    providers::chat(&p, Some(&self.sidecar), &messages, max_tokens, &mut |d| {
                        out.send(&json!({"id": did, "type": "delta", "text": d}))
                    })
                    .await?;
                json!({"text": text})
            }
            "guard.wrap" => json!(guard::wrap_untrusted(&s("source"), &s("text"))),
            "guard.rules" => json!(guard::SYSTEM_RULES),
            "guard.parse" => json!(guard::parse_action(&s("text"))),
            "guard.check" => {
                let action: guard::Action = serde_json::from_value(m["action"].clone())?;
                let ctx: guard::Context = serde_json::from_value(m["context"].clone())?;
                let mut verdict = guard::check(&action, &ctx);
                if verdict.decision != guard::Decision::Deny
                    && m["judge"].as_bool().unwrap_or(false)
                {
                    let cfg = Config::load();
                    let p = cfg.get(None)?.clone();
                    let prompt = guard::judge_prompt(&action, &ctx.user_request);
                    match providers::chat(&p, Some(&self.sidecar), &prompt, 60, &mut |_| {}).await {
                        Ok(reply) if guard::judge_says_yes(&reply) => {}
                        Ok(reply) => {
                            verdict.decision = guard::Decision::Confirm;
                            verdict.reasons.push(format!(
                                "second check: {}",
                                reply.trim().chars().take(160).collect::<String>()
                            ));
                        }
                        Err(e) => {
                            verdict.decision = guard::Decision::Confirm;
                            verdict
                                .reasons
                                .push(format!("second check unavailable: {e}"));
                        }
                    }
                }
                json!(verdict)
            }
            "skills.list" => {
                let (skills, errors) = crate::skills::load_all(&crate::paths::skills_dir());
                json!({"skills": skills, "errors": errors})
            }
            "skills.for_site" => {
                let host = s("host");
                let (skills, _) = crate::skills::load_all(&crate::paths::skills_dir());
                json!(skills
                    .into_iter()
                    .filter(|k| crate::skills::matches_site(k, &host))
                    .collect::<Vec<_>>())
            }
            "skills.get" => json!(crate::skills::find(
                &crate::paths::skills_dir(),
                &s("name")
            )?),
            "skills.create" => {
                let sites: Vec<String> =
                    serde_json::from_value(m["sites"].clone()).unwrap_or_default();
                let d = crate::skills::create_from_prompt(
                    &crate::paths::skills_dir(),
                    &s("name"),
                    &s("description"),
                    &s("prompt"),
                    &sites,
                )?;
                json!(d)
            }
            "memory.list" => json!(Memory::open()?.list()?),
            "memory.read" => json!(Memory::open()?.read(&s("name"))?),
            "memory.write" => {
                let name = m["name"].as_str();
                json!(Memory::open()?.write(
                    name,
                    &s("content"),
                    m["append"].as_bool().unwrap_or(true)
                )?)
            }
            "memory.delete" => {
                Memory::open()?.delete(&s("name"))?;
                json!(true)
            }
            "memory.search" => {
                json!(Memory::open()?
                    .search(&s("query"), m["limit"].as_u64().unwrap_or(20) as usize)?)
            }
            "memory.export" => json!(Memory::open()?.export()?),
            "import.detect" => json!(crate::import::detect(&crate::paths::home())),
            "import.read" => {
                let path = s("path");
                let profile = crate::import::detect(&crate::paths::home())
                    .into_iter()
                    .find(|p| p.path.to_string_lossy() == path)
                    .ok_or_else(|| anyhow::anyhow!("not a detected profile: {path}"))?;
                let limit = m["history_limit"].as_u64().unwrap_or(5000) as usize;
                json!(
                    tokio::task::spawn_blocking(move || crate::import::read(&profile, limit))
                        .await?
                )
            }
            "roles.list" => json!(crate::roles::ROLES),
            "settings.get" => json!(crate::settings::Settings::load()),
            "settings.save" => {
                let st: crate::settings::Settings = serde_json::from_value(m["settings"].clone())?;
                st.save()?;
                json!(true)
            }
            "crash.list" => json!(crate::crash::list()?),
            "crash.read" => json!(crate::crash::read(&s("name"))?),
            "crash.delete" => {
                crate::crash::delete(&s("name"))?;
                json!(true)
            }
            other => anyhow::bail!("unknown request type {other:?}"),
        };
        Ok(Some(v))
    }
}

pub fn manifest_json(host_path: &str) -> String {
    serde_json::to_string_pretty(&json!({
        "name": HOST_ID,
        "description": "Tobari core: local AI, skills, memory",
        "path": host_path,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    }))
    .unwrap()
}

pub fn install_manifests() -> anyhow::Result<Vec<String>> {
    let exe = std::env::current_exe()?;
    let mut done = Vec::new();
    for t in crate::paths::native_manifest_dirs() {
        std::fs::create_dir_all(&t.dir)?;
        let dest = t.dir.join(format!("{HOST_ID}.json"));
        std::fs::write(&dest, manifest_json(&exe.to_string_lossy()))?;
        done.push(format!("{}: {}", t.name, dest.display()));
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    #[test]
    fn frames_roundtrip() {
        let body = br#"{"id":1,"type":"status"}"#;
        let mut buf = (body.len() as u32).to_ne_bytes().to_vec();
        buf.extend_from_slice(body);
        let mut cur = std::io::Cursor::new(buf);
        let v = super::read_frame(&mut cur).unwrap().unwrap();
        assert_eq!(v["type"], "status");
        assert!(super::read_frame(&mut cur).unwrap().is_none());
    }

    #[test]
    fn rejects_oversized_frames() {
        let mut cur = std::io::Cursor::new(u32::MAX.to_ne_bytes().to_vec());
        assert!(super::read_frame(&mut cur).is_err());
    }

    #[test]
    fn manifest_pins_the_extension() {
        let m = super::manifest_json("/opt/tobari/tobari");
        assert!(m.contains(super::EXTENSION_ID));
        assert!(!m.contains("*"));
    }
}
