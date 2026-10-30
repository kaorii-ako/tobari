# Releasing

## v2 preview (0.5.0 and later)

1. Set the version in `core/Cargo.toml`, `extension/static/manifest.json`,
   `extension/package.json` and the `VERSION=` default in `packaging/v2/install.sh`.
   The release workflow refuses a tag that doesn't match all of them.
2. Tag and push:

```bash
git tag v0.5.0 && git push origin v0.5.0
```

3. `.github/workflows/release.yml` runs every test, builds the core and the extension,
   smoke-tests the archive, and creates a **draft** pre-release with
   `tobari-<v>-linux-x86_64.tar.gz`, `tobari-<v>-extension.zip`, `install.sh` and `SHA256SUMS`.
4. On the machine that holds the release key, sign and publish:

```bash
packaging/sign-release.sh 0.5.0
```

It downloads the checksums and files, re-checks them, signs `SHA256SUMS` with
`~/.minisign/tobari.key`, uploads `SHA256SUMS.minisig` and publishes the release.

5. Publishing fires the `release` event. GitHub Pages rebuilds and the download page lists the new
   version; Vercel rebuilds too if the `VERCEL_DEPLOY_HOOK` secret is set.

The release key never goes to CI. Its public half is `tobari.pub`
(key id `0F0DC333B8A4E968`), pinned in `packaging/v2/install.sh` and `packaging/get-tobari.sh`.
An unsigned release cannot be installed: the installer stops at the signature check.

## Website

`site/` builds the static site. GitHub Pages deploys it from `main` (`.github/workflows/pages.yml`);
Vercel deploys it through its Git integration with Root Directory `site`. The build fails on any
broken internal link, inline script or style, or third-party request.

```bash
cd site && npm ci && SITE_BASE=/tobari/ node scripts/build.mjs
```
