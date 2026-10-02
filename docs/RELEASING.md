# RELEASING

## Security cadence: the CEF bump

Tobari's engine is Chromium as packaged by CEF. When Chrome ships a security
fix, Tobari users are exposed to a publicly known bug until two things happen:
a CEF build carrying that Chromium version appears, and Tobari ships it. The
first is outside this project's control; the second is not.

**Target: a Tobari release within 3 days of a CEF stable build that carries a
Chromium security fix.**

Steps:

1. Find the new build in `https://cef-builds.spotifycdn.com/index.json` under
   `linux64`, channel `stable`, file type `minimal`.
2. Update `CEF_VERSION` and `CEF_SHA1` in `shell/provision-cef.sh` together,
   and the CEF `url` and `sha256` in
   `packaging/flatpak/dev.tobari.Browser.source.yml` (download the archive,
   check its SHA-1 against the index, then take its `sha256sum`).
3. Build, run the checks in `docs/DEV-LINUX.md` §5, launch on a throwaway
   profile, and confirm the blocker, bangs, both bundled extensions and a Web
   Store install still work.
4. Record the gap in the table in `SECURITY.md` (Chrome stable release, CEF
   build, Tobari release).
5. Release as below.

## Filter lists

Installed copies update themselves weekly. To refresh the lists shipped with a
release:

```sh
scripts/update-filters.sh
```

It downloads the four lists, refuses an empty one, writes `SHA256SUMS` and
records the snapshot time in `SNAPSHOT`, which Tobari uses to date bundled lists
that carry no version stamp of their own.

## Building release artifacts

1. Add a `<release version="X.Y.Z" date="…">` entry at the top of
   `packaging/dev.tobari.Browser.metainfo.xml`, and set the same version as the
   default in `packaging/get-tobari.sh` (`VERSION="${TOBARI_VERSION:-X.Y.Z}"`).
   The site build and `release.sh` both refuse to run if the two disagree.
2. Build and package:

```sh
cmake --build ~/.cache/tobari-dev/build
packaging/release.sh ~/.cache/tobari-dev/build     # → dist/release-X.Y.Z/
```

`release.sh` produces:

| file | what |
|---|---|
| `tobari-X.Y.Z.flatpak` | Flatpak bundle; names Flathub as its runtime source |
| `tobari-X.Y.Z-linux-x86_64.tar.gz` | `tobari-X.Y.Z/app/` (the build), `install.sh`, desktop entry, metainfo, icons |
| `install.sh` | the online installer, `packaging/get-tobari.sh` |
| `SHA256SUMS`, `SHA256SUMS.minisig` | checksums of the three files above, signed |

3. Create the GitHub release `vX.Y.Z` with those five files, then push, so the
   site (which serves the installer at `/install.sh`) points at a release that
   exists.

## The installer

`packaging/get-tobari.sh` is served by the site at `/install.sh` and attached to
every release. It pins the release version and the public key, downloads
`SHA256SUMS`, its signature and one artifact from GitHub Releases, verifies the
signature with `minisign` or — when minisign is absent — with OpenSSL 3, which
can check minisign's Ed25519 signatures over BLAKE2b-512 directly, checks the
artifact's SHA-256 against the signed list, and only then installs, for the
current user only. `TOBARI_RELEASE_URL` points it at a local directory
(`file://…`) to test a release before uploading it.

## Signing

Every artifact is signed with minisign. The release key was created on
2026-10-02:

```
key id      0F0DC333B8A4E968
public key  RWRo6aS4M8MND+s3tkrSD2POK8Donu5pWez8QI5+Pf6KZike67q2L6iB
```

`tobari.pub` in the repository root holds it. The secret key lives at
`~/.minisign/tobari.key` on the maintainer's machine, mode 0600, and never in
the repository or CI. It was generated without a passphrase so it could be
created unattended; add one before the first public release with
`minisign -C -s ~/.minisign/tobari.key`, and keep an offline backup.

```sh
sha256sum tobari.flatpak tobari-*.tar.gz > SHA256SUMS
minisign -Sm SHA256SUMS -s ~/.minisign/tobari.key -t "tobari <version>"
```

Users verify with:

```sh
minisign -Vm SHA256SUMS -P RWRo6aS4M8MND+s3tkrSD2POK8Donu5pWez8QI5+Pf6KZike67q2L6iB \
  && sha256sum -c SHA256SUMS
```

A key that has to be replaced is announced in `SECURITY.md` and signed with the
old key while it is still trusted.

## Distribution

- **GitHub Releases** — the Flatpak bundle, the tarball, `SHA256SUMS` and its
  `.minisig`.
- **Flathub** — once the manifest builds from source (`docs/PACKAGING.md`).
- **Never Netlify** for binaries. The site links to GitHub Releases.
