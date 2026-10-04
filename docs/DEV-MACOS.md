# macOS

Tobari runs on Apple-silicon Macs. It is built, ad-hoc signed, launched and
checked on GitHub's macOS runners for every change to the shell
(`.github/workflows/macos.yml`), and each release carries
`Tobari-<version>-macos-arm64.dmg`. It has **not** been used day to day on a
Mac, and there is no Mac outside CI to test on; treat it as a preview.

## Install

```sh
brew install minisign      # the installer needs it to check the signature
curl -fsSL https://kaorii-ako.github.io/tobari/install.sh | bash
```

The installer verifies the release signature and checksum, then copies
`Tobari.app` into `~/Applications`. A file fetched with `curl` carries no
quarantine flag, so Gatekeeper does not block the first launch.

Opening the `.dmg` from a browser download is different: the browser marks it
quarantined, and because the app is not notarized Gatekeeper refuses it at
first. Right-click the app → Open → Open, once. Notarization needs a paid
Apple Developer account, which this project does not have.

## What is different from Linux

- **Bundle.** `Tobari.app` contains CEF's framework and the five helper apps
  CEF requires (renderer, GPU, plugin, alerts, plain) in `Contents/Frameworks`;
  the bundled extensions, filter lists and icon are in `Contents/Resources`.
- **Sandbox.** Each helper enters Chromium's macOS sandbox
  (`CefScopedSandboxContext`) before loading the framework, and exits if it
  cannot; the CI smoke test renders the welcome page, which needs a working
  renderer helper.
- **Data.** Profiles and state live in `~/Library/Application Support/Tobari`.
- **Signing.** Ad-hoc (`codesign --sign -`): enough for Apple silicon to run
  the code, not a Developer ID.
- **Not ported yet:** setting Tobari as the default browser from the welcome
  flow (use System Settings → Desktop & Dock → Default web browser), and Intel
  Macs.

## Build

On a Mac with Xcode's command-line tools, CMake and Rust:

```sh
CEF_ROOT=$(CEF_PLATFORM=macosarm64 shell/provision-cef.sh | tail -1)
cmake -S shell -B build -DCEF_ROOT="$CEF_ROOT" -DCMAKE_BUILD_TYPE=Release -DPROJECT_ARCH=arm64
cmake --build build --parallel
codesign --force --deep --sign - build/Tobari.app
open build/Tobari.app
```
