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

| Chrome stable | released | security fixes | first CEF build | Tobari | gap |
|---|---|---|---|---|---|
| 154.0.8037.97 | 2026-10-01 | none listed | none yet (checked 2026-10-02) | — | no known security fix missing |
| 154.0.8037.92 | 2026-09-29 | 32 (1 Critical, 25 High, 1 Medium, 5 Low) | 154.0.33 (Chromium 154.0.8037.94), 2026-10-02 | this build | **closed** |
| 154.0.8037.58 | before 2026-09-24 | — | 154.0.26 (2026-09-24) | previous builds (154.0.32) | — |

**As of 2026-10-02 Tobari runs Chromium 154.0.8037.94**, which carries the 32
fixes from 154.0.8037.92, including CVE-2026-102331 (Critical, buffer overflow
in ANGLE). Builds before this one, on CEF 154.0.32 / Chromium 154.0.8037.58, do
not have them: update. Chrome 154.0.8037.97 lists no security fixes; Tobari will
move to it when CEF does. The daily `engine-watch` workflow checks this and
opens an issue when Tobari falls behind; the commitment is to ship within 3
days of a CEF build carrying security fixes (`docs/RELEASING.md`).

## What Tobari changes, and why

### Network-layer blocking

Ad and tracker requests are cancelled before they load, using `adblock-rust` —
the engine Brave ships — linked into the browser. It runs in
`CefResourceRequestHandler::OnBeforeResourceLoad` for every tab, including tabs
Chromium creates itself, and for requests made by service and shared workers
(which have no tab; they are routed through a request context handler), and
returns `RV_CANCEL`.

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
- Requests an extension makes for its own pages and workers are not filtered,
  as in Chrome, where one extension cannot filter another's traffic.
- **Limit:** WebSocket and WebTransport connections are not evaluated.
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
  at least 1,000 rules, has not lost more than half of its rules and has not
  more than tripled. Downloads stop at 16 MB and redirects are refused: the
  response must come straight from the pinned URL. If the engine cannot load
  the installed lists, Tobari falls back to the copies shipped with the build.
- **Limit:** the lists are not signed upstream. Their authenticity rests on TLS
  to those two hosts. A compromised list host could ship rules that block or
  allow the wrong things, or rules that are slow to evaluate; it could not run
  code, because filter rules are data.

### Bangs

DuckDuckGo-style `!bangs` (`!gh tokio`, `!w kyoto`) are resolved on your
machine. When a search-results URL from a known engine (Google, DuckDuckGo,
Bing, Brave Search, Startpage, Yahoo, Ecosia, Kagi) carries a bang, Tobari
rewrites the request to the destination **before it is sent**, so the search
engine never receives the query. Queries without a bang go to your default
engine normally.

- **Limit:** DuckDuckGo's HTML-only form (`html.duckduckgo.com`) submits by
  POST, so a bang typed there reaches DuckDuckGo, which resolves it itself.

### First-run defaults

Applied on a profile's first run and recorded with a version marker. Defaults
added in a later version are applied to existing profiles once, **except** where
that profile already has its own value for the setting; anything you change in
`chrome://settings` stays changed. If a default fails to apply, the marker is
not written and Tobari retries at the next launch.

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
| V8 optimizing compilers | **blocked**; allowed per site from the toolbar | see tradeoff below |
| HTTPS-Only mode | on | plain-HTTP pages show a warning first; `localhost` is exempt |
| USB, serial, HID, Bluetooth device access | blocked | device attack surface most sites never need |
| motion sensors, local fonts, idle detection | blocked | fingerprinting and tracking surfaces |

**Tradeoff — V8 optimizer.** Most exploited Chrome bugs of recent years are in
V8's optimizing compilers (TurboFan, Maglev): type confusions that turn a web
page into code execution in the renderer. Chromium can run a site without them
(`chrome://settings/content/v8`); Tobari makes that the default. JavaScript
still runs, through the interpreter and the baseline compiler, but **heavy
JavaScript is slower**. Measured on a JavaScript micro-benchmark (numeric
loops, objects, arrays, strings, JSON, DOM), total time was 851 ms blocked
against 399 ms allowed: 2.1× slower, with tight numeric and object code about
3–4× slower and DOM and string work unchanged. For a site you trust and use
heavily — a web app, an editor, a game — turn on **Fast JavaScript** in the
Tobari toolbar popup; it applies to that site (its registrable domain,
including subdomains) and takes effect on reload.

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
left idle for 10 minutes, CEF 154.0.33: **the only requests that leave the
machine are the four filter-list downloads.**

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

Crash reporting, domain reliability, pings and sync are also disabled at
launch.

Tobari deliberately does **not** pass `--disable-background-networking`, the
usual catch-all. Measured: with it, Chromium's extension updater never ran, so
extensions installed from the Web Store — password managers, blockers — would
never receive their updates. The services it would have stopped are handled
one by one above.

Without it, Chromium also installs extensions that Linux packages register
system-wide in `/usr/share/chromium/extensions` (on Fedora-based systems
GNOME Shell integration does this), downloading them from Google into every
profile without asking. Tobari sets Chromium's
`extensions.block_external_extensions` preference, so only extensions you
install run, plus the two bundled ones. Verified: on a fresh profile nothing is
downloaded; on a profile that already had the GNOME extension, it was removed
at the next launch.

