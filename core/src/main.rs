mod backend;
mod control;
mod crash;
mod deps;
mod download;
mod extract;
mod guard;
mod host;
mod import;
mod memory;
mod models;
mod paths;
mod providers;
mod roles;
mod secrets;
mod settings;
mod sidecar;
mod skills;
mod sse;

use std::io::{Read, Write};

use clap::{Parser, Subcommand};
use serde_json::json;

#[derive(Parser)]
#[command(name = "tobari", version, about = "Tobari: local-first AI browser")]
struct Cli {
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Open {
        urls: Vec<String>,
    },
    Tabs,
    Sleep {
        #[arg(long, default_value_t = 0)]
        idle_minutes: u32,
    },
    Chat {
        prompt: Vec<String>,
        #[arg(long)]
        provider: Option<String>,
    },
    #[command(subcommand)]
    Skill(SkillCmd),
    #[command(subcommand)]
    Memory(MemoryCmd),
    #[command(subcommand)]
    Models(ModelsCmd),
    #[command(subcommand)]
    Providers(ProvidersCmd),
    #[command(subcommand)]
    Import(ImportCmd),
    Setup {
        #[arg(long)]
        model: Option<String>,
        #[arg(short, long)]
        yes: bool,
    },
    InstallHost,
    Status,
    Crashes,
    Host {
        origin: String,
    },
}

#[derive(Subcommand)]
enum SkillCmd {
    List,
    Show {
        name: String,
    },
    Run {
        name: String,
        #[arg(long)]
        url: Option<String>,
        #[arg(long)]
        file: Option<std::path::PathBuf>,
        #[arg(long, default_value = "")]
        input: String,
        #[arg(long)]
        provider: Option<String>,
    },
    New {
        name: String,
        #[arg(long)]
        description: String,
        #[arg(long)]
        prompt: String,
        #[arg(long)]
        site: Vec<String>,
    },
}

#[derive(Subcommand)]
enum MemoryCmd {
    List,
    Show {
        name: String,
    },
    Search {
        query: Vec<String>,
    },
    Add {
        #[arg(long)]
        name: Option<String>,
        text: Vec<String>,
    },
    Export {
        #[arg(long)]
        out: Option<std::path::PathBuf>,
    },
}

#[derive(Subcommand)]
enum ModelsCmd {
    List,
    Download { id: Option<String> },
    Use { id: String },
    Delete { id: String },
}

#[derive(Subcommand)]
enum ProvidersCmd {
    List,
    Add {
        id: String,
        #[arg(long, value_enum)]
        kind: KindArg,
        #[arg(long, default_value = "")]
        base_url: String,
        #[arg(long, default_value = "")]
        model: String,
        #[arg(long, default_value = "")]
        region: String,
    },
    Use {
        id: String,
    },
    Key {
        id: String,
    },
    Models {
        id: String,
    },
    Remove {
        id: String,
    },
}

#[derive(Clone, Copy, clap::ValueEnum)]
enum KindArg {
    Local,
    Ollama,
    Openai,
    Anthropic,
    Google,
}

#[derive(Subcommand)]
enum ImportCmd {
    Detect,
    Show {
        path: String,
        #[arg(long, default_value_t = 20)]
        history: usize,
    },
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let result = if args
        .get(1)
        .map(|a| a.starts_with("chrome-extension://"))
        .unwrap_or(false)
    {
        runtime().and_then(|rt| rt.block_on(host::run(&args[1])))
    } else {
        run(Cli::parse())
    };
    if let Err(e) = result {
        eprintln!("tobari: {e:#}");
        std::process::exit(1);
    }
}

fn runtime() -> anyhow::Result<tokio::runtime::Runtime> {
    Ok(tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?)
}

fn print(json_mode: bool, v: serde_json::Value, human: impl FnOnce(&serde_json::Value)) {
    if json_mode {
        println!("{}", serde_json::to_string_pretty(&v).unwrap());
    } else {
        human(&v);
    }
}

