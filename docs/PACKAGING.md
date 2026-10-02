# PACKAGING

## Formats

| format | status | sandbox | notes |
|---|---|---|---|
| Flatpak | **primary** | Chromium sandbox via `zypak` inside Flatpak's | `packaging/flatpak/` |
| Per-user install | works | Chromium sandbox via unprivileged user namespaces | `packaging/install.sh` |
| AppImage | not built | — | see below |
| `.rpm` / `.deb` | not built | — | optional, not designed around |

Every format keeps Chromium's sandbox on. None ever passes `--no-sandbox`.

## Flatpak

There are two manifests in `packaging/flatpak/`. Both produce the same app:
the same app ID, the same files under `/app`, the same `finish-args`.

| manifest | builds | use |
|---|---|---|
| `dev.tobari.Browser.yml` | packages a CMake build made outside flatpak-builder | quick local loop |
| `dev.tobari.Browser.source.yml` | everything from source inside flatpak-builder, no network | Flathub |

### Quick local build

```sh
packaging/flatpak/build.sh ~/.cache/tobari-dev/build --install
flatpak run dev.tobari.Browser
```

`build.sh` stages the CMake build output and runs `flatpak-builder` against
`packaging/flatpak/dev.tobari.Browser.yml`, then writes `tobari.flatpak`.

### From source

```sh
flatpak install --user flathub org.freedesktop.Sdk//26.08 \
  org.freedesktop.Platform//26.08 org.freedesktop.Sdk.Extension.rust-stable//26.08

C="$HOME/.cache/tobari-flathub"
flatpak-builder --user --force-clean --default-branch=source \
  --state-dir="$C/state" --repo="$C/repo" "$C/builddir" \
  packaging/flatpak/dev.tobari.Browser.source.yml
flatpak build-bundle "$C/repo" "$C/tobari-source.flatpak" dev.tobari.Browser source
flatpak install --user "$C/tobari-source.flatpak"
flatpak run dev.tobari.Browser//source
```

Keep the build directory, repo and state directory outside the source tree:
the manifest takes the working tree as a `type: dir` source, and anything
inside it is copied into the build. Branch `source` installs beside the
`master` branch `build.sh` produces instead of replacing it; both share the
profile in `~/.var/app/dev.tobari.Browser/`.

flatpak-builder downloads every source first, then builds in its sandbox with
no network. The sources:

- **zypak**: git, tag `v2025.09`, commit `693a71c5…`, as in the other manifest.
- **CEF**: the archive `shell/provision-cef.sh` pins, from
  `cef-builds.spotifycdn.com`, verified by **sha256**. Spotify's index publishes
  only a SHA-1, which flatpak-builder does not accept; the sha256 in the
  manifest was computed from a download whose SHA-1 matched `CEF_SHA1`. A CEF
  bump changes `CEF_VERSION`/`CEF_SHA1` in the script and the URL/`sha256` in
  the manifest together (`docs/RELEASING.md`).
- **Rust crates**: `packaging/flatpak/cargo-sources.json`, one checksummed
  crate archive per `blocker/Cargo.lock` entry plus a cargo source replacement
  pointing at them. CMake still drives cargo; the manifest sets `CARGO_HOME` to
  the vendored directory, passes it as `-DTOBARI_CARGO_HOME`, and sets
  `CARGO_NET_OFFLINE=true`, so cargo runs as `cargo build --release --offline`
  would. `shell/CMakeLists.txt` is unchanged.
- **The repository**: `type: dir`, path `../..`, for the shell, blocker,
  filter lists, icons, desktop entry and AppStream data.

