# PACKAGING

## Phase 1: AppImage + plain tarball (Linux)

The sidecar must reach the user's existing Chrome/Chromium/Brave install,
so being *outside* any sandbox is required, not incidental.

- Use the **static type2-runtime**. The classic runtime dlopens
  `libfuse.so.2`; Bazzite ships FUSE3, so the default runtime fails on the
  primary dev machine.
- **Bundle nothing graphics-related.** No libvulkan, no Mesa, no libdrm.
  A bundled Vulkan loader against host ICDs silently drops GPU offload to
  CPU and quietly destroys the memory story. Link the host stack and fail
  loudly if no ICD is found.
- Models are never inside the AppImage. They download to the XDG data dir
  on first run after SHA-256 verification against `core/models.toml`.
- Native messaging manifests are installed on first launch via
  `tobari-core --install-manifests`, only for browsers actually present
  (Chrome, Chromium, Brave paths; macOS equivalents under
  `~/Library/Application Support/`). The extension ID is key-pinned and
  compiled into the sidecar — there is no flag to override it and no
  wildcard in `allowed_origins`.
- `tobari-core --uninstall` removes the manifests. Offer it, document it.

### Two things the Phase 1 build must not get wrong

**1. The AppDir needs an explicit `AppRun`.** `appimagetool` no longer
synthesizes one. Without it the type2 runtime falls back to the desktop
`Exec` line and dies with `execv error: No such file or directory` before
printing anything useful. `build-appimage.sh` writes:

```sh
#!/bin/sh
set -eu
HERE="$(dirname "$(readlink -f "$0")")"
export LD_LIBRARY_PATH="$HERE/usr/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$HERE/usr/bin/tobari-core" "$@"
```

The `LD_LIBRARY_PATH` line is required because upstream llama.cpp builds
`libggml*`, `libllama*` and `libmtmd*` as shared objects. Those are *our own*
build artifacts and are bundled; the graphics stack is still not.

**2. `tobari-core` must be rebuilt, never reused from staging.**
`build-appimage.sh` runs `cargo build --release` itself and installs the
fresh binary. A stale staged binary is invisible at build time and produces an
AppImage that behaves like an older commit — this was hit in practice (an
AppImage that silently reported `backend: cpu` on a machine with a working
RX 6800 XT, because staging held a pre-fix sidecar). The script also writes
`staging/tobari-core.buildinfo` with the UTC timestamp and SHA-256 of the
binary it packaged.

### Verification that nothing graphics-related was bundled

```sh
ls packaging/build/staging/Tobari.AppDir/usr/bin/ | grep -iE 'vulkan|mesa|drm'
```

Must print nothing. `libggml-vulkan.so` is present by design: it is the ggml
backend that `dlopen`s the **host** loader, not a copy of it.

## Phase 2+: Flatpak (primary), AppImage (secondary, constrained)

Flatpak (`dev.tobari.Browser`) carries `tobari-core` inside the same
sandbox as the browser, so native messaging never crosses the sandbox
boundary. It also gives real sandboxing and correct
`x-scheme-handler/http(s)` registration.

A Phase 2 AppImage is secondary and carries a hard constraint: the
Chromium sandbox stays on. AppImages mount `nosuid`, so the SUID
`chrome-sandbox` helper cannot work; the build must rely on unprivileged
user namespaces and **refuse to start** if they are unavailable. Never
ship `--no-sandbox` in a browser sold on security. Detect and report; do
not degrade.

`.rpm` and `.deb` are optional conveniences, not design targets.
