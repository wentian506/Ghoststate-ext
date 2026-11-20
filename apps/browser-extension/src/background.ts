import { extensionApi as apiMaybe } from '../../../packages/browser-adapters/src/index';
import { VaultService } from '../../../packages/vault/src/service';
import { canTransition } from '../../../packages/state-machine/src/index';
import { canonicalOrigin, requireOrigin, type FieldMapping, type Snapshot } from '../../../packages/shared-types/src/index';
const api = apiMaybe!;
const service = new VaultService();
const vault = service.vault;
interface Target { tabId: number; origin: string }
let memoryTarget: Target | null = null;
const execution = new Map<string, {workflowId:string;stateId:string}>();
// Short-lived, in-memory only. A worker restart or vault lock clears permission to autofill.
interface AutoAuthorization { tabId:number; origin:string; profileId:string; expiresAt:number; filled:Set<string> }
let auto: AutoAuthorization | null = null;
let autoTimer: ReturnType<typeof setTimeout> | undefined;
let autoBusy = false, autoRetry = false;
function disableAuto():void { auto = null; autoRetry = false; if (autoTimer) clearTimeout(autoTimer); autoTimer = undefined; }
async function autoStatus():Promise<{tabId:number;origin:string;profileId:string;expiresAt:number}|null> {
  const a = auto; if (!a) return null;
  if (Date.now() >= a.expiresAt || !(await vault.status()).unlocked) { if (auto === a) disableAuto(); return null; }
  return {tabId:a.tabId,origin:a.origin,profileId:a.profileId,expiresAt:a.expiresAt};
}
function scheduleAuto(tabId:number):void {
  if (!auto || auto.tabId !== tabId) return;
  if (autoBusy) { autoRetry = true; return; }
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => { autoTimer = undefined; void runAuto(tabId); }, 180);
}

