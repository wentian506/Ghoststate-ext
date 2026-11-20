# GhostState 0.2.2 — Chrome developer and Store guide

## Read this first

**This is a structurally packaged, pre-release extension—not an approved, independently audited or production-ready password manager. Use synthetic test credentials only.** Physical Bluetooth has not been tested. The Windows and Linux BLE sender/receiver implementations are experimental; no Android or iPhone companion app is included. The Chrome Web Store listing, public privacy-policy URL, publisher identity, independent security review and real-device tests are still outstanding. A Store reviewer may reject the package.

No Store account is connected here and no upload or submission has been made.

## Which file should I use?

| File | Purpose | Upload to the Store? |
|---|---|---|
| `ghoststate-0.2.2-chrome-store.zip` | The extension only. Its `manifest.json` is at the root. | **Yes, this file only.** |
| `ghoststate-0.2.2-chrome-dev-unpacked.zip` | Extract it; select the `GhostState-Unpacked` folder in Chrome. | No. |
| `ghoststate-0.2.2-companion-windows-x64-experimental.zip` | Separate unsigned Windows native host, installer and diagnostic script. | No. |
| `ghoststate-0.2.2-companion-linux-x64-experimental.zip` | Separate unsigned Linux native host and installer. | No. |
| `ghoststate-0.2.2-store-listing-assets.zip` | Actual extension screenshots, icon, optional promo tile, listing text and policy template. | No; add its images/text in the appropriate listing fields. |
| `ghoststate-0.2.2-web-preview.zip` | Static web-only interface demo; no extension or Bluetooth access. | No. |
| `ghoststate-0.2.2-developer-kit.zip` | Convenience bundle containing the files above and guides. | **No; extract it first.** |
| `ghoststate-0.2.2-project.zip` | Source code for review and rebuilding. | **No.** |
| `ghoststate-0.2.2-complete-package.zip` | All individual deliverables, source, Firefox build and deployment guide together. | **No; extract it first.** |

The upgraded dashboard, emblem, popup, font and extension logic are already inside the extension ZIP. The extension runs as a Chrome extension page; no web server is needed. The native helper is optional for the vault and sign-in workflows, but required for experimental Bluetooth.

## A. Test the extension in desktop Chrome

1. Extract `ghoststate-0.2.2-chrome-dev-unpacked.zip` to a permanent folder. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select its `GhostState-Unpacked` folder—the folder containing `manifest.json`, not the ZIP itself. Pin GhostState from the extensions menu.
2. Open the toolbar icon and **Open dashboard**. Create a test vault using a unique *synthetic* passphrase, and make a profile with a test-only username, password and exact site origin. No recovery is provided; record the passphrase securely if you need the test vault.
3. On a test sign-in page, click the icon → **Use this site** → approve that site's requested permission. Under **Workflows**, learn each page state, review the mapping and use **Review & fill**. Submit forms and handle OTP/CAPTCHA/passkeys yourself. Automatic fill is off by default and requires a separate, temporary opt-in. No cross-origin SSO following, iframe/shadow DOM support or session-cookie transfer is implemented.
4. On `chrome://extensions`, copy this installation's **32-character ID**. It is also shown in GhostState → **Help & support**. A Store-installed item typically has a *different* ID from a path-based unpacked build. Register the actual ID for the version you are testing; repeat when the ID changes. The two installations have separate vaults.

Chrome's instructions: <https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked>.

## B. Windows Bluetooth companion (experimental)

Requires 64-bit Windows with an appropriate Bluetooth LE adapter, powered on and permitted by the OS, a separately installed Chrome extension on each computer, and a compatible GhostState protocol-v2 peer. The provided `.exe` was **cross-compiled on Linux, is unsigned, and has not been run on real Windows hardware**. It and its new Windows GATT receiver need security review and physical testing; do not use real credentials. SmartScreen/security software may warn about an unsigned executable. Do not bypass security controls without understanding the risk.