**Tradeoff — component updates.** The same component updater that phoned home
also delivers CRLSet (Chromium's pushed certificate revocations) and the
Certificate Transparency log list. With it off, those come only from the data
built into the engine, which is refreshed when Tobari moves to a new CEF build.
Chromium stops enforcing Certificate Transparency once its built-in log list is
about ten weeks old, so a Tobari build that is not updated for that long loses
CT enforcement silently, and an emergency revocation pushed through CRLSet does
not reach Tobari until the next engine update. Keeping Tobari on a current
engine (see the top of this page) is what keeps this data fresh.

What still happens, and when:

- **Extension updates.** Extensions you install from the Chrome Web Store are
  kept up to date by Chromium's extension updater, which asks Google
  (`clients2.google.com`, `update.googleapis.com`) for newer versions and sends
  the IDs and versions of the extensions you installed. It is deliberately not
  redirected: stale extensions are a security problem. Measured on a profile
  with Bitwarden and uBlock Origin Lite installed: those update checks, plus
  Bitwarden's own call to `api.bitwarden.com`. With no Web Store extensions
  installed it sends nothing.
- **The Chrome Web Store** is Google's site; visiting it is a normal visit.
- **Spelling dictionaries.** If you turn on spell check for a language,
  Chromium downloads that language's dictionary once. Not measured.

## The toolbar extension and its bridge

Two extensions ship inside Tobari with fixed keys and stable IDs: the new-tab
page (`jfngkfgpblbmkkhalnefimbonoikdmjb`) and the blocking control
(`lgfgpfedeaaahediodajihnoneonicaf`). Neither requests host access to web
pages or injects content scripts. The blocking control holds the `tabs`
permission so it can read the active tab's URL for the popup; that URL goes
only to Tobari's own native code. Both extension pages run under a strict
content security policy (`script-src 'self'; object-src 'none'`).

The blocking control talks to native code at `https://tobari.internal/`, which
Tobari answers itself — the name never resolves on the network. It answers only
requests coming **from that extension**, judged by facts the browser computes
and page script cannot set: the requesting frame's URL, or the site-for-cookies
of the requesting context. For everything else the request fails with a plain
network error, indistinguishable from a name that does not resolve, so a page
cannot use the bridge to tell Tobari apart from other Chromium browsers. Two obvious signals
are deliberately not used because they do not work here: CEF reports `Origin`
as `null` for every caller, and Chromium strips `Referer` on
extension-to-web requests. Verified: a request from an ordinary web page fails
like an unknown host; the toolbar popup and badge are served.

## Extensions you install

The Chrome Web Store works: it detects Chromium's install API and offers "Add".
Chromium shows its install prompt listing the permissions an extension
requests. In a clean test the prompt stayed open waiting for an answer and the
extension did not install without one. In two earlier scripted test runs, an
install completed without the tester answering the prompt; the cause was not
identified. Treat the prompt as you would in Chrome, and report any install
that completes without one.

Only the two bundled extensions are loaded unpacked, from the install
directory. Tobari does not load extensions from your data directory, so another
program running as you cannot plant one that runs without an install prompt.

## Sandbox

Chromium's sandbox is on in every build and every package. Tobari never passes
`--no-sandbox`.

- **Flatpak:** renderers are sandboxed through Flatpak's own sandbox via
  `zypak`, as in Chromium's and Spotify's Flatpaks. `zypak` is built from
  source in the manifest and pointed at `libcef.so`, where CEF keeps Chromium.
- **Per-user install:** the SUID helper cannot be installed without root, so
  the sandbox depends on unprivileged user namespaces. The installer tries to
  create one (`unshare -Ur`) and refuses to install if that fails, which covers
  the Debian sysctl, Ubuntu's AppArmor restriction and a zero namespace limit; Chromium itself refuses to start renderers
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

Measured on Bazzite / Ryzen 5 9600X. Rows marked † were measured on CEF
154.0.32 (Chromium 154.0.8037.58) on 2026-10-01 and not repeated; the rest on
CEF 154.0.33 (Chromium 154.0.8037.94) on 2026-10-02.

| check | result |
|---|---|
| Tracker test page (5 scripts, 4 on lists) | 4 cancelled, 1 allowed |
| Service worker fetching 2 trackers and 1 library | trackers cancelled, library allowed |
| Bang via DuckDuckGo results URL | redirected to destination; DuckDuckGo not contacted |
| Bridge from a web page, including a `no-cors` probe | fails like an unknown host |
| Bridge from the toolbar popup | served |
| Fast JavaScript switch | per-site exception stored for the site; JS benchmark 399 ms allowed against 851 ms blocked; switching back restores the default |
| Per-site blocking switch † | persisted; off lets all 5 through, on blocks 4 after a cache-bypassing reload |
| Weekly list update † | 4 lists downloaded, accepted, engine swapped without restart |
| First-run defaults (v6) | all applied, including V8 optimizer blocked, HTTPS-Only, device APIs blocked, external extensions blocked |
| HTTPS-Only | `http://` page shows Chromium's warning first; `localhost` exempt |
| Migration onto an older profile | v6 applied; a system-pushed extension already installed was removed |
| Web Store | detects the browser and offers "Add to Chrome"; Bitwarden and uBlock Origin Lite installed from the store † |
| Extension updates | update checks sent for installed Web Store extensions |
| Idle network, fresh profile, 10 min | only the four filter lists leave the machine |
| Sandbox, per-user build (`chrome://sandbox`) | user namespaces, seccomp-BPF: "adequately sandboxed" |
| Sandbox, Flatpak | zypak SUID layer, seccomp-BPF: "adequately sandboxed"; Web Store offers "Add to Chrome" |
| Flatpak † | blocker, bangs and both bundled extensions working; profile under `~/.var/app/dev.tobari.Browser/` |
| Second launch with a URL | opened as a tab in the existing window |

## Reporting

Report vulnerabilities privately through GitHub's security advisory form on
`kaorii-ako/tobari`. Please do not open a public issue for a vulnerability.
