#!/usr/bin/env bash
# Tobari installer.
#
#   curl -fsSL https://kaorii-ako.github.io/tobari/install.sh | bash
#   curl -fsSL https://kaorii-ako.github.io/tobari/install.sh | bash -s -- --tarball --set-default
#
# Linux x86_64 and Apple-silicon macOS. Downloads a Tobari release from GitHub, checks its minisign signature against
# the release key pinned below, checks the artifact's SHA-256 against the
# signed list, and installs it for the current user only. Nothing is written
# outside $HOME and nothing runs as root.
#
# Options:
#   --flatpak       install the Flatpak bundle (default when flatpak is present)
#   --tarball       install the per-user build into ~/.local (no Flatpak needed)
#   --appimage      put the AppImage in ~/Applications (it adds itself to the menu)
#
# On an Apple-silicon Mac it installs Tobari.app into ~/Applications instead.
#   --set-default   make Tobari the default web browser
#   --version X.Y.Z install a specific release instead of the one pinned here
#   --uninstall     remove Tobari (profiles are kept)
#   --help
#
# Reading this before running it is a good idea. It is short on purpose.
set -euo pipefail

VERSION="${TOBARI_VERSION:-0.3.0}"
REPO="kaorii-ako/tobari"
# The release key (docs/RELEASING.md). Key id 0F0DC333B8A4E968.
PUBKEY="RWRo6aS4M8MND+s3tkrSD2POK8Donu5pWez8QI5+Pf6KZike67q2L6iB"
APP_ID="dev.tobari.Browser"

MODE=""
SET_DEFAULT=0
UNINSTALL=0

if [ -t 1 ]; then
  B=$'\e[1m'; D=$'\e[2m'; R=$'\e[0m'; V=$'\e[38;5;167m'; G=$'\e[32m'
else
  B=""; D=""; R=""; V=""; G=""
fi

say()  { printf '%s\n' "$*"; }
step() { printf '%s›%s %s\n' "$V" "$R" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$R" "$*"; }
die()  { printf '%s✗ %s%s\n' "$V" "$*" "$R" >&2; exit 1; }

usage() {
  cat <<'EOF'
Tobari installer

  curl -fsSL https://kaorii-ako.github.io/tobari/install.sh | bash -s -- [options]

  --flatpak       install the Flatpak bundle (default when flatpak is present)
  --tarball       install the per-user build into ~/.local (no Flatpak needed)
  --appimage      put the AppImage in ~/Applications
  --set-default   make Tobari the default web browser
  --version X.Y.Z install a specific release
  --uninstall     remove Tobari (profiles are kept)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --flatpak) MODE=flatpak ;;
    --tarball) MODE=tarball ;;
    --appimage) MODE=appimage ;;
    --set-default) SET_DEFAULT=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --version) shift; VERSION="${1:?--version needs a value}" ;;
    --version=*) VERSION="${1#--version=}" ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die "not a version: $VERSION"
BASE="${TOBARI_RELEASE_URL:-https://github.com/$REPO/releases/download/v$VERSION}"
BASE="${BASE%/}"

# ------------------------------------------------------------------ uninstall

