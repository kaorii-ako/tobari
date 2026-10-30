# Developing Tobari on Bazzite

Build tools live in a distrobox container, never on the host. Nothing here needs `sudo` on the
host or `rpm-ostree`.

## One-time container setup

```bash
distrobox create --name tobari --image registry.fedoraproject.org/fedora-toolbox:42
```

```bash
distrobox enter tobari
```

Inside the container:

```bash
sudo dnf install -y git gcc gcc-c++ cmake ninja-build pkgconf nodejs npm python3 strace chromium libsecret vulkan-loader-devel glslc
```

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

## Run Tobari today (Chromium + Tobari extension)

Until the CEF shell is built, this is the fastest way to use Tobari. It runs the container's
Chromium with Tobari's own profile in `~/.config/tobari/browser`, loads the extension, and
registers the core for native messaging.

```bash
scripts/dev-run.sh
```

Then get the model runtime and the default model (asks before downloading, about 2.4 GB):

```bash
core/target/release/tobari setup
```

Open the panel with Alt+J, the command bar with Alt+K.

Do not use Flatpak Chrome or Flatpak Chromium for this: their sandbox cannot start a program
outside it, so native messaging to `tobari` fails.

## Build the CEF shell

Needs network access to `cef-builds.spotifycdn.com`. The first configure pins the current stable
CEF in `shell/cef.lock`; commit that file.

```bash
cmake -S shell -B shell/build -G Ninja -DCMAKE_BUILD_TYPE=Release
```

```bash
cmake --build shell/build
```

```bash
shell/build/Release/tobari-shell
```

## Tests

```bash
cargo test --manifest-path core/Cargo.toml
```

```bash
cargo build --manifest-path core/Cargo.toml && python3 core/tests/e2e.py
```

```bash
npm test --prefix extension
```

The UI test drives real Chromium with Playwright against the real core and a scripted fake model:

```bash
cd extension && npm install --no-save playwright && npx playwright install chromium && xvfb-run -a node scripts/ui-e2e.mjs
```

## Benchmarks

```bash
python3 bench/run.py --browsers tobari-ext,firefox,zen,brave,chrome --counts 0,5,10,25 --discard
```

It prepends a dated table to `docs/bench.md` and writes per-process numbers to
`bench/results/raw/`. Close other browsers first; numbers are PSS summed over each browser's
process tree.
