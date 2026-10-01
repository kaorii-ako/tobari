#!/bin/sh
# zypak replaces Chromium's SUID sandbox helper with Flatpak's own sandbox
# primitives. Chromium's sandbox stays on; it is never launched with
# --no-sandbox. CEF keeps Chromium in libcef.so rather than the executable,
# and zypak has to be told where to hook it.
export ZYPAK_CEF_LIBRARY_PATH=/app/lib/tobari/libcef.so
exec zypak-wrapper /app/lib/tobari/tobari --class=dev.tobari.Browser "$@"
