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

```sh
packaging/flatpak/build.sh ~/.cache/tobari-dev/build --install
flatpak run dev.tobari.Browser
```

`build.sh` stages the CMake build output and runs `flatpak-builder` against
`packaging/flatpak/dev.tobari.Browser.yml`, then writes `tobari.flatpak`.

The app sits on `org.chromium.Chromium.BaseApp`, which provides `zypak`.
Chromium normally sandboxes renderers with a SUID helper or with user
namespaces; neither is available inside Flatpak's own sandbox. `zypak` makes
Chromium spawn its sandboxed children through Flatpak's sandbox instead, the
same mechanism Chromium's and Spotify's (also CEF) Flatpaks use.

Inside the Flatpak, `$XDG_DATA_HOME` and friends resolve under
`~/.var/app/dev.tobari.Browser/`, so the profile, filter updates and state live
there. Tobari never hard-codes a path; it only reads the XDG variables.

**Not yet Flathub-ready.** Flathub builds from source. The manifest here
packages a build made outside it. The remaining work:

1. add the pinned CEF archive as a `file` source with its **sha256** (the
   provisioning script pins Spotify's published SHA-1, which Flatpak does not
   accept);
2. vendor the `adblock` crate's dependencies with `flatpak-cargo-generator`;
3. run the CMake build inside `flatpak-builder` with no network.

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