if [ "$UNINSTALL" = 1 ]; then
  step "Removing Tobari"
  if command -v flatpak >/dev/null 2>&1 && flatpak info --user "$APP_ID" >/dev/null 2>&1; then
    flatpak uninstall --user -y --noninteractive "$APP_ID" >/dev/null && ok "Flatpak removed"
  fi
  if [ -d "$HOME/.local/lib/tobari" ]; then
    rm -rf "$HOME/.local/lib/tobari"
    rm -f "$HOME/.local/bin/tobari" \
          "${XDG_DATA_HOME:-$HOME/.local/share}/applications/$APP_ID.desktop" \
          "${XDG_DATA_HOME:-$HOME/.local/share}/metainfo/$APP_ID.metainfo.xml"
    find "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor" -name "$APP_ID.png" -delete 2>/dev/null || true
    ok "Per-user install removed"
  fi
  if [ -f "$HOME/Applications/Tobari.AppImage" ]; then
    rm -f "$HOME/Applications/Tobari.AppImage"
    entry="${XDG_DATA_HOME:-$HOME/.local/share}/applications/$APP_ID.desktop"
    if [ -f "$entry" ] && grep -q "X-Tobari-AppImage=true" "$entry"; then rm -f "$entry"; fi
    ok "AppImage removed"
  fi
  if [ -d "$HOME/Applications/Tobari.app" ]; then
    rm -rf "$HOME/Applications/Tobari.app"
    ok "Tobari.app removed"
  fi
  say "Profiles were kept: ${XDG_DATA_HOME:-$HOME/.local/share}/tobari, ~/.var/app/$APP_ID or ~/Library/Application Support/Tobari."
  exit 0
fi

# ------------------------------------------------------------------ checks

printf '\n  %s帳  Tobari %s%s  %sinstaller%s\n\n' "$B" "$VERSION" "$R" "$D" "$R"