let nativePort: chrome.runtime.Port | null = null;
let nativeMode: 'direct'|'bridge'|null = null;
let nativeReady = false;
let nativeError: string|null = null;
// The fallback can only be claimed by the requesting dashboard's fresh child
// frame, with a one-use random challenge. Neither is exposed to web pages.
let bridgePending: {token:string;tabId:number;deadline:number}|null = null;
let nativeSeq = 0;
const pending = new Map<number, {resolve:(v:unknown)=>void; reject:(e:Error)=>void; timer:ReturnType<typeof setTimeout>}>();
let nativeEvent: unknown = null;
async function getTarget(): Promise<Target | null> {
  if (api.storage.session) { const s = await api.storage.session.get('target'); return (s.target as Target | undefined) || null; }
  return memoryTarget;
}
async function setTarget(target: Target | null) { memoryTarget = target; if (api.storage.session) await api.storage.session.set({ target }); }
async function checkedTarget(): Promise<Target> {
  const t = await getTarget(); if (!t || !Number.isInteger(t.tabId)) throw new Error('Choose a site with the GhostState toolbar button first.');
  const tab = await api.tabs.get(t.tabId); if (!tab.url) throw new Error('The selected tab is unavailable.'); requireOrigin(tab.url, t.origin);
  return t;
}
async function stopObservation(t: Target | null): Promise<void> {
  if (!t) return;
  try { await api.tabs.sendMessage(t.tabId, { type: 'GS_STOP' }); } catch { /* the tab may already be closed or navigated */ }
}
/** Fail closed if Firefox's optional data-collection consent has not been granted or was revoked. */
async function requireTransferConsent(): Promise<void> {
  const manifest = api.runtime.getManifest() as any;
  if (!manifest.browser_specific_settings?.gecko?.data_collection_permissions) return;
  const granted = await api.permissions.getAll() as unknown as {data_collection?:string[]};
  if (!Array.isArray(granted.data_collection) || !granted.data_collection.includes('authenticationInfo')) throw new Error('Firefox authentication-info consent is required for credential transfer.');
}
interface ScanResult { snapshot:Snapshot; documentId:string }
async function scanDetailed(): Promise<ScanResult> {
  const t = await checkedTarget();
  await api.scripting.executeScript({ target: { tabId: t.tabId, frameIds:[0] }, files: ['content.js'] });
  const current = await getTarget();
  if (!current || current.tabId !== t.tabId || current.origin !== t.origin) { await stopObservation(t); throw new Error('Selected site changed.'); }
  const response = await api.tabs.sendMessage(t.tabId, { type: 'GS_SCAN' }, {frameId:0}) as {ok:boolean;snapshot?:Snapshot;documentId?:string;error?:string};
  if (!response?.ok || !response.snapshot || typeof response.documentId !== 'string' || response.documentId.length > 64) throw new Error(response?.error || 'Could not scan the selected page.');
  requireOrigin(response.snapshot.origin, t.origin); return {snapshot:response.snapshot, documentId:response.documentId};
}
async function scan(): Promise<Snapshot> { return (await scanDetailed()).snapshot; }
async function activeVisibleTab(a:AutoAuthorization):Promise<boolean> {
  const t = await checkedTarget(); if (t.tabId !== a.tabId || t.origin !== a.origin) return false;
  const tab = await api.tabs.get(a.tabId); if (!tab.active) return false;
  const win = await api.windows.get(tab.windowId); if (!win.focused) return false;
  const u = new URL(a.origin); return api.permissions.contains({origins:[`${u.protocol}//${u.hostname}/*`]});
}
/** Never trust an observation as a fill instruction; scan again and validate immediately before delivery. */
async function runAuto(tabId:number):Promise<void> {
  const a = auto; if (!a || a.tabId !== tabId || autoBusy) return;
  autoBusy = true;
  try {
    if (!(await autoStatus()) || auto !== a || !(await activeVisibleTab(a))) return;
    const lease = vault.captureLease(false); // Passive observations cannot extend the inactivity timer.
    const {snapshot:snap,documentId} = await scanDetailed();
    const fill = await vault.getFill(a.profileId, a.origin, snap, false);
    const workflow = await vault.getWorkflow(a.profileId, false); if (!workflow) return;
    const executionKey = `${a.tabId}:${a.profileId}`; const previous = execution.get(executionKey);
    if (previous && previous.workflowId === fill.workflowId && !canTransition(workflow, previous.stateId, fill.stateId)) return;
    const onceKey = `${documentId}:${fill.stateId}`; if (a.filled.has(onceKey) || a.filled.size >= 50) return;
    if (auto !== a || Date.now() >= a.expiresAt || !(await activeVisibleTab(a)) || auto !== a || Date.now() >= a.expiresAt) return;
    const fields = fill.mappings.map(m => ({...m, value:fill.values[m.kind]}));
    vault.assertLease(lease);
    const result = await api.tabs.sendMessage(a.tabId, {type:'GS_FILL',origin:a.origin,documentId,fingerprint:snap.fingerprint,fields,automatic:true}, {frameId:0}) as {ok:boolean};
    if (!result?.ok) return;
    // Never fill a given learned state twice in one document, even if the page clears it.
    if (auto === a) a.filled.add(onceKey);
    execution.set(executionKey,{workflowId:fill.workflowId,stateId:fill.stateId});
    try { await vault.recordFill(a.profileId,true); } catch { /* Delivery already occurred. */ }
  } catch { /* Fail closed. User can review/fill manually. Never log a page or secret. */ }
  finally { autoBusy = false; if (autoRetry) { autoRetry = false; if (auto) scheduleAuto(auto.tabId); } }
}

