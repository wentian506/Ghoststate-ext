# GhostState Linux x86-64 companion — experimental 0.2.2

This is a separate **unsigned and unaudited** development binary, built on Debian 13. It requires compatible glibc/libdbus, BlueZ/D-Bus and a powered BLE adapter supporting the selected role. It may need rebuilding on another distribution. Physical Bluetooth and independent security review are outstanding; use synthetic credentials only. Both devices must use protocol v2. Up to eight sender slots are software limits, not measured radio capacity; each Linux or Windows receiver handles one sender session at a time.

Extract this archive, then run with the **actual installed extension ID** shown by your browser:

```sh
chmod +x ./ghoststate-companion ./install-native.sh
./install-native.sh chrome YOUR_ACTUAL_EXTENSION_ID ./ghoststate-companion
# Alternatively use chromium, edge, brave, opera, chrome-testing or firefox.
```

Restart the browser and connect in GhostState → Devices & transfer. This archive does not include the browser extension. Firefox's development ID is `ghoststate@local.invalid`. The installer copies the host to `~/.local/bin`, registers the browser-specific native manifest and stores exact callers in `~/.config/ghoststate/allowed-callers.json`. Reruns preserve existing exact IDs for a browser; review and remove outdated IDs when appropriate. Register the Store ID separately if it differs from an unpacked developer ID. Uninstalling the extension does not automatically remove the companion.

Windows and Linux receiver code is experimental; real transfers have not been tested. macOS sender source exists but no macOS receiver or binary is provided. No Android or iPhone companion app is provided. See the developer guide and Bluetooth test plan before any further use.