fn run(cli: Cli) -> anyhow::Result<()> {
    let j = cli.json;
    match cli.cmd {
        Cmd::Host { origin } => runtime()?.block_on(host::run(&origin)),
        Cmd::Open { urls } => open(urls),
        Cmd::Tabs => {
            let tabs = runtime()?.block_on(control::call("tabs.list", json!({})))?;
            print(j, tabs, |v| {
                for t in v.as_array().into_iter().flatten() {
                    let mark = if t["active"].as_bool() == Some(true) {
                        "*"
                    } else {
                        " "
                    };
                    println!(
                        "{mark} {:>6}  {}  {}",
                        t["id"],
                        t["title"].as_str().unwrap_or(""),
                        t["url"].as_str().unwrap_or("")
                    );
                }
            });
            Ok(())
        }
        Cmd::Sleep { idle_minutes } => {
            let r = runtime()?.block_on(control::call(
                "tabs.discard",
                json!({"minutes": idle_minutes}),
            ))?;
            print(j, r.clone(), |v| {
                println!("{} tabs put to sleep", v["discarded"])
            });
            Ok(())
        }
        Cmd::Chat { prompt, provider } => {
            let msgs = vec![
                providers::Message {
                    role: "system".into(),
                    content: guard::SYSTEM_RULES.into(),
                    images: vec![],
                },
                providers::Message {
                    role: "user".into(),
                    content: prompt.join(" "),
                    images: vec![],
                },
            ];
            stream(provider.as_deref(), msgs)
        }
        Cmd::Skill(c) => skill(c, j),
        Cmd::Memory(c) => memory_cmd(c, j),
        Cmd::Models(c) => models_cmd(c, j),
        Cmd::Providers(c) => providers_cmd(c, j),
        Cmd::Import(c) => import_cmd(c, j),
        Cmd::Setup { model, yes } => deps::setup_interactive(model, yes),
        Cmd::InstallHost => {
            for line in host::install_manifests()? {
                println!("installed {line}");
            }
            let n = skills::install_bundled(&paths::skills_dir())?;
            println!(
                "skills: {n} installed into {}",
                paths::skills_dir().display()
            );
            Ok(())
        }
        Cmd::Status => {
            let cfg = providers::Config::load();
            let p = cfg.get(None)?;
            let models = models::load_manifest()?;
            let m = models::selected_model(&models)?;
            let v = json!({
                "version": env!("CARGO_PKG_VERSION"),
                "backend": backend::detect().as_str(),
                "llama_server": paths::llama_bin(),
                "llama_server_found": paths::llama_bin().is_file(),
                "model": m.id,
                "model_downloaded": models::model_file_path(m).is_file(),
                "destination": p.destination(),
                "skills_dir": paths::skills_dir(),
                "memory_dir": paths::memory_dir(),
                "running": paths::control_socket().exists(),
            });
            print(j, v, |v| {
                println!("tobari {}", v["version"].as_str().unwrap_or(""));
                println!(
                    "prompts go to: {}",
                    v["destination"]["summary"].as_str().unwrap_or("")
                );
                println!("backend: {}", v["backend"].as_str().unwrap_or(""));
                println!(
                    "local model: {} (downloaded: {})",
                    v["model"].as_str().unwrap_or(""),
                    v["model_downloaded"]
                );
                println!(
                    "llama-server: {} (found: {})",
                    v["llama_server"].as_str().unwrap_or(""),
                    v["llama_server_found"]
                );
                println!("skills: {}", v["skills_dir"].as_str().unwrap_or(""));
                println!("memory: {}", v["memory_dir"].as_str().unwrap_or(""));
            });
            Ok(())
        }
        Cmd::Crashes => {
            let list = crash::list()?;
            print(j, json!(list), |v| {
                let a = v.as_array().cloned().unwrap_or_default();
                if a.is_empty() {
                    println!("no crash reports in {}", paths::crash_dir().display());
                }
                for r in a {
                    println!("{}  {} bytes", r["name"].as_str().unwrap_or(""), r["bytes"]);
                }
            });
            Ok(())
        }
    }
}

fn open(urls: Vec<String>) -> anyhow::Result<()> {
    let rt = runtime()?;
    let urls: Vec<String> = if urls.is_empty() {
        vec!["tobari://newtab".into()]
    } else {
        urls
    };
    if rt
        .block_on(control::call("tabs.open", json!({"urls": urls})))
        .is_ok()
    {
        return Ok(());
    }
    let exe = std::env::current_exe()?;
    let shell = std::env::var("TOBARI_BROWSER")
        .ok()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| exe.with_file_name("tobari-shell"));
    if !shell.is_file() {
        anyhow::bail!(
            "Tobari is not running and {} was not found. Set TOBARI_BROWSER to the browser binary.",
            shell.display()
        );
    }
    std::process::Command::new(shell)
        .args(urls.iter().filter(|u| !u.starts_with("tobari://")))
        .spawn()?;
    Ok(())
}

fn stream(provider: Option<&str>, msgs: Vec<providers::Message>) -> anyhow::Result<()> {
    let cfg = providers::Config::load();
    let p = cfg.get(provider)?.clone();
    eprintln!("[{}]", p.destination().summary);
    let rt = runtime()?;
    rt.block_on(async {
        let sc = sidecar::Sidecar::new(std::time::Duration::from_secs(60));
        let mut out = std::io::stdout();
        let r = providers::chat(&p, Some(&sc), &msgs, 2048, &mut |d| {
            let _ = out.write_all(d.as_bytes());
            let _ = out.flush();
        })
        .await;
        sc.stop().await;
        println!();
        r.map(|_| ())
    })
}

