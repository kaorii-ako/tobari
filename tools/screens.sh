#!/bin/sh
# screens.sh [BIN] — screenshot every shell surface in light and dark into docs/screens/ (needs network for the pages).
cd "$(dirname "$0")/.." || exit 1
bin=$(realpath "${1:-build/out/tobari}")
mkdir -p docs/screens
tmp=$(mktemp -d)
pages='https://ja.wikipedia.org/wiki/%E3%83%96%E3%83%A9%E3%82%A6%E3%82%B6 https://th.wikipedia.org/wiki/%E0%B9%80%E0%B8%A7%E0%B9%87%E0%B8%9A%E0%B9%80%E0%B8%9A%E0%B8%A3%E0%B8%B2%E0%B8%A7%E0%B9%8C%E0%B9%80%E0%B8%8B%E0%B8%AD%E0%B8%A3%E0%B9%8C https://example.org'
for theme in light dark; do
  # surface:demo flags:extra args
  for spec in 'browse::' 'assistant:ai:' 'command:cmd:' 'find:find:' 'split:split:' 'compact:compact:' \
              'toast:toast:' 'empty::--tobari-empty' 'about::tobari://about/' 'blocking::tobari://blocking/' \
              'bangs::tobari://bangs/' 'https::tobari://https/#http://http.badssl.com/' 'import::tobari://import/'; do
    name=${spec%%:*}; rest=${spec#*:}; demo=${rest%%:*}; extra=${rest#*:}
    urls=$pages
    case $extra in --tobari-empty) urls= extra= ;; tobari:*) urls="$pages $extra" extra= ;; esac
    rm -rf "$tmp/data"
    # $urls is split into separate arguments on purpose.
    XDG_DATA_HOME="$tmp/data" bench/shot.sh "docs/screens/$name-$theme.png" 12 \
      "$bin" --ozone-platform=wayland \
      --tobari-demo="theme=$theme&demo=$demo" $urls >/dev/null 2>&1
    echo "screens: $name-$theme"
  done
done
rm -rf "$tmp"