OS="$(uname -s)"
case "$OS/$(uname -m)" in
  Linux/x86_64|Linux/amd64) ;;
  Darwin/arm64) MODE=mac ;;
  Darwin/*) die "Tobari for macOS is built for Apple silicon only; this Mac is $(uname -m)." ;;
  *) die "Tobari runs on Linux x86_64 and Apple-silicon Macs; this is $OS on $(uname -m)." ;;
esac
[ "$(id -u)" != 0 ] || die "Run this as your own user, not root. It installs into your home directory."

if [ -z "$MODE" ]; then
  if command -v flatpak >/dev/null 2>&1; then MODE=flatpak; else MODE=tarball; fi
fi
if [ "$MODE" = mac ]; then
  ARTIFACT="Tobari-$VERSION-macos-arm64.dmg"
elif [ "$MODE" = flatpak ]; then
  command -v flatpak >/dev/null 2>&1 || die "flatpak is not installed. Use --tarball or --appimage, or install flatpak first."
  ARTIFACT="tobari-$VERSION.flatpak"
else
  # The per-user build relies on unprivileged user namespaces for Chromium's
  # sandbox. Without them it would refuse to start renderers, so stop here.
  if command -v unshare >/dev/null 2>&1 && ! unshare -Ur true 2>/dev/null; then
    die "Unprivileged user namespaces are disabled here, which Chromium's sandbox needs. Use --flatpak instead."
  fi
  if [ "$MODE" = appimage ]; then
    ARTIFACT="Tobari-$VERSION-x86_64.AppImage"
  else
    ARTIFACT="tobari-$VERSION-linux-x86_64.tar.gz"
  fi
fi

for tool in base64 tar; do
  command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done
# GNU coreutils' sha256sum checks a list with -c. macOS 14+ also has a BSD
# sha256sum in /sbin whose -c means "compare with this string", so only the
# GNU one is used, and shasum (on every Mac) otherwise.
if sha256sum --version 2>/dev/null | grep -q GNU; then sha256_check() { sha256sum -c --status; }
else sha256_check() { shasum -a 256 -c --status; }; fi
if printf 'YQ==' | base64 -d >/dev/null 2>&1; then b64d() { base64 -d; }; else b64d() { base64 -D; }; fi
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fL --proto '=https,file' --tlsv1.2 --retry 3 --progress-bar -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q --show-progress --https-only -O "$2" "$1"; }
else
  die "need curl or wget to download"
fi
if command -v minisign >/dev/null 2>&1; then
  VERIFIER=minisign
elif command -v openssl >/dev/null 2>&1 && openssl version | grep -q '^OpenSSL 3'; then
  VERIFIER=openssl
else
  if [ "$OS" = Darwin ]; then
    die "need minisign to check the release signature: brew install minisign"
  fi
  die "need minisign or OpenSSL 3 to check the release signature"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/tobari-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ------------------------------------------------------------------ download

step "Downloading release $VERSION ($MODE)"
fetch "$BASE/SHA256SUMS" "$WORK/SHA256SUMS" 2>/dev/null || die "could not download $BASE/SHA256SUMS"
fetch "$BASE/SHA256SUMS.minisig" "$WORK/SHA256SUMS.minisig" 2>/dev/null || die "could not download the signature"
fetch "$BASE/$ARTIFACT" "$WORK/$ARTIFACT" || die "could not download $ARTIFACT"

# ------------------------------------------------------------------ verify

# minisign format: the public key is base64("Ed" | key id (8) | key (32)); a
# signature line is base64("ED" | key id (8) | Ed25519 over BLAKE2b-512 of the
# file), and the global signature covers that signature plus the trusted
# comment. OpenSSL 3 can check Ed25519 directly, so minisign is not required.
verify_with_openssl() {
  local file="$1" sig="$2" w="$WORK/v"
  mkdir -p "$w"
  printf '%s' "$PUBKEY" | b64d > "$w/pk.bin" 2>/dev/null || return 1
  [ "$(head -c 2 "$w/pk.bin")" = "Ed" ] || return 1
  sed -n 2p "$sig" | b64d > "$w/sig.bin" 2>/dev/null || return 1
  [ "$(head -c 2 "$w/sig.bin")" = "ED" ] || return 1
  # Key ids must match.
  cmp -s <(head -c 10 "$w/pk.bin" | tail -c 8) <(head -c 10 "$w/sig.bin" | tail -c 8) || return 1
  # SubjectPublicKeyInfo for Ed25519, then the raw 32-byte key.
  { printf '\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00'; tail -c 32 "$w/pk.bin"; } > "$w/pk.der"
  openssl pkey -pubin -inform DER -in "$w/pk.der" -out "$w/pk.pem" 2>/dev/null || return 1
  tail -c 64 "$w/sig.bin" > "$w/s.bin"
  openssl dgst -blake2b512 -binary "$file" > "$w/h.bin" || return 1
  openssl pkeyutl -verify -pubin -inkey "$w/pk.pem" -rawin -in "$w/h.bin" -sigfile "$w/s.bin" >/dev/null 2>&1 || return 1
  # Global signature: binds the trusted comment to this signature.
  local trusted
  trusted="$(sed -n 3p "$sig")"
  case "$trusted" in "trusted comment: "*) ;; *) return 1 ;; esac
  { cat "$w/s.bin"; printf '%s' "${trusted#trusted comment: }"; } > "$w/g.msg"
  sed -n 4p "$sig" | b64d > "$w/g.sig" 2>/dev/null || return 1
  openssl pkeyutl -verify -pubin -inkey "$w/pk.pem" -rawin -in "$w/g.msg" -sigfile "$w/g.sig" >/dev/null 2>&1 || return 1
  printf '%s\n' "${trusted#trusted comment: }"
}

step "Checking the signature ($VERIFIER)"
if [ "$VERIFIER" = minisign ]; then
  TRUSTED="$(minisign -Vm "$WORK/SHA256SUMS" -x "$WORK/SHA256SUMS.minisig" -P "$PUBKEY" -q >/dev/null 2>&1 && \
             sed -n 's/^trusted comment: //p' "$WORK/SHA256SUMS.minisig")" \
    || die "SIGNATURE CHECK FAILED. This download is not a Tobari release. Nothing was installed."
else
  TRUSTED="$(verify_with_openssl "$WORK/SHA256SUMS" "$WORK/SHA256SUMS.minisig")" \
    || die "SIGNATURE CHECK FAILED. This download is not a Tobari release. Nothing was installed."
fi
ok "signed by the Tobari release key: $TRUSTED"

LINE="$(grep -E "^[0-9a-f]{64}  $ARTIFACT\$" "$WORK/SHA256SUMS" || true)"
[ -n "$LINE" ] || die "$ARTIFACT is not listed in the signed checksums."
(cd "$WORK" && printf '%s\n' "$LINE" | sha256_check) \
  || die "CHECKSUM MISMATCH for $ARTIFACT. Nothing was installed."
ok "checksum matches: ${LINE%% *}"

# ------------------------------------------------------------------ install

if [ "$MODE" = mac ]; then
  step "Installing Tobari.app into ~/Applications"
  # Downloaded with curl, the image carries no quarantine flag, so Gatekeeper
  # does not stop the first launch; the signature check above is what vouches
  # for it. The app is ad-hoc signed, not notarized.
  mkdir -p "$HOME/Applications" "$WORK/mnt"
  hdiutil attach -nobrowse -readonly -quiet -mountpoint "$WORK/mnt" "$WORK/$ARTIFACT"
  rm -rf "$HOME/Applications/Tobari.app"
  ditto "$WORK/mnt/Tobari.app" "$HOME/Applications/Tobari.app"
  hdiutil detach -quiet "$WORK/mnt"
  xattr -dr com.apple.quarantine "$HOME/Applications/Tobari.app" 2>/dev/null || true
  ok "installed ~/Applications/Tobari.app"
  LAUNCH="open ~/Applications/Tobari.app"
  DESKTOP=""
elif [ "$MODE" = appimage ]; then
  step "Installing the AppImage into ~/Applications"
  mkdir -p "$HOME/Applications"
  install -m 755 "$WORK/$ARTIFACT" "$HOME/Applications/Tobari.AppImage"
  ok "installed ~/Applications/Tobari.AppImage (it adds itself to the app menu on first launch)"
  LAUNCH="~/Applications/Tobari.AppImage"
  DESKTOP="$APP_ID.desktop"
elif [ "$MODE" = flatpak ]; then
  step "Installing the Flatpak (user installation)"
  # The bundle names Flathub as its runtime source; adding it explicitly keeps
  # the runtime download working on systems where it was never configured.
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y --noninteractive --reinstall "$WORK/$ARTIFACT"
  ok "installed $APP_ID"
  # A per-user entry with the same id shadows the Flatpak's in the app menu
  # and the dock. Drop one whose program no longer exists, so the window is
  # matched to the Flatpak and gets its icon.
  STALE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/$APP_ID.desktop"
  if [ -f "$STALE" ]; then
    EXEC="$(sed -n 's/^Exec=\([^ ]*\).*/\1/p' "$STALE" | head -1)"
    if [ -n "$EXEC" ] && [ ! -x "$EXEC" ]; then
      rm -f "$STALE"
      ok "removed a stale launcher that pointed at $EXEC"
    fi
  fi
  LAUNCH="flatpak run $APP_ID"
  DESKTOP="$APP_ID.desktop"
else
  step "Installing into ~/.local"
  tar -xzf "$WORK/$ARTIFACT" -C "$WORK"
  DIR="$WORK/tobari-$VERSION"
  [ -x "$DIR/install.sh" ] || die "the archive has no installer"
  "$DIR/install.sh" "$DIR/app" | sed 's/^/  /'
  LAUNCH="tobari"
  DESKTOP="$APP_ID.desktop"
fi

if [ "$SET_DEFAULT" = 1 ] && [ "$OS" = Darwin ]; then
  say "  On macOS, choose the default browser in System Settings → Desktop & Dock."
elif [ "$SET_DEFAULT" = 1 ]; then
  xdg-settings set default-web-browser "$DESKTOP" 2>/dev/null || true
  for t in x-scheme-handler/http x-scheme-handler/https text/html; do
    xdg-mime default "$DESKTOP" "$t" 2>/dev/null || true
  done
  ok "Tobari is now the default browser"
fi

printf '\n  %sDone.%s Open Tobari from your app menu, or run: %s%s%s\n' "$B" "$R" "$B" "$LAUNCH" "$R"
printf '  %sTo update, run this installer again. To remove: … | bash -s -- --uninstall%s\n\n' "$D" "$R"