fn skill(c: SkillCmd, j: bool) -> anyhow::Result<()> {
    let dir = paths::skills_dir();
    skills::install_bundled(&dir)?;
    match c {
        SkillCmd::List => {
            let (all, errors) = skills::load_all(&dir);
            print(j, json!({"skills": all, "errors": errors}), |_| {
                for s in &all {
                    println!("{:<22} {:<9} {}", s.name, s.role, s.description);
                }
                for e in &errors {
                    eprintln!("skipped {e}");
                }
            });
            Ok(())
        }
        SkillCmd::Show { name } => {
            let s = skills::find(&dir, &name)?;
            print(j, json!(s), |_| {
                println!("{}\n\n{}", s.description, s.instructions)
            });
            Ok(())
        }
        SkillCmd::New {
            name,
            description,
            prompt,
            site,
        } => {
            let d = skills::create_from_prompt(&dir, &name, &description, &prompt, &site)?;
            println!("created {}", d.join("SKILL.md").display());
            Ok(())
        }
        SkillCmd::Run {
            name,
            url,
            file,
            input,
            provider,
        } => {
            let s = skills::find(&dir, &name)?;
            let mut context = String::new();
            if let Some(u) = url {
                let rt = runtime()?;
                let html = rt.block_on(async {
                    reqwest::Client::builder()
                        .user_agent(concat!("tobari/", env!("CARGO_PKG_VERSION")))
                        .build()?
                        .get(&u)
                        .send()
                        .await?
                        .error_for_status()?
                        .text()
                        .await
                        .map_err(anyhow::Error::from)
                })?;
                let (title, text) = extract::html_to_text(&html);
                let text: String = text.chars().take(60_000).collect();
                context.push_str(&guard::wrap_untrusted(
                    &u,
                    &format!("Title: {title}\nURL: {u}\n\n{text}"),
                ));
            }
            if let Some(f) = file {
                let mut body = String::new();
                std::fs::File::open(&f)?
                    .take(2_000_000)
                    .read_to_string(&mut body)?;
                context.push_str(&guard::wrap_untrusted(&f.display().to_string(), &body));
            }
            if context.is_empty() && input.is_empty() {
                let mut body = String::new();
                std::io::stdin().take(2_000_000).read_to_string(&mut body)?;
                context.push_str(&guard::wrap_untrusted("stdin", &body));
            }
            let role = roles::get(&s.role).map(|r| r.prompt).unwrap_or("");
            let msgs = vec![
                providers::Message {
                    role: "system".into(),
                    content: format!("{}\n\n{role}\n\nSkill `{}`:\n{}\n\nThis run is headless: no browser tools are available, answer in Markdown only.", guard::SYSTEM_RULES, s.name, s.instructions),
                    images: vec![],
                },
                providers::Message {
                    role: "user".into(),
                    content: format!("{}\n\n{}", if input.is_empty() { "Run this skill." } else { &input }, context),
                    images: vec![],
                },
            ];
            stream(provider.as_deref(), msgs)
        }
    }
}

fn memory_cmd(c: MemoryCmd, j: bool) -> anyhow::Result<()> {
    let m = memory::Memory::open()?;
    match c {
        MemoryCmd::List => {
            let l = m.list()?;
            print(j, json!(l), |_| {
                for n in &l {
                    println!("{:<40} {:>7} bytes", n.name, n.bytes);
                }
            });
        }
        MemoryCmd::Show { name } => println!("{}", m.read(&name)?),
        MemoryCmd::Search { query } => {
            let hits = m.search(&query.join(" "), 20)?;
            print(j, json!(hits), |_| {
                for h in &hits {
                    println!("{}:{}  {}", h.name, h.line, h.text);
                }
            });
        }
        MemoryCmd::Add { name, text } => {
            let body = if text.is_empty() {
                let mut s = String::new();
                std::io::stdin().read_to_string(&mut s)?;
                s
            } else {
                text.join(" ")
            };
            println!("saved to {}", m.write(name.as_deref(), &body, true)?);
        }
        MemoryCmd::Export { out } => {
            let md = m.export()?;
            match out {
                Some(p) => {
                    std::fs::write(&p, md)?;
                    println!("wrote {}", p.display());
                }
                None => print!("{md}"),
            }
        }
    }
    Ok(())
}

