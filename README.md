# GhostState 0.2.2

**A local-first authentication workflow assistant.** GhostState stores credentials and learned form structures in an encrypted local vault, then fills a recognized step with your approval or, if you explicitly opt in, automatically for a short period on one selected tab. You submit forms yourself and complete OTP, CAPTCHA, passkey and security-key challenges manually. It does not copy cookies or send data to a cloud service.

> **Pre-release security warning:** this is an engineering implementation, not a security-audited password manager. Chromium and Firefox workflows and native-messaging connections have been tested with synthetic accounts; physical BLE transfer, Safari, Windows and macOS still require the testing described in [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md). Do not use real or high-value credentials until an independent security review and target-platform testing are complete.

> **Update from 0.2.0:** A dialog focus race in the earlier build could redirect quickly typed text into the profile-name field, potentially exposing a password on screen. Version 0.2.1 focuses dialogs synchronously. If you tried an older build, inspect your profile names; if a password appeared there, treat it as exposed and change it on the affected website.

## What is included

- Unpacked Manifest V3 builds in `release/chromium/` and `release/firefox/`.
- A responsive extension dashboard and popup with the supplied GhostState mark, a reference-inspired light layout, and an optional dark theme. On narrow or short screens, the dashboard uses a bottom navigation bar; **More** opens the remaining sections and the vault lock. The overview shows real local vault, portal, workflow, companion and activity state; its filters and sort operate on actual profiles. The packaged extension needs no separate web server.
- A local IndexedDB vault protected by AES-256-GCM and a 600,000-iteration PBKDF2-SHA-256 master-passphrase KDF, with locking, deletion and encrypted backup/restore. Activity logging is optional and off by default.
- On-demand, value-free structural fingerprints; explicit field mappings; versioned workflows; reviewed fills and off-by-default, ten-minute automatic filling for one selected profile/tab. Automatic fill never submits a form and a compromised site can still read filled values.
- Local configurable password generation, profile search/edit, reauthenticated reveal/copy, basic offline reused/weak-password warnings, and explicitly reviewed local standard/Bitwarden login CSV import. Notes and OTP fields are not imported.
- A Rust native messaging host and BLE central transport using `btleplug`, plus experimental Linux/BlueZ and Windows/WinRT GATT receivers. The Windows executable was cross-compiled on Linux and tested only for native framing/protocol under Wine; Windows OS and radios remain untested. Session-only X25519 pairing uses an eight-digit verification code, authenticated confirmation, HKDF, AES-GCM, short-lived credential-reauthentication grants and replay checks. **Up to eight sender connection slots are implemented, but physical radios and real concurrency have not been tested.** A Linux or Windows receiver handles one sender at a time; approve each recipient and transfer separately.
- TypeScript, Rust, integration and browser tests; scripts, a threat model, privacy policy and platform-specific instructions.

## Quick start: Chromium family

1. Open `chrome://extensions` (or the equivalent in Edge/Brave), turn on **Developer mode**, choose **Load unpacked**, and select `release/chromium` from this project. In Chrome for Testing or an unpacked development environment, this is a temporary/developer installation, not a store-signed release.
2. Click the GhostState toolbar icon, choose **Open dashboard**, and create a unique master passphrase (at least 12 characters). There is no passphrase recovery service; export an encrypted backup and retain the passphrase securely.
3. Add a portal profile with the exact `https://` origin, username and password. Only `http://localhost` and `http://127.0.0.1` are permitted for local testing.
4. Navigate to that site's login page, click the toolbar icon and choose **Use this site**. Approve the browser's per-host permission prompt. Alternatively choose **Workflows → Choose a site** in the dashboard. Permissions for the host can cover all its ports, but GhostState additionally checks the *exact scheme, hostname and port* before filling.
5. Under **Workflows**, click **Learn a state**, review and save the mappings, then manually advance to the next screen and capture it too. To fill a step, return to the site, choose **Review & fill**, verify the site and approve. Review the fields and submit manually. Any unrecognized structure or detected challenge pauses the process. Optionally choose **Enable auto-fill** for one learned profile and return to that selected tab; the opt-in lasts at most 10 minutes and is off after lock, worker restart or disabling. A compromised site may read anything filled.

For basic password tools use **Portal profiles**. CSV imports are plaintext at the source; review, reauthenticate and delete the source file safely after importing. Only supported login fields are imported. For manually storing an encrypted backup with your own cloud provider, see [Cloud backup and sync](docs/CLOUD_BACKUP_AND_SYNC.md); there is no automatic cloud sync. The [password-manager comparison](docs/PASSWORD_MANAGER_COMPARISON.md) lists remaining gaps.

The current implementation handles same-origin full-page navigation and SPA changes. It **does not automatically follow cross-origin SSO redirects**, iframes or shadow DOM; select and authorize each exact origin separately. See [installation](docs/INSTALLATION.md) and [troubleshooting](docs/TROUBLESHOOTING.md).

## Build and test

Prerequisites: Node.js **20.19+** and npm; Rust stable and Cargo for the companion. Linux native builds require a C compiler, `pkg-config`, `libdbus-1-dev`, `libudev-dev`, BlueZ/D-Bus and suitable Bluetooth hardware for real transport.

