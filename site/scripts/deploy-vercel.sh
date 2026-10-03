#!/usr/bin/env bash
# Builds the site for Vercel and deploys the static output to the linked
# Vercel project (site/.vercel, created by `vercel link --project tobari`).
#   site/scripts/deploy-vercel.sh          preview deployment
#   site/scripts/deploy-vercel.sh --prod   production (tobari-pi.vercel.app)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .vercel/project.json ] || { echo "not linked: run 'vercel link --project tobari' in site/" >&2; exit 1; }
SITE_HOST=vercel node scripts/build.mjs
cp -r .vercel dist/
cd dist && vercel deploy -y "$@"
