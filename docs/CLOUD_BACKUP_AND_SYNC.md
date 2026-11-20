# GhostState cloud storage: what you can do today

**Status: manual encrypted backup only. GhostState has no cloud account, cloud upload, or automatic synchronization.** It never uploads your vault on its own. This experimental version has not been independently reviewed; use it with synthetic credentials until security review and target-platform testing are complete.

## Save an encrypted backup with a cloud provider

You can choose a service you trust, such as Google Drive, Microsoft OneDrive or Dropbox. You will upload the **encrypted GhostState backup file yourself**; this is separate from a live sync service.

1. In the installed GhostState extension, unlock your vault. Open **Privacy & security → Export encrypted backup**. Save `ghoststate-encrypted-backup.json` somewhere you can find it. It contains the encrypted vault, not your plaintext master passphrase.
2. Sign in to your chosen cloud-storage account. Use that service’s normal **upload file** command to upload the JSON file. Do not create a public sharing link. Set up two-factor authentication for the cloud account.
3. Keep your original GhostState master passphrase safe **separately** from the backup. The cloud provider cannot use its own password-reset feature to recover your GhostState passphrase. If that passphrase is lost, this backup cannot be decrypted or restored.
4. Make a new backup after making changes. Rename dated versions, for example `ghoststate-backup-2026-11-19.json`, before uploading; keep more than one known-good copy. Check your provider’s version history and access settings. This is not automatic synchronization: edits on one device do not appear on another without a new export and restore.
5. Test a restore with **synthetic data** in a separate, fresh browser profile with the extension installed. In the new profile open GhostState, choose **Create vault → Restore it instead**, select the downloaded backup, and enter the passphrase that was used for that backup. Verify the expected profiles are present. The standalone web preview has a different vault and is not the installed extension.

### Important: restoring replaces, not merges

GhostState can restore only when no local vault exists. On a device with a vault, restoring requires deleting that local vault first. That deletion removes its local credentials, learned workflows and activity and can lose newer work. **Do not reset an existing vault until you have separately exported and tested a backup of it and are certain you intend to replace it.** GhostState does not compare or merge two backup files, and a stale backup can overwrite newer work after a reset. Preserve both versions and resolve differences manually.

### Risks and privacy

- The provider can see file names, sizes, upload times, account identity and similar metadata, although the GhostState vault contents are encrypted in the file.
- Anyone who obtains the file can attempt to guess the master passphrase offline. Use a long, unique, high-entropy passphrase, protect the file and your cloud account, and do not place the passphrase next to the file.
- A malicious or compromised device can capture secrets before encryption or after unlock. Encryption is not a substitute for an independent security review, device security, or backups.
- Encryption authenticates the backup contents but **does not prove it is the latest backup**. A provider or attacker could return an older valid file; check your retained dated copies.
- Cloud deletion and file-history retention vary by provider. Deleting a local profile does not remove older backups. Confirm retention and sharing policies.
- CSV files exported by other managers are usually **plaintext**. Never mistake them for this encrypted JSON backup or upload them as a backup. GhostState imports only selected login fields; its CSV importer does not import OTP seeds, notes, passkeys or other item types.

## How to build actual cloud sync later

This is a design and release checklist, **not an implemented service**. Do not connect a production account or upload real vaults using this prototype.

1. **Explicit setup and account separation.** Offer a clear opt-in, explain the provider and data flow, request narrowly scoped OAuth permissions, use TLS, support MFA and revocation, and keep service credentials distinct from the master passphrase. Do not put tokens or passwords in logs, URLs or source code. A native helper that persists tokens must use the platform’s OS credential store.
2. **End-to-end encryption before upload.** Encrypt the vault on the client with a well-reviewed, versioned envelope; only ciphertext and minimal routing/version metadata reach the service. Never send the master passphrase or an unwrapped vault key. Ensure unique random nonces and domain-separated authenticated data for every new revision; keep KDF parameters and upgrade/migration policy explicit. The server must not be able to decrypt vault contents.
3. **Multi-device keys and verification.** Design secure device enrollment and revocation, per-device authentication, key wrapping/rotation, and a separate user-held recovery secret if recovery is desired. A provider password reset cannot recover a genuinely end-to-end-encrypted vault without an independently held recovery secret.
4. **Reliable changes and conflicts.** Use conditional writes/compare-and-swap against a version identifier, immutable encrypted revisions, bounded history, offline queues, encrypted tombstones and a deliberate client-side merge or conflict-resolution screen. Never silently choose an older whole-vault blob when two devices edit at once. Design crash-safe writes, backup retention, restore testing, quotas and deletion behavior.
5. **Integrity and rollback.** Authenticate headers, item IDs and revision links. A hash chain and securely stored last-seen revision can detect some rollback on previously enrolled clients, but an untrusted server can still withhold updates or present stale history to a new client. Plan independent checkpoints, cross-device verification or a transparency mechanism and communicate the residual risk.
6. **Production gates.** Threat-model account takeover, compromised clients, malicious server, leaked backups, lost devices, metadata and insider access. Commission independent cryptographic and implementation audits, abuse/rate-limit tests, data-protection/legal review, monitoring without secret logging, incident response, accessibility and real-world multi-device tests before launch.

The existing encrypted backup is a useful starting artifact, but uploading it periodically is **not** equivalent to a tested, conflict-safe, end-to-end encrypted sync system.
