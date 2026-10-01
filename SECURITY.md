# SECURITY

Tobari does not make you invisible or anonymous. It reduces what third parties
receive while you browse, sends nothing home, and states every tradeoff it
makes. Anything not written here should not be assumed.

## Engine currency — read this first

Tobari's engine is Chromium as packaged by CEF. When Chrome ships a security
fix, Tobari is exposed to a publicly disclosed bug until a CEF build with that
Chromium appears **and** Tobari ships it. This is the real security cost of
building on CEF rather than maintaining a Chromium patch set, and it is tracked
here for every release.

| Chrome stable | released | security fixes | first CEF build | Tobari release | gap |
|---|---|---|---|---|---|
| 154.0.8037.92 | 2026-09-29 | 32 (1 Critical, 25 High, 1 Medium, 5 Low) | **none yet** (checked 2026-10-01) | — | **open** |
| 154.0.8037.58 | before 2026-09-24 | — | 154.0.26 (2026-09-24) | current build uses 154.0.32 | — |

**As of 2026-10-01 Tobari runs Chromium 154.0.8037.58 and does not have the 32
fixes in 154.0.8037.92**, including CVE-2026-102331 (Critical, buffer overflow
in ANGLE). No CEF stable build carrying .92 had been published when this was
written. Tobari's commitment is to ship within 3 days of one appearing
(`docs/RELEASING.md`). Until then, if that exposure is unacceptable for what you
do, use an up-to-date Chrome or Chromium for it.

## What Tobari changes, and why

### Network-layer blocking

Ad and tracker requests are cancelled before they load, using `adblock-rust` —
the engine Brave ships — linked into the browser. It runs in
`CefResourceRequestHandler::OnBeforeResourceLoad` for every tab, including tabs
Chromium creates itself, and returns `RV_CANCEL`.

- Lists: EasyList, EasyPrivacy, uBlock Origin `filters` and `privacy`
  (~142,000 rules).
- Main-frame navigations are never blocked, so blocking cannot stop you
  reaching a page you asked for. `chrome:`, `chrome-extension:`, `data:`,
  `blob:`, `about:` and `file:` requests are not evaluated.
- Blocking can be switched off per site from the toolbar. The exception list is
  stored in `$XDG_DATA_HOME/tobari/state/disabled-hosts.json`.
- **Limit:** a resource fetched while blocking was off for a site can be served
  from the renderer's in-memory cache on a normal reload without a new network
  request, so it is not re-evaluated. Turning blocking back on from the popup
  reloads the tab bypassing the cache for this reason.
- **Limit:** blocking is network-level only. There is no cosmetic filtering
  (hiding page elements) and no scriptlet injection, which uBlock Origin does.
  Install uBlock Origin Lite from the Web Store if you want those.

### Filter-list updates

Installed copies of the lists update **weekly**, and this is the only network
request Tobari's own code makes without you asking (see "Contacts Tobari makes
on its own" below).

- Requests go through a separate in-memory request context: no cookie, cache
  entry or credential from your profile is attached. They are plain GETs with
  no query string, to `easylist.to` and `raw.githubusercontent.com`.
- A downloaded list replaces the current one only if it is at least 20 KB, has
  at least 1,000 rules, and has not lost more than half of its rules. This
  catches truncation and an obviously wrong file.
- **Limit:** the lists are not signed upstream. Their authenticity rests on TLS
  to those two hosts. A compromised list host could ship rules that block or
  allow the wrong things; it could not run code, because filter rules are data.

### Bangs

DuckDuckGo-style `!bangs` (`!gh tokio`, `!w kyoto`) are resolved on your
machine. When a search-results URL from a known engine (Google, DuckDuckGo,
Bing, Brave Search, Startpage, Yahoo, Ecosia, Kagi) carries a bang, Tobari
rewrites the request to the destination **before it is sent**, so the search
engine never receives the query. Queries without a bang go to your default
engine normally.

### First-run defaults

Applied once, on a profile's first run, and recorded with a version marker so
anything you change afterwards in `chrome://settings` stays changed.

| setting | Tobari default | why |
|---|---|---|
| default search | DuckDuckGo | does not build a profile from searches |
| search suggestions | off | otherwise every keystroke goes to the engine |
| network prediction / preloading | off | otherwise pages you did not open are fetched |
| third-party cookies | blocked | cross-site tracking |
| WebRTC | public interface only | stops local-network address disclosure |
| "alternate error pages" | off | otherwise failed lookups are sent to Google |
| Translate | off | Google Translate service calls |
| Safe Browsing | off | see tradeoff below |
| credit-card autofill | off | ties into Google Payments; addresses and passwords stay local and on |
| Payment Request "can make payment" | off | fingerprinting surface |
| browser sign-in | off | Tobari has no account system |
| session restore | on | continue where you left off |

**Tradeoff — Safe Browsing.** Google Safe Browsing warns about known phishing
and malware sites by checking URLs against Google's lists. CEF does not ship the
Safe Browsing database, and the service would otherwise contact Google, so it
is off. **Tobari will not warn you before you open a known phishing or malware
site.** This is a real loss of protection compared with Chrome, stated plainly.

### Interface

Menu items, toolbar buttons and page actions that exist only to reach a Google
service are hidden: sign-in and sync, Send Tab to Self, Translate, Lens, price
tracking and insights, Gemini, payments offers, "AI mode". Local features —
passwords, autofill addresses, find, zoom, reading mode, PWA install — remain.

## Contacts Tobari makes on its own