Regenerate `cargo-sources.json` whenever `blocker/Cargo.lock` changes, with
`cargo/flatpak-cargo-generator.py` from
[flatpak-builder-tools](https://github.com/flatpak/flatpak-builder-tools)
(the committed file was generated at commit
`74697c75b630d7330e77250fc13cb5ea688d9479`; it needs python3 with `aiohttp` and
`tomlkit`):

```sh
python3 -m venv ~/.cache/tobari-flathub/venv
~/.cache/tobari-flathub/venv/bin/pip install aiohttp tomlkit
~/.cache/tobari-flathub/venv/bin/python <flatpak-builder-tools>/cargo/flatpak-cargo-generator.py \
  blocker/Cargo.lock -o packaging/flatpak/cargo-sources.json
```

The module overrides the SDK's default `CFLAGS`/`CXXFLAGS` only to drop
`-Wp,-D_FORTIFY_SOURCE=3`: CEF's CMake defines `_FORTIFY_SOURCE=2` itself and
compiles with `-Werror`, so with the SDK's define every file of the CEF wrapper
fails with "'_FORTIFY_SOURCE' redefined". The SDK's other hardening flags stay.

Verified on 2026-10-02 (Bazzite, SELinux, flatpak-builder 1.4.12): the build
completes; the installed file list matches the `master` build plus the
`LICENSE` flatpak-builder installs from the source tree;
`desktop-file-validate` and `appstreamcli validate --no-net` pass on the
installed files; `chrome://sandbox` reports "You are adequately sandboxed";
and the shield extension's service worker
(`chrome-extension://lgfgpfedeaaahediodajihnoneonicaf/bg.js`) runs. The one
build warning is cargo preferring `config.toml` to the `config` file
flatpak-cargo-generator writes.

### Sandboxing

Both manifests build zypak from source rather than taking it from
`org.chromium.Chromium.BaseApp`: on SELinux hosts (Fedora, Bazzite) a
user-installed BaseApp cannot be layered, because flatpak copies its files with
their `flatpak_home_t` label and the relabel is refused. Chromium normally
sandboxes renderers with a SUID helper or with user namespaces; neither is
available inside Flatpak's own sandbox. `zypak` makes Chromium spawn its
sandboxed children through Flatpak's sandbox instead, the same mechanism
Chromium's and Spotify's (also CEF) Flatpaks use.

Inside the Flatpak, `$XDG_DATA_HOME` and friends resolve under
`~/.var/app/dev.tobari.Browser/`, so the profile, filter updates and state live
there. Tobari never hard-codes a path; it only reads the XDG variables.

### Remaining for a Flathub submission

The from-source build works locally; nothing has been submitted. Still to do:

1. Tag a release and replace the `type: dir` source in
   `dev.tobari.Browser.source.yml` with the pinned repository: `type: git`,
   `url: https://github.com/kaorii-ako/tobari`, `tag: v<version>`,
   `commit: <full sha>`. Flathub does not build from local directories.
2. Add `<screenshots>` to `packaging/dev.tobari.Browser.metainfo.xml`, and a
   `<release>` entry for the tagged version.
3. Run `flatpak-builder-lint` on the manifest and the built repo (not run yet)
   and fix what it reports.
4. Open the submission PR against `flathub/flathub` (base branch `new-pr`)
   with the manifest, renamed to `dev.tobari.Browser.yml`, and
   `cargo-sources.json`.
5. Expect review questions on the prebuilt CEF archive (Chromium is not
   compiled from source here), the `finish-args` a browser needs, and the
   MPRIS name it owns. Verifying the app ID needs control of `tobari.dev`.

## Per-user install

```sh
packaging/install.sh ~/.cache/tobari-dev/build            # install
packaging/install.sh ~/.cache/tobari-dev/build --set-default
packaging/install.sh --uninstall
```

Installs into `~/.local/lib/tobari`, a launcher into `~/.local/bin`, the desktop
entry, AppStream metadata and icons into `~/.local/share`. Nothing outside
`$HOME` is written, so it works on immutable distributions.

A per-user install cannot set up Chromium's SUID sandbox helper, so it depends
on unprivileged user namespaces. The installer checks for them and **refuses to
install** if they are disabled, rather than produce a browser that would only
run unsandboxed. `--set-default` is opt-in; installing never changes your
default browser on its own.

## AppImage

The original plan shipped an AppImage. It is not built for the browser, for the
reason the spec gave in advance: AppImages mount `nosuid`, so Chromium's SUID
sandbox helper cannot work, and the result would depend entirely on user
namespaces — the same as the per-user install, with none of the integration.
Flatpak gives real sandboxing and correct `x-scheme-handler/http(s)`
registration. If an AppImage is added, it must check for user namespaces and
refuse to start without them, exactly as `install.sh` does.

## Desktop integration

`packaging/dev.tobari.Browser.desktop` registers for `http`, `https`, HTML,
XHTML and PDF, and has a "New Window" action. `StartupWMClass` matches the
`--class=dev.tobari.Browser` Tobari sets on its windows, so the taskbar groups
them under the right icon. Both files pass `desktop-file-validate` and
`appstreamcli validate`.

When Tobari is already running, a second launch (for example a link clicked in
another app) is forwarded to the running instance by Chromium's process
singleton. A URL opens as a new tab in the most recently focused window; a bare
launch opens a new window.
