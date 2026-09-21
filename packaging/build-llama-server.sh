#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="b11053"
UPSTREAM="https://github.com/ggml-org/llama.cpp"
STAGING="${TOBARI_STAGING:-$REPO_ROOT/packaging/build/staging}"
SRC="${TOBARI_LLAMA_SRC:-$REPO_ROOT/packaging/build/llama.cpp}"
BUILD_TYPE="${BUILD_TYPE:-Release}"

command -v cmake >/dev/null 2>&1 || { echo "cmake missing — enter the distrobox container (docs/DEV-LINUX.md) and rerun" >&2; exit 1; }
command -v ninja >/dev/null 2>&1 || { echo "ninja missing — enter the distrobox container (docs/DEV-LINUX.md) and rerun" >&2; exit 1; }

if [ ! -d "$SRC/.git" ]; then
  git clone --depth 1 --branch "$TAG" "$UPSTREAM" "$SRC"
else
  current="$(git -C "$SRC" describe --tags --always 2>/dev/null || echo unknown)"
  if [ "$current" != "$TAG" ]; then
    echo "llama.cpp at $SRC is '$current', expected '$TAG' — remove the directory and rerun" >&2
    exit 1
  fi
fi

BACKEND_FLAGS=(-DGGML_VULKAN=ON)
if [ "${TOBARI_LLAMA_CUDA:-0}" = "1" ]; then
  BACKEND_FLAGS=(-DGGML_CUDA=ON)
fi

cmake -S "$SRC" -B "$SRC/build" -G Ninja "${BACKEND_FLAGS[@]}" -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
cmake --build "$SRC/build" --target llama-server

mkdir -p "$STAGING"
cp "$SRC/build/bin/llama-server" "$STAGING/llama-server"
for lib in "$SRC/build/bin"/libggml*.so* "$SRC/build/bin"/libllama*.so* "$SRC/build/bin"/libmtmd*.so*; do
  [ -e "$lib" ] || continue
  cp -P "$lib" "$STAGING/"
done
echo "staged: $STAGING/llama-server (+ shared libs)"
