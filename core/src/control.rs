use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::host::Host;

const FORWARDED: &[&str] = &[
    "tabs.list",
    "tabs.open",
    "tabs.focus",
    "tabs.discard",
    "ping",
];

pub async fn serve(host: Arc<Host>) -> anyhow::Result<()> {
    let dir = crate::paths::runtime_dir();
    crate::paths::ensure_private_dir(&dir)?;
    let path = crate::paths::control_socket();
    if path.exists() {
        if UnixStream::connect(&path).await.is_ok() {
            anyhow::bail!("another Tobari window already owns {}", path.display());
        }
        std::fs::remove_file(&path)?;
    }
    let listener = UnixListener::bind(&path)?;
    let uid = unsafe { libc::getuid() };
    loop {
        let (stream, _) = listener.accept().await?;
        if stream.peer_cred().map(|c| c.uid() != uid).unwrap_or(true) {
            continue;
        }
        let h = host.clone();
        tokio::spawn(async move {
            let _ = client(h, stream).await;
        });
    }
}

async fn client(host: Arc<Host>, stream: UnixStream) -> anyhow::Result<()> {
    let (r, mut w) = stream.into_split();
    let mut lines = BufReader::new(r).lines();
    while let Some(line) = lines.next_line().await? {
        let req: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let op = req["op"].as_str().unwrap_or("");
        let resp = if FORWARDED.contains(&op) {
            match host.browser(op, req["args"].clone()).await {
                Ok(d) => json!({"ok": true, "data": d}),
                Err(e) => json!({"ok": false, "error": format!("{e:#}")}),
            }
        } else {
            json!({"ok": false, "error": format!("unknown op {op:?}")})
        };
        w.write_all(format!("{resp}\n").as_bytes()).await?;
    }
    Ok(())
}

pub async fn call(op: &str, args: Value) -> anyhow::Result<Value> {
    let path = crate::paths::control_socket();
    let stream = UnixStream::connect(&path)
        .await
        .map_err(|_| anyhow::anyhow!("Tobari is not running (no {})", path.display()))?;
    let (r, mut w) = stream.into_split();
    w.write_all(format!("{}\n", json!({"op": op, "args": args})).as_bytes())
        .await?;
    let mut lines = BufReader::new(r).lines();
    let line = lines
        .next_line()
        .await?
        .ok_or_else(|| anyhow::anyhow!("Tobari closed the connection"))?;
    let v: Value = serde_json::from_str(&line)?;
    if v["ok"].as_bool() == Some(true) {
        Ok(v["data"].clone())
    } else {
        anyhow::bail!("{}", v["error"].as_str().unwrap_or("error"))
    }
}
