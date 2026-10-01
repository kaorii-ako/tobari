# DEV-LINUX — building Tobari

Bazzite and other atomic distributions have a read-only base image. Every build
tool lives in a distrobox container; nothing is layered onto the host. The one
host tool used is `flatpak-builder`, which Bazzite already ships.

## 1. Container

```sh
distrobox create --name tobari --image registry.fedoraproject.org/fedora:41
distrobox enter tobari
sudo dnf install -y git cmake ninja-build gcc-c++ python3 python3-pillow openssl \
  gtk3-devel libX11-devel libXi-devel nss-devel alsa-lib-devel \
  at-spi2-atk-devel cups-devel libdrm-devel mesa-libgbm-devel
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

## 2. CEF

```sh
shell/provision-cef.sh
```

Downloads the pinned CEF binary distribution (`minimal`, ~326 MB), checks it
against the SHA-1 hard-coded in the script, unpacks it into
`~/.cache/tobari-dev/` and prints the resulting directory. The cache survives
reboots and `/tmp` cleanups, which matters: a CEF tree under `/tmp` will
disappear and take a build with it.

Bumping CEF means changing `CEF_VERSION` and `CEF_SHA1` together; see
`docs/RELEASING.md`.

## 3. Build

```sh
CEF_ROOT=$(shell/provision-cef.sh | tail -1)
cmake -S shell -B ~/.cache/tobari-dev/build -G Ninja \
  -DCEF_ROOT="$CEF_ROOT" -DCMAKE_BUILD_TYPE=Release
cmake --build ~/.cache/tobari-dev/build
```

One build produces everything: the CEF wrapper library, the Rust blocking
engine in `blocker/` (cargo is driven from CMake), the `tobari` binary, the two
bundled extensions, and the filter lists staged beside the binary.

If `~/.cache/cargo` is not writable, pass `-DTOBARI_CARGO_HOME=<dir>`; by
default cargo uses a directory inside the build tree.

## 4. Run

```sh
~/.cache/tobari-dev/build/tobari
```

Useful while developing:

| | |
|---|---|
| `XDG_DATA_HOME=/tmp/p tobari` | throwaway profile; exercises first-run defaults |
| `--remote-debugging-port=9222` | drive it from DevTools / scripts |
| `--ozone-platform=x11` | run under XWayland (default is native Wayland) |
| `TOBARI_NO_BLOCKING=1` | load without the engine, for benchmarking |
| `TOBARI_LOG=info` | raise CEF's log level |

## 5. Verify

```sh
scripts/contrast.py                       # palette meets WCAG AA in both themes
scripts/benchmark-ram.sh tobari|chrome    # BENCHMARKS.md methodology
```

The blocking engine has a standalone check: build `blocker/` with cargo and
link a small C program against `libtobari_blocker.a` — see the test cases in
`BENCHMARKS.md`.
