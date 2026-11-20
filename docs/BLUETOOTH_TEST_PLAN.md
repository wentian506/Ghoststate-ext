# Bluetooth release-gate test plan — not yet performed

**Status:** implementation and synthetic protocol tests exist; no physical Bluetooth adapter or peer was available in the development environment. The new Windows GATT receiver was cross-compiled and the protocol was exercised under Wine, not on Windows hardware. No Android/iPhone application exists. This checklist is a plan, not evidence of success. Use synthetic credentials and independent security review before any real use.

## Record the environment

For each test, record build/version and SHA-256, extension ID, browser/version, host install/registration method, operating-system version and architecture, adapter model/driver/firmware, whether the adapter supports central and peripheral roles, Bluetooth permission/power state and physical distance. Do not log real passwords, passphrases, decrypted grants, verification codes tied to real users or raw personal device identifiers. Run each direction on more than one adapter model where possible.

## Required platform matrix

| Sender | Receiver | Status |
|---|---|---|
| Windows x64 | Windows x64 | Not physically tested; new Windows receiver is experimental. |
| Windows x64 | Linux/BlueZ | Not physically tested. |
| Linux/BlueZ | Windows x64 | Not physically tested; new Windows receiver is experimental. |
| Linux/BlueZ | Linux/BlueZ | Not physically tested. |
| macOS | Linux or Windows | Not physically tested; macOS sender must first be built and verified. No macOS receiver exists. |
| Android or iPhone | Any | Blocked: no compatible mobile app/receiver exists. |

Chrome on phones does not install this desktop extension. A future mobile app needs a separate permission and deployment design, interoperability implementation and security review; responsive desktop UI is not a mobile app.

## Acceptance cases for each available direction

1. Fresh-install extension and companion as normal users. Confirm exact extension-ID registration, optional permission denial and re-grant, host restart, host removal and a Store-installed ID distinct from the unpacked ID. On Windows check the real HKCU registry manifest and file ACLs; on Linux check file modes and D-Bus permissions.
2. Turn Bluetooth off, remove/disable the adapter, refuse OS permissions and retry. Check that each error is actionable and no interface falsely reports discoverability or a completed transfer. Turn Bluetooth on manually; the app must not silently change radio state.
3. Start the receiver. Check that its service UUID is present in actual advertisements, that discovery lists it, that service and characteristics can be resolved and that advertising stops on timeout, explicit stop, host exit, browser shutdown and radio loss. The Windows advertisement status must be fully `Started`; partial advertisements should fail visibly.
4. Pair once and compare the complete eight-digit code. Confirm sender-first and receiver-first orders. Reject a mismatch, fake/wrong protocol version, expired code and unauthorized second peer. Confirm that a stale, disconnected or unverified peer cannot receive a credential. Test repeated confirmation and reconnect after adapter loss.
5. Approve a synthetic credential on the sender and verify the receiver sees only the intended origin before explicitly accepting. Test accept, reject, timeout, vault lock while a message is in flight, host disconnect, clock skew and restart. Confirm nothing is persisted before acceptance; verify an accepted profile is locally usable. Check that the sender's authenticated acknowledgement is not presented as receiver acceptance.
6. Test fragmentation/reassembly at the smallest supported ATT MTU, different payload lengths, 20-byte frames, malformed/truncated/out-of-order fragments and dropped links. Test the upper bounds without sending real secrets. Check receiver single-peer isolation and sender slot limits; measure actual adapter capacity instead of assuming eight connections work.
7. Test sleep/wake, user switching, browser/profile restart, extension update, old companion version, stale ID registration, Unicode profile paths and reinstall. Verify clear error/recovery behavior and that one browser's host installation does not silently remove a different browser's authorized ID.
8. Inspect packet traces and processes for unintended plaintext credential broadcasts, accidental logs and secrets after cancellation. Metadata and the public handshake remain observable by design. Perform independent protocol/implementation review, fuzzing and adversarial testing; do not treat successful encryption/decryption as proof of security.

## Release decision

Record pass/fail and reproducible evidence for each platform and direction. Resolve failures, rerun regression suites, security-review the entire extension and companion, sign distributable binaries, confirm the public privacy disclosures and submit to Store review. Unsupported/unverified platforms must remain explicitly described as such in the product and listing. A Chrome Web Store approval alone is not a security or Bluetooth certification.
