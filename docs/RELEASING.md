# RELEASING.md

Every Tobari release is signed, checksummed, and reproducible from a tag.
Binaries are served from GitHub Releases and (Phase 2+) Flathub. They are never
served from Netlify — bandwidth caps make that a bill, not a distribution
strategy (spec §8c).

## Signing key

Tobari signs with **minisign**. It is a single small tool, the public key is one
line a reader can eyeball, and verification needs no keyserver round trip.

Generate once, on the dev machine, inside the distrobox container:

```sh
minisign -G -s ~/.tobari-signing/minisign.key -p ./tobari-release.pub
```

- The secret key lives **only** at `~/.tobari-signing/minisign.key`, passphrase
  protected, never in the repo, never in CI, never in a password manager sync
  that a browser extension can reach.
- `tobari-release.pub` is committed to the repo root and published at
  `tobari.dev/tobari-release.pub`. Two locations, so a reader can cross-check
  one against the other.
- There is no key rotation story yet. Write one before the key is a year old.

**Signing happens on the dev machine, not in CI.** CI has no release token and
no signing key (spec §10). A compromised workflow must not be able to produce a
signed Tobari build.

## Release checklist

1. **Decide the version.** `MAJOR.MINOR.PATCH`. Pre-1.0 the minor is the phase.
2. **Update the version in every place it appears:**
   - `core/Cargo.toml` (`workspace.package.version`)
   - `extension/manifest.json` (`version`)
   - `packaging/build-appimage.sh` (`VERSION`)
   - `CHANGELOG.md`
3. **Verify the tree is clean and CI is green** on the commit being tagged.
4. **Build in the container:**
   ```sh
   packaging/build-llama-server.sh
   packaging/build-appimage.sh
   ```
5. **Verify the artifacts before signing them.** Signing an untested binary
   just makes a bad build authentic.
   ```sh
   ./packaging/build/dist/Tobari-$VERSION-linux-x86_64.AppImage --validate
   ./packaging/build/dist/Tobari-$VERSION-linux-x86_64.AppImage --doctor
   ```
   Run the §5 acceptance flow against the AppImage on a clean Bazzite system
   with no host packages layered. An AppImage that only works on the machine
   that built it is not a release.
6. **Checksums, then signatures:**
   ```sh
   cd packaging/build/dist
   sha256sum Tobari-$VERSION-linux-x86_64.AppImage \
             tobari-$VERSION-linux-x86_64.tar.gz > SHA256SUMS
   minisign -S -s ~/.tobari-signing/minisign.key -m SHA256SUMS \
            -c "Tobari $VERSION" -t "Tobari $VERSION release"
   ```
   Signing `SHA256SUMS` rather than each artifact means one signature to verify
   and one file to check artifacts against.
7. **Tag and push:**
   ```sh
   git tag -a v$VERSION -m "Tobari $VERSION"
   git push origin v$VERSION
   ```
8. **Create the GitHub Release** with `Tobari-*.AppImage`,
   `tobari-*.tar.gz`, `SHA256SUMS`, `SHA256SUMS.minisig`, and release notes.
   ```sh
   gh release create v$VERSION --title "Tobari $VERSION" \
      --notes-file CHANGELOG-$VERSION.md \
      packaging/build/dist/Tobari-$VERSION-linux-x86_64.AppImage \
      packaging/build/dist/tobari-$VERSION-linux-x86_64.tar.gz \
      packaging/build/dist/SHA256SUMS \
      packaging/build/dist/SHA256SUMS.minisig
   ```
9. **Verify the published artifacts** by downloading them fresh and running the
   user-facing verification below. Do it from a different directory than the
   build. This catches upload corruption and the wrong-file-attached mistake.

## What a user runs to verify

This block belongs verbatim on the download page (spec §8c).

```sh
minisign -Vm SHA256SUMS -P RWQ...            # the published public key
sha256sum -c SHA256SUMS --ignore-missing
```

`minisign -V` must print `Signature and comment signature verified`. If it does
not, the download is not Tobari — stop, and open an issue.

## Flathub (Phase 2+)

Not applicable in Phase 1: the Phase 1 deliverable is a sidecar that must reach
the user's *existing* browser, which requires being outside a sandbox
(spec §12.1). There is nothing to put on Flathub until the Phase 2 browser
exists.

When it does:

- App ID `dev.tobari.Browser`, submitted to `flathub/flathub` as a manifest PR.
- `tobari-core` ships **inside the same Flatpak** as the browser, so native
  messaging never crosses the sandbox boundary.
- The manifest builds from a **tagged source tarball with a sha256**, never
  from a moving branch.
- Flathub builds are produced by Flathub's infrastructure, so they carry
  **Flathub's** signature, not ours. Say this plainly on the download page
  rather than implying our key covers them.
- `dev.tobari.Browser.metainfo.xml` needs a `<release>` entry per version or
  the listing goes stale in GNOME Software and KDE Discover.

## macOS

No signed macOS artifact is produced. See `docs/DEV-MACOS.md` — macOS is a
build-from-source target until there is a Mac to test on and a paid Apple
Developer account for notarization. Do not attach a `.dmg` to a release; an
unnotarized `.dmg` that Gatekeeper blocks is worse than no download at all.

## After the release

- [ ] Download page on `tobari.dev` points at the new tag.
- [ ] `SECURITY.md` and `BENCHMARKS.md` on the site match the repo at this tag.
- [ ] Devlog written **by the developer** (spec §11), including what broke.
- [ ] No claim in the release notes lacks a backing section in `SECURITY.md`
      or `BENCHMARKS.md`.
