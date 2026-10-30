# Tobari rewrite: handoff

Updated 2026-10-30. Current step: **0, waiting for Kao's answers.**

## Done
- Created local tags (not pushed yet):
  - `archive/browser-0.4.0` → `origin/browser` at 893ad36
  - `archive/v2-extension` → `origin/main` at c44e407
- Created the orphan branch `rewrite`, with no history from the old code. It holds only this file, `docs/tabbit-parity.md` and `tobari.pub` (key id 0F0DC333B8A4E968, copied unchanged).
- Read tabbit.ai and the Tabbit CLI blog post, and wrote `docs/tabbit-parity.md`.
- Checked reachability from this machine with curl, 2026-10-30: cef-builds.spotifycdn.com, commondatastorage.googleapis.com (Chromium snapshots) and archive.mozilla.org all returned 200.
- Not changed: the `phase-3-ai` and `claude/dreamy-albattani-pl8bw2` remote branches, and Releases 0.1.0 to 0.4.0.

## Next
1. Kao answers the Step 0 questions.
2. Push the archive tags and `rewrite`, if Kao approves.
3. Step 1: build a CJK and Thai test page that grades itself, then measure CEF (Chrome style), a Chromium fork and a Gecko build.

## Open risks
- A Chromium fork with patches needs about 100 GB of disk and several hours per build. A standard GitHub runner has about 14 GB of free disk and a 6-hour job limit, so a fork probably can't be built on free CI. Step 1 will measure this instead of assuming it.
- Encrypting history at rest isn't something CEF or Chromium offers. It means either a custom store or an encrypted profile directory. This gets decided in Step 1 or 2.
- Some old remote branches still exist (`phase-3-ai`, `claude/dreamy-albattani-pl8bw2`). They aren't covered by the archive tags.

## Resume
```
cd ~/projects/tobari && git switch rewrite
git tag -l 'archive/*'
# after approval:
git push origin archive/browser-0.4.0 archive/v2-extension rewrite
```
