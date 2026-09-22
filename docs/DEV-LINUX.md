# Linux development

All of this runs on the host except the Rust build, which needs a newer
toolchain than Bazzite's base image carries. Rust lives in a distrobox
container. Nothing here requires layering packages onto the atomic host
with rpm-ostree.

## 1. Enter the container

```sh
distrobox enter box
```

The stock `box` container is Fedora latest and is fine for Phase 1.

## 2. Toolchain inside the container

```sh
sudo dnf install -y git gcc openssl-devel pkg-config python3 nodejs npm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env
rustc --version
cargo --version
```

Expected: a stable Rust from rustup, gcc for linking, node 20 or newer
for the extension build.

## 3. Build the sidecar

```sh
cd /var/home/hxshino/projects/Tobari/core
cargo build --release
./target/release/tobari-core status
```

`status` prints the detected backend (vulkan, cuda, metal, cpu) and
whether the default model is downloaded. No cargo on the host is needed;
the project directory is visible inside the container.

## 4. llama-server

Phase 1 supervises a `llama-server` binary sitting next to `tobari-core`.
Build it from llama.cpp with the backend matching your GPU:

AMD (primary target): Vulkan build. NVIDIA laptop: CUDA build if the
toolkit is present, else the same Vulkan build works. Do not use ROCm.

```sh
git clone https://github.com/ggerganov/llama.cpp
cmake -S llama.cpp -B llama.cpp/build -DGGML_VULKAN=ON
cmake --build llama.cpp/build --config Release --target llama-server -j6
cp llama.cpp/build/bin/llama-server /var/home/hxshino/projects/Tobari/core/target/release/
```

## 5. Extension

On the host or in the container, either works:

```sh
cd /var/home/hxshino/projects/Tobari/extension
npm install
npm run build
```

Load the `extension/` directory unpacked in Chrome, Chromium, or Brave.
Copy the extension ID from `chrome://extensions`, then:

```sh
tobari-core install --ext-id <paste-id-here>
tobari-core download
```

## 6. Acceptance checks

With the network interface down, select text on any page, context menu,
Explain, and confirm a streamed local answer arrives.

```sh
ss -tlnp | grep tobari
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/health
curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer wrong' http://127.0.0.1:<port>/health
```

Expect: only 127.0.0.1 listeners, 401 without the token, and a rejected
request from a page console that has no token.
