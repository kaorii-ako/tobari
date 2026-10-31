#!/usr/bin/env bash
# Installer check: bench/install_test.sh. Builds fake releases signed with a throwaway minisign key and checks that
# packaging/install.sh installs a good one (with minisign and with OpenSSL) and refuses a tampered AppImage, a
# tampered SHA256SUMS, a missing signature and another key's signature. Needs minisign and OpenSSL 3.
set -uo pipefail
inst=$(realpath "$(dirname "$0")/../packaging/install.sh")
w=$(mktemp -d); trap '[ -n "${KEEP:-}" ] || rm -rf "$w"' EXIT
v=9.9.9; app=Tobari-$v-x86_64.AppImage
minisign -G -W -p "$w/test.pub" -s "$w/test.key" >/dev/null && minisign -G -W -p "$w/other.pub" -s "$w/other.key" >/dev/null || exit 1
pub=$(tail -1 "$w/test.pub")

release() {  # release DIR KEY: a fake AppImage that only knows --appimage-extract, its SHA256SUMS and signature
  mkdir -p "$1"
  cat > "$1/$app" <<'APP'
#!/bin/sh
[ "$1" = --appimage-extract ] || { echo "fake tobari"; exit 0; }
mkdir -p squashfs-root && echo '<svg/>' > squashfs-root/tobari.svg
printf '[Desktop Entry]\nName=Tobari\nExec=tobari %%U\n' > squashfs-root/tobari.desktop
APP
  (cd "$1" && sha256sum "$app" > SHA256SUMS)
  minisign -Sm "$1/SHA256SUMS" -s "$2" -t "tobari $v" >/dev/null </dev/null
}
run() {  # run DIR VERIFIER [ARGS]: the installer in a fresh HOME; prints the HOME
  local h; h=$(mktemp -d "$w/home.XXXX")
  HOME=$h XDG_DATA_HOME= TOBARI_TEST_BASE="file://$1" TOBARI_TEST_PUBKEY=$pub TOBARI_TEST_VERIFIER=$2 \
    bash "$inst" --version $v "${@:3}" >"$h/log" 2>&1
  echo "$h:$?"
}
installed() { [ -x "$1/.local/share/tobari/app/Tobari.AppImage" ] && [ "$("$1/.local/bin/tobari")" = "fake tobari" ] &&
  grep -q "^Exec=$1/.local/share/tobari/app/Tobari.AppImage %U" "$1/.local/share/applications/tobari.desktop"; }
nothing() { [ ! -e "$1/.local/share/tobari/app" ] && [ ! -e "$1/.local/bin/tobari" ]; }

pass=0; fail=()
check() { if "${@:2}"; then pass=$((pass + 1)); else fail+=("$1"); fi; }
release "$w/good" "$w/test.key"
for ver in minisign openssl; do
  r=$(run "$w/good" $ver); check "good_$ver" eval "[ ${r##*:} = 0 ] && installed ${r%:*}"
done
cp -r "$w/good" "$w/badapp"; echo x >> "$w/badapp/$app"
r=$(run "$w/badapp" openssl); check bad_checksum eval "[ ${r##*:} != 0 ] && nothing ${r%:*} && grep -q 'CHECKSUM MISMATCH' ${r%:*}/log"
cp -r "$w/good" "$w/badsums"; sed -i 's/^./0/' "$w/badsums/SHA256SUMS"
for ver in minisign openssl; do
  r=$(run "$w/badsums" $ver); check "bad_signature_$ver" eval "[ ${r##*:} != 0 ] && nothing ${r%:*} && grep -q 'SIGNATURE CHECK FAILED' ${r%:*}/log"
done
cp -r "$w/good" "$w/nosig"; rm "$w/nosig/SHA256SUMS.minisig"
r=$(run "$w/nosig" openssl); check no_signature eval "[ ${r##*:} != 0 ] && nothing ${r%:*}"
release "$w/otherkey" "$w/other.key"
for ver in minisign openssl; do
  r=$(run "$w/otherkey" $ver); check "other_key_$ver" eval "[ ${r##*:} != 0 ] && nothing ${r%:*}"
done
r=$(run "$w/good" openssl); h=${r%:*}
HOME=$h XDG_DATA_HOME= bash "$inst" --uninstall >/dev/null 2>&1
check uninstall eval "nothing $h && [ ! -e $h/.local/share/applications/tobari.desktop ]"
echo "install: $([ ${#fail[@]} = 0 ] && echo PASS || echo FAIL) $pass / $((pass + ${#fail[@]})) ${fail[*]:-}"
[ ${#fail[@]} = 0 ]
