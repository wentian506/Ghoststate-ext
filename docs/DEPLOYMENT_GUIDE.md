# GhostState 0.2.2 — deployment and preview guide

## Read first

GhostState is an **unsigned, unaudited prototype**. Use fictional test credentials only. There has been no Chrome Web Store submission or approval, no independent security audit, no real Windows OS test and no physical Bluetooth transfer test. The Windows and Linux companions are experimental. No Android or iPhone companion is included.

The extension does **not** need a website, hosted server or developer tools once it is installed. The separately installed native companion is needed only for experimental nearby sharing. The visual web preview is a different, limited program and has its own browser storage.

## 1. Choose the right file

Extract `ghoststate-0.2.2-complete-package.zip` first. It contains these separate archives:

| File | Use |
|---|---|
| `ghoststate-0.2.2-chrome-dev-unpacked.zip` | Install an unpacked test extension in desktop Chrome. |
| `ghoststate-0.2.2-chrome-store.zip` | **Only this extension ZIP** is intended for the Chrome Web Store draft. |
| `ghoststate-0.2.2-companion-windows-x64-experimental.zip` | Separate unsigned Windows native host and installation scripts. |
| `ghoststate-0.2.2-companion-linux-x64-experimental.zip` | Separate unsigned Linux native host and installer. |
| `ghoststate-0.2.2-web-preview.zip` | Standalone web-only interface demonstration; not the extension. |
| `ghoststate-0.2.2-store-listing-assets.zip` | Screenshots, icon, draft listing, policy template and hardware test plan. |
| `ghoststate-0.2.2-firefox.zip` | Experimental Firefox build; it uses a development ID and is not an AMO-signed release. |
| `ghoststate-0.2.2-project.zip` | Source, tests, development workspace, documentation and staged development hosts. |
| `ghoststate-0.2.2-developer-kit.zip` | A smaller convenience bundle of Chrome builds, preview, companion ZIPs, listing assets and guides. |

**Do not upload the complete package, developer kit, project, preview or companion executable to the Chrome Web Store.** `SHA256SUMS` detects accidental changes or corruption; it is not a signature and does not prove who published a file.

## 2. Install a test build in desktop Chrome

1. Extract `ghoststate-0.2.2-chrome-dev-unpacked.zip` into a permanent folder. Inside it is `GhostState-Unpacked`, containing `manifest.json`.
2. Open `chrome://extensions` on a desktop computer. Turn on **Developer mode**, select **Load unpacked**, and choose the **GhostState-Unpacked folder**, not the ZIP. Pin GhostState from the puzzle-piece extensions menu.
3. Open the GhostState icon → **Open dashboard**. Choose **Get started** and use a disposable synthetic passphrase. Create a profile with fake credentials and an exact test-site origin. A lost passphrase cannot be recovered.
4. To test a form, open a trusted test page. Use the toolbar button → **Use this site**, approve the requested site permission, then learn and review the fields in **Workflows**. The extension does not submit the form or solve OTP/CAPTCHA. A site can read credentials filled into its own form.
5. In `chrome://extensions` or **GhostState → Help & support**, copy this installation's actual 32-letter extension ID. An unpacked build and a future Store installation may have different IDs and separate vaults. Re-register the companion for the exact installation you are testing.

## 3. Set up the optional companion

The extension and companion must be installed separately on **each** compatible test computer. Use only after reviewing the files and the risks. Real Windows operation and all radio transfers are unverified; do not assume installation or pairing will work on a particular device. The Windows EXE is unsigned and may trigger security software warnings.

### Windows x64 — experimental

Extract the Windows companion archive and open PowerShell in its extracted folder. Replace the placeholder below with the actual ID copied in step 2:

```powershell
.\install-native.ps1 -Browser chrome -ExtensionId YOUR_ACTUAL_EXTENSION_ID -Binary .\ghoststate-companion.exe
```

Restart Chrome. In **Devices & transfer**, choose **Connect companion** and approve the browser's optional native-messaging permission. Keep the dashboard used to connect open during a nearby transfer; closing it may disconnect the companion. To check registration, run:

```powershell
.\check-native.ps1 -Browser chrome -ExtensionId YOUR_ACTUAL_EXTENSION_ID
```