1. Extract `ghoststate-0.2.2-companion-windows-x64-experimental.zip` into its own folder. Inspect its contents and checksums; the ZIP is **not** the Chrome extension. Open PowerShell in that folder as your normal Windows user (not Administrator).
2. In the command below, replace `YOUR_ACTUAL_EXTENSION_ID` with the ID you copied from Chrome—do not include angle brackets or upload an ID/key file:

```powershell
.\install-native.ps1 -Browser chrome -ExtensionId YOUR_ACTUAL_EXTENSION_ID -Binary .\ghoststate-companion.exe
```

If your execution policy blocks the inspected script and you choose to run it for this one process, use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-native.ps1 -Browser chrome -ExtensionId YOUR_ACTUAL_EXTENSION_ID -Binary .\ghoststate-companion.exe
```

3. Restart Chrome. In the extension, open **Devices & transfer → Connect companion** and approve the optional native-messaging permission. Keep the dashboard used to connect open during nearby transfers; closing it can disconnect the host. If disconnected, open the dashboard and connect again. A connection failure gives the browser's error and points to installation help. The executable allowlist and the Chrome manifest must both contain the exact ID; installer reruns retain previously registered exact IDs, so review and remove unused ones deliberately.
4. Optional read-only registration checks (replace the ID again):

```powershell
.\check-native.ps1 -Browser chrome -ExtensionId YOUR_ACTUAL_EXTENSION_ID
```

This checks the registry, manifest, executable and allowlist; Bluetooth device enumeration is informational. **It cannot prove Bluetooth hardware, security or a transfer works.** If the process execution policy blocks the diagnostic script, invoke it with the same one-process `powershell.exe -ExecutionPolicy Bypass -File` pattern. See `README-WINDOWS.md` inside the companion archive for file locations and removal guidance.

## C. Linux Bluetooth companion (experimental)

Extract the Linux archive. It is an unsigned x86-64 development binary built on Debian 13 and may need rebuilding for your distribution. A working BlueZ/D-Bus stack and a powered adapter supporting the selected BLE roles are required. In a terminal from the extracted folder:

```sh
chmod +x ./ghoststate-companion ./install-native.sh
./install-native.sh chrome YOUR_ACTUAL_EXTENSION_ID ./ghoststate-companion
```

Restart Chrome and connect the companion in GhostState. Other supported installer names and native-source build instructions are in `INSTALLATION.md` in the project archive.

## D. Bluetooth status and cautious test procedure

| Platform | Current code | What remains |
|---|---|---|
| Windows x64 | Experimental native sender **and new receiver**; unsigned cross-compiled EXE supplied. | Real Windows installation, radio discovery, advertising, transfer, permissions and security review. |
| Linux x64 | Experimental native sender and BlueZ receiver; unsigned development binary supplied. | Physical radio, compatibility and security testing. |
| macOS | Sender source only; no macOS receiver or macOS binary supplied. | Native build, permissions, receiver implementation and hardware testing. |
| Android / iPhone | **No GhostState mobile app or compatible receiver is supplied.** | Separate platform apps and full protocol/security/hardware validation. Normal Chrome on phones cannot install this desktop extension. |

Do not describe any route as verified. On two compatible test computers, install the extension and host separately on **both** ends. In the receiver's Devices screen select **Make discoverable**; on the sender select **Discover nearby** and **Pair**. Compare all eight displayed digits over a trusted channel and confirm on both sides. If the sender confirmed first, use **Check other device** after the receiver confirms. Send one synthetic profile to the specifically verified peer; on the receiver review and accept before expiry. Stop discovery or end the pairing when finished. Discovery/identifiers alone do not prove identity. A Linux/Windows receiver is reserved to its first sender until the listener is stopped; stop and restart discovery before pairing another sender. This also allows denial of service. Eight sender slots are a software limit, not a measured radio guarantee. Use the hardware checklist in `BLUETOOTH_TEST_PLAN.md` before making release claims.

## E. Prepare a Chrome Web Store draft

1. Register and complete verification for your own [Chrome Web Store developer account](https://developer.chrome.com/docs/webstore/register); sign in to its [developer dashboard](https://chrome.google.com/webstore/devconsole/).
2. Choose **New item**, then upload **only** `ghoststate-0.2.2-chrome-store.zip`. `manifest.json` is at its root. Do not upload the whole project, developer kit or companion executable. Create a draft only until the release blockers are resolved. Each update to an existing Store item must have a version greater than that item's previously uploaded version; 0.2.2 is not necessarily greater than an unknown existing Store version.
3. In **Store listing**, review the proposed listing text and upload the supplied **128×128 PNG icon** and at least one actual **1280×800** screenshot. The 440×280 promo image is optional. All screenshots use synthetic test profiles and show the actual extension, not a claimed working Bluetooth transfer. Review the images for accuracy before using them.
4. In **Privacy practices**, accurately disclose authentication data, form/website structure, selected site origin/browsing-related data and possible user identifiers. Review Google's current categories and every certification yourself. Explain each permission, including optional site access and `nativeMessaging`; see the draft justifications below. There is no remotely hosted extension code in this build, but the optional separately installed native program must be disclosed.
5. Complete, legally review and **publicly host** `PRIVACY_POLICY_TEMPLATE.md` with your real publisher name, contact and effective date. Supply that accessible HTTPS URL to the dashboard. Publish the required Limited Use disclosure on your extension's website or one click away. Neither hosting nor the publisher details are supplied here.
6. Provide a real support contact, choose accurate distribution and visibility, and review `REVIEWER_INSTRUCTIONS.md` for an optional Test instructions entry—including how to obtain/install the separate experimental companion if reviewers need it. A working public companion-download URL is not supplied here. Only certify statements you have verified. Finish independent security review and real Windows/Linux Bluetooth tests first; do not advertise unsupported mobile functionality. Then submit from your own account for Google's review.

## Draft listing text (review before use)

**Single purpose:** Help a user store local sign-in credentials and fill user-approved sign-in steps on selected websites.

**Short description:** Local encrypted credentials and user-controlled sign-in workflows.

**Detailed description:** GhostState is an experimental local-first sign-in assistant. Create an encrypted local vault, save profiles for exact website origins, and teach it the structure of sign-in steps. Select and grant a site before learning or filling; review each fill, or separately opt in to short-lived automatic filling. You submit forms and complete security challenges yourself. The optional nearby credential-sharing feature requires a separately installed native companion and is experimental, unaudited and not physically tested. Android and iPhone companion apps are not included. This is a prototype; use synthetic credentials until security review and platform testing are complete.

**Draft permission explanations (verify against the submitted build and dashboard prompts):**

- `storage`: retain the selected tab/origin in browser session storage; vault ciphertext uses extension IndexedDB.
- `activeTab`: let the user explicitly select the active site from the toolbar.
- `scripting`: inject the packaged content script into the user-selected site to recognize a learned sign-in structure and fill approved fields.
- Optional HTTPS host patterns and loopback HTTP: request an individual selected host for learning and authorized filling. Browser grants are host-wide, but the application separately checks the exact origin including port. Loopback HTTP is for local testing.
- Optional `nativeMessaging`: communicate with the separately installed local companion only after the user connects it, for the experimental nearby credential-transfer feature.

No cookies, history, broad required host permissions, externally-connectable API, telemetry, cloud sync or vendor server is included. The user-approved transfer sends a chosen credential in plaintext over the local browser/native pipe and encrypted over BLE; websites can read credentials filled into their forms. Read `SECURITY.md` and `PRIVACY_POLICY_TEMPLATE.md` for the residual risks and handling details.

## Official references

- Packaging and submission: <https://developer.chrome.com/docs/webstore/prepare> and <https://developer.chrome.com/docs/webstore/publish>
- Listing images: <https://developer.chrome.com/docs/webstore/images>
- Local data and privacy disclosures: <https://developer.chrome.com/docs/webstore/program-policies/user-data-faq>
- Limited Use: <https://developer.chrome.com/docs/webstore/program-policies/limited-use>
- Native messaging and Windows registry: <https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>
- Optional consistent development ID after creating a draft: <https://developer.chrome.com/docs/extensions/reference/manifest/key>

SHA-256 files detect corruption only; they are not a signature or proof of publisher identity. Never include a private key, real vault, credential or account recovery file in an upload.
