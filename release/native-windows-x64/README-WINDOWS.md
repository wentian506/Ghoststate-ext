# GhostState Windows x64 companion — experimental 0.2.2

**Not a Chrome extension and not an audited password manager.** This separate unsigned native program was cross-compiled on Linux; its Windows GATT receiver, installation on real Windows, radio discovery and transfers have not been tested on hardware. Use synthetic credentials only. It needs a compatible protocol-v2 peer with its own extension and companion. No Android or iPhone app is included.

## Install for Chrome

1. Extract all files in this ZIP to one folder. Load or install the GhostState 0.2.2 Chrome extension separately. On `chrome://extensions`, copy the actual 32-letter extension ID (also shown under GhostState → Help & support).
2. In this extracted folder open PowerShell as the signed-in user. Replace the uppercase text below with the actual ID:

```powershell
.\install-native.ps1 -Browser chrome -ExtensionId YOUR_ACTUAL_EXTENSION_ID -Binary .\ghoststate-companion.exe
```

If the script is blocked by PowerShell execution policy, inspect it first and, only if you choose, use the one-process bypass shown in the Chrome developer guide. The host is unsigned; your security software may warn. Do not disable protections or use a production credential without understanding the risks.

3. Restart Chrome. Open GhostState → Devices & transfer → Connect companion; grant native-messaging permission when prompted. Repeat registration with the actual Store-installed ID if it differs from the unpacked test ID.
4. For a read-only setup check:

```powershell
.\check-native.ps1 -Browser chrome -ExtensionId YOUR_ACTUAL_EXTENSION_ID
```

Passing this check verifies only the current PowerShell registry view, not working Bluetooth. Chrome checks the 32-bit registry view before the 64-bit view, so a stale conflicting registration in the other view can still cause a failure. If needed, inspect both views (do not remove entries you do not understand):

```powershell
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ghoststate.bridge" /ve /reg:32
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ghoststate.bridge" /ve /reg:64
```

Both receiver and sender implementations require suitable BLE-capable hardware and real testing; availability depends on Windows and the adapter. Compare all eight pairing digits on both devices and approve every synthetic transfer.

## Files and removal

The installer copies the executable and writes a caller allowlist under `%USERPROFILE%\.config\ghoststate`. The Chrome native-host manifest is `com.ghoststate.bridge.chrome.json` in that folder. Its per-user registry key is `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ghoststate.bridge` and its default value points to the manifest. Edge, Brave and Firefox use their own registry paths/manifests. Reinstalling can retain prior exact trusted IDs; review and remove old IDs in both the applicable browser manifest and `allowed-callers.json` when they are no longer needed.

To remove the Chrome registration, delete that specific per-user registry key and Chrome manifest. Only remove the common executable/allowlist directory after confirming no other GhostState browser registration still uses it. Uninstalling the browser extension does not automatically remove the separate companion. Removing the companion does not remove an extension vault.

Checksums identify file changes but are not digital signatures. Windows, all real Bluetooth routes, independent cryptographic review, publisher signing and Store approval remain outstanding.
