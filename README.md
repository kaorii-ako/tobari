# Tobari (帳)

**A browser that closes over the window.**

A Chromium browser for Linux that blocks ads and trackers before they load,
resolves `!bangs` on your machine, sends nothing home, and publishes what it
costs and what it gives up.

Tobari does not claim to make you invisible. It gives you something you close
deliberately. No "untraceable", no "anonymous", no claim that is not backed by
[SECURITY.md](SECURITY.md) or [BENCHMARKS.md](BENCHMARKS.md).

> **Engine (2026-10-02).** Tobari runs Chromium 154.0.8037.94 (CEF 154.0.33),
> which includes the 32 security fixes from Chrome 154.0.8037.92. Builds made
> before 2026-10-02 lack them. The running record is at the top of
> [SECURITY.md](SECURITY.md).

## What it is

| | |
|---|---|
| Engine | Chromium 154 via CEF, Chromium's own tabs and toolbar |
| Blocking | `adblock-rust`, ~142,000 rules from EasyList, EasyPrivacy and uBlock Origin; cancels requests before they load; per-site switch and badge count in the toolbar |
| Bangs | 35 DuckDuckGo-style bangs, resolved locally; the search engine never sees a bang query |
| Extensions | Chrome Web Store, including password managers |
| Defaults | DuckDuckGo, no suggestions, no prediction, third-party cookies blocked, HTTPS-Only on |
| Hardening | V8 optimizing compilers off by default (per-site "Fast JavaScript" switch), device APIs blocked, workers filtered too |
| Phoning home | none on its own except weekly filter-list updates — measured, see SECURITY.md |
| Sandbox | always on; never `--no-sandbox` |
| Packages | Flatpak (primary), per-user install |

Measured on 2026-10-02 (Tobari 0.1.0, CEF 154.0.33), ten identical tabs, three interleaved runs:
**861.1 MB PSS against Chrome's 1,219.6 MB (29.4% lower), 20 processes against
69.** Blocking accounts for 151 MB and 13 of those processes. Some of the gap
is features Tobari does not have. Method and caveats in
[BENCHMARKS.md](BENCHMARKS.md).

## Status

Phase 1 — the browser — works end to end and is packaged. Not yet done:

- a week of daily-driver use on Wayland (the acceptance test in the brief);
- the Flathub submission itself; the from-source manifest builds and runs
  sandboxed, and `docs/PACKAGING.md` lists what remains.

[docs/VALIDATION.md](docs/VALIDATION.md) still records **no go/pivot/stop
decision**; Phase 1 was built under a waiver.

The local AI assistant is planned for Phase 3 and is not in this build. Earlier
AI work is kept on the `phase-3-ai` branch.

## Install

```sh
curl -fsSL https://kaorii-ako.github.io/tobari/install.sh | bash
```

Linux x86_64. Installs the Flatpak if you have Flatpak, otherwise a per-user
build in `~/.local`; either way only for your user. The script checks the
release's minisign signature (key `0F0DC333B8A4E968`, in `tobari.pub`) and the
artifact's checksum before installing anything. Options, manual verification
and uninstalling: [the install page](https://kaorii-ako.github.io/tobari/install/)
or `bash install.sh --help`.

## Build

Inside a distrobox container on immutable distributions; nothing is layered onto
the host. Full steps in [docs/DEV-LINUX.md](docs/DEV-LINUX.md).

```sh
CEF_ROOT=$(shell/provision-cef.sh | tail -1)      # pinned CEF, SHA-1 checked, cached
cmake -S shell -B build -G Ninja -DCEF_ROOT="$CEF_ROOT" -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/tobari
```

Install:

```sh
packaging/flatpak/build.sh build --install        # Flatpak
packaging/install.sh build [--set-default]        # per-user, into ~/.local
```

## Layout

```
shell/src/         C++: Chromium client, blocking, bangs, defaults, list updates,
                   the bridge to the toolbar extension
shell/extensions/  bundled extensions: new-tab page, blocking control
shell/ui/          design tokens, new-tab page, bang table (bangs.json)
shell/filters/     bundled filter-list snapshot
blocker/           Rust staticlib wrapping adblock-rust behind a C ABI
packaging/         desktop entry, AppStream data, installer, Flatpak
site/              tobari.dev — static, no trackers, no cookies
scripts/           benchmarks, contrast check, filter refresh, engine watch
```

## Docs

- [SECURITY.md](SECURITY.md) — threat model, every tradeoff, the engine-currency record
- [BENCHMARKS.md](BENCHMARKS.md) — memory method, raw numbers, the Phase 2 question
- [docs/DESIGN.md](docs/DESIGN.md) — visual system and why the browser chrome is Chromium's
- [docs/PACKAGING.md](docs/PACKAGING.md) — Flatpak, per-user install, sandboxing per format
- [docs/RELEASING.md](docs/RELEASING.md) — the CEF security bump, signing, distribution
- [docs/DEV-LINUX.md](docs/DEV-LINUX.md) — building
- [docs/DEV-MACOS.md](docs/DEV-MACOS.md) — why macOS is not a Phase 1 target

## Platforms

Linux. macOS is not a Phase 1 target (no Mac to test on, no notarization
account). Windows is out of scope permanently.

## License

MIT.
