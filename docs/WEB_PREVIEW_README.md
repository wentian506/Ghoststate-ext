# GhostState — interface preview

This folder is a **web-only demonstration**, not the browser extension or a production password manager. Use fictional sample data only. Site selection, learning/filling real browser tabs, native messaging and Bluetooth do not work in this preview. Its local browser storage is separate from an installed extension and may be cleared when browser or preview data is removed. There is no cloud sync.

## Open it on your own computer

1. Extract the preview ZIP and open a terminal in the `GhostState-Preview` folder containing `index.html`.
2. If Python 3 is installed, run one of these commands:

   **Windows:**
   ```powershell
   py -3 -m http.server 8765 --bind 127.0.0.1
   ```

   **Linux or macOS:**
   ```sh
   python3 -m http.server 8765 --bind 127.0.0.1
   ```

3. On that **same computer**, open `http://127.0.0.1:8765/`. The server listens only on your computer. Press Ctrl+C in the terminal to stop it. If port 8765 is busy, choose another port in both the command and URL.
4. Explore the screens. To try the local vault UI, choose **Get started** and create a disposable synthetic passphrase and profile. Never enter a real password.

Opening `index.html` directly as a file may not work because browsers restrict local-file scripts and storage; use a local HTTP server or an HTTPS static host instead. Python is needed only for this optional preview method—not for the installed Chrome extension.

## Optional: publish a visual demo

After security and privacy review, the **contents of this folder** can be uploaded to an HTTPS static-site host; `index.html` must be at the site's root and the `assets` folder must remain beside it. Do not upload the whole project or use a development server as a public production server. This is still only a demo: there is no extension access, Bluetooth or shared/cloud vault. Anyone with the URL may be able to open it. Host logging, access control, retention and privacy disclosures are your responsibility. Use synthetic data only.

For installing the real extension or preparing a Chrome Web Store draft, see `DEPLOYMENT_GUIDE.md` in the complete package or `docs/CHROME_STORE_RELEASE.md` in the project. Neither the preview nor the packages constitute Store approval, an independent security audit or a physical Bluetooth test.
