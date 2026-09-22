# Packaging

## Phase 1: AppImage plus tarball

Phase 1 must reach the user's existing Chrome, Chromium, or Brave
installs, so it runs outside any sandbox. That is required, not
incidental. The AppImage carries `tobari-core` and `llama-server` and
installs native-messaging manifests on first launch.

Static type2 runtime. Use the static runtime, not the classic one. The
classic runtime dlopens libfuse.so.2 and Bazzite ships FUSE3, so the
default runtime fails on the primary dev machine.

Bundle nothing graphics-related. No libvulkan, no Mesa, no libdrm, no ICD
files. A bundled Vulkan loader resolving against host ICDs can silently
drop GPU offload to CPU. Link the host stack and fail loudly with no ICD.

Models are never inside the image. They download to the XDG data dir on
first run and are verified by SHA-256 before use.

First launch installs manifests only for browsers actually present. The
`--uninstall` flag removes them again.

## Chromium sandbox note for later

An AppImage mounts its payload nosuid, so the SUID chrome-sandbox helper
cannot work there. When Phase 2 ships an AppImage of the browser, it must
rely on unprivileged user namespaces and refuse to start when they are
unavailable. Never ship `--no-sandbox`.

## Phase 2 and later: Flatpak

Flatpak becomes the primary format once there is a browser of our own.
`tobari-core` rides inside the same Flatpak, so native messaging never
crosses the sandbox boundary. Flatpak also gives real sandboxing and
correct x-scheme-handler/http(s) registration, neither of which an
AppImage provides.
