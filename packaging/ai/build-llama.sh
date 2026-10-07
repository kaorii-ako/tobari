#!/usr/bin/env bash
# Builds llama.cpp's llama-server (pinned tag) and stages it with its shared
# libraries into <cmake-build-dir>/ai, where Tobari's local AI looks for it.
# Linux: Vulkan backend (falls back to CPU when there is no GPU). macOS: Metal.
#
#   packaging/ai/build-llama.sh <cmake-build-dir>
set -euo pipefail
TAG="b11053"
UPSTREAM="https://github.com/ggml-org/llama.cpp"
BUILD="$(cd "${1:?usage: build-llama.sh <cmake-build-dir>}" && pwd)"
SRC="${TOBARI_LLAMA_SRC:-${XDG_CACHE_HOME:-$HOME/.cache}/tobari-dev/llama.cpp-$TAG}"

if [ ! -d "$SRC/.git" ]; then
  git clone --quiet --depth 1 --branch "$TAG" "$UPSTREAM" "$SRC"
fi
[ "$(git -C "$SRC" describe --tags --exact-match 2>/dev/null)" = "$TAG" ] || { echo "$SRC is not $TAG" >&2; exit 1; }

FLAGS=(-DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
       -DLLAMA_BUILD_SERVER=ON -DBUILD_SHARED_LIBS=ON -DCMAKE_INSTALL_RPATH='$ORIGIN' -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON)
if [ "$(uname -s)" = Darwin ]; then
  FLAGS+=(-DGGML_METAL=ON -DCMAKE_INSTALL_RPATH='@loader_path' -DGGML_METAL_EMBED_LIBRARY=ON)
else
  # Backends load at run time, the CPU one in the variant that suits the
  # machine (AVX2, AVX-512, ...), so a computer without a GPU is not stuck
  # with baseline x86-64 code.
  FLAGS+=(-DGGML_VULKAN=ON -DGGML_NATIVE=OFF -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON)
fi
cmake -S "$SRC" -B "$SRC/build" -G Ninja "${FLAGS[@]}" >/dev/null
# Relink into an empty bin/ so nothing stale from an earlier configuration is staged.
rm -rf "$SRC/build/bin"
# With loadable backends the server does not depend on them; build them too.
BACKENDS=$(ninja -C "$SRC/build" -t targets all | sed -n 's/^\(ggml-[a-z0-9_-]*\): phony$/\1/p' | grep -v -e '^ggml-base$' || true)
cmake --build "$SRC/build" --target llama-server $BACKENDS --parallel

OUT="$BUILD/ai"
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$SRC/build/bin/llama-server" "$OUT/"
for lib in "$SRC/build/bin"/lib*.so* "$SRC/build/bin"/lib*.dylib; do
  [ -e "$lib" ] && cp -P "$lib" "$OUT/"
done
cp "$SRC/LICENSE" "$OUT/LICENSE.llama.cpp"
echo "staged $OUT"
