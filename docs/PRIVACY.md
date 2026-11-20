# Privacy policy and data flows

GhostState is a local-first, pre-release application. It has no GhostState server, telemetry endpoint, analytics, cloud vault or external account. There is no vendor-operated remote recovery service.

## Data kept locally

The browser extension keeps an encrypted vault in its own IndexedDB. The encrypted record can contain the exact origins and user-entered labels, usernames and passwords of saved profiles; approved structural form descriptors and mappings; workflow edges; settings; and (if enabled) up to 200 authorized-operation log entries and associated origins. This is an opt-in operation log, off by default, not a general browsing-history log. The current selected tab ID and origin live in browser session storage when available and are removed on browser restart; other visited pages and full URL paths/queries are not retained.

A scan reads DOM structure and some element attributes transiently to identify fields and challenges. It does not read form values, page text, raw HTML, screenshots, cookies or OTP values. Only normalized tag/type/role/path/autocomplete categories, field-kind enums, hashes and challenge enums are used. The browser can expose structure to the extension after the user grants the site. Before an opt-in automatic fill, the content script checks locally whether the mapped fields are empty; it does not transmit or persist existing values. Websites can read values intentionally filled into their forms, and a compromised site can exploit automatic fill.

The encrypted export contains vault ciphertext and public KDF metadata. You may choose to upload that file to a cloud provider manually; GhostState has no automatic cloud upload or sync. It can be restored only with its passphrase. Deleting a profile, clearing the activity log, resetting the vault, revoking a site grant and choosing whether to log operations are available in the UI; deleted ciphertext may persist in old backups and storage snapshots.

## Local password tools

Generation happens locally. Search uses profile names and origins; a basic offline health calculation compares decrypted passwords in memory and is not a breach check. A fresh passphrase is required to reveal, edit or import; revealing displays a secret in the trusted extension UI and copying places it on the system clipboard, where history or other applications may retain it. Plaintext CSV imports are chosen and reviewed explicitly, processed locally and never uploaded by GhostState; only login name, canonical origin, username and password are saved. Notes, TOTP/OTP fields, passkeys and other columns are not imported. The chosen file itself may remain on disk and must be protected/removed by the user. JavaScript memory and device backups cannot be guaranteed wiped.

## Nearby transfer

When explicitly requested, a selected credential is sent as plaintext through the local browser/native-messaging pipe to the user's local companion, encrypted for the verified ephemeral session, then transmitted over BLE to the selected device. The sender selects one separately verified recipient for every send; up to eight sender slots exist in software. A Linux or experimental Windows receiver accepts one session at a time and the recipient must approve before local import. Real radio capacity is untested. The grant expiry limits delivery, not the lifetime of the credential once it has been imported; the password stays valid until changed with its provider. The BLE discovery service UUID, radio identifiers and handshake metadata may be observable by nearby devices. No cookie, session token, OTP or site-issued grant is transferred. The companion holds keys and pending grants in memory only and stores no credential files; expired pending grants are removed during a periodic sweep. Device verification is session-only; there is no persistent paired-device roster.

## External communications

At runtime GhostState has no cloud calls. Its build/dependency and security-audit commands use npm, crates.io, Playwright downloads and OSV and are development-time network operations. Navigating to a user's chosen site is normal browser traffic. The optional BLE grant goes to the approved nearby peer, not to a vendor server. The standalone Vite preview and browser extension have separate storage; a remotely hosted preview has a different trust boundary and should not be used for sensitive secrets.

## Contact and policy changes

This project has no deployed operator or support address. A distributor must provide its own contact, security reporting channel, retention disclosures, consent flows and updated privacy policy before public distribution.