The diagnostic checks registration, not Bluetooth functionality or security. See `README-WINDOWS.md` in the Windows archive and `CHROME_STORE_RELEASE.md` in the developer kit for troubleshooting and script-policy details. Do not bypass operating-system protections without understanding the risk.

### Linux x64 — experimental

Extract the Linux companion archive, open a terminal in that folder and replace the placeholder with the actual Chrome extension ID:

```sh
chmod +x ./ghoststate-companion ./install-native.sh
./install-native.sh chrome YOUR_ACTUAL_EXTENSION_ID ./ghoststate-companion
```

Restart Chrome, then use **Devices & transfer → Connect companion** and approve the optional permission. A compatible powered BLE adapter and BlueZ/D-Bus are needed; this Debian-built binary may need rebuilding for another distribution.

### Cautious two-computer test

On the intended receiver choose **Make discoverable**. On the sender choose **Discover nearby** and **Pair**. Compare all **eight digits** over a trusted channel and confirm on both devices. Approve a synthetic profile transfer to the specifically verified peer and review/accept it on the receiver. Stop discovery afterward. A receiver is reserved to its first sender until stopped; the eight-sender figure is a software limit, not measured radio capacity. This procedure is a test plan, not evidence that Bluetooth works. See `BLUETOOTH_TEST_PLAN.md` in the listing-assets archive.

## 4. Prepare a Chrome Web Store draft

1. Finish independent security review and real-device tests before any public release. Provide a trusted companion download, real publisher identity and working support/security contacts. Complete, legally review and publicly host the policy template, and verify all current Store privacy/permission disclosures.
2. Sign in to **your own** [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole/) and complete any required developer registration and verification.
3. Create a new item and upload **only** `ghoststate-0.2.2-chrome-store.zip`. Its `manifest.json` is at the root. Keep it as a draft while the remaining gates are unresolved. If updating an existing listing, its new version must be greater than the previously uploaded version; check that 0.2.2 qualifies or update and rebuild the project first.
4. Use the supplied 128×128 icon and 1280×800 synthetic screenshots from the listing-assets archive. Review the draft description, policy URL, Limited Use disclosure, permission explanations and reviewer instructions against what you actually distribute. Provide a real, accessible companion-download URL if the listing or reviewers need the companion.
5. Test the actual Store-installed build and register **its** actual extension ID with the companion. Only submit when you have resolved the review, security and hardware requirements. Google decides whether to approve it; the supplied ZIP is not an approval.

Nothing has been uploaded or submitted from this workspace. Full details and official links are in `CHROME_STORE_RELEASE.md` in the developer kit and project.

## 5. Open or host the web-only preview

The live Arena preview, if running, is temporary and separate from the extension. For an offline/local copy, extract `ghoststate-0.2.2-web-preview.zip`; its `GhostState-Preview/README.md` explains how to start a loopback-only Python server and open it on your own computer. The preview contains no remote dependencies and does not need npm. Never enter real credentials.

For an optional public **visual demo**, upload the contents of `GhostState-Preview` (including `index.html`, CSS, JavaScript and `assets`) to an HTTPS static-site host. The preview is not the extension: it cannot select or fill browser tabs, connect a native companion, use Bluetooth, or sync a vault. Its test data stays in the visitor's browser storage and can be deleted. Hosting access, logs, retention, security and privacy compliance are the publisher's responsibility. Do not expose a development server as a public production service.

## 6. Rebuild or test from source

Extract `ghoststate-0.2.2-project.zip`, install Node.js 20 or newer and npm, open a terminal in the project folder, then run:

```sh
npm ci
npm run build
npm test
```

The built extension folders are `release/chromium` and `release/firefox`. To run the Vite development preview from source, use `npm run dev` and open the local URL it prints on the **same computer**; it is not a production server and is separate from the extension vault.

Creating all release archives from source additionally requires the staged Linux and cross-built Windows Rust hosts, Python Pillow, zip/unzip and generated Store screenshots. `npm run package` packages those inputs; `npm run test:release` tests the extracted Store ZIP, actual Chromium native-permission prompt and real registered Linux host plus a separate mock transfer. The release test needs Linux, Playwright Chromium, Xvfb and `xdotool`; it is not a Windows or Bluetooth test. See the project `README.md` and `.github/workflows/ci.yml` for prerequisites and commands. Hosted CI has not been run.
