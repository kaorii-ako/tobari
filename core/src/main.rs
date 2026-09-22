mod backend;
mod chat;
mod download;
mod host;
mod install;
mod models;
mod paths;
mod serve;
mod supervise;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "tobari-core", version)]
struct Cli {
    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Subcommand)]
enum Cmd {
    Serve,
    Download {
        #[arg(long)]
        model: Option<String>,
    },
    Status,
    Install {
        #[arg(long)]
        ext_id: String,
    },
    Uninstall,
    Sha {
        file: std::path::PathBuf,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.cmd.unwrap_or(Cmd::Serve) {
        Cmd::Sha { file } => {
            let digest = download::sha256_file(&file)?;
            println!("{digest}  {}", file.display());
            Ok(())
        }
        Cmd::Download { model } => run_download(model),
        Cmd::Status => run_status(),
        Cmd::Install { ext_id } => install::install(&ext_id),
        Cmd::Uninstall => install::uninstall(),
        Cmd::Serve => serve(),
    }
}

fn run_download(model: Option<String>) -> anyhow::Result<()> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let (_, models) = models::load_manifest()?;
        let want = match model {
            Some(id) => id,
            None => models::default_model(&models)?.id.clone(),
        };
        let entry = models
            .iter()
            .find(|m| m.id == want)
            .ok_or_else(|| anyhow::anyhow!("unknown model id"))?;
        download::download_verified(entry).await
    })
}

fn run_status() -> anyhow::Result<()> {
    let (_, manifest) = models::load_manifest()?;
    let backend = backend::detect();
    println!("backend: {}", backend.as_str());
    if backend == backend::Backend::Cpu {
        println!("note: no usable GPU detected, running on CPU will be slow");
    }
    for m in &manifest {
        let present = models::model_file_path(m).is_file();
        let mark = if m.default { "(default)" } else { "" };
        println!("{}  downloaded={}  {}", m.id, present, mark);
    }
    Ok(())
}

fn serve() -> anyhow::Result<()> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    rt.block_on(serve::serve_async())
}