Measured with Chromium's own network log (`--log-net-log`) on a fresh profile
left idle for 150 seconds: **the only requests that leave the machine are the
four filter-list downloads.**

That was not true on the first measurement. With only the usual switches
(`--disable-component-update`, `--disable-background-networking`, sign-in off),
Chromium still contacted Google on its own:

| request | what it was | now |
|---|---|---|
| `update.googleapis.com/service/update2/json` | component updater check | sent to a closed local port |
| `edgedl.me.gvt1.com/…` | component download | gone (nothing asked for it) |
| `clients2.google.com/time/1/current` | network-time service | feature disabled |
| `accounts.google.com/ListAccounts` | Google account cookie check | sent to a closed local port |

The component updater and Chromium's account plumbing are redirected with
Chromium's own endpoint switches (`--component-updater=url-source=`,
`--gaia-url=`) to `127.0.0.1:9`, where nothing listens; no packet leaves the
machine. This changes only Chromium's built-in service endpoints — you can still
sign in to Google sites in a tab. The network-time service is disabled with
`--disable-features=NetworkTimeServiceQuerying`.

Crash reporting, domain reliability, pings, background networking and sync are
also disabled at launch.

What still happens, and when:

- **Extension updates.** Extensions you install from the Chrome Web Store are
  kept up to date by Chromium's extension updater, which asks Google for newer
  versions and sends the IDs and versions of the extensions you installed. It
  has its own endpoint and is deliberately not redirected: stale extensions
  are a security problem. If you install none, it does not run.
- **The Chrome Web Store** is Google's site; visiting it is a normal visit.

## The toolbar extension and its bridge

Two extensions ship inside Tobari with fixed keys and stable IDs: the new-tab
page (`jfngkfgpblbmkkhalnefimbonoikdmjb`) and the blocking control
(`lgfgpfedeaaahediodajihnoneonicaf`). Neither requests access to web pages.

The blocking control talks to native code at `https://tobari.internal/`, which
Tobari answers itself — the name never resolves on the network. It answers only
requests coming **from that extension**, judged by facts the browser computes
and page script cannot set: the requesting frame's URL, or the site-for-cookies
of the requesting context. Everything else receives `403`. Two obvious signals
are deliberately not used because they do not work here: CEF reports `Origin`
as `null` for every caller, and Chromium strips `Referer` on
extension-to-web requests. Verified: a request from an ordinary web page is
refused; the toolbar popup and badge are served.

## Extensions you install

The Chrome Web Store works: it detects Chromium's install API and offers "Add".
Chromium shows its install prompt listing the permissions an extension
requests. In a clean test the prompt stayed open waiting for an answer and the
extension did not install without one. In two earlier scripted test runs, an
install completed without the tester answering the prompt; the cause was not
identified. Treat the prompt as you would in Chrome, and report any install
that completes without one.

## Sandbox

Chromium's sandbox is on in every build and every package. Tobari never passes
`--no-sandbox`.

- **Flatpak:** renderers are sandboxed through Flatpak's own sandbox via
  `zypak`, as in Chromium's and Spotify's Flatpaks. `zypak` is built from
  source in the manifest and pointed at `libcef.so`, where CEF keeps Chromium.
- **Per-user install:** the SUID helper cannot be installed without root, so
  the sandbox depends on unprivileged user namespaces. The installer refuses to
  install if they are disabled; Chromium itself refuses to start renderers
  without a usable sandbox rather than running them unsandboxed.

## What is not protected

- Your IP address is visible to every site and to your network.
- Sites can fingerprint the browser. Tobari's user agent and feature set are
  Chromium's; it does not randomise or spoof anything.
- Blocking lists are imperfect in both directions: some trackers get through,
  and some pages break.
- Anything an extension you install can do, it can do.
- The engine-currency gap at the top of this page.

## Planned: local AI (Phase 3)

A future release adds an assistant that runs only on your machine through
llama.cpp, with no cloud path of any kind. Its threat model, including the
structural prompt-injection defence, will be documented here when it ships. It
is not in this build.

## Verified

Measured on Bazzite / Ryzen 5 9600X, CEF 154.0.32 (Chromium 154.0.8037.58),
2026-10-01.

| check | result |
|---|---|
| Tracker test page (5 scripts, 4 on lists) | 4 cancelled, 1 allowed |
| Bang via DuckDuckGo results URL | redirected to destination; DuckDuckGo not contacted |
| Bridge from a web page | refused |
| Bridge from the toolbar popup and badge | served |
| Per-site switch | persisted; off lets all 5 through, on blocks 4 after a cache-bypassing reload |
| Weekly list update | 4 lists downloaded, accepted, engine swapped without restart |
| First-run defaults | all applied; DuckDuckGo default |
| Web Store install | Bitwarden and uBlock Origin Lite installed from the store |
| Idle network, fresh profile, 150 s | only the four filter lists leave the machine |
| Sandbox, per-user build (`chrome://sandbox`) | user namespaces, PID + network namespaces, seccomp-BPF with TSYNC: "adequately sandboxed" |
| Sandbox, Flatpak | zypak SUID layer, PID + network namespaces, seccomp-BPF with TSYNC: "adequately sandboxed" |
| Flatpak | blocker, bangs and both bundled extensions working; profile under `~/.var/app/dev.tobari.Browser/` |
| Second launch with a URL | opened as a tab in the existing window |

## Reporting

Report vulnerabilities privately through GitHub's security advisory form on
`kaorii-ako/tobari`. Please do not open a public issue for a vulnerability.