fn models_cmd(c: ModelsCmd, j: bool) -> anyhow::Result<()> {
    match c {
        ModelsCmd::List => {
            let l = models::infos()?;
            print(j, json!(l), |_| {
                for m in &l {
                    let mark = if m.active { "*" } else { " " };
                    println!(
                        "{mark} {:<34} {:>5} MB  downloaded={}  {}",
                        m.id, m.size_mb, m.downloaded, m.about
                    );
                }
            });
            Ok(())
        }
        ModelsCmd::Download { id } => {
            let all = models::load_manifest()?;
            let m = match id {
                Some(i) => all
                    .iter()
                    .find(|m| m.id == i)
                    .ok_or_else(|| anyhow::anyhow!("unknown model {i}"))?,
                None => models::selected_model(&all)?,
            }
            .clone();
            runtime()?.block_on(download::download_verified(&m, &|d, t| {
                eprint!("\r  {}/{} MB", d / 1_048_576, t / 1_048_576)
            }))?;
            eprintln!("\nverified {}", m.id);
            Ok(())
        }
        ModelsCmd::Use { id } => {
            models::save_selection(&id)?;
            println!("default model: {id}");
            Ok(())
        }
        ModelsCmd::Delete { id } => {
            models::delete(&id)?;
            println!("deleted {id}");
            Ok(())
        }
    }
}

fn providers_cmd(c: ProvidersCmd, j: bool) -> anyhow::Result<()> {
    let mut cfg = providers::Config::load();
    match c {
        ProvidersCmd::List => {
            let rows: Vec<_> = cfg.providers.iter().map(|p| json!({"provider": p, "destination": p.destination(), "active": p.id == cfg.active})).collect();
            print(j, json!(rows), |_| {
                for p in &cfg.providers {
                    let mark = if p.id == cfg.active { "*" } else { " " };
                    println!("{mark} {:<12} {}", p.id, p.destination().summary);
                }
            });
        }
        ProvidersCmd::Add {
            id,
            kind,
            base_url,
            model,
            region,
        } => {
            let kind = match kind {
                KindArg::Local => providers::Kind::Local,
                KindArg::Ollama => providers::Kind::Ollama,
                KindArg::Openai => providers::Kind::Openai,
                KindArg::Anthropic => providers::Kind::Anthropic,
                KindArg::Google => providers::Kind::Google,
            };
            let p = providers::Provider {
                id: id.clone(),
                kind,
                label: String::new(),
                base_url,
                model,
                region,
            };
            let needs_key = p.needs_key();
            cfg.upsert(p);
            cfg.save()?;
            println!("saved provider {id}");
            if needs_key {
                println!("store its API key with: tobari providers key {id}");
            }
        }
        ProvidersCmd::Use { id } => {
            cfg.get(Some(&id))?;
            cfg.active = id;
            cfg.save()?;
            println!(
                "prompts now go to: {}",
                cfg.get(None)?.destination().summary
            );
        }
        ProvidersCmd::Key { id } => {
            cfg.get(Some(&id))?;
            eprint!("API key for {id} (input is read from stdin): ");
            let mut k = String::new();
            std::io::stdin().read_line(&mut k)?;
            secrets::store(&id, k.trim())?;
            eprintln!("\nstored in the OS secret service");
        }
        ProvidersCmd::Models { id } => {
            let p = cfg.get(Some(&id))?.clone();
            let l = runtime()?.block_on(providers::list_models(&p))?;
            print(j, json!(l), |_| l.iter().for_each(|m| println!("{m}")));
        }
        ProvidersCmd::Remove { id } => {
            cfg.remove(&id)?;
            cfg.save()?;
            let _ = secrets::clear(&id);
            println!("removed {id}");
        }
    }
    Ok(())
}

fn import_cmd(c: ImportCmd, j: bool) -> anyhow::Result<()> {
    match c {
        ImportCmd::Detect => {
            let l = import::detect(&paths::home());
            print(j, json!(l), |_| {
                if l.is_empty() {
                    println!("no Chrome, Chromium, Brave, Edge or Firefox profiles found");
                }
                for p in &l {
                    println!("{:<20} {:<24} {}", p.browser, p.name, p.path.display());
                }
            });
        }
        ImportCmd::Show { path, history } => {
            let p = import::detect(&paths::home())
                .into_iter()
                .find(|p| p.path.to_string_lossy() == path)
                .ok_or_else(|| anyhow::anyhow!("not a detected profile: {path}"))?;
            let d = import::read(&p, history);
            print(j, json!(d), |_| {
                println!("{} / {}", d.profile.browser, d.profile.name);
                println!(
                    "bookmarks: {}  history: {}  extensions: {}",
                    d.bookmarks.len(),
                    d.history.len(),
                    d.extensions.len()
                );
                for e in &d.extensions {
                    println!("  ext {}  {}", e.name, e.store_url);
                }
                for w in &d.warnings {
                    println!("  warning: {w}");
                }
            });
        }
    }
    Ok(())
}
