# Draft Chrome Web Store reviewer instructions — 0.2.2

Publisher: verify these instructions against the exact ZIP and the third-party demo page before submitting. Provide a working public companion download URL only if you choose to distribute and have tested that companion. Do not paste placeholders, actual private credentials or claims that Bluetooth has been validated. Chrome's optional [Test instructions tab](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions) can be used when appropriate.

## Test the extension without the companion

No GhostState account or paid subscription is required. The vault and test profile are created on the reviewer's local browser. For testing, use only the sample data below; the password is publicly displayed by the third-party test site itself.

1. Open the GhostState toolbar icon and choose **Open dashboard**. Choose **Get started** and create a local vault with a disposable test passphrase. Record it if needed; there is no recovery service.
2. Open <https://the-internet.herokuapp.com/login> in another tab. This is a third-party public practice website, not operated by GhostState. Its page advertises the synthetic credentials `tomsmith` and `SuperSecretPassword!`; never enter real credentials there. Availability and form structure can change independently.
3. In GhostState choose **New portal**. Enter the label `Public test demo`, site `https://the-internet.herokuapp.com`, username `tomsmith` and password `SuperSecretPassword!`. Save the encrypted profile.
4. While the public practice page is open, return to GhostState → **Workflows → Choose a site**, enter `https://the-internet.herokuapp.com`, and approve Chrome's optional host permission. (Alternatively, select the practice-page tab, open GhostState's toolbar icon and choose **Use this site**.)
5. For `Public test demo`, choose **Learn a state**. In the mapping dialog select **Username** for the text field and **Password** for the password field; choose **Save this state**. These mappings save structural descriptions, not the current field values.
6. Choose **Review & fill**, review the origin and choose **Fill this step**. Return to the practice tab: the two public test values should be filled. GhostState does not submit the form; the tester can choose whether to do so. A third-party site can read values entered into its own form.
7. Open **Privacy & security** to lock the vault, or **Portal profiles** to inspect and delete the test profile. Site access can be revoked in Chrome's extension settings.

This path was smoke-tested on Linux Chromium against the publicly accessible practice form with a **test-only pregranted host permission** and without submitting the form. The separate Linux prompt suite exercised actual optional-permission consent on a local synthetic page. It does not prove availability of the third-party website at future review time.

## Optional companion / Bluetooth

The extension's vault, profiles and workflow do not require a companion. The experimental nearby sharing feature does require a separately installed native host on each compatible test computer and an actual protocol-v2 peer. Windows and Linux native receiver code has **not been tested with physical radios**. The provided Windows EXE is unsigned and cross-compiled on Linux; no Android or iPhone companion app is included. No working public companion-download URL is supplied in this draft; the publisher must provide a trusted, accessible URL and accurate installation instructions if asking reviewers to test it.

After a verified installation, connect via **Devices & transfer → Connect companion**, approve the optional native-messaging permission, compare all eight pairing digits over a trusted channel, and explicitly approve each synthetic transfer on both ends. Do not treat this written procedure as evidence of a working radio transfer. See `BLUETOOTH_TEST_PLAN.md` for required device testing and `CHROME_STORE_RELEASE.md` for exact extension-ID registration.
