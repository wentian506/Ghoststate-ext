# Installation and release packaging

## Prerequisites and build

- Node.js 20.19 or later, npm, and Python 3 (for the host installer); packaging also requires Info-ZIP `zip`. Run `npm ci`, `npm run build`. The built folders are `release/chromium` and `release/firefox`.
- For the native companion: a current Rust stable toolchain and Cargo. On Debian/Ubuntu install `build-essential pkg-config libdbus-1-dev libudev-dev`, then run `cargo build --release --locked --manifest-path apps/desktop-companion/Cargo.toml`. The executable is `apps/desktop-companion/target/release/ghoststate-companion` (with `.exe` on Windows).
- Linux BLE additionally requires BlueZ, a running system D-Bus and `bluetoothd`, a powered BLE adapter that supports the chosen central/peripheral role, and appropriate D-Bus/adapter permissions. The program will not silently power on the radio. Adapter and physical transfer tests are pending.
- `release/native-linux-x86_64/ghoststate-companion`, if included, was built on Debian 13 x86-64 and is an **unsigned development binary**. Other glibc versions/distributions may not run it. Rebuild locally from source, inspect it and obtain a security review before real use.

## Chromium, Chrome, Edge, Brave, Opera

1. Open the browser's extensions manager (`chrome://extensions`, `edge://extensions`, etc.). Enable Developer mode.
2. Choose **Load unpacked** and select `release/chromium` (not its parent). Pin GhostState if desired.
3. Open the action popup to select a site or open the dashboard. Grant a site only when you decide to use it. The permission dialog is host-wide and may include every port; the application independently refuses a different exact origin.
4. From the extensions page, copy this installation's **32-letter ID**. For the native host, run:

```sh
./scripts/install-native.sh chrome YOUR_EXTENSION_ID apps/desktop-companion/target/release/ghoststate-companion
# substitute chromium, edge, brave, opera or chrome-testing for chrome
```

The script copies the executable into `~/.local/bin`, writes a browser-specific native manifest and adds only that exact `chrome-extension://<id>/` caller to `~/.config/ghoststate/allowed-callers.json`. Repeat for each trusted browser ID. Old IDs remain in the allowlist until manually removed; review it when changing installations. On nonstandard Chromium profile paths, place the generated manifest in the native-messaging directory actually used by that browser. Restart the browser, then choose **Devices & transfer → Connect companion** and grant the optional native permission.

## Firefox

1. Open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `release/firefox/manifest.json`.
2. The development build has fixed add-on ID `ghoststate@local.invalid`, minimum Firefox 142, a Firefox background script and explicit data-collection declarations. Temporary add-ons disappear on restart; Firefox normal distribution requires signing. This ID is reserved here for development and must be replaced by a legitimate publisher ID before release.
3. Register the native host:

```sh
./scripts/install-native.sh firefox ghoststate@local.invalid apps/desktop-companion/target/release/ghoststate-companion
```

Firefox uses `allowed_extensions` and a different manifest directory than Chromium. Firefox 159 was tested on Linux with a synthetic two-step capture/fill flow, an actual registered native host and persistence across restart (temporary add-on reloaded). A separate test exercised the unmodified package's real site, native-messaging and authentication-info prompts, with a synthetic native transfer peer. Physical BLE on Firefox is not tested. Firefox's optional authentication-info consent is requested on credential transfer and checked again by the background.

### Optional Firefox integration tests

