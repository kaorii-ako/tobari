#!/usr/bin/env bash
# Tobari installer.
#
#   curl -fsSL https://github.com/kaorii-ako/tobari/releases/latest/download/install.sh | bash
#   curl -fsSL https://github.com/kaorii-ako/tobari/releases/latest/download/install.sh | bash -s -- --uninstall
#
# Linux x86_64. Downloads the AppImage from GitHub, checks the minisign signature
# on SHA256SUMS against the release key pinned below and the AppImage against
# the signed checksums, then installs for the current user only: the AppImage
# goes to ~/.local/share/tobari/app, the command to ~/.local/bin. Nothing runs
# as root. Anything that fails a check is deleted, never run.
set -euo pipefail

VERSION="${TOBARI_VERSION:-0.5.1}"
REPO="kaorii-ako/tobari"
PUBKEY="RWRo6aS4M8MND+s3tkrSD2POK8Donu5pWez8QI5+Pf6KZike67q2L6iB"
UNINSTALL=0

if [ -t 1 ]; then B=$'\e[1m'; R=$'\e[0m'; V=$'\e[38;5;167m'; G=$'\e[32m'; else B=""; R=""; V=""; G=""; fi
say()  { printf '%s\n' "$*"; }
step() { printf '%s›%s %s\n' "$V" "$R" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$R" "$*"; }
die()  { printf '%s✗ %s%s\n' "$V" "$*" "$R" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) UNINSTALL=1 ;;
    --version) VERSION="${2:?--version needs a value}"; shift ;;
    --help|-h) sed -n '2,12p' "$0" 2>/dev/null || true; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
  shift
done

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/tobari"
APP="$DATA/app"
BIN="$HOME/.local/bin"
DESKTOP="${XDG_DATA_HOME:-$HOME/.local/share}/applications/tobari.desktop"
ICON="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps/tobari.svg"

if [ "$UNINSTALL" = 1 ]; then
  step "Removing Tobari"
  rm -rf "$APP" "$BIN/tobari" "$DESKTOP" "$ICON"
  ok "removed. Your profile, history and settings are kept in $DATA"
  exit 0
fi

[ "$(uname -s)" = Linux ] || die "Tobari is Linux only"
[ "$(uname -m)" = x86_64 ] || die "Tobari is built for x86_64 only"
[ "$(id -u)" != 0 ] || die "run this as your normal user, not root"

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
if [ -n "${TOBARI_TEST_VERIFIER:-}" ]; then VERIFIER="$TOBARI_TEST_VERIFIER"  # bench/install_test.sh tries both
elif command -v minisign >/dev/null 2>&1; then VERIFIER=minisign
elif command -v openssl >/dev/null 2>&1 && openssl version | grep -q '^OpenSSL 3'; then VERIFIER=openssl
else die "need minisign or OpenSSL 3 to check the release signature"; fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/tobari-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
BASE="${TOBARI_TEST_BASE:-https://github.com/$REPO/releases/download/v$VERSION}"
[ -z "${TOBARI_TEST_PUBKEY:-}" ] || PUBKEY="$TOBARI_TEST_PUBKEY"
ARTIFACT="Tobari-$VERSION-x86_64.AppImage"

step "Downloading Tobari $VERSION"
fetch "$BASE/SHA256SUMS" "$WORK/SHA256SUMS" 2>/dev/null || die "release v$VERSION not found at $BASE (not published yet?)"
fetch "$BASE/SHA256SUMS.minisig" "$WORK/SHA256SUMS.minisig" 2>/dev/null || die "release v$VERSION has no signature yet, so it can't be trusted. Nothing was installed."
fetch "$BASE/$ARTIFACT" "$WORK/$ARTIFACT" || die "could not download $ARTIFACT"

verify_with_openssl() {
  local file="$1" sig="$2" w="$WORK/v"
  mkdir -p "$w"
  printf '%s' "$PUBKEY" | b64d > "$w/pk.bin" 2>/dev/null || return 1
  [ "$(head -c 2 "$w/pk.bin")" = "Ed" ] || return 1
  sed -n 2p "$sig" | b64d > "$w/sig.bin" 2>/dev/null || return 1
  [ "$(head -c 2 "$w/sig.bin")" = "ED" ] || return 1
  cmp -s <(head -c 10 "$w/pk.bin" | tail -c 8) <(head -c 10 "$w/sig.bin" | tail -c 8) || return 1
  { printf '\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00'; tail -c 32 "$w/pk.bin"; } > "$w/pk.der"
  openssl pkey -pubin -inform DER -in "$w/pk.der" -out "$w/pk.pem" 2>/dev/null || return 1
  tail -c 64 "$w/sig.bin" > "$w/s.bin"
  openssl dgst -blake2b512 -binary "$file" > "$w/h.bin" || return 1
  openssl pkeyutl -verify -pubin -inkey "$w/pk.pem" -rawin -in "$w/h.bin" -sigfile "$w/s.bin" >/dev/null 2>&1 || return 1
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
(cd "$WORK" && printf '%s\n' "$LINE" | sha256_check) || die "CHECKSUM MISMATCH for $ARTIFACT. Nothing was installed."
ok "checksum matches: ${LINE%% *}"

step "Installing into $APP"
mkdir -p "$APP" "$BIN" "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
chmod +x "$WORK/$ARTIFACT"
mv -f "$WORK/$ARTIFACT" "$APP/Tobari.AppImage"
ln -sf "$APP/Tobari.AppImage" "$BIN/tobari"
(cd "$WORK" && "$APP/Tobari.AppImage" --appimage-extract 'tobari.*' >/dev/null 2>&1) || die "the AppImage won't open"
cp "$WORK/squashfs-root/tobari.svg" "$ICON"
sed "s|^Exec=tobari|Exec=$APP/Tobari.AppImage|" "$WORK/squashfs-root/tobari.desktop" > "$DESKTOP"
ok "Tobari $VERSION installed"

say ""
say "${B}Start it:${R}  tobari   (or Tobari in your app menu)"
case ":$PATH:" in *":$BIN:"*) ;; *) say "Add $BIN to your PATH to run tobari from a terminal." ;; esac
