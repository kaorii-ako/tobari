# Flatpak

Status: draft manifest, not built yet. Every value marked `PIN-…` must be filled from a real
download before `flatpak-builder` will accept it. Nothing in it was checksummed from this repo's
cloud session because the CEF CDN, GNOME downloads and GitHub release assets were blocked there.

## Pins to fill

| Module | What to pin | How |
|---|---|---|
| libsecret-tools | tarball sha256 | `curl -LO <url> && sha256sum libsecret-*.tar.xz` |
| shaderc | release tag | latest tag on github.com/google/shaderc |
| llama-server | release tag | latest `bNNNN` tag on github.com/ggml-org/llama.cpp |
| tobari-shell, `cef` source | archive URL and sha1 | run `cmake -S shell -B shell/build` once; it writes `shell/cef.lock` (version, file, sha1) |
| tobari-core | `cargo-sources.json` | `flatpak-cargo-generator core/Cargo.lock -o packaging/flatpak/cargo-sources.json` |

## Sandbox permissions and why

| Permission | Why |
|---|---|
| `--socket=wayland`, `--socket=fallback-x11`, `--share=ipc` | Window. Wayland first, X11 only when there is no Wayland. |
| `--device=dri` | GPU for page compositing and for llama.cpp on Vulkan. Covers the RX 6800 XT and the RTX 5060 (Vulkan through the NVIDIA ICD). |
| `--share=network` | Web browsing. The model server binds 127.0.0.1 inside the sandbox only. |
| `--socket=pulseaudio` | Media playback. |
| `--filesystem=xdg-download` | `save_file` and normal downloads. |
| `--filesystem=xdg-run/tobari:create` | The control socket, so `tobari tabs` on the host can reach the running browser. |
| `--talk-name=org.freedesktop.secrets` | API keys in GNOME Keyring or KWallet through `secret-tool`. |
| `~/.config/google-chrome:ro` and the other browser profile paths | Read-only, for Import. Remove any you don't need. |

Fonts: Flatpak maps the host's `/usr/share/fonts` and `~/.local/share/fonts` into `/run/host`.
That mapping is exactly where Phase 0 suspects the Japanese tofu bug might live. Run
`phase0/probe.sh flatpak:dev.tobari.Tobari` on the first build before anything else.

Native messaging: the browser and `tobari` are in the same sandbox, so the browser can start the
core. `tobari-launch` runs `tobari install-host` on every start, which writes the manifest into
`~/.var/app/dev.tobari.Tobari/config/tobari/browser/NativeMessagingHosts`.

Chromium's sandbox inside Flatpak uses zypak from `org.chromium.Chromium.BaseApp`;
`tobari-launch` wraps the shell with `zypak-wrapper` when it exists.

## Build

```bash
flatpak install --user flathub org.freedesktop.Sdk//24.08 org.freedesktop.Sdk.Extension.rust-stable//24.08 org.freedesktop.Sdk.Extension.node22//24.08 org.chromium.Chromium.BaseApp//24.08
```

```bash
flatpak-builder --user --install --force-clean build-flatpak packaging/flatpak/dev.tobari.Tobari.yml
```

Updates: once published to a Flatpak remote, `flatpak update` (or Discover / GNOME Software in
the background) handles them. Tobari ships no updater of its own in the Flatpak.
