use serde::{Deserialize, Serialize};

use crate::sidecar::Sidecar;
use crate::sse::SseBuffer;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Local,
    Ollama,
    Openai,
    Anthropic,
    Google,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub kind: Kind,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub region: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub active: String,
    #[serde(default, rename = "provider")]
    pub providers: Vec<Provider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
}

fn data_url_parts(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("data:")?;
    let (mime, data) = rest.split_once(";base64,")?;
    Some((mime.to_owned(), data.to_owned()))
}

fn openai_messages(messages: &[Message], with_images: bool) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|m| {
            if m.images.is_empty() || !with_images {
                serde_json::json!({"role": m.role, "content": m.content})
            } else {
                let mut parts = vec![serde_json::json!({"type": "text", "text": m.content})];
                parts.extend(
                    m.images
                        .iter()
                        .map(|u| serde_json::json!({"type": "image_url", "image_url": {"url": u}})),
                );
                serde_json::json!({"role": m.role, "content": parts})
            }
        })
        .collect()
}

fn anthropic_messages(messages: &[Message]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|m| {
            if m.images.is_empty() {
                return serde_json::json!({"role": m.role, "content": m.content});
            }
            let mut parts: Vec<serde_json::Value> = m
                .images
                .iter()
                .filter_map(|u| data_url_parts(u))
                .map(|(mime, data)| serde_json::json!({"type": "image", "source": {"type": "base64", "media_type": mime, "data": data}}))
                .collect();
            parts.push(serde_json::json!({"type": "text", "text": m.content}));
            serde_json::json!({"role": m.role, "content": parts})
        })
        .collect()
}

pub fn accepts_images(kind: Kind) -> bool {
    !matches!(kind, Kind::Local)
}

#[derive(Debug, Clone, Serialize)]
pub struct Destination {
    pub provider: String,
    pub model: String,
    pub host: String,
    pub region: String,
    pub local: bool,
    pub images: bool,
    pub summary: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            active: "local".into(),
            providers: vec![Provider {
                id: "local".into(),
                kind: Kind::Local,
                label: "On this device".into(),
                base_url: String::new(),
                model: String::new(),
                region: String::new(),
            }],
        }
    }
}

