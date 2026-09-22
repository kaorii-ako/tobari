use crate::models::ModelEntry;

pub async fn chat_loop(
    port: u16,
    token: &str,
    backend: crate::backend::Backend,
    model_id: &str,
    manifest: &[ModelEntry],
) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let backend_name = backend.as_str().to_owned();
    let active = model_id.to_owned();
    loop {
        let req = match crate::host::read_message()? {
            None => break,
            Some(r) => r,
        };
        match req {
            crate::host::HostRequest::Status => {
                let probe = client
                    .get(format!("http://127.0.0.1:{port}/health"))
                    .bearer_auth(token)
                    .send()
                    .await;
                let healthy = probe.map(|r| r.status().is_success()).unwrap_or(false);
                let resp = crate::host::HostResponse::Status {
                    backend: backend_name.clone(),
                    model: active.clone(),
                    port,
                    healthy,
                };
                crate::host::write_message(&resp)?;
            }
            crate::host::HostRequest::Models => {
                let mut infos = Vec::new();
                for m in manifest {
                    infos.push(crate::host::ModelInfo {
                        id: m.id.clone(),
                        downloaded: crate::models::model_file_path(m).is_file(),
                        active: m.id == active,
                    });
                }
                crate::host::write_message(&crate::host::HostResponse::Models {
                    models: infos,
                })?;
            }
            crate::host::HostRequest::SetModel { id } => {
                let _ = id;
                crate::host::write_message(&crate::host::HostResponse::Error {
                    message: "model switching requires a restart in Phase 1".to_owned(),
                })?;
            }
            crate::host::HostRequest::Chat { messages, stream } => {
                let _ = stream;
                let body = serde_json::json!({ "messages": messages, "stream": true });
                let url = format!("http://127.0.0.1:{port}/v1/chat/completions");
                let res = client.post(url).bearer_auth(token).json(&body).send().await?;
                if !res.status().is_success() {
                    crate::host::write_message(&crate::host::HostResponse::Error {
                        message: "model error".to_owned(),
                    })?;
                    continue;
                }
                super::proxy_stream(res).await?;
            }
        }
    }
    Ok(())
}

pub async fn proxy_stream(mut resp: reqwest::Response) -> anyhow::Result<()> {
    let mut buf = String::new();
    loop {
        match resp.chunk().await? {
            None => break,
            Some(chunk) => {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                drain_lines(&mut buf)?;
            }
        }
    }
    crate::host::write_message(&crate::host::HostResponse::Chunk {
        content: String::new(),
        done: true,
    })?;
    Ok(())
}

fn drain_lines(buf: &mut String) -> anyhow::Result<()> {
    while let Some(pos) = buf.find('\n') {
        let line: String = buf.drain(..=pos).collect();
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let payload = line.strip_prefix("data:").map(str::trim).unwrap_or(line);
        if payload == "[DONE]" {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
            let piece = v
                .pointer("/choices/0/delta/content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_owned();
            if !piece.is_empty() {
                crate::host::write_message(&crate::host::HostResponse::Chunk {
                    content: piece,
                    done: false,
                })?;
            }
        }
    }
    Ok(())
}
