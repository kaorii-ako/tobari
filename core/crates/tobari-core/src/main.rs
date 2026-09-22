mod chat;
mod config;
mod gpu;
mod llama;
mod manifests;
mod models;
mod native_host;
mod server;

use anyhow::Result;
use serde_json::{json, Value};
use std::io::BufReader;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::config::Catalog;
use crate::server::AppState;

fn validate_environment() -> Result<()> {
    let info = gpu::detect();
    println!(
        "backend: {} · VRAM: {:.1} GB · device: {}",
        info.backend.as_str(),
        info.vram_gb,
        info.device_name
    );
    let paths = config::paths()?;
    paths.ensure()?;
    let catalog = Catalog::load(&config::resolve_catalog_path(&paths)?)?;
    println!(
        "llama.cpp pin: {} ({})",
        catalog.llama_cpp_tag, catalog.llama_cpp_repo
    );
    for model in &catalog.models {
        let path = models::model_path(&paths, model);
        if path.exists() {
            models::verify_sha256(&path, &model.sha256)?;
            println!("model {} verified at {}", model.id, path.display());
        } else {
            println!("model {} not downloaded", model.id);
        }
    }
    let server = manifests::llama_server_path()?;
    println!("llama-server: {}", server.display());
    manifests::report_targets()?;
    Ok(())
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--version") {
        println!("tobari-core 0.1.0");
        return Ok(());
    }
    if args.iter().any(|a| a == "--install-manifests") {
        manifests::install_manifests()?;
        return Ok(());
    }
    if args.iter().any(|a| a == "--uninstall") {
        manifests::uninstall_manifests()?;
        return Ok(());
    }
    if args.iter().any(|a| a == "--doctor") {
        manifests::report_targets()?;
        return Ok(());
    }
    if args.iter().any(|a| a == "--validate") {
        validate_environment()?;
        return Ok(());
    }

    let paths = config::paths()?;
    paths.ensure()?;
    let catalog = Catalog::load(&config::resolve_catalog_path(&paths)?)?;
    let state = Arc::new(AppState {
        catalog,
        paths,
        llama: Mutex::new(None),
        out: std::sync::Mutex::new(std::io::stdout()),
    });

    server::send_status(&state, "starting", None);
    tokio::spawn(server::supervise(Arc::clone(&state)));

    let stdin = std::io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    loop {
        let message: Value = match native_host::read_message(&mut reader) {
            Ok(Some(value)) => value,
            Ok(None) => break,
            Err(err) => {
                eprintln!("{err}");
                break;
            }
        };
        let kind = message["type"].as_str().unwrap_or_default().to_string();
        match kind.as_str() {
            "get_status" => server::send_status(&state, "starting", None),
            "get_catalog" => chat::handle_catalog(&state).await,
            "download_model" => {
                let state = Arc::clone(&state);
                tokio::spawn(async move { chat::handle_download(&state, &message).await });
            }
            "chat" => {
                let state = Arc::clone(&state);
                tokio::spawn(async move { chat::handle_chat(&state, &message).await });
            }
            "hello" => {
                let origin = message["origin"].as_str().unwrap_or_default();
                match native_host::validate_origin(origin) {
                    Ok(()) => server::send(&state, &json!({ "type": "hello_ok" })),
                    Err(err) => server::send_error(&state, None, &err.to_string()),
                }
            }
            other => server::send_error(&state, None, &format!("unknown message type {other}")),
        }
    }
    Ok(())
}
