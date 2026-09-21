use anyhow::Result;

mod ipc;
mod state;

#[cfg(feature = "cef-ui")]
mod cef_app;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--version") {
        println!("tobari 0.1.0 (shell scaffold; Phase 2 in progress)");
        return Ok(());
    }
    #[cfg(feature = "cef-ui")]
    {
        cef_app::run().await
    }
    #[cfg(not(feature = "cef-ui"))]
    {
        println!("tobari shell scaffold: build with --features cef-ui once CEF binaries are provisioned (shell/CEF_PIN).");
        println!("Same sidecar, same IPC: the shell talks to tobari-core over the tobari-ipc protocol.");
        Ok(())
    }
}
