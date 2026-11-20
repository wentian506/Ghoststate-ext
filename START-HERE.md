# GhostState — open-source starter

This folder contains the GhostState source code, browser-extension builds, tests, documentation, and experimental native-companion source and development binaries. You can inspect and modify the code, rebuild it and share it under the licence described below.

> **Safety:** GhostState is a pre-release, unaudited prototype. Use fictional test credentials only. Windows operation and physical Bluetooth transfers have not been tested; the native companions are experimental and unsigned. The web preview is not the browser extension. There is no Android or iPhone companion app.

## 1. Licence and sharing

GhostState's project software is provided under the **MIT licence** in `LICENSE`: it permits use, copying, modification and redistribution, including commercial use, subject to retaining the copyright and licence notice. It is provided without warranty. Keep `LICENSE` with copies or substantial portions of the project.

Third-party components may have their own licence terms. The bundled Inter font is under the SIL Open Font License; its notice is in `apps/dashboard/assets/INTER-OFL.txt`. npm and Rust dependencies have their own licences; review and include required notices when redistributing them, especially compiled binaries. The supplied GhostState logo and name may involve separate copyright or trademark rights: verify that you have permission to redistribute or use them, or replace them. The MIT licence does not itself grant trademark rights.

## 2. Requirements

- A desktop computer with **Node.js 20.19 or newer** and npm. Download them from the official Node.js website if needed.
- An internet connection for the first `npm ci` to download the locked development dependencies. `node_modules` is intentionally not included.
- Chrome or a Chromium-family desktop browser to test the extension.
- Rust and platform-specific system dependencies only if you want to rebuild the optional native companion. See `docs/INSTALLATION.md`.

## 3. Run the editable browser preview

Extract the ZIP, then open a terminal **in this folder**—the folder containing `package.json`. On Windows you can open the folder in File Explorer, type `cmd` in its address bar and press Enter. Run:

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local address printed in the terminal, normally `http://127.0.0.1:4173/`, **on the same computer**. Press Ctrl+C in the terminal to stop the server. If port 4173 is busy, run `npm run dev -- --host 127.0.0.1 --port 4174` and open the address it prints.

This is a local development preview, not a production server. It can exercise the local vault interface with synthetic data, but it **cannot** select/fill other browser tabs or connect the Bluetooth companion. Its browser storage is separate from the extension. Changes to dashboard source usually appear when the page refreshes. Do not expose the development server to the public internet.

## 4. Build and install the actual Chrome extension

In the same project folder:

```sh
npm ci
npm run build
npm test
```

The build creates `release/chromium/` and `release/firefox/`. In desktop Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, then choose **the `release/chromium` folder containing `manifest.json`**. Pin the GhostState icon, open the dashboard and use only synthetic data.

After changing the code, run `npm run build` again, go to `chrome://extensions` and select **Reload** on the extension. The unpacked extension needs no web server. Loading a folder from a different location may give it a different extension ID and separate browser storage.

The project also includes a prebuilt `release/chromium` for an initial test, but rebuild after any source changes. More tests and platform requirements are in `README.md` and `DEVELOPMENT_STATUS.md`.

## 5. Where to make changes

- `apps/dashboard/src/main.ts` — dashboard screens and behavior.
- `apps/dashboard/style.css` and `apps/dashboard/index.html` — visual styling and HTML shell.
- `apps/browser-extension/src/` — background worker, popup, content script and native relay.
- `apps/browser-extension/manifest.base.json` — extension permissions and manifest settings.
- `apps/desktop-companion/src/` — Rust native host and experimental Bluetooth transport.
- `packages/` — vault, cryptography, state machine and shared application code.
- `tests/` — synthetic unit, security and browser tests; `docs/` — guides and design notes.

Treat `release/chromium` and `release/firefox` as **generated output**: edit the source and run `npm run build` rather than relying on changes made only in those folders. For further development, read `docs/SECURITY.md`, `docs/INSTALLATION.md`, `docs/DEPLOYMENT_GUIDE.md` and `TASKS.md`.

## 6. Native companion and distribution

Bluetooth is optional and needs a separately installed native host on every participating computer, with each actual browser-extension ID registered. The included Windows and Linux binaries are unsigned experimental development artifacts; the Windows executable was cross-compiled and tested under Wine, not on real Windows. No physical Bluetooth transfer has been verified. See `docs/INSTALLATION.md`, `docs/CHROME_STORE_RELEASE.md` and `docs/BLUETOOTH_TEST_PLAN.md` before attempting a synthetic test.

This **source ZIP is not a Chrome Web Store upload**. To prepare a release, follow `docs/DEPLOYMENT_GUIDE.md` and `docs/CHROME_STORE_RELEASE.md`, review dependency licences and privacy requirements, complete independent security review and real-device tests, then package only the built extension for the Store. No Store submission or approval has occurred.
