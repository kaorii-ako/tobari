# DEV-LINUX — primary dev target

Bazzite is an rpm-ostree atomic system: the base image is read-only. All
build toolchains live in a distrobox container. Never `rpm-ostree install`
a build dependency.

## 1. Create the container

```sh
distrobox create --name tobari-dev --image fedora:latest
distrobox enter tobari-dev
```

All steps below run **inside** the container.

## 2. Toolchain

```sh
sudo dnf install -y git curl cmake ninja-build gcc-c++ patchelf glslc \
  vulkan-headers mesa-vulkan-drivers vulkan-tools nodejs npm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup target add x86_64-unknown-linux-gnu
```

Verify the host GPU stack is visible from the container:

```sh
vulkaninfo --summary
```

If no ICD is reported, stop: GPU offload cannot work and any build that
silently falls back to CPU invalidates the Phase 1 memory story.

## 3. llama.cpp (pinned source build)

Pinned tag: `b11053` (`https://github.com/ggml-org/llama.cpp`).
Bump only deliberately; record the new tag in `core/models.toml`.

```sh
git clone --branch b11053 --depth 1 https://github.com/ggml-org/llama.cpp
cmake -S llama.cpp -B llama.cpp/build -G Ninja \
  -DGGML_VULKAN=ON \
  -DCMAKE_BUILD_TYPE=Release
cmake --build llama.cpp/build --target llama-server
```

NVIDIA laptop only: if the CUDA toolkit is present, `-DGGML_CUDA=ON` may
replace `-DGGML_VULKAN=ON`. Never ROCm on RDNA2.

The resulting `llama-server` binary is supervised by `tobari-core`; it is
never executed by hand in production and never bound to anything but
`127.0.0.1` (enforced by the sidecar, see `SECURITY.md`).

Build and package inside the same container. Binaries link the container's
glibc; keep the container image at or below the oldest host you support
(Bazzite tracks Fedora stable, glibc 2.35+) so the AppImage and tarball run
on a clean system.

## 4. Build the sidecar and extension

```sh
cargo build --release -p tobari-core
cd extension && npm ci && npm run build
```

## 5. Run (Phase 1)

```sh
packaging/build-llama-server.sh
./scripts/dev-run.sh
```

`build-llama-server.sh` stages the pinned `llama-server` into
`packaging/build/staging/`; `dev-run.sh` builds the sidecar and the
extension, copies `llama-server` to `~/.local/share/tobari/bin/`,
installs the native messaging manifests, and prints the load
instructions. Load `extension/dist/` as an unpacked extension, then
select text on any page and use Explain with the network interface down.

## Disk and time budget

Phase 1 needs a few GB in-container. Phase 3 (Chromium build) needs
~150 GB of writable space and 4–8 hours clean on 6 cores; that lands on
the same disk as this checkout and is flagged here, not discovered later.
