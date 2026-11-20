# GhostState privacy policy — DRAFT; NOT YET PUBLISHED

**Publisher action required:** replace the bracketed fields with real information, verify every statement against the version you distribute and your actual business practices, obtain legal review, then host the completed policy at a public HTTPS URL. The project currently has no known publisher, support address or hosted policy. Do not submit this template unchanged or represent it as a completed policy.

**Publisher/operator:** [LEGAL NAME AND BUSINESS ADDRESS OR OTHER REQUIRED CONTACT DETAILS]  
**Privacy contact:** [WORKING EMAIL OR CONTACT URL]  
**Effective date:** [DATE]

## What GhostState does

GhostState helps you store sign-in credentials in a local encrypted vault and, when you request it, recognize and fill learned fields on a site you select. The version described here is experimental and unaudited. Automatic filling is off by default and requires a separate short-lived authorization. You submit forms and complete security challenges yourself. Features, data flows and applicable laws should be reviewed for each release.

## Information handled

- **Credentials and profile details:** the exact site origin, profile name, username and password you choose to save. A chosen username or label can include personal information.
- **Selected website and form structure:** the extension accesses an origin and, after you choose and grant a site, reads structure and selected element attributes to recognize login steps and challenges. It saves normalized structural descriptors and mappings in the encrypted vault. It does not intentionally collect page text, entered form values, cookies or one-time codes when scanning. The browser's host grant can cover all ports on that host; the application also checks the exact origin before filling.
- **Settings and activity:** the selected tab ID and origin can be held in session storage. Optional activity logging, off by default, records authorized operations and related origins in the encrypted vault. Local UI preferences, such as theme, are also stored on the device.
- **Imported files and clipboard:** if you choose CSV import, supported login fields are processed locally and saved in the encrypted vault. The original CSV may remain unencrypted on your disk. If you choose to copy a revealed password, the operating-system clipboard and clipboard history may retain it.
- **Nearby sharing:** if you install and connect the separate companion, explicitly verify a peer and approve a transfer, the selected credential passes in plaintext through local extension/native messaging, is encrypted for the verified session and is transmitted over Bluetooth to the chosen recipient. Some browsers use a bundled extension frame for the local connection; no remote page is involved. A recipient must approve saving it. Radio identifiers, the advertised service and handshake metadata can be observable nearby. Both devices hold session data temporarily in memory. No cookies, OTP values or authenticated browser sessions are transferred. Bluetooth is experimental and has not been tested with real radios.

## How information is used and disclosed

This build has no GhostState-operated cloud vault, analytics or telemetry endpoint. Data is used locally to provide the sign-in, vault and explicitly requested nearby-transfer features. The developer does not receive vault data from the extension. A site can read credentials filled into its form and may automatically process or submit them; only use a site you trust. A recipient you choose receives a credential after the approved Bluetooth transfer. If you manually upload an encrypted backup to a cloud provider, that provider handles the file and its metadata under its own terms. [PUBLISHER: ADD ANY ACTUAL SUPPORT, WEBSITE, PAYMENT, CRASH REPORTING OR OTHER DATA COLLECTION YOU OPERATE.]

The publisher's use of user data will comply with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including its [Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use). [PUBLISHER: make this statement only after confirming your actual practices comply.]

## Storage, retention and security

Vault records and chosen workflow data are encrypted in the extension's local IndexedDB. A key derived from your passphrase is held in memory while the vault is unlocked; the passphrase is not intentionally stored or sent by GhostState. Locking or background suspension can clear the in-memory key, but JavaScript strings, clipboard history, swap, crash dumps, backups and operating-system copies cannot be guaranteed erased. Endpoint malware, a compromised browser or another privileged process may expose information. A strong, unique passphrase matters. No independent security audit has been completed.

Local records remain until you delete them, reset the vault, or remove the extension and its browser-managed data. Copies may persist in old browser backups, filesystem snapshots, exported encrypted backup files, plaintext CSV files or clipboard history. Pending nearby grants expire within two minutes and are held by the companion in memory; sessions and discoverability expire after approximately five minutes or when stopped. Once a recipient accepts a credential, it remains in that recipient's vault until removed, and the website password remains valid until changed with the website.

## Your choices

You can add, edit or delete a profile, clear optional activity, lock or reset the local vault, revoke site permissions through GhostState or browser settings, disconnect the companion, and uninstall the extension and companion. You can export an encrypted backup and restore it only with its original passphrase. There is no remote recovery or automatic cloud sync. Removing the companion's registration and files is described in the installation guide. If you use an earlier 0.2.0 build, inspect profile names for accidentally entered secrets and change affected credentials; see the security notes.

## Children, jurisdictions and changes

[PUBLISHER: state applicable age restrictions, jurisdiction-specific rights, complaint channels, your actual retention/deletion process and how you notify users about policy changes. Do not invent practices or promise legal rights without review.]

## Contact

For privacy questions or requests contact [WORKING PRIVACY CONTACT]. Security reports: [WORKING SECURITY CONTACT].
