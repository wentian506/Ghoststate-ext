/*
 * Chromium binds runtime.connectNative when a context starts. If optional
 * nativeMessaging is granted after the service worker started, a fresh, local
 * extension frame supplies the native port without broadening permissions or
 * restarting/locking the vault. The trusted worker explicitly arms and accepts
 * only this bundled page. Closing its dashboard closes this fallback connection.
 */
import { extensionApi as api } from '../../../packages/browser-adapters/src/index';
if (!api) throw new Error('GhostState extension context is required.');
const browserApi = api;
// A randomly generated, one-use challenge is supplied only in the requesting
// dashboard's local frame URL. No connection is attempted without it.
const challenge = location.hash.slice(1);
if (!/^[a-f0-9]{32}$/.test(challenge)) throw new Error('A local dashboard challenge is required.');
const relay = browserApi.runtime.connect({name:`ghoststate.native-bridge.v1:${challenge}`});
const allowed = new Set(['status','discover','listen','stop_listen','pair','confirm_pair','cancel_pair','incoming','reject_transfer','send_grant','accept_transfer']);
let host: chrome.runtime.Port | null = null;
let closed = false;
let armed = false;
function fail(reason:string) {
  if (closed) return;
  closed = true;
  try { relay.postMessage({bridgeError:reason.slice(0,300)}); } catch { /* Worker is gone. */ }
  try { relay.disconnect(); } catch { /* Already disconnected. */ }
  try { host?.disconnect(); } catch { /* Already disconnected. */ }
}
relay.onDisconnect.addListener(() => {
  // Reading lastError avoids an unchecked-error warning for rejected ports.
  void browserApi.runtime.lastError;
  if (closed) return;
  closed = true;
  try { host?.disconnect(); } catch { /* Already disconnected. */ }
});
relay.onMessage.addListener((message:unknown) => {
  if (closed || !message || typeof message !== 'object') return;
  if ((message as {bridgeArm?:unknown}).bridgeArm === true && !armed) {
    armed = true;
    void start().catch(() => fail('Could not start the companion bridge.'));
    return;
  }
  if (!host) return;
  const req = (message as {bridgeRequest?:unknown}).bridgeRequest;
  if (!req || typeof req !== 'object') return fail('Invalid internal companion request.');
  const r = req as {id?:unknown;op?:unknown;payload?:unknown};
  if (!Number.isSafeInteger(r.id) || typeof r.op !== 'string' || !allowed.has(r.op) || !r.payload || typeof r.payload !== 'object' || Array.isArray(r.payload)) return fail('Invalid internal companion request.');
  try { host.postMessage(req); } catch { fail('Could not send to the companion.'); }
});
async function start() {
  const granted = await browserApi.permissions.contains({permissions:['nativeMessaging']});
  if (closed) return;
  if (!granted) return fail('Native messaging permission was not granted.');
  if (typeof browserApi.runtime.connectNative !== 'function') return fail('This browser did not enable native messaging. Restart the browser and try again.');
  host = browserApi.runtime.connectNative('com.ghoststate.bridge');
  host.onMessage.addListener((message:unknown) => {
    if (!closed) { try { relay.postMessage({nativeMessage:message}); } catch { fail('Companion bridge disconnected.'); } }
  });
  host.onDisconnect.addListener(() => fail(browserApi.runtime.lastError?.message || 'Companion disconnected.'));
  if (!closed) relay.postMessage({bridgeReady:true});
}