function pageKind(sender: chrome.runtime.MessageSender): 'dashboard'|'popup'|null {
  if (sender.id !== api.runtime.id || !sender.url) return null;
  const root = api.runtime.getURL(''); if (!sender.url.startsWith(root)) return null;
  const path = sender.url.slice(root.length).split(/[?#]/)[0]; return path === 'dashboard.html' ? 'dashboard' : path === 'popup.html' ? 'popup' : null;
}
function rejectNativePending(reason:string):void {
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason)); }
  pending.clear();
}
function closeNative(reason:string):void {
  const port = nativePort; nativePort = null; nativeMode = null; nativeReady = false;
  nativeEvent = null; nativeError = reason; bridgePending = null;
  rejectNativePending(reason);
  try { port?.disconnect(); } catch { /* Already closed. */ }
}
async function nativeRequest(op: string, payload: unknown = {}): Promise<unknown> {
  const port = nativePort; if (!port || !nativeReady) throw new Error('Companion is not connected.');
  const id = ++nativeSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (nativePort === port) closeNative('Companion timed out. Reconnect and check Bluetooth setup.'); }, 45000);
    pending.set(id, { resolve, reject, timer });
    const request = { id, op, payload };
    try { port.postMessage(nativeMode === 'bridge' ? {bridgeRequest:request} : request); }
    catch { if (nativePort === port) closeNative('Could not send to the companion. Reconnect and check its installation.'); }
  });
}
function attachNative(port:chrome.runtime.Port, mode:'direct'|'bridge'):void {
  nativePort = port; nativeMode = mode; nativeReady = mode === 'direct'; nativeError = null;
  port.onMessage.addListener((raw: any) => {
    if (nativePort !== port) return;
    let m = raw;
    if (mode === 'bridge') {
      if (raw?.bridgeReady === true) { nativeReady = true; return; }
      if (typeof raw?.bridgeError === 'string') { closeNative(raw.bridgeError.slice(0,300)); return; }
      if (!raw || !Object.prototype.hasOwnProperty.call(raw,'nativeMessage')) return;
      m = raw.nativeMessage;
    }
    if (m && Number.isSafeInteger(m.id) && pending.has(m.id)) { const p = pending.get(m.id)!; clearTimeout(p.timer); pending.delete(m.id); if (m.ok) p.resolve(m.data); else p.reject(new Error(typeof m.error === 'string' ? m.error.slice(0,300) : 'Companion error.')); }
    else if (m && typeof m.event === 'string') nativeEvent = m; // Untrusted status; never interpreted as a vault command.
  });
  port.onDisconnect.addListener(() => {
    const reason = api.runtime.lastError?.message || 'Companion disconnected.';
    // An old port's delayed disconnect must not clear a newer connection.
    if (nativePort !== port) return;
    nativePort = null; nativeMode = null; nativeReady = false; nativeEvent = null; nativeError = reason; rejectNativePending(reason);
  });
}
function connectNative(sender:chrome.runtime.MessageSender): {bridgeRequired:true;bridgeToken:string}|null {
  if (nativePort) {
    if (!nativeReady) throw new Error('A companion connection is already starting; try again shortly.');
    return null;
  }
  // Chrome may not add a newly granted optional API to an already-running
  // worker. The dashboard opens our bundled bridge in a fresh extension frame.
  if (typeof api.runtime.connectNative !== 'function') {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || sender.frameId !== 0) throw new Error('Open the dashboard in a browser tab to connect the companion.');
    if (bridgePending && Date.now() <= bridgePending.deadline) throw new Error('A companion connection is already starting; try again shortly.');
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,'0')).join('');
    bridgePending = {token,tabId:tabId!,deadline:Date.now()+15_000}; nativeError = null;
    return {bridgeRequired:true,bridgeToken:token};
  }
  bridgePending = null;
  attachNative(api.runtime.connectNative('com.ghoststate.bridge'),'direct'); return null;
}
api.runtime.onConnect.addListener(port => {
  if (!port.name.startsWith('ghoststate.native-bridge.v1')) return;
  const sender = port.sender, pendingBridge = bridgePending;
  const path = sender?.url?.split('#')[0];
  const valid = !!pendingBridge && Date.now() <= pendingBridge.deadline && !nativePort &&
    port.name === `ghoststate.native-bridge.v1:${pendingBridge.token}` &&
    sender?.id === api.runtime.id && path === api.runtime.getURL('native-bridge.html') &&
    sender.tab?.id === pendingBridge.tabId && typeof sender.frameId === 'number' && sender.frameId > 0;
  if (!valid) {
    try { port.disconnect(); } catch { /* Reject unsolicited, wrong-tab, top-level or duplicate bridges. */ }
    return;
  }
  bridgePending = null; attachNative(port,'bridge');
  try { port.postMessage({bridgeArm:true}); } catch { closeNative('Could not start the companion bridge.'); }
});
async function dispatch(message: any, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string' || message.type.length > 80) throw new Error('Invalid message.');
  if (message.type === 'GS_OBSERVATION') {
    const t = await getTarget(); if (!t || sender.id !== api.runtime.id || sender.tab?.id !== t.tabId || sender.frameId !== 0 || !sender.url) throw new Error('Unauthorized observation.');
    requireOrigin(sender.url, t.origin); requireOrigin(message.snapshot?.origin, t.origin);
    scheduleAuto(t.tabId);
    return null; // Do not persist DOM observations or browsing history.
  }
  const kind = pageKind(sender); if (!kind) throw new Error('Unauthorized extension caller.');
  const p = message.payload && typeof message.payload === 'object' ? message.payload : {};
  if (message.type === 'SELECT_TAB') {
    if (!Number.isInteger(p.tabId) || typeof p.origin !== 'string') throw new Error('Invalid tab.');
    const tab = await api.tabs.get(p.tabId); if (!tab.url) throw new Error('Cannot access tab.'); const actual = canonicalOrigin(tab.url); requireOrigin(actual, p.origin);
    // A dashboard may select only a tab at an explicitly granted origin; popup has activeTab as well.
    const u = new URL(actual); const has = await api.permissions.contains({origins:[`${u.protocol}//${u.hostname}/*`]}); if (!has) throw new Error('Site permission has not been granted.');
    const old = await getTarget(); disableAuto(); execution.clear(); await setTarget({tabId:p.tabId, origin:actual});
    if (old && (old.tabId !== p.tabId || old.origin !== actual)) await stopObservation(old);
    return { origin:actual };
  }
  if (kind === 'popup' && message.type !== 'STATUS' && message.type !== 'TARGET') throw new Error('Command not allowed from popup.');
  switch (message.type) {
    case 'LOCK': disableAuto(); execution.clear(); vault.lock(); await stopObservation(await getTarget()); return null;
    case 'CLEAR_TARGET': { const old = await getTarget(); disableAuto(); execution.clear(); await setTarget(null); await stopObservation(old); return null; }
    case 'TARGET': { const t = await getTarget(); if (!t) return null; try { return await checkedTarget(); } catch { return null; } }
    case 'SCAN': return scan();
    case 'AUTO_STATUS': return autoStatus();
    case 'AUTO_DISABLE': disableAuto(); return null;
    case 'AUTO_ENABLE': {
      if (typeof p.id !== 'string' || !p.id || p.id.length > 64) throw new Error('Choose a profile.');
      const t = await checkedTarget(); const lease = vault.captureLease();
      const selected = (await vault.listProfiles()).find(x => x.id === p.id);
      if (!selected || !selected.stateCount) throw new Error('Learn a sign-in state for this profile first.');
      requireOrigin(t.origin, selected.origin); const u = new URL(t.origin);
      if (!(await api.permissions.contains({origins:[`${u.protocol}//${u.hostname}/*`]}))) throw new Error('Site permission has been revoked.');
      const fresh = await checkedTarget(); if (fresh.tabId !== t.tabId || fresh.origin !== t.origin) throw new Error('Selected site changed.');
      vault.assertLease(lease); disableAuto(); execution.clear();
      auto = {tabId:t.tabId,origin:t.origin,profileId:p.id,expiresAt:Date.now()+10*60_000,filled:new Set()};
      scheduleAuto(t.tabId); return autoStatus();
    }
    case 'RECORD_STATE': { disableAuto(); const s = await scan(); if (s.fingerprint !== p.fingerprint) throw new Error('The page changed. Scan again before saving.'); return vault.recordState(p.id, s, p.mappings as FieldMapping[]); }
    case 'CLEAR_WORKFLOW': case 'DELETE_PROFILE': case 'UPDATE_PROFILE': case 'IMPORT_PROFILES': case 'RESET': { disableAuto(); execution.clear(); return service.execute(message.type,p); }
    case 'FILL_STATE': {
      const t = await checkedTarget(); const {snapshot:snap,documentId} = await scanDetailed(); const lease = vault.captureLease(); const fill = await vault.getFill(p.id, t.origin, snap);
      const workflow = await vault.getWorkflow(p.id); if (!workflow) throw new Error('Workflow not found.');
      const executionKey = `${t.tabId}:${p.id}`; const previous = execution.get(executionKey);
      if (previous && previous.workflowId === fill.workflowId && !canTransition(workflow, previous.stateId, fill.stateId)) throw new Error('Unexpected workflow transition. Take over manually or start again at the first state.');
      const fresh = await checkedTarget(); if (fresh.tabId !== t.tabId || fresh.origin !== t.origin) throw new Error('Selected site changed.');
      const fields = fill.mappings.map(m => ({ ...m, value: fill.values[m.kind] }));
      vault.assertLease(lease); // no asynchronous gap before handing the approved fill to the browser
      const result = await api.tabs.sendMessage(t.tabId, { type: 'GS_FILL', origin:t.origin, documentId, fingerprint:snap.fingerprint, fields }, {frameId:0}) as {ok:boolean; data?:unknown; error?:string};
      if (!result?.ok) throw new Error(result?.error || 'Fill failed.'); execution.set(executionKey, {workflowId:fill.workflowId,stateId:fill.stateId});
      // A lock after delivery must not report the already-completed fill as a failure.
      let logFailed = false; try { await vault.recordFill(p.id); } catch { logFailed = true; }
      return { ...(result.data as Record<string,unknown>), logFailed };
    }
    case 'NATIVE_CONNECT': {
      const has = await api.permissions.contains({permissions:['nativeMessaging']}); if (!has) throw new Error('Native messaging permission has not been granted.');
      let connection:chrome.runtime.Port|null = null;
      try {
        const bridge = connectNative(sender);
        if (bridge) return bridge;
        connection = nativePort; return await nativeRequest('status');
      }
      catch (e) {
        const detail = e instanceof Error ? e.message : 'Connection failed.';
        if (connection && nativePort === connection) closeNative('Companion connection failed.');
        throw new Error(`${detail} Check the companion installation and exact extension ID; see Installation help.`);
      }
    }
    case 'NATIVE_STATUS': return { connected: !!nativePort && nativeReady, event: nativeEvent, error: nativeError };
    case 'NATIVE_SEND_PROFILE': {
      if (!nativePort) throw new Error('Companion is not connected.');
      if (typeof p.peerId !== 'string' || !p.peerId || p.peerId.length > 256) throw new Error('Choose a verified recipient.');
      const lease = vault.captureLease();
      const credential = await vault.credentialForTransfer(p.id, p.origin);
      await requireTransferConsent(); vault.assertLease(lease);
      const result = await nativeRequest('send_grant', {...credential, peerId:p.peerId});
      // Delivery is already acknowledged; report a subsequent audit-write error separately.
      let logFailed = false; try { await vault.recordTransfer(p.id); } catch { logFailed = true; }
      return { ...(result as Record<string,unknown>), logFailed };
    }
    case 'NATIVE_ACCEPT_PROFILE': {
      if (!nativePort) throw new Error('Companion is not connected.');
      const lease = vault.captureLease();
      await requireTransferConsent(); vault.assertLease(lease);
      const result = await nativeRequest('accept_transfer', {id:p.id}) as {id:string;origin:string;username:string;password:string};
      vault.assertLease(lease);
      if (!result || result.id !== p.id || typeof result.origin !== 'string') throw new Error('Invalid companion response.');
      requireOrigin(result.origin, p.origin);
      return vault.addProfile(p.label, result.origin, result.username, result.password);
    }
    case 'NATIVE_DISCONNECT': closeNative('Companion disconnected.'); return null;
    case 'NATIVE_REQUEST': {
      // No generic native request: only non-secret operations, explicitly allowlisted.
      const allowed = ['status', 'discover', 'listen', 'stop_listen', 'pair', 'confirm_pair', 'cancel_pair', 'incoming', 'reject_transfer'];
      if (typeof p.op !== 'string' || !allowed.includes(p.op)) throw new Error('Native operation not allowed.');
      return nativeRequest(p.op, p.data || {});
    }
    default: return service.execute(message.type, p);
  }
}
api.runtime.onMessage.addListener((message, sender, respond) => {
  dispatch(message, sender).then(data => respond({ok:true,data}), e => respond({ok:false,error:e instanceof Error ? e.message : 'Request failed.'})); return true;
});
api.tabs.onRemoved.addListener(tabId => {
  if (auto?.tabId === tabId) disableAuto();
  if (bridgePending?.tabId === tabId) { bridgePending = null; nativeError = 'Companion dashboard closed.'; }
  void getTarget().then(t => { if (t?.tabId === tabId) { execution.clear(); return setTarget(null); } });
});
// No general navigation tracking or broad host permission. These handlers only act on the
// one explicitly selected and temporarily authorized tab, while its vault is unlocked.
api.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'complete') scheduleAuto(tabId); });
api.tabs.onActivated.addListener(({tabId}) => scheduleAuto(tabId));
api.windows.onFocusChanged.addListener(windowId => { if (windowId !== api.windows.WINDOW_ID_NONE && auto) void api.tabs.query({active:true,windowId}).then(tabs => { if (tabs[0]?.id) scheduleAuto(tabs[0].id); }).catch(()=>{}); });
api.permissions.onRemoved.addListener(removed => {
  if (auto) disableAuto();
  if (removed.permissions?.includes('nativeMessaging')) closeNative('Native messaging permission was revoked.');
});
