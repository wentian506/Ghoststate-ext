# Task checklist

## Chrome packaging and experimental Bluetooth — 0.2.2

- [x] Prepare extension-only root-manifest Store and developer-unpacked builds with the upgraded emblem/UI; no standalone server is included in those packages.
- [x] Implement experimental WinRT receiver code; cross-compile the Windows host; run protocol/framing under Wine and registration tests with a mocked PowerShell registry. These are not Windows or hardware tests.
- [x] Harden exact-ID registration, installer validation, native reconnection diagnostics, powered-off discovery messages and capability-aware UI.
- [x] Exercise Chrome's real optional native-permission prompt with a registered Linux host and handle a stale worker binding through a one-use, tab-bound local frame; test rejection, closure and consent revocation. Synthetic transfer routing uses a mock, not BLE.
- [x] Create synthetic extension screenshots/icon, draft listing/privacy/reviewer materials, Windows/Linux companion packages and a hardware test plan.
- [x] Package a separately labeled, static web-only interface preview plus a deployment guide and complete all-deliverables convenience ZIP; keep the actual Store upload extension-only.
- [x] Repeat unit, browser, native, responsive, automated accessibility and dependency scans; record that mobile, Windows and physical radios remain unverified.
- [ ] Run the guarded native CI test on a disposable real Windows runner, then test real Windows/Linux radio transfers and failure modes on multiple adapters.
- [ ] Build Android/iPhone companion apps and validate their implementation, security and device interoperability; no mobile apps are supplied.
- [ ] Complete independent security/cryptography review, real accessibility assessment, publisher identity, hosted privacy policy and companion distribution; submit from the publisher's own Store account only after addressing blockers.

- [x] Inspect supplied blueprint and empty workspace.
- [x] Build shared schemas, KDF, encrypted vault, backup and origin isolation; test.
- [x] Implement structural fingerprints, DOM observation and heuristic challenge pauses; test.
- [x] Implement state graph, exact recognition, manual step transitions and recovery; test.
- [x] Build Chromium/Firefox MV3 bundles, consent-based injection and dashboard.
- [x] Load Chromium and Firefox distributables; test real optional-host prompts.
- [x] Learn and fill a synthetic two-step flow in each browser; test manual OTP pause, exact-port rejection and browser-restart persistence.
- [x] Implement/build/test Linux Rust native host, caller validation and connections from both browsers.
- [x] Test Firefox authentication-info consent denial, acceptance and revocation with a test-only mock native peer.
- [x] Implement BLE central, Linux GATT peripheral, ephemeral key agreement and user-approved encrypted transfers; exercise protocol/framing in memory.
- [x] Add npm/OSV dependency scanning, Clippy, security tests and a CI definition.
- [x] Document installation, threat model, privacy, API, known issues and packaging.
- [x] Redesign the dashboard and popup around the supplied visual reference while retaining functional, privacy-preserving controls and real empty/locked states.
- [x] Replace dashboard, popup and browser/action icons with the supplied GhostState logo; bundle the font and license locally.
- [x] Test responsive light/dark layouts, working overview filters, keyboard dialogs, backup/restore and automated accessibility scenarios (45 at the prior redesign).
- [x] Rebuild and checksum the release archives; verify a clean project extraction, reproducible browser bundles and redesigned UI tests.
- [ ] Test real BLE discovery, pairing and credential transfer with two compatible physical devices, including Firefox, failures, reconnection, congestion, MTU and clock skew.
- [ ] Test native central on real macOS/Windows; test the new Windows receiver on real Windows hardware; implement a macOS receiver if needed.
- [ ] Build and validate the Safari Xcode app and implement its separate native Swift/XPC bridge.
- [ ] Perform an independent security/cryptography review and broader penetration/fuzz/accessibility tests.
- [ ] Run CI on the actual hosting service; replace the development Firefox ID, sign/notarize/store-review release packages, and establish an actual operator/security contact.

## Password-manager and sharing improvements (0.2.0)

- [x] Compare current GhostState against established password managers using current vendor documentation, with an honest gap list.
- [x] Add tested local password generation, editing, explicit reauthenticated reveal/copy, search, basic offline password-health checks and reviewed, atomic standard/Bitwarden login CSV import.
- [x] Add explicit, narrowly scoped, time-limited automatic filling for learned states, with origin/visibility/challenge/lock and no-submit protections; test in real browsers.
- [x] Improve Bluetooth for a bounded number of independently verified peers and explicit per-recipient transfers; test isolation and replay in memory, disclose missing radio tests.
- [x] Provide a practical cloud-backup and end-to-end-encrypted sync design without enabling external credential transfer by default.
- [x] Update docs/status and guide; verify rebuilt archives, clean extraction and reproducible browser bundles.
- [ ] Design and independently audit actual cloud synchronization, recovery and conflict handling; no such service exists today.
- [ ] Build remaining mature-manager features where compatible with the project constraints: save/update prompts, passkey management, mobile/Safari support, broader import, breach reports and shared vault administration. OTP interception/storage remains intentionally excluded.

## Mobile and desktop interface refresh

- [x] Replace site, popup, browser-action and guide branding with the newly supplied black geometric emblem; retain the exact source PNG.
- [x] Adapt dashboard navigation, cards, dialogs and touch controls to phone, tablet and short-landscape layouts while retaining desktop functionality and the reference-inspired style.
- [x] Exercise all nine screens in both themes across representative emulated Chromium, Firefox and WebKit sizes, including touch, keyboard, automated accessibility, fresh/locked and synthetic populated states.
- [x] Reproduce and correct the prior dialog-focus issue that could redirect a typed secret into a profile name; add a deterministic regression and advise affected users to treat exposed secrets accordingly.
- [x] Refresh the documentation/guide, rebuild the 0.2.1 releases, verify checksums, and exercise a clean extraction with byte-for-byte browser bundle reproduction.
- [ ] Test on real mobile devices and target assistive technologies. Mobile browser extensions, Safari's native bridge and actual Bluetooth require separate implementation/testing.