```sh
npm ci
npm run build                   # release/chromium + release/firefox
npm test                        # TypeScript unit/security tests
npm run test:autofill           # synthetic Chromium automatic-fill safety checks
npm run test:responsive         # Chromium viewport, touch, keyboard and popup layout checks
npm run test:responsive:firefox # Firefox viewport and keyboard layout checks
npm run test:responsive:webkit  # WebKit viewport, touch and keyboard layout checks
npm run test:a11y               # automated axe-core dashboard/popup checks (requires Playwright Chromium)
cargo test --locked --manifest-path apps/desktop-companion/Cargo.toml
cargo build --release --locked --manifest-path apps/desktop-companion/Cargo.toml
```

For the Linux browser/native integration suite, copy the release binary to `release/native-linux-x86_64/ghoststate-companion`, install Playwright Chromium, Firefox and WebKit (`npx playwright install --with-deps chromium firefox webkit`), then run `npm run test:dashboard`, `test:responsive`, `test:responsive:firefox`, `test:responsive:webkit`, `test:a11y`, `test:native`, `test:installer`, `test:browser`, `test:native-ui`, `test:autofill`, `test:permission`, `test:native-permission` and `test:native-bridge` (prefix each with `npm run`). Graphical prompt tests require `xvfb-run` and `xdotool`. Some browser integrations use a **test-only manifest with pregranted permissions**. Separate graphical tests verify real site and native permission prompts on the unmodified extension; the native test connects to the real registered Linux host, while the transfer test uses a mock host and synthetic credentials. None is a physical Bluetooth test.

Firefox 159 was also tested with a synthetic two-step workflow, lock/unlock and browser restart, exact-port isolation and the actual Linux native host. Its separate graphical test exercised real site, native-messaging and authentication-info consent prompts on the unmodified package, with a **mock native peer for transfer UI only**. To reproduce these optional tests, see [Firefox test prerequisites](docs/INSTALLATION.md#optional-firefox-integration-tests). No physical BLE transport was tested.

`npm run package` creates a root-manifest Chrome Store ZIP, an unpacked-development archive, separate unsigned Windows and Linux companion ZIPs, a static web-only preview, Store listing assets, a developer kit, a source project ZIP and one complete convenience package. Before packaging from source, build and stage both native release binaries under `release/native-*`, install Python Pillow, `zip`/`unzip`, Xvfb and `xdotool`, run `npm run test:store-assets` to generate the screenshots, and run `npm run test:release` after packaging. That release check exercises the extracted Store ZIP's actual native-permission prompt with the Linux host and a separate synthetic transfer mock. The CI configuration shows Linux and Windows cross-build commands. See [Chrome Store guide](docs/CHROME_STORE_RELEASE.md). Checksums detect corruption but are not signed authenticity guarantees.

No standalone server is needed or included in the Chrome package. The source project retains an optional Vite development workspace used by synthetic tests; it has a separate storage origin from the extension and does not share its vault. A separately packaged static web-only preview can be served locally without npm; its README explains how. Both previews show an explicit synthetic-data warning and cannot access browser tabs or Bluetooth. Their layout adapts to phone-sized viewports, but this is not a mobile app or proof that browser extensions, autofill or Bluetooth work on a phone. Never use the preview as a replacement for a reviewed extension installation. The light theme is the default; the appearance toggle is saved locally and is also used by the extension popup. Portal filtering and sorting never alter stored credentials.

The dashboard and popup package their logo and font locally; they do not fetch a font or branding from a network. The newly supplied original emblem is retained unmodified at `apps/dashboard/assets/ghoststate-logo-original.png`; the packaged mark is a centered crop of its white margin, and the extension icons are derived from it. The unused earlier `.jpg` branding asset has been removed. The bundled Inter font is licensed under the SIL Open Font License 1.1; its license is included at `apps/dashboard/assets/INTER-OFL.txt` and in each extension bundle.

## Companion setup

On Linux, after building the companion and determining your installed extension ID from the extensions page:

```sh
./scripts/install-native.sh chrome YOUR_32_LETTER_EXTENSION_ID \
  apps/desktop-companion/target/release/ghoststate-companion
```

Use `chromium`, `edge`, `brave`, `opera`, or `firefox` instead of `chrome` as appropriate. Firefox's development ID is `ghoststate@local.invalid`. The installer registers the exact caller and copies the binary to `~/.local/bin`. See [installation](docs/INSTALLATION.md) for Windows, macOS, Safari, Bluetooth and limitations. **Never use an extension ID you do not trust.**

## Project map

- `apps/browser-extension`: popup, worker and isolated content script.
- `apps/dashboard`: extension UI and standalone web workspace.
- `apps/desktop-companion`: Rust native messaging, BLE and grant protocol.
- `packages`: cryptography, vault, fingerprinting, state machine, shared schemas and browser adapters.
- `tests`: synthetic unit, security, integration and browser tests.
- `docs`: architecture, security, privacy, installation, API and troubleshooting.

[Deployment guide](docs/DEPLOYMENT_GUIDE.md) · [Chrome Store guide](docs/CHROME_STORE_RELEASE.md) · [Bluetooth test plan](docs/BLUETOOTH_TEST_PLAN.md) · [Draft privacy policy](docs/PRIVACY_POLICY_TEMPLATE.md) · [Plain-English guide](docs/GhostState_Simple_Guide.pdf) · [Release notes](docs/RELEASE_NOTES.md) · [Comparison](docs/PASSWORD_MANAGER_COMPARISON.md) · [Cloud backup](docs/CLOUD_BACKUP_AND_SYNC.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md) · [Privacy](docs/PRIVACY.md) · [API](docs/API.md) · [Known blockers](BUILD_ERRORS.md)

MIT licensed; see [LICENSE](LICENSE).