The tests need Linux, Firefox 142+ (tested here with Playwright Firefox 159), geckodriver 0.36.0, Python and test-only Selenium. The graphical prompt test additionally needs Xvfb and `xdotool`. Set up a separate Python virtual environment and provide the actual executable paths:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r tests/e2e/requirements-firefox.txt
npx playwright install firefox
export FIREFOX_BINARY="$(node -p "require('playwright').firefox.executablePath()")"
export GECKODRIVER=/absolute/path/to/geckodriver
npm run build
# A Linux x86-64 Rust release host must exist at release/native-linux-x86_64/ghoststate-companion.
npm run test:firefox
npm run test:firefox-consent
```

The functional test uses a disposable manifest copy with localhost and native permissions pregranted. The prompt test uses the unmodified extension and a local **test double** for the native peer; it deliberately tests denial and revocation of consent. These tests use only synthetic credentials. The test process enables privileged Firefox WebDriver access to open the extension dashboard and locate native browser buttons; this is not needed for normal product use.

## macOS

Build the Rust companion on a Mac and use `scripts/install-native.sh` for a supported Chromium-family browser or Firefox. macOS may require an app bundle with `NSBluetoothAlwaysUsageDescription` and Bluetooth authorization; a bare command-line host's authorization behavior depends on the launching app/OS. `btleplug` is central-only. This implementation has no macOS GATT peripheral; a Linux/BlueZ or Windows experimental receiver is needed, and neither route is physically verified. macOS build, permissions and hardware have **not** been tested.

### Safari packaging path — not a working native bridge

On a Mac with Xcode and the Safari Web Extension converter:

```sh
npm ci && npm run build
./scripts/package-safari.sh  # or pass an output project directory
```

The script invokes `xcrun safari-web-extension-converter` on the Chromium resources to generate a macOS Xcode app/extension project. Open, sign and build the generated project, enable the extension in Safari settings, and test the extension APIs and permission behavior. The converter alone does **not** implement Safari native messaging. Safari routes messages to a `SafariWebExtensionHandler` inside its containing app, not to Chrome/Firefox's stdio host manifest. A production Safari bridge needs a signed, sandboxed Swift handler and authenticated XPC/App Group integration to a persistent companion, appropriate entitlements and Bluetooth permission, plus a Safari-specific message adapter and physical tests. Those are **not implemented or tested** here; do not claim BLE transfer works in Safari. The converter itself was not run in this Linux environment.

## Windows

Build the companion using Rust stable with the MSVC toolchain, then in PowerShell run, for example:

```powershell
.\scripts\install-native.ps1 -Browser chrome -ExtensionId YOUR_EXTENSION_ID -Binary .\apps\desktop-companion\target\release\ghoststate-companion.exe
```

`edge`, `brave`, and `firefox` are also supported by the installer. It registers a per-user native-host registry key and writes the exact caller allowlist under `%USERPROFILE%\.config\ghoststate`. A Windows x64 EXE was cross-compiled on Linux and contains experimental `btleplug` central and new WinRT GATT peripheral code. Its protocol/native framing has been tested under Wine, and PowerShell registration logic was tested with a mocked registry; neither is a real Windows, driver, BLE or hardware test. Installation, OS permissions, peripheral advertising and all physical transfers remain **unverified**. The unsigned binary is for synthetic testing only. See [Chrome Store guide](CHROME_STORE_RELEASE.md) and [hardware plan](BLUETOOTH_TEST_PLAN.md).

## Password tools and automatic fill

- **Portal profiles → Add portal** includes a local password generator. It does not change the password on the website: complete that change with the website too.
- **Portal profiles → Import CSV** accepts standard `url,username,password` columns (optional `name`) or Bitwarden login columns. The file is normally plaintext. Review the supported logins, enter the master passphrase, and confirm; unsupported and incomplete records are skipped, exact origin/username duplicates are skipped, and notes/OTP/passkeys are not imported. A vault holds at most 200 profiles. Remove the plaintext export safely afterward.
- Search, edit and reveal/copy appear under Portal profiles. Editing and revealing require the master passphrase. Copied text can remain in system clipboard history.
- Automatic fill is **off by default**. For a trusted site, select its exact-origin tab, learn its screens, then choose **Workflows → Enable auto-fill → Enable for 10 minutes**, and return to that tab. It works only while unlocked and focused, for exact learned top-frame states and empty eligible fields. You still submit manually. Stop it via **Turn off** or lock the vault. A compromised website may read credentials you fill, and challenge detection is not perfect.
- For a manually uploaded encrypted cloud backup (not sync) and safe restore procedure, see [CLOUD_BACKUP_AND_SYNC.md](CLOUD_BACKUP_AND_SYNC.md).

## Pair and transfer (experimental; hardware test required)

1. Install the extension and companion on each device, register each host for the installed extension ID, and open/unlock the vaults. The receiver must be Linux with a usable BlueZ peripheral adapter or Windows with a compatible peripheral-role adapter; both receiver implementations remain physically untested. No Android or iPhone companion app is included.
2. On the receiver, connect the companion and click **Make discoverable**. On the sender, connect and click **Discover nearby**, then **Pair** the intended device. Discovery and device names are not identity verification.
3. Compare all displayed eight digits through a trusted channel. Both people click **Codes match**. If the sender confirms first, the receiver confirms and the sender selects **Check other device** on that specific pairing. End and restart if codes differ.
4. On the sender's specific verified session, choose **Send a credential**, select a profile and approve. The sender can open up to eight independent peer slots in software; repeat discovery, compare a new code and explicitly approve every recipient and every send. A receiver handles one sender at a time. Adapter/OS capacity may be lower and no physical multi-device test has been performed. On the receiver, refresh Devices, review the incoming origin, provide a profile name and **Accept & save locally** before the two-minute grant expiry. The receiving device signs in itself. No cookies or authenticated session are transferred.
5. Both devices must use BLE protocol v2 (introduced in 0.2.0 and retained in 0.2.2); older six-digit v1 companions are rejected rather than downgraded. Sessions expire after five minutes; advertising expires after five minutes. End pairing or stop discovery when finished. Credential availability on the peer depends on explicit approval and compatible radios; the workflow has not yet been hardware-tested.

## Release distribution

`npm run package` produces the Chrome root-manifest Store ZIP, developer-unpacked ZIP, separate unsigned Windows/Linux companion archives, Store asset kit and project archive, plus SHA-256 checksums. Checksums are not signatures and do not authenticate their source. Browser stores require their own review, signing and disclosures; do not publish this development build as audited. For Firefox use `web-ext lint` and AMO signing with a real ID. Safari requires an Xcode app, Apple signing, notarization/App Store compliance and its own native handler. For Windows/macOS sign the host, set appropriate OS permissions and test both installation and updates. Never include test vaults, passphrases, private signing keys, or development certificates in a release.