impl Config {
    pub fn load() -> Self {
        std::fs::read_to_string(crate::paths::providers_path())
            .ok()
            .and_then(|t| toml::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let p = crate::paths::providers_path();
        std::fs::create_dir_all(p.parent().unwrap())?;
        std::fs::write(p, toml::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn get(&self, id: Option<&str>) -> anyhow::Result<&Provider> {
        let want = id.unwrap_or(&self.active);
        self.providers
            .iter()
            .find(|p| p.id == want)
            .ok_or_else(|| anyhow::anyhow!("no provider named {want}"))
    }

    pub fn upsert(&mut self, p: Provider) {
        match self.providers.iter_mut().find(|x| x.id == p.id) {
            Some(x) => *x = p,
            None => self.providers.push(p),
        }
    }

    pub fn remove(&mut self, id: &str) -> anyhow::Result<()> {
        if id == "local" {
            anyhow::bail!("the local provider cannot be removed");
        }
        self.providers.retain(|p| p.id != id);
        if self.active == id {
            self.active = "local".into();
        }
        Ok(())
    }
}

impl Provider {
    pub fn base(&self) -> String {
        let b = self.base_url.trim_end_matches('/');
        if !b.is_empty() {
            return b.to_owned();
        }
        match self.kind {
            Kind::Local => String::new(),
            Kind::Ollama => "http://127.0.0.1:11434".into(),
            Kind::Openai => "https://api.openai.com/v1".into(),
            Kind::Anthropic => "https://api.anthropic.com".into(),
            Kind::Google => "https://generativelanguage.googleapis.com".into(),
        }
    }

    pub fn needs_key(&self) -> bool {
        matches!(self.kind, Kind::Openai | Kind::Anthropic | Kind::Google)
    }

    pub fn destination(&self) -> Destination {
        let host = match self.kind {
            Kind::Local => "this device".to_owned(),
            _ => host_of(&self.base()),
        };
        let local = self.kind == Kind::Local || is_loopback_host(&host);
        let model = if self.kind == Kind::Local {
            crate::models::load_manifest()
                .ok()
                .and_then(|m| crate::models::selected_model(&m).ok().map(|e| e.id.clone()))
                .unwrap_or_default()
        } else {
            self.model.clone()
        };
        let summary = if local {
            format!("{model} · stays on this device")
        } else if self.region.is_empty() {
            format!("{model} · sent to {host}")
        } else {
            format!("{model} · sent to {host} ({})", self.region)
        };
        Destination {
            provider: self.id.clone(),
            model,
            host,
            region: self.region.clone(),
            local,
            images: accepts_images(self.kind),
            summary,
        }
    }
}

pub fn host_of(url: &str) -> String {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let hostport = rest.split('/').next().unwrap_or(rest);
    hostport
        .rsplit_once('@')
        .map(|(_, h)| h)
        .unwrap_or(hostport)
        .to_owned()
}

pub fn is_loopback_host(hostport: &str) -> bool {
    let host = if hostport.starts_with('[') {
        hostport
            .trim_start_matches('[')
            .split(']')
            .next()
            .unwrap_or("")
    } else {
        hostport.split(':').next().unwrap_or("")
    };
    host == "localhost"
        || host
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false)
}

fn client(local: bool) -> anyhow::Result<reqwest::Client> {
    let b = reqwest::Client::builder().user_agent(concat!("tobari/", env!("CARGO_PKG_VERSION")));
    Ok(if local { b.no_proxy() } else { b }.build()?)
}

fn key_for(p: &Provider) -> anyhow::Result<String> {
    crate::secrets::lookup(&p.id)?.ok_or_else(|| {
        anyhow::anyhow!(
            "no API key stored for {}. Run `tobari providers key {}`.",
            p.id,
            p.id
        )
    })
}

pub async fn chat(
    p: &Provider,
    sidecar: Option<&Sidecar>,
    messages: &[Message],
    max_tokens: u32,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> anyhow::Result<String> {
    let mut full = String::new();
    let mut emit = |s: &str| {
        full.push_str(s);
        on_delta(s);
    };
    match p.kind {
        Kind::Local => {
            let sc = sidecar.ok_or_else(|| anyhow::anyhow!("local model needs the sidecar"))?;
            let (port, token) = sc.ensure().await?;
            let url = format!("http://127.0.0.1:{port}/v1/chat/completions");
            let body =
                serde_json::json!({"messages": messages, "stream": true, "max_tokens": max_tokens});
            let resp = client(true)?
                .post(url)
                .bearer_auth(token)
                .json(&body)
                .send()
                .await?;
            stream_openai(resp, &mut emit).await?;
            sc.touch().await;
        }
        Kind::Ollama | Kind::Openai => {
            let base = if p.kind == Kind::Ollama {
                format!("{}/v1", p.base())
            } else {
                p.base()
            };
            let local = is_loopback_host(&host_of(&base));
            let mut req = client(local)?
                .post(format!("{base}/chat/completions"))
                .json(&serde_json::json!({"model": p.model, "messages": openai_messages(messages, true), "stream": true, "max_tokens": max_tokens}));
            if p.needs_key() {
                req = req.bearer_auth(key_for(p)?);
            }
            stream_openai(req.send().await?, &mut emit).await?;
        }
        Kind::Anthropic => {
            let (system, rest) = split_system(messages);
            let mut body = serde_json::json!({
                "model": p.model,
                "max_tokens": max_tokens,
                "stream": true,
                "messages": anthropic_messages(&rest),
            });
            if !system.is_empty() {
                body["system"] = system.into();
            }
            let resp = client(false)?
                .post(format!("{}/v1/messages", p.base()))
                .header("x-api-key", key_for(p)?)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await?;
            stream_json(resp, &mut emit, |v| {
                (v["type"] == "content_block_delta")
                    .then(|| v["delta"]["text"].as_str().map(str::to_owned))
                    .flatten()
            })
            .await?;
        }
        Kind::Google => {
            let (system, rest) = split_system(messages);
            let contents: Vec<_> = rest
                .iter()
                .map(|m| {
                    let mut parts: Vec<serde_json::Value> = m
                        .images
                        .iter()
                        .filter_map(|u| data_url_parts(u))
                        .map(|(mime, data)| serde_json::json!({"inline_data": {"mime_type": mime, "data": data}}))
                        .collect();
                    parts.push(serde_json::json!({"text": m.content}));
                    serde_json::json!({
                        "role": if m.role == "assistant" { "model" } else { "user" },
                        "parts": parts,
                    })
                })
                .collect();
            let mut body = serde_json::json!({
                "contents": contents,
                "generationConfig": {"maxOutputTokens": max_tokens},
            });
            if !system.is_empty() {
                body["systemInstruction"] = serde_json::json!({"parts": [{"text": system}]});
            }
            let resp = client(false)?
                .post(format!(
                    "{}/v1beta/models/{}:streamGenerateContent?alt=sse",
                    p.base(),
                    p.model
                ))
                .header("x-goog-api-key", key_for(p)?)
                .json(&body)
                .send()
                .await?;
            stream_json(resp, &mut emit, |v| {
                let parts = v.pointer("/candidates/0/content/parts")?.as_array()?;
                Some(parts.iter().filter_map(|x| x["text"].as_str()).collect())
            })
            .await?;
        }
    }
    Ok(full)
}

fn split_system(messages: &[Message]) -> (String, Vec<Message>) {
    let system = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let rest = messages
        .iter()
        .filter(|m| m.role != "system")
        .cloned()
        .collect();
    (system, rest)
}

async fn check(resp: reqwest::Response) -> anyhow::Result<reqwest::Response> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    let short: String = text.chars().take(400).collect();
    anyhow::bail!("provider returned HTTP {status}: {short}")
}

async fn stream_openai(
    resp: reqwest::Response,
    emit: &mut (dyn FnMut(&str) + Send),
) -> anyhow::Result<()> {
    stream_json(resp, emit, |v| {
        v.pointer("/choices/0/delta/content")
            .and_then(|c| c.as_str())
            .map(str::to_owned)
    })
    .await
}

async fn stream_json(
    resp: reqwest::Response,
    emit: &mut (dyn FnMut(&str) + Send),
    pick: impl Fn(&serde_json::Value) -> Option<String>,
) -> anyhow::Result<()> {
    let mut resp = check(resp).await?;
    let mut sse = SseBuffer::default();
    while let Some(chunk) = resp.chunk().await? {
        for payload in sse.feed(&chunk) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload) {
                if let Some(err) = v.get("error") {
                    anyhow::bail!("provider error: {err}");
                }
                if let Some(t) = pick(&v) {
                    if !t.is_empty() {
                        emit(&t);
                    }
                }
            }
        }
    }
    Ok(())
}

pub async fn list_models(p: &Provider) -> anyhow::Result<Vec<String>> {
    let mut ids: Vec<String> = match p.kind {
        Kind::Local => crate::models::load_manifest()?
            .into_iter()
            .map(|m| m.id)
            .collect(),
        Kind::Ollama => {
            let v: serde_json::Value = check(
                client(true)?
                    .get(format!("{}/api/tags", p.base()))
                    .send()
                    .await?,
            )
            .await?
            .json()
            .await?;
            v["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["name"].as_str().map(str::to_owned))
                .collect()
        }
        Kind::Openai => {
            let local = is_loopback_host(&host_of(&p.base()));
            let mut req = client(local)?.get(format!("{}/models", p.base()));
            if let Ok(Some(k)) = crate::secrets::lookup(&p.id) {
                req = req.bearer_auth(k);
            }
            let v: serde_json::Value = check(req.send().await?).await?.json().await?;
            v["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["id"].as_str().map(str::to_owned))
                .collect()
        }
        Kind::Anthropic => {
            let v: serde_json::Value = check(
                client(false)?
                    .get(format!("{}/v1/models?limit=100", p.base()))
                    .header("x-api-key", key_for(p)?)
                    .header("anthropic-version", "2023-06-01")
                    .send()
                    .await?,
            )
            .await?
            .json()
            .await?;
            v["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["id"].as_str().map(str::to_owned))
                .collect()
        }
        Kind::Google => {
            let v: serde_json::Value = check(
                client(false)?
                    .get(format!("{}/v1beta/models?pageSize=200", p.base()))
                    .header("x-goog-api-key", key_for(p)?)
                    .send()
                    .await?,
            )
            .await?
            .json()
            .await?;
            v["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| {
                    m["supportedGenerationMethods"]
                        .as_array()
                        .map(|a| a.iter().any(|x| x == "generateContent"))
                        .unwrap_or(false)
                })
                .filter_map(|m| {
                    m["name"]
                        .as_str()
                        .map(|n| n.trim_start_matches("models/").to_owned())
                })
                .collect()
        }
    };
    ids.sort();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_detection() {
        assert!(is_loopback_host("127.0.0.1:11434"));
        assert!(is_loopback_host("localhost"));
        assert!(is_loopback_host("[::1]:8080"));
        assert!(!is_loopback_host("api.anthropic.com"));
        assert!(!is_loopback_host("192.168.1.5:11434"));
    }

    #[test]
    fn destination_names_the_host() {
        let p = Provider {
            id: "anthropic".into(),
            kind: Kind::Anthropic,
            label: String::new(),
            base_url: String::new(),
            model: "some-model".into(),
            region: "US".into(),
        };
        let d = p.destination();
        assert!(!d.local);
        assert_eq!(d.host, "api.anthropic.com");
        assert_eq!(d.summary, "some-model · sent to api.anthropic.com (US)");
    }

    #[test]
    fn lan_ollama_is_not_local() {
        let p = Provider {
            id: "o".into(),
            kind: Kind::Ollama,
            label: String::new(),
            base_url: "http://192.168.1.9:11434".into(),
            model: "m".into(),
            region: String::new(),
        };
        assert!(!p.destination().local);
    }

    #[test]
    fn images_map_per_provider() {
        let m = vec![Message {
            role: "user".into(),
            content: "what is this".into(),
            images: vec!["data:image/jpeg;base64,AAAA".into()],
        }];
        let o = openai_messages(&m, true);
        assert_eq!(
            o[0]["content"][1]["image_url"]["url"],
            "data:image/jpeg;base64,AAAA"
        );
        let local = openai_messages(&m, false);
        assert_eq!(local[0]["content"], "what is this");
        let a = anthropic_messages(&m);
        assert_eq!(a[0]["content"][0]["source"]["media_type"], "image/jpeg");
        assert_eq!(a[0]["content"][0]["source"]["data"], "AAAA");
    }

    #[test]
    fn system_messages_are_split() {
        let m = vec![
            Message {
                role: "system".into(),
                content: "a".into(),
                images: vec![],
            },
            Message {
                role: "user".into(),
                content: "b".into(),
                images: vec![],
            },
        ];
        let (s, r) = split_system(&m);
        assert_eq!(s, "a");
        assert_eq!(r.len(), 1);
    }
}
