import { extensionApi as api, isExtension } from '../../../packages/browser-adapters/src/index';
import { VaultService } from '../../../packages/vault/src/service';
import { generatePassword } from '../../../packages/vault/src/passwords';
import { readLoginCsv } from '../../../packages/vault/src/import-csv';
import { canonicalOrigin, type AuditEvent, type FieldMapping, type ProfileView, type Snapshot, type Workflow } from '../../../packages/shared-types/src/index';

const app = document.querySelector<HTMLElement>('#app')!;
const toastEl = document.querySelector<HTMLElement>('#toast')!;
const web = isExtension() ? null : new VaultService();
type Screen = 'overview'|'welcome'|'portals'|'workflows'|'devices'|'activity'|'security'|'compatibility'|'help';
interface Status { initialized:boolean; unlocked:boolean; timeoutMinutes:number }
interface NativeStatus { connected:boolean; event?:any; error?:string|null }
type OverviewFilter = 'all' | 'learned' | 'unlearned';
let overviewFilter: OverviewFilter = 'all'; let sortDescending = false; let profileSearch = '';
interface AutoStatus { tabId:number;origin:string;profileId:string;expiresAt:number }
let autoStatus: AutoStatus | null = null;
let screen: Screen = 'overview'; let mobileMenuOpen = false; let status: Status = {initialized:false,unlocked:false,timeoutMinutes:5};
let profiles: ProfileView[] = []; let events: AuditEvent[] = []; let target: {tabId:number;origin:string}|null = null;
let native: NativeStatus = {connected:false}; let nativeInfo: any = null; let nearby: {id:string;name:string}[] = []; let toastTimer: ReturnType<typeof setTimeout>;
let nativeBridgeFrame: HTMLIFrameElement|null = null;
let connectingNative = false;
const ext = isExtension();
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const icons: Record<string,string> = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  shield:'<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  unlock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  flow:'<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h4a4 4 0 0 1 4 4v5M14 12l3 3 3-3"/>',
  device:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M10 18h4"/>',
  activity:'<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M19.4 15a8 8 0 0 0 .1-6l1.3-1-2-3.5-1.6.6A8 8 0 0 0 12 3l-.8-1H9l-.5 1.7A8 8 0 0 0 6 5l-1.6-.5-2 3.5L3.7 9a8 8 0 0 0 0 6l-1.3 1 2 3.5L6 19a8 8 0 0 0 3 1.3L9.5 22h4l.5-1.7A8 8 0 0 0 17 19l1.6.5 2-3.5Z"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  check:'<path d="m5 12 5 5L20 7"/>',
  cloud:'<path d="M6 18a4 4 0 0 1-.5-8A6.5 6.5 0 0 1 18 9a4.5 4.5 0 0 1 0 9H6ZM3 3l18 18"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-2 2 1 1-2 2-1-1-3 3"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  moon:'<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  close:'<path d="M5 5l14 14M19 5 5 19"/>',
  warning:'<path d="M12 3 2 21h20L12 3ZM12 9v5m0 3h.01"/>',
  bluetooth:'<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  monitor:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  spark:'<path d="m12 2 1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2ZM19 15l.6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6L19 15Z"/>'
};
function icon(name:string, size=17) { return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.info}</svg>`; }
const mark = '<img src="./assets/ghoststate-logo.png" alt="" width="40" height="40">';
async function call<T = any>(type:string, payload:Record<string,any>={}):Promise<T> {
  if (web) {
    if (type === 'TARGET' || type === 'AUTO_STATUS') return null as T;
    if (type === 'NATIVE_STATUS') return {connected:false} as T;
    if (['SCAN','RECORD_STATE','FILL_STATE'].includes(type) || type.startsWith('AUTO_') || type.startsWith('NATIVE_')) throw new Error('This feature requires the installed browser extension.');
    return await web.execute(type,payload) as T;
  }
  const response = await api!.runtime.sendMessage({type,payload}) as {ok:boolean;data:T;error?:string};
  if (!response?.ok) throw new Error(response?.error || 'The extension could not complete this request.'); return response.data;
}
function toast(message:string) { toastEl.textContent = message; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>toastEl.classList.remove('show'),4000); }
function removeNativeBridge():void { nativeBridgeFrame?.remove(); nativeBridgeFrame = null; }
async function openNativeBridge(challenge:string):Promise<void> {
  // A fresh bundled extension frame obtains an optional API that Chrome did not
  // bind to the already-running worker. It is not a remote page or web server.
  if (!/^[a-f0-9]{32}$/.test(challenge)) throw new Error('Invalid companion bridge challenge.');
  removeNativeBridge();
  const frame = document.createElement('iframe');
  frame.hidden = true; frame.tabIndex = -1; frame.title = 'Local companion bridge';
  frame.src = `${api!.runtime.getURL('native-bridge.html')}#${challenge}`;
  nativeBridgeFrame = frame; document.body.append(frame);
  const deadline = Date.now() + 10_000;
  try {
    while (Date.now() < deadline) {
      const state = await call<NativeStatus>('NATIVE_STATUS');
      if (state.connected) return;
      if (state.error) throw new Error(`${state.error} Check the companion installation and exact extension ID; see Installation help.`);
      await new Promise(resolve => setTimeout(resolve,100));
    }
    throw new Error('The local companion bridge did not start. Restart the browser and check the installation.');
  } catch (e) {
    removeNativeBridge(); await call('NATIVE_DISCONNECT').catch(()=>null); throw e;
  }
}
async function refresh(renderNow=true) {
  status = await call<Status>('STATUS');
  if (status.unlocked) { [profiles,events] = await Promise.all([call<ProfileView[]>('LIST_PROFILES'),call<AuditEvent[]>('LIST_EVENTS')]); }
  else { profiles=[];events=[]; }
  target = await call('TARGET').catch(()=>null); autoStatus = await call<AutoStatus|null>('AUTO_STATUS').catch(()=>null); native = await call('NATIVE_STATUS').catch(()=>({connected:false}));
  if (native.connected) nativeInfo = await call('NATIVE_REQUEST',{op:'status'}).catch(()=>null); else { nativeInfo=null; nearby=[]; }
  if (renderNow) render();
}
function navButton(id:Screen,label:string,ic:string,count?:number) {
  return `<button class="nav-button ${screen===id?'active':''}" data-screen="${id}" ${screen===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span>${count!==undefined && count>0 ? `<span class="nav-count" aria-label="${count} saved">${count}</span>`:''}</button>`;
}
const labels:Record<Screen,string> = {overview:'Dashboard',welcome:'Getting started',portals:'Portal profiles',workflows:'Workflows',devices:'Devices & transfer',activity:'Activity log',security:'Privacy & security',compatibility:'Compatibility',help:'Help & support'};
const moreScreens:Screen[] = ['welcome','activity','security','compatibility','help'];
function mobileTab(id:Screen,label:string,ic:string) {
  return `<button class="mobile-tab ${screen===id?'active':''}" data-screen="${id}" ${screen===id?'aria-current="page"':''}>${icon(ic,19)}<span>${label}</span></button>`;
}
function mobileMenuLink(id:Screen,ic:string) {
  return `<button class="mobile-menu-link ${screen===id?'active':''}" data-screen="${id}" ${screen===id?'aria-current="page"':''}>${icon(ic,18)}<span>${labels[id]}</span>${icon('arrow',15)}</button>`;
}
function mobileNavigation() {
  return `<div class="mobile-nav-shell">${mobileMenuOpen?'<div class="mobile-menu-dismiss" data-action="close-mobile-menu" aria-hidden="true"></div>':''}
    <nav class="mobile-nav" aria-label="Mobile navigation">${mobileTab('overview','Home','grid')}${mobileTab('portals','Vault','globe')}${mobileTab('workflows','Flows','flow')}${mobileTab('devices','Devices','device')}<button class="mobile-tab ${mobileMenuOpen||moreScreens.includes(screen)?'active':''}" data-action="mobile-more" aria-expanded="${mobileMenuOpen}" aria-controls="mobile-more-panel">${icon('more',19)}<span>More</span></button></nav>
    <section class="mobile-more-panel" id="mobile-more-panel" ${mobileMenuOpen?'':'hidden'} aria-label="More sections"><div class="mobile-more-title">YOUR WORKSPACE <span>EXPLORE</span></div>${mobileMenuLink('welcome','spark')}${mobileMenuLink('activity','activity')}${mobileMenuLink('security','shield')}${mobileMenuLink('compatibility','monitor')}${mobileMenuLink('help','help')}<button class="mobile-menu-link mobile-lock" data-action="${status.unlocked?'lock':'unlock'}">${icon(status.unlocked?'lock':'unlock',18)}<span>${status.unlocked?'Lock vault':status.initialized?'Unlock vault':'Create vault'}</span>${icon('arrow',15)}</button></section>
  </div>`;
}
function shell(body:string) {
  const locked = !status.unlocked;
  return `<div class="app-shell"><a class="skip-link" href="#main-content">Skip to content</a><aside class="sidebar"><div class="brand"><div class="brand-mark">${mark}</div><div><div class="brand-name">GhostState</div><div class="brand-sub">PRIVATE WORKSPACE</div></div><span class="brand-indicator"><i class="dot good"></i> LOCAL ONLY</span></div>
    <div class="side-nav"><div class="nav-label">Navigation</div><nav class="nav" aria-label="Workspace">${navButton('overview','Dashboard','grid')}${navButton('portals','Portal profiles','globe',profiles.length)}${navButton('workflows','Workflows','flow')}${navButton('devices','Devices & transfer','device')}${navButton('activity','Activity log','activity')}</nav>
    <div class="nav-label">Preferences</div><nav class="nav" aria-label="Preferences">${navButton('security','Privacy & security','shield')}${navButton('compatibility','Compatibility','monitor')}${navButton('welcome','Getting started','spark')}${navButton('help','Help & support','help')}</nav></div>
    <div class="sidebar-bottom"><div class="privacy-note"><div class="privacy-title">${icon('shield',15)} Private by design</div><div class="privacy-copy">Your vault stays on this device. No cloud account required.</div></div><div class="side-lock"><div class="lock-blob">${icon(locked?'lock':'unlock',15)}</div><div><strong>${!status.initialized?'Vault not set up':locked?'Vault locked':'Vault unlocked'}</strong><small>${locked?'Your local workspace':'Only on this device'}</small></div><button data-action="${locked?'unlock':'lock'}" aria-label="${locked?'Unlock':'Lock'} vault">${icon('arrow',15)}</button></div></div></aside>
    <main class="main" id="main-content" tabindex="-1"><header class="topbar"><h1 tabindex="-1">${esc(labels[screen])}</h1><div class="top-right"><span class="top-status"><i class="dot ${ext?'good':''}"></i>${ext?'Extension active':'Local web workspace'}</span><button class="icon-button" data-action="theme" title="Toggle light and dark theme" aria-label="Toggle light and dark theme" aria-pressed="${document.documentElement.dataset.theme==='dark'}">${icon(document.documentElement.dataset.theme==='light'?'moon':'sun',17)}</button><button class="icon-button help-button" data-screen="help" title="Help and support" aria-label="Open help">${icon('help',17)}</button>${btn('add-profile','New portal','plus','primary top-create')}</div></header><div class="content">${ext?'':`<aside class="preview-notice" aria-label="Preview limitations"><strong>Interface preview</strong><span>Use sample data only. Preview data is separate and may be cleared. Site access needs the extension; Bluetooth also needs a separate companion.</span></aside>`}${body}<footer class="app-footer"><span><i class="dot good"></i> PRIVATE BY DESIGN <span>·</span> LOCAL BY DEFAULT</span><span>GhostState 0.2.2 <span>·</span> No cloud account</span></footer></div></main>${mobileNavigation()}</div>`;
}
function header(title:string,description:string,actions='',eyebrow='YOUR WORKSPACE') { return `<div class="heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2><p>${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`; }
function btn(action:string,label:string,ic='',classes='',extra='') { return `<button class="btn ${classes}" data-action="${action}" ${extra}>${ic?icon(ic,15):''}${label}</button>`; }
function activityRows(items:AuditEvent[]) { return items.map(e=>`<div class="event"><div class="event-dot">${icon('check',13)}</div><div><strong>${esc(e.action)}</strong>${e.origin?`<small>${esc(e.origin)}</small>`:''}</div><span class="event-time">${esc(new Date(e.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))}</span></div>`).join(''); }
function guideRow(number:string,title:string,description:string,actionLabel:string,actionAttr:string,complete=false) {
  return `<div class="workspace-row guide-row"><span class="row-symbol ${complete?'complete':''}" aria-hidden="true">${complete?icon('check',13):number}</span><div class="workspace-row-main"><strong>${title}</strong><small>${description}</small></div><span class="row-indicator">${complete?'Ready':'GET STARTED'}</span><button class="row-link" ${actionAttr}>${actionLabel} ${icon('arrow',13)}</button></div>`;
}
function overview() {
  const states = profiles.reduce((n,p)=>n+p.stateCount,0);
  const vaultWord = !status.initialized?'Not created':status.unlocked?'Unlocked':'Locked';
  const vaultAction = status.unlocked?'lock':'unlock';
  const vaultActionLabel = status.unlocked?'Lock vault':status.initialized?'Unlock vault':'Get started';
  const filtered = profiles.filter(p => overviewFilter==='all' || (overviewFilter==='learned' ? p.stateCount>0 : p.stateCount===0))
    .slice().sort((a,b)=>sortDescending?b.label.localeCompare(a.label):a.label.localeCompare(b.label));
  const filters: {id:OverviewFilter;label:string}[] = [{id:'all',label:'All portals'},{id:'learned',label:'Learned'},{id:'unlearned',label:'Needs setup'}];
  const guides = [
    guideRow('01',status.unlocked?'Your local vault is ready':status.initialized?'Unlock your local vault':'Create your local vault',status.unlocked?'Your passphrase protects your encrypted data.':status.initialized?'Enter your master passphrase to access the vault.':'Choose a unique passphrase to protect your data.',status.unlocked?'Security':status.initialized?'Unlock':'Create vault',status.unlocked?'data-screen="security"':'data-action="unlock"',status.unlocked),
    guideRow('02','Add a portal profile','Save a sign-in for one exact site origin.','Add portal','data-action="add-profile"'),
    guideRow('03','Choose the sign-in site',ext?'Grant access only to a site you trust.':'Site selection requires the browser extension.','Choose site','data-action="select-site"',!!target),
    guideRow('04','Learn the sign-in steps','Capture structure, never page content or field values.','Open workflows','data-screen="workflows"'),
    guideRow('05','Choose how to fill','Approve each fill, or enable temporary automatic fill. Submit forms yourself.','How it works','data-action="welcome"')
  ].join('');
  let rows:string;
  if (!status.unlocked || (profiles.length===0 && overviewFilter==='all')) {
    rows = `<div class="list-note">${!status.unlocked?'Your profiles stay private until the vault is unlocked.':'No profiles yet. Follow these steps to get started.'}</div>${guides}`;
  } else if (!filtered.length) {
    rows = `<div class="workspace-empty"><div class="empty-icon">${icon('flow',19)}</div><strong>${overviewFilter==='learned'?'No learned profiles yet':overviewFilter==='unlearned'?'No profiles need setup':'No portal profiles yet'}</strong><p>${overviewFilter==='learned'?'Capture a sign-in step from Workflows to see it here.':overviewFilter==='unlearned'?'Profiles without a learned state will appear here.':'Add a portal to start a private workflow.'}</p><button class="text-button" data-screen="workflows">Open workflows ${icon('arrow',13)}</button></div>`;
  } else {
    rows = filtered.map(p=>`<div class="workspace-row portal-row"><span class="row-symbol record" aria-hidden="true">${icon('globe',15)}</span><div class="workspace-row-main"><strong>${esc(p.label)}</strong><small>${esc(p.origin)}</small></div><span class="row-indicator ${p.stateCount?'learned':''}">${p.stateCount?`${p.stateCount} ${p.stateCount===1?'state':'states'}`:'Not learned'}</span><div class="row-buttons"><button class="row-link" data-action="learn" data-id="${esc(p.id)}" aria-label="Learn a state for ${esc(p.label)}">Learn</button><button class="row-link" data-action="fill" data-id="${esc(p.id)}" aria-label="Review and fill ${esc(p.label)}">Fill ${icon('arrow',13)}</button></div></div>`).join('');
  }
  return `<div class="dashboard-intro"><div class="intro-copy"><span class="eyebrow">YOUR PRIVATE WORKSPACE</span><h2>Your sign-ins, your control.</h2><p>Everything you need for a more private sign-in, all in one place.</p></div><span class="intro-meta">${icon('shield',15)} LOCAL BY DEFAULT</span></div>
  <div class="metrics-row" aria-label="Workspace summary">
    <section class="metric-card"><div class="metric-title"><h2>Local vault</h2>${icon('lock',17)}</div><div class="metric-middle"><span>Vault status</span><strong>${vaultWord}</strong></div><div class="metric-rule mint" aria-hidden="true"></div><div class="metric-bottom"><span class="metric-tag">ENCRYPTED STORAGE</span><button class="inline-action" data-action="${vaultAction}">${vaultActionLabel} ${icon('arrow',13)}</button></div></section>
    <section class="metric-card"><div class="metric-title"><h2>Portal profiles</h2>${icon('globe',17)}</div><div class="metric-middle"><span>Saved profiles</span><strong>${status.unlocked?profiles.length:'—'}</strong></div><div class="metric-rule lavender" aria-hidden="true"></div><div class="metric-bottom"><span class="metric-tag">EXACT ORIGIN</span><button class="inline-action" data-screen="portals">View profiles ${icon('arrow',13)}</button></div></section>
    <section class="metric-card"><div class="metric-title"><h2>Sign-in steps</h2>${icon('flow',17)}</div><div class="metric-middle"><span>Learned states</span><strong>${status.unlocked?states:'—'}</strong></div><div class="metric-rule sand" aria-hidden="true"></div><div class="metric-bottom"><span class="metric-tag">YOU APPROVE</span><button class="inline-action" data-screen="workflows">View workflows ${icon('arrow',13)}</button></div></section>
  </div>
  <div class="workspace-grid"><section class="workspace-main" aria-label="Portal workspace"><div class="overview-toolbar"><div class="filter-group" role="group" aria-label="Filter portal profiles">${filters.map(f=>`<button class="filter-button ${overviewFilter===f.id?'active':''}" data-filter="${f.id}" aria-pressed="${overviewFilter===f.id}" ${!status.unlocked?'disabled title="Unlock your vault to filter profiles"':''}>${f.label}</button>`).join('')}</div><button class="sort-button" data-action="sort-profiles" ${!status.unlocked||profiles.length<2?'disabled':''} aria-label="Sort: ${sortDescending?'Z–A':'A–Z'} (portal profiles, ${sortDescending?'descending':'ascending'})">${icon('flow',14)} Sort: ${sortDescending?'Z–A':'A–Z'}</button></div>
    <div class="workspace-list"><div class="list-heading"><div><span class="list-heading-icon">${icon('globe',17)}</span><div><strong>${status.unlocked&&profiles.length?'Your portal profiles':'Get started with GhostState'}</strong><small>${status.unlocked&&profiles.length?'Manage your saved sign-ins':'A few simple steps to a private workspace'}</small></div></div><button class="btn small" data-action="add-profile">${icon('plus',14)} Add portal</button></div><div class="overview-rows" aria-live="polite">${rows}</div></div>
  </section><aside class="workspace-aside" aria-label="More workspace information"><div class="aside-title"><span>At a glance</span><span>YOUR WORKSPACE</span></div>
    <section class="card aside-card"><div class="aside-card-label">${icon('device',15)} COMPANION <span class="aside-status ${native.connected?'connected':''}"><i class="dot ${native.connected?'good':''}"></i>${native.connected?'Connected':'Offline'}</span></div><h3>${native.connected?'Companion connected':'Connect a nearby device'}</h3><p>${native.connected?'Pair explicitly and compare verification codes before sharing a credential.':'Use the local companion for an explicitly approved credential transfer. No cookies or active sessions are copied.'}</p><button class="aside-action" data-screen="devices">Manage devices ${icon('arrow',13)}</button></section>
    <section class="card aside-card activity-summary"><div class="aside-card-label">${icon('activity',15)} RECENT ACTIVITY</div>${status.unlocked&&events.length?`<div class="summary-events">${activityRows(events.slice(0,2))}</div>`:`<h3>${status.unlocked?'Nothing to show yet':'Activity stays private'}</h3><p>${status.unlocked?'Optional activity logging records authorized operations, not your browsing history.':'Unlock your vault to view the optional encrypted activity log.'}</p>`}<button class="aside-action" data-screen="activity">View activity ${icon('arrow',13)}</button></section>
    <div class="aside-caption">${icon('shield',14)} Your sign-ins. Your control.</div></aside></div>`;
}
function welcome() { return `${header('A little more control,\nfor every sign-in.','Three simple steps to a more private workflow.',status.unlocked?btn('add-profile','Add a portal','plus','primary'):btn('unlock',status.initialized?'Unlock vault':'Create your vault','arrow','primary'),'WELCOME TO GHOSTSTATE')}
  <div class="split"><div class="card panel"><h2>Start with your vault</h2><p>Your vault is protected with a master passphrase that never leaves this device. Choose a long, unique passphrase and keep it somewhere safe.</p><div class="steps"><div class="step"><div class="step-number">1</div><div><strong>Create a private vault</strong><p>Set a master passphrase. It is not stored or recoverable by us.</p></div></div><div class="step"><div class="step-number">2</div><div><strong>Add a portal profile</strong><p>Save the exact site origin and credentials you want to use.</p></div></div><div class="step"><div class="step-number">3</div><div><strong>Teach the sign-in steps</strong><p>Select your site and capture each form. Approve each fill or opt in to temporary automatic fill.</p></div></div></div></div><div class="card panel"><h2>What GhostState will never do</h2><p>Trust works best when expectations are clear.</p><div class="steps"><div class="step"><div class="assurance-icon">${icon('cloud',16)}</div><div><strong>No cloud sync</strong><p>Your vault is local. Make an encrypted backup if you need one.</p></div></div><div class="step"><div class="assurance-icon">${icon('shield',16)}</div><div><strong>No challenge bypass</strong><p>CAPTCHA, one-time codes, passkeys, and security keys remain yours to complete.</p></div></div><div class="step"><div class="assurance-icon">${icon('check',16)}</div><div><strong>No GhostState form submission</strong><p>Review and submit yourself; websites may still react automatically to filled fields.</p></div></div></div></div></div>`; }
function lockedContent(text:string) { return `<div class="card empty"><div class="empty-icon">${icon('lock',20)}</div><h3>${status.initialized?'Your vault is locked':'Start with a private vault'}</h3><p>${text}</p>${btn('unlock',status.initialized?'Unlock vault':'Create vault','lock','primary')}</div>`; }
function portals() {
  const q = profileSearch.trim().toLocaleLowerCase();
  const matches = profiles.filter(p => !q || `${p.label} ${p.origin}`.toLocaleLowerCase().includes(q));
  return `${header('Portal profiles','Credentials are isolated to the exact site origin you choose.',btn('import-csv','Import CSV','download','')+btn('add-profile','Add portal','plus','primary'),'YOUR VAULT')}${!status.unlocked?lockedContent('Unlock to view or add your locally encrypted portal profiles.'):profiles.length?`<div class="banner">${icon('shield',17)}<div>Passwords stay hidden until you deliberately reveal one and re-enter your master passphrase. Health checks are local and do not check data breaches.</div></div><div class="profile-search"><label for="profile-search">Search profiles by name or site</label><input type="search" id="profile-search" value="${esc(profileSearch)}" placeholder="Search names or websites" maxlength="200"></div>${matches.length?`<div class="list">${matches.map(p=>`<div class="list-row"><div class="list-icon">${icon('globe',18)}</div><div class="list-main"><strong>${esc(p.label)}</strong><small>${esc(p.origin)}</small><small>${p.weakPassword?'Potentially weak password · ':''}${p.reusedPassword?'Password reused in this vault · ':''}${p.stateCount} learned ${p.stateCount===1?'state':'states'}</small></div><div class="row-actions">${btn('learn','Learn','flow','small',`data-id="${esc(p.id)}"`)}${btn('fill','Fill','key','small',`data-id="${esc(p.id)}"`)}${btn('edit-profile','Edit','','small',`data-id="${esc(p.id)}"`)}${btn('reveal-profile','Reveal','','small',`data-id="${esc(p.id)}"`)}${btn('delete-profile','Delete','','small danger',`data-id="${esc(p.id)}"`)}</div></div>`).join('')}</div>`:`<div class="card empty"><h3>No matching profiles</h3><p>Try a different name or website.</p></div>`}`:`<div class="card empty"><div class="empty-icon">${icon('globe',20)}</div><h3>No portal profiles yet</h3><p>Add a site and your credentials to start building a private, site-specific workflow.</p>${btn('add-profile','Add your first portal','plus','primary')}</div>`}`;
}
function workflows() { return `${header('Learned workflows','Recognize the steps of a sign-in, while keeping you in control.',btn('select-site','Choose a site','globe',''),'AUTHENTICATION')}${!status.unlocked?lockedContent('Unlock to see and manage the workflows protected in your vault.'):`<div class="banner ${target?'':'warn'}">${icon(target?'globe':'info',17)}<div>${target?`Selected site: <strong>${esc(target.origin)}</strong>. Capture each new screen after navigating or submitting manually.`:'Select a site with the GhostState toolbar button, or choose one here. Only that exact origin can receive its credentials.'}</div></div>${autoStatus?`<div class="banner warn">${icon('warning',17)}<div>Temporary automatic fill is on for <strong>${esc(autoStatus.origin)}</strong>, this selected tab only, until ${esc(new Date(autoStatus.expiresAt).toLocaleTimeString())}. Return to that tab; GhostState never submits the form.</div>${btn('auto-disable','Turn off','','small')}</div>`:`<div class="banner">${icon('info',17)}<div>Automatic filling is off by default. You may enable it for one learned profile and selected tab for up to 10 minutes. A compromised site can read anything filled.</div></div>`}${profiles.length?`<div class="list">${profiles.map(p=>`<div class="list-row"><div class="list-icon">${icon('flow',19)}</div><div class="list-main"><strong>${esc(p.label)}</strong><small>${esc(p.origin)} · ${p.stateCount} ${p.stateCount===1?'state':'states'}${p.workflowVersion?` · v${esc(p.workflowVersion)}`:''}</small></div><span class="pill ${p.stateCount?'green':''}">${p.stateCount?'Learned':'Not learned'}</span><div class="row-actions">${btn('learn',p.stateCount?'Capture next state':'Learn a state','plus','small',`data-id="${esc(p.id)}"`)}${btn('fill','Review & fill','key','small',`data-id="${esc(p.id)}"`)}${p.stateCount?btn('auto-enable',autoStatus?.profileId===p.id?'Restart auto-fill':'Enable auto-fill','','small',`data-id="${esc(p.id)}"`):''}${p.stateCount?btn('workflow-detail','Details','','small',`data-id="${esc(p.id)}"`):''}</div></div>`).join('')}</div>`:`<div class="card empty"><div class="empty-icon">${icon('flow',20)}</div><h3>Teach your first workflow</h3><p>Start by creating a portal profile. You can then capture each sign-in screen without saving its HTML.</p>${btn('add-profile','Add a portal','plus','primary')}</div>`}`}`; }

function devices() {
  const senders = Array.isArray(nativeInfo?.pairings) ? nativeInfo.pairings : [];
  const receiver = nativeInfo?.receiverPairing; const pairings = receiver ? [...senders, receiver] : senders;
  const incoming = Array.isArray(nativeInfo?.incoming) ? nativeInfo.incoming : [];
  const canSend = nativeInfo?.centralSupported === true;
  const canReceive = nativeInfo?.peripheralSupported === true;
  const discoveryDisabled = nativeInfo?.listening || !canSend ? 'disabled title="Stop receiving or refresh companion status"' : '';
  const listenDisabled = senders.length || !canReceive ? 'disabled title="Receiving is unavailable, or sender pairings are active"' : '';
  const connection = native.connected ? `<div class="row-actions">${btn('discover','Discover nearby','bluetooth','small',discoveryDisabled)}${nativeInfo?.listening?btn('stop-listen','Stop discovery','','small'):btn('listen','Make discoverable','device','small',listenDisabled)}${btn('native-status','Refresh','activity','small')}</div>` : `<div class="row-actions">${btn('connect-native','Connect companion','bluetooth','small primary')}${btn('help','Installation help','help','small')}</div>`;
  const platformStatus = native.connected ? (nativeInfo ? `<p class="ble-capability">Companion ${esc(nativeInfo.version || 'unknown version')} · ${esc(nativeInfo.platform || 'unknown platform')} · sender ${canSend?'implemented':'unavailable'} · receiver ${canReceive?'implemented':'unavailable'}. Implementation does not guarantee that this adapter or OS supports it.</p>` : `<p class="ble-capability">Companion status unavailable. Refresh or reconnect before scanning.</p>`) : `<p class="ble-capability">Install the separate companion and register this exact extension ID. See Installation help.</p>`;
  const nearbyList = nearby.length ? `<div class="list">${nearby.map(d=>`<div class="list-row"><div class="list-icon">${icon('bluetooth',17)}</div><div class="list-main"><strong>${esc(d.name||'GhostState device')}</strong><small>${esc(d.id)}</small></div>${btn('pair',senders.some((p:any)=>p.peerId===d.id)?'Already paired':'Pair','','small',`data-id="${esc(d.id)}" ${senders.some((p:any)=>p.peerId===d.id)?'disabled':''}`)}</div>`).join('')}</div>` : `<div class="empty-activity"><div class="empty-icon">${icon('device',20)}</div><strong>No nearby devices listed</strong><p>${native.connected?'Make a second device discoverable, then scan nearby.':'Connect your companion to start discovery.'}</p></div>`;
  const pairPanels = pairings.map((pairing:any)=>{const id=pairing.role==='sender'?String(pairing.peerId):'';const attr=id?`data-id="${esc(id)}"`:'';return `<div class="card panel" style="margin-top:15px"><div class="panel-head"><div><h2>${pairing.verified?'Verified device':'Verify this pairing'}</h2><p>${pairing.verified?'This verified connection is temporary and will expire.':'Compare all eight digits on both devices in person or over a trusted channel.'}${id?` Recipient: ${esc(id)}.`:' Receiving device.'}</p></div><span class="pill ${pairing.verified?'green':''}">${pairing.verified?'Verified':'Confirmation required'}</span></div><div class="setting-row"><div><strong>Verification code</strong><p>Peer key fingerprint: ${esc(pairing.peerFingerprint)}</p></div><strong style="font-size:25px;letter-spacing:.12em;color:var(--accent)">${esc(pairing.code)}</strong></div><div class="row-actions">${!pairing.verified?btn('confirm-pair',pairing.localConfirmed?'Check other device':'Codes match — confirm','check','small primary',attr):''}${pairing.verified && pairing.role==='sender'?btn('send-profile','Send a credential','key','small primary',attr):''}${btn('cancel-pair','End pairing','','small',attr)}</div>${pairing.localConfirmed&&!pairing.verified?'<p>Waiting for the other device. Confirm there, then check again.</p>':''}</div>`;}).join('');
  const transfers = incoming.length ? `<div class="card panel"><h2>Incoming transfers</h2><p>Nothing is saved until you explicitly accept it. Grants expire quickly.</p><div class="list">${incoming.map((g:any)=>`<div class="list-row"><div class="list-icon">${icon('key',18)}</div><div class="list-main"><strong>${esc(g.origin)}</strong><small>Credential-assisted sign-in · expires ${esc(new Date(g.expires*1000).toLocaleTimeString())}</small></div>${btn('accept-transfer','Review','','small primary',`data-id="${esc(g.id)}"`)}${btn('reject-transfer','Reject','','small danger',`data-id="${esc(g.id)}"`)}</div>`).join('')}</div></div>` : '';
  return `${header('Devices & transfer','Pair nearby devices and approve a credential-assisted sign-in.',native.connected?btn('disconnect-native','Disconnect','close',''):btn('connect-native','Connect companion','bluetooth','primary'),'PROXIMITY BRIDGE')}
  <div class="banner warn">${icon('info',17)}<div><strong>Experimental Bluetooth:</strong> compare all eight digits separately with each recipient and approve every transfer. Windows and Linux receiver implementations and all physical radio paths are untested. Android and iPhone companion apps are not included. Use synthetic credentials only.</div></div><div class="split"><div class="card panel"><div class="panel-head"><div><h2>Companion connection</h2><p>The native helper provides local Bluetooth access and requires a separate installation. ${!native.connected?'Connect to check this device’s capabilities.':nativeInfo?.listening?'Discovery is active for up to five minutes; radio visibility depends on your adapter.':`${senders.length} of ${esc(nativeInfo?.connectionLimit||8)} sender connections active.`}</p></div><span class="pill ${native.connected?'green':''}">${native.connected?'Connected':'Not connected'}</span></div>${platformStatus}${connection}</div><div class="card panel"><h2>Nearby devices</h2><p>Only devices advertising the GhostState service are listed. Names and addresses are not identity verification.</p>${nearbyList}</div></div>${pairPanels}${transfers?`<div style="margin-top:15px">${transfers}</div>`:''}`;
}

function activity() { return `${header('Activity & security log','A local record of actions you explicitly authorize.',status.unlocked&&events.length?btn('clear-events','Clear activity','',''): '','YOUR HISTORY')}${!status.unlocked?lockedContent('Your activity log is encrypted with your vault and is only visible while unlocked.'):events.length?`<div class="card panel"><div class="events">${activityRows(events)}</div></div>`:`<div class="card empty"><div class="empty-icon">${icon('activity',20)}</div><h3>Nothing to show yet</h3><p>Profile and workflow actions appear here if activity logging is enabled. We do not record browsing history.</p></div>`}`; }
function security() { return `${header('Privacy & security','Make your local workspace work the way you want.','','YOUR PREFERENCES')}${!status.unlocked?lockedContent('Unlock to change vault settings or manage an encrypted backup.'): `<div class="card panel"><h2>Vault protection</h2><p>Your master passphrase is never stored. Locking clears the in-memory key.</p><div class="setting-row"><div><strong>Automatic lock</strong><p>Lock after a period of inactivity. Browser worker suspension may lock it sooner.</p></div><select id="auto-lock" aria-label="Automatic lock timeout"><option value="1">1 minute</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option></select></div><div class="setting-row"><div><strong>Activity log</strong><p>Optional, off by default. Record authorized operations inside the encrypted vault; never page content.</p></div><label><input id="logging" type="checkbox" aria-label="Enable activity logging"> Enabled</label></div><div class="setting-row"><div><strong>Offline password health</strong><p>${profiles.filter(p=>p.weakPassword).length} potentially weak and ${profiles.filter(p=>p.reusedPassword).length} reused profile(s). This basic local check cannot detect breaches or guarantee strength.</p></div></div><div class="setting-row"><div><strong>Lock vault now</strong><p>Clear the in-memory encryption key.</p></div>${btn('lock','Lock vault','lock','small')}</div><div class="setting-row"><div><strong>Selected-site access</strong><p>${target?`Currently ${esc(target.origin)}. Revocation removes browser access for that host.`:'No site currently selected. Manage other grants in your browser’s extension settings.'}</p></div>${btn('revoke-site','Revoke selected site','','small',target&&ext?'':'disabled')}</div></div><div class="card panel"><h2>Backup & recovery</h2><p>Backups are encrypted, but protect the file. You will still need your master passphrase to restore it. A forgotten passphrase cannot be recovered.</p><div class="row-actions">${btn('export','Export encrypted backup','download','small')}${btn('restore-info','Restore a backup','','small')}${btn('cloud-info','Cloud backup guidance','cloud','small')}${btn('reset','Delete this vault','','small danger')}</div></div>`}`; }
function compatibility() { return `${header('Browser compatibility','One local workspace, with capabilities that vary by platform.','','PLATFORM SUPPORT')}<div class="card panel"><h2>Extension support</h2><p>Package and test in your own browser before relying on it. See installation documentation for exact steps.</p><div class="table-scroll" role="region" tabindex="0" aria-label="Browser compatibility table, scroll horizontally if needed"><table class="table"><thead><tr><th>Browser</th><th>Extension</th><th>Companion</th></tr></thead><tbody><tr><td><strong>Chromium family</strong><br>Chrome, Edge, Brave, Opera</td><td>Manifest V3 build; per-site permission</td><td>Native messaging requires a local host registration.</td></tr><tr><td><strong>Firefox</strong></td><td>Separate MV3 manifest; verify on target version</td><td>Separate host manifest and fixed add-on ID required.</td></tr><tr><td><strong>Safari on macOS</strong></td><td>Requires Xcode conversion and a containing app</td><td>Safari uses an app extension handler, not Chrome native messaging.</td></tr><tr><td><strong>Android & iPhone</strong></td><td>The standard mobile Chrome apps do not install this desktop Chrome extension.</td><td>No Android or iPhone GhostState companion app is included.</td></tr><tr><td><strong>Mobile captive portals</strong></td><td>Not supported in OS captive-portal mini-browsers</td><td>Open a normal supported browser where possible.</td></tr></tbody></table></div></div>`; }
function help() { return `${header('Help & troubleshooting','The details you need, right when you need them.','','HERE TO HELP')}<div class="split"><div class="card panel"><h2>Getting started</h2><div class="steps"><div class="step"><div class="step-number">1</div><div><strong>Install the browser extension</strong><p>Load the desktop browser extension using the separate developer guide. The dashboard opens directly in the browser.</p></div></div><div class="step"><div class="step-number">2</div><div><strong>Select the site you trust</strong><p>On the sign-in page, click the GhostState toolbar icon and choose “Use this site.” Allow access to that site when asked.</p></div></div><div class="step"><div class="step-number">3</div><div><strong>Capture, then fill</strong><p>Add a profile with the exact origin. Capture each sign-in screen, review the mappings, then approve filling. Submit manually.</p></div></div></div></div><div class="card panel"><h2>When something changes</h2><div class="steps"><div class="step"><div class="assurance-icon">${icon('warning',16)}</div><div><strong>Page not recognized?</strong><p>Website changes can alter the structure. Take over manually, then capture the new screen.</p></div></div><div class="step"><div class="assurance-icon">${icon('shield',16)}</div><div><strong>Challenge detected?</strong><p>Complete OTP, CAPTCHA, passkeys, and security questions yourself. The assistant will not solve them.</p></div></div><div class="step"><div class="assurance-icon">${icon('key',16)}</div><div><strong>Forgot the passphrase?</strong><p>There is no recovery service. Restore an encrypted backup only if you still know its passphrase; otherwise reset the vault.</p></div></div></div></div></div><div class="card panel" style="margin-top:16px"><h2>Bluetooth setup & limits</h2><p>The Bluetooth companion is a separate local program. Install it, register the extension ID shown below, restart the browser, then choose <strong>Devices &amp; transfer → Connect companion</strong> and grant the optional permission. Keep the dashboard used to connect open during nearby transfers; closing it may disconnect the companion.</p><p>${ext?`This installation’s extension ID: <code class="extension-id">${esc(api!.runtime.id)}</code>`:'Load the extension to see its ID.'} A store installation may have a different ID from an unpacked test installation. Register the ID of the one you actually use.</p><p>Windows and Linux sender/receiver code is experimental; real radios have not been tested. macOS has sender code only. Android and iPhone apps are not included. Discovery and pairing exchange Bluetooth identifiers and handshake data. A credential is sent only after you verify a peer and approve the transfer.</p><p>If the host is not found, check the companion installation, the exact extension ID and your browser's native-messaging registration; then restart the browser. If discovery fails, check that Bluetooth is on and both adapters support the required roles. Consult the separate developer guide for platform-specific steps.</p></div>`; }
function render() { const body = ({overview,welcome,portals,workflows,devices,activity,security,compatibility,help})[screen](); app.innerHTML = shell(body); document.title = `${labels[screen]} — GhostState`; if (screen==='security'&&status.unlocked) void loadSettings(); }
async function loadSettings() { try { const s = await call<{autoLockMinutes:number;logging:boolean}>('GET_SETTINGS'); const select=document.querySelector<HTMLSelectElement>('#auto-lock'); const checkbox=document.querySelector<HTMLInputElement>('#logging'); if (select && checkbox) { select.value=String(s.autoLockMinutes); checkbox.checked=s.logging; } } catch {} }

function modal(title:string,body:string,options:{wide?:boolean}={}) {
  const backdrop=document.createElement('div'); backdrop.className='dialog-backdrop';
  backdrop.innerHTML=`<section class="dialog ${options.wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="close" aria-label="Close dialog">${icon('close',19)}</button></div>${body}<div class="error" role="alert"></div></section>`;
  const previous = document.activeElement as HTMLElement | null;
  app.inert = true;
  let closed=false; const close=()=>{if(closed)return;closed=true;document.removeEventListener('keydown',key);backdrop.remove();app.inert=false;previous?.focus();};
  const key=(e:KeyboardEvent)=>{ if(e.key==='Escape'){close();return;} if(e.key==='Tab'){ const nodes=Array.from(backdrop.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])')).filter(el=>el.getClientRects().length>0); if(!nodes.length)return; const first=nodes[0], last=nodes[nodes.length-1]; if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();} else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();} } };
  document.body.append(backdrop);
  backdrop.querySelector('.close')!.addEventListener('click',close);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)close();});
  document.addEventListener('keydown',key);
  // Focus before returning from the opening event. A deferred focus could steal
  // typing from another field and place sensitive text into the profile name.
  (backdrop.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled)') || backdrop.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
  return { root:backdrop, close, error:(s:string)=>{backdrop.querySelector<HTMLElement>('.error')!.textContent=s;} };
}
function bindForm(m:ReturnType<typeof modal>, run:(data:FormData)=>Promise<void>) {
  const form=m.root.querySelector<HTMLFormElement>('form')!;
  form.addEventListener('submit',async e=>{e.preventDefault(); const button=form.querySelector<HTMLButtonElement>('[type=submit]'); if(button)button.disabled=true; m.error(''); try{await run(new FormData(form));m.close();await refresh();}catch(err){if(m.root.isConnected)m.error(err instanceof Error?err.message:'Could not complete this action.');else toast('Action completed, but the workspace could not refresh. Reload to check its state.');}finally{if(button)button.disabled=false;}});
}
function unlockDialog() {
  if (status.unlocked) { toast('Your vault is already unlocked.'); return; }
  const setup=!status.initialized;
  const m=modal(setup?'Create your vault':'Unlock your vault',`<p>${setup?'Choose a unique passphrase of at least 12 characters. It never leaves your device and cannot be recovered if forgotten.':'Enter your master passphrase to access your local vault.'}</p><form><div class="field"><label for="passphrase">Master passphrase</label><input id="passphrase" name="passphrase" type="password" autocomplete="off" minlength="${setup?12:1}" maxlength="1024" required placeholder="${setup?'At least 12 characters':'Enter your passphrase'}"></div>${setup?'<div class="field"><label for="confirm-pass">Confirm passphrase</label><input id="confirm-pass" name="confirm" type="password" autocomplete="off" required placeholder="Repeat your passphrase"></div>':''}<div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">${setup?'Create vault':'Unlock vault'} ${icon('arrow',15)}</button></div></form>${setup?'<p>Have an encrypted backup? <a href="#" class="restore-link">Restore it instead</a>.</p>':''}`);
  m.root.querySelector('.cancel')!.addEventListener('click',m.close);
  m.root.querySelector('.restore-link')?.addEventListener('click',e=>{e.preventDefault();m.close();restoreDialog();});
  bindForm(m,async d=>{const pass=String(d.get('passphrase')||'');if(setup&&pass!==String(d.get('confirm')))throw new Error('Passphrases do not match.');await call(setup?'SETUP':'UNLOCK',{passphrase:pass});toast(setup?'Your encrypted vault is ready.':'Vault unlocked.');});
}
function profileDialog(id?:string) {
  if(!status.unlocked){unlockDialog();return;}
  const p=id?getProfile(id):null;
  const m=modal(p?'Edit portal':'Add a portal',`<p>${p?'Leave username or password blank to keep the current value. Changing the site clears the learned workflow; it does not change your password at the website.':'Save credentials for one exact origin. They are stored encrypted on this device; GhostState fills only the exact site you select.'}</p><form><div class="field"><label for="label">Profile name</label><input id="label" name="label" maxlength="80" required placeholder="e.g. University portal" value="${esc(p?.label||'')}"></div><div class="field"><label for="url">Site URL</label><input id="url" name="url" type="url" maxlength="2048" required placeholder="https://portal.example" value="${esc(p?.origin||target?.origin||'')}"><small>HTTPS only; the scheme, hostname, and port must match exactly.</small></div><div class="field"><label for="username">${p?'New username or email (optional)':'Username or email'}</label><input id="username" name="username" maxlength="512" ${p?'':'required'} autocomplete="off" placeholder="${p?'Leave blank to keep current':'Your username'}"></div><div class="field"><label for="password">${p?'New password (optional)':'Password'}</label><input id="password" name="password" type="password" maxlength="4096" ${p?'':'required'} autocomplete="new-password" placeholder="${p?'Leave blank to keep current':'Your password'}"><label class="check-line"><input type="checkbox" id="show-generated"> Show the password being entered</label></div><details class="generator"><summary>Generate a password locally</summary><p>Longer passwords and more character sets are generally harder to guess. Change it on the website too; saving here alone does not update the site.</p><div class="generator-options"><label for="gen-length">Length</label><input id="gen-length" type="number" min="12" max="128" value="20"><label><input id="gen-lower" type="checkbox" checked> Lowercase</label><label><input id="gen-upper" type="checkbox" checked> Uppercase</label><label><input id="gen-numbers" type="checkbox" checked> Numbers</label><label><input id="gen-symbols" type="checkbox" checked> Symbols</label></div><button type="button" class="btn small" id="generate-password">Generate password</button></details>${p?'<div class="field"><label for="edit-pass">Confirm master passphrase</label><input id="edit-pass" name="master" type="password" autocomplete="off" required></div>':''}<div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button class="btn primary" type="submit">${p?'Save profile changes':'Save encrypted profile'} ${icon('arrow',15)}</button></div></form>`);
  m.root.querySelector('.cancel')!.addEventListener('click',m.close);
  const password=m.root.querySelector<HTMLInputElement>('#password')!;
  m.root.querySelector<HTMLInputElement>('#show-generated')!.addEventListener('change',e=>{password.type=(e.target as HTMLInputElement).checked?'text':'password';});
  m.root.querySelector<HTMLButtonElement>('#generate-password')!.addEventListener('click',()=>{try { password.value=generatePassword({length:Number(m.root.querySelector<HTMLInputElement>('#gen-length')!.value),lowercase:m.root.querySelector<HTMLInputElement>('#gen-lower')!.checked,uppercase:m.root.querySelector<HTMLInputElement>('#gen-upper')!.checked,numbers:m.root.querySelector<HTMLInputElement>('#gen-numbers')!.checked,symbols:m.root.querySelector<HTMLInputElement>('#gen-symbols')!.checked});m.error('');toast('New password generated locally.'); } catch(e) {m.error(e instanceof Error?e.message:'Could not generate a password.');}});
  bindForm(m,async d=>{const fields={label:String(d.get('label')),url:String(d.get('url')),username:String(d.get('username')),password:String(d.get('password'))};if(p){await call('UPDATE_PROFILE',{id:p.id,...fields,passphrase:String(d.get('master'))});toast('Profile updated locally.');}else{await call('ADD_PROFILE',fields);toast('Portal profile saved locally.');}});
}
function revealProfileDialog(id:string) {
  if(!status.unlocked){unlockDialog();return;} const p=getProfile(id);
  const m=modal('Confirm before revealing',`<p>Re-enter your master passphrase to show the credential for <strong>${esc(p.label)}</strong>. Others who can see your screen or clipboard may be able to read it.</p><form><div class="field"><label for="reveal-pass">Master passphrase</label><input id="reveal-pass" name="passphrase" type="password" autocomplete="off" required maxlength="1024"></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Reveal credential</button></div></form>`);
  m.root.querySelector('.cancel')!.addEventListener('click',m.close);
  m.root.querySelector<HTMLFormElement>('form')!.addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget as HTMLFormElement;const button=form.querySelector<HTMLButtonElement>('[type=submit]')!;button.disabled=true;m.error('');
    try {const secret=await call<{username:string;password:string}>('REVEAL_PROFILE',{id,passphrase:String(new FormData(form).get('passphrase'))});const live=await call<Status>('STATUS');if(!live.unlocked)throw new Error('Vault is locked.');m.close();
      const result=modal('Revealed credential',`<p>For <strong>${esc(p.label)}</strong> · ${esc(p.origin)}. This view closes after 30 seconds or when the vault locks.</p><div class="field"><label for="revealed-username">Username</label><input id="revealed-username" readonly></div><div class="field"><label for="revealed-password">Password</label><input id="revealed-password" readonly></div><p>Copying uses the system clipboard, which other applications or clipboard history may retain.</p><div class="dialog-actions"><button type="button" class="btn copy-secret">Copy password</button><button type="button" class="btn primary done-secret">Done</button></div>`);
      result.root.querySelector<HTMLInputElement>('#revealed-username')!.value=secret.username;result.root.querySelector<HTMLInputElement>('#revealed-password')!.value=secret.password;
      result.root.querySelector('.done-secret')!.addEventListener('click',result.close);result.root.querySelector('.copy-secret')!.addEventListener('click',()=>{if(!navigator.clipboard?.writeText){result.error('Clipboard unavailable. Select the password and copy it manually.');return;}void navigator.clipboard.writeText(secret.password).then(()=>toast('Copied. Clipboard history may retain it.'),()=>result.error('Clipboard unavailable. Select the password and copy it manually.'));});
      const deadline=Date.now()+30_000;const timer=setInterval(()=>{if(!result.root.isConnected){clearInterval(timer);return;}if(Date.now()>=deadline){result.close();clearInterval(timer);return;}void call<Status>('STATUS').then(s=>{if(!s.unlocked){result.close();clearInterval(timer);}}).catch(()=>{result.close();clearInterval(timer);});},1000);
    }catch(err){m.error(err instanceof Error?err.message:'Could not reveal credential.');button.disabled=false;}
  });
}

function importCsvDialog() {
  if(!status.unlocked){unlockDialog();return;}
  const m=modal('Import login CSV',`<p>Choose a standard CSV with <strong>url, username, password</strong> columns (name is optional), or a Bitwarden CSV export. This reads the file locally; nothing is uploaded.</p><div class="banner warn">${icon('warning',17)}<div>CSV exports are usually unencrypted: anyone with the file can read them. Notes, one-time codes/seeds, passkeys and other fields are not imported. Afterward, remove the plaintext file safely.</div></div><form><div class="field"><label for="import-file">CSV file (up to 2 MB)</label><input type="file" id="import-file" name="file" accept=".csv,text/csv" required></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Review logins</button></div></form>`);
  m.root.querySelector('.cancel')!.addEventListener('click',m.close);
  m.root.querySelector<HTMLFormElement>('form')!.addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget as HTMLFormElement;const button=form.querySelector<HTMLButtonElement>('[type=submit]')!;button.disabled=true;m.error('');
    try {const file=new FormData(form).get('file');if(!(file instanceof File)||file.size>2_000_000)throw new Error('Choose a CSV under 2 MB.');const preview=readLoginCsv(await file.text());m.close();
      const review=modal('Review CSV import',`<p>${preview.records.length} supported login(s) found; ${preview.skipped} unsupported or incomplete row(s) skipped. Existing exact origin-and-username duplicates will be skipped; passwords are not shown here. URL paths are discarded. Imported profiles have no learned steps.</p><div class="import-preview">${preview.records.map(r=>`<div><strong>${esc(r.label)}</strong><small>${esc(r.url)}</small></div>`).join('')}</div>${preview.skipped?`<details><summary>Why some rows were skipped</summary><ul>${preview.skippedRows.slice(0,50).map(r=>`<li>Row ${r.row}: ${esc(r.reason)}</li>`).join('')}</ul>${preview.skipped>50?'<p>Only the first 50 skipped rows are shown.</p>':''}</details>`:''}<form><div class="field"><label for="import-pass">Confirm master passphrase</label><input type="password" id="import-pass" name="passphrase" autocomplete="off" maxlength="1024" required></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Import into vault</button></div></form>`,{wide:true});
      review.root.querySelector('.cancel')!.addEventListener('click',review.close);
      bindForm(review,async d=>{const result=await call<{imported:number;duplicates:number}>('IMPORT_PROFILES',{records:preview.records,passphrase:String(d.get('passphrase'))});toast(`${result.imported} login(s) imported; ${result.duplicates} duplicate(s) skipped.`);});
    }catch(err){m.error(err instanceof Error?err.message:'Could not read the CSV.');button.disabled=false;}
  });
}
function confirmDialog(title:string,message:string,yes:string,fn:()=>Promise<void>,danger=false) {
  const m=modal(title,`<p>${esc(message)}</p><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="button" class="btn ${danger?'danger':'primary'} accept">${esc(yes)}</button></div>`);
  m.root.querySelector('.cancel')!.addEventListener('click',m.close); const button=m.root.querySelector<HTMLButtonElement>('.accept')!;
  button.addEventListener('click',async()=>{button.disabled=true;try{await fn();m.close();await refresh();}catch(e){m.error(e instanceof Error?e.message:'Action failed.');button.disabled=false;}});
}
function restoreDialog() {
  if(status.initialized){toast('Reset the existing vault before restoring a backup.');return;}
  const m=modal('Restore an encrypted backup',`<p>Select a GhostState backup and enter the master passphrase used when it was created. No data leaves this device.</p><form><div class="field"><label for="backup">Encrypted backup file</label><input id="backup" name="backup" type="file" accept="application/json,.json" required></div><div class="field"><label for="restore-pass">Master passphrase</label><input id="restore-pass" name="passphrase" type="password" required autocomplete="off"></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Restore vault</button></div></form>`);m.root.querySelector('.cancel')!.addEventListener('click',m.close);
  bindForm(m,async d=>{const file=d.get('backup');if(!(file instanceof File)||file.size>10_000_000)throw new Error('Choose a valid backup under 10 MB.');await call('RESTORE',{backup:await file.text(),passphrase:String(d.get('passphrase'))});toast('Encrypted vault restored.');});
}
function selectSiteDialog() {
  if(!ext){toast('Install the browser extension to select and scan a site.');return;}
  const m=modal('Choose a site',`<p>Enter the site origin to grant access. If the site is already open, GhostState will select its tab; otherwise it opens one in the background. You can also use the toolbar button while on the site.</p><form><div class="field"><label for="site-url">Site URL</label><input id="site-url" name="url" type="url" required placeholder="https://portal.example"><small>The browser permission covers the host; GhostState separately enforces the exact origin including its port.</small></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Allow & select site</button></div></form>`); m.root.querySelector('.cancel')!.addEventListener('click',m.close);
  bindForm(m,async d=>{
    const origin=canonicalOrigin(String(d.get('url'))); const u=new URL(origin); const pattern=`${u.protocol}//${u.hostname}/*`;
    const granted=await api!.permissions.request({origins:[pattern]}); if(!granted)throw new Error('Site permission was not granted.');
    const tabs=await api!.tabs.query({}); let tab=tabs.find(t=>{try{return !!t.url&&canonicalOrigin(t.url)===origin;}catch{return false;}});
    if(!tab)tab=await api!.tabs.create({url:origin,active:false}); if(!tab.id)throw new Error('Could not select that tab.');
    await call('SELECT_TAB',{tabId:tab.id,origin});toast(`Selected ${origin}.`);
  });
}
function getProfile(id:string) { const p=profiles.find(p=>p.id===id); if(!p)throw new Error('Profile not found.');return p; }
async function learnDialog(id:string) {
  if(!status.unlocked){unlockDialog();return;} const p=getProfile(id); if(!target){selectSiteDialog();return;} if(target.origin!==p.origin)throw new Error('The selected tab is not the exact origin of this profile.');
  const snap=await call<Snapshot>('SCAN');
  if(snap.challenges.length) throw new Error(`Complete ${snap.challenges.join(', ')} manually before capturing this state.`);
  const inputs=snap.nodes.filter(n=>n.tag==='input' && ['text','email','password','search','url'].includes(n.type) && !n.autocomplete.includes('new-password') && !n.autocomplete.includes('one-time-code') && !n.autocomplete.includes('webauthn'));
  if(!inputs.length)throw new Error('No eligible visible username or password fields were found on the selected page.');
  const m=modal('Review this sign-in step',`<p>Map the fields on <strong>${esc(p.origin)}</strong>. Only the structural path and your mapping are saved, never page text, HTML, or field values.</p><form><div>${inputs.map((n,i)=>`<div class="mapping-row"><div><strong>${esc(n.type==='password'?'Password field':n.type==='email'?'Email field':'Text field')} ${i+1}</strong><small>${esc(n.path)}</small></div><select aria-label="Mapping for field ${i+1}" name="field-${i}"><option value="">Do not fill</option>${n.type!=='password'?`<option value="username" ${n.suggested==='username'?'selected':''}>Username</option>`:''}${n.type==='password'?`<option value="password" ${n.suggested==='password'?'selected':''}>Password</option>`:''}</select></div>`).join('')}</div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Save this state</button></div></form>`,{wide:true});
  m.root.querySelector('.cancel')!.addEventListener('click',m.close);
  bindForm(m,async d=>{const mappings:FieldMapping[]=inputs.flatMap((n,i)=>{const kind=String(d.get(`field-${i}`));return kind==='username'||kind==='password'?[{path:n.path,kind}]:[];});if(!mappings.length)throw new Error('Choose at least one field to fill.');await call('RECORD_STATE',{id,mappings,fingerprint:snap.fingerprint});toast('Workflow state saved. Continue to the next screen manually.');});
}
async function fillDialog(id:string) {
  if(!status.unlocked){unlockDialog();return;} const p=getProfile(id); if(!target){selectSiteDialog();return;} if(target.origin!==p.origin)throw new Error('Selected site and profile origin do not match. No credentials were released.');
  const [snap,w]=await Promise.all([call<Snapshot>('SCAN'),call<Workflow|null>('GET_WORKFLOW',{id})]); if(!w)throw new Error('Capture a workflow state first.');
  if(snap.challenges.length)throw new Error(`Complete ${snap.challenges.join(', ')} manually. GhostState will not fill this screen.`);
  const matched=w.states.find(s=>s.fingerprint===snap.fingerprint);if(!matched)throw new Error('The current screen does not match a learned state. Take over manually or capture the changed screen.');
  const kinds=[...new Set(matched.mappings.map(m=>m.kind))].join(' and ');
  confirmDialog('Approve this fill?',`Fill ${kinds} for “${p.label}” on ${p.origin}? GhostState will not submit the form. Review the page before continuing.`,'Fill this step',async()=>{const r=await call<{logFailed?:boolean}>('FILL_STATE',{id});toast(r.logFailed?'Fields filled, but activity could not be recorded. Review and submit manually.':'Fields filled. Review and submit the form yourself.');});
}
async function workflowDetail(id:string) {
  const p=getProfile(id),w=await call<Workflow|null>('GET_WORKFLOW',{id}); if(!w)throw new Error('No workflow recorded.');
  const m=modal('Workflow details',`<p><strong>${esc(p.label)}</strong> · ${esc(p.origin)} · version ${esc(w.version)}</p><div class="list">${w.states.map((s,i)=>`<div class="list-row"><div class="step-number">${i+1}</div><div class="list-main"><strong>${s.mappings.map(x=>esc(x.kind)).join(' + ')}</strong><small>Fingerprint ${esc(s.fingerprint.slice(0,16))}… · ${s.nodes.length} structural nodes</small></div></div>`).join('')}</div><p>Transitions represent manual submissions or navigation. Unexpected screens pause the workflow.</p><div class="dialog-actions"><button type="button" class="btn danger clear">Remove workflow</button><button type="button" class="btn close-detail">Done</button></div>`,{wide:true});
  m.root.querySelector('.close-detail')!.addEventListener('click',m.close);m.root.querySelector('.clear')!.addEventListener('click',()=>{m.close();confirmDialog('Remove workflow?',`Remove the learned workflow for ${p.label}? Your credentials will remain.`, 'Remove workflow',async()=>{await call('CLEAR_WORKFLOW',{id});toast('Workflow removed.');},true);});
}
function sendProfileDialog(peerId:string) {
  if(!status.unlocked){unlockDialog();return;}
  const pairing=(Array.isArray(nativeInfo?.pairings)?nativeInfo.pairings:[]).find((x:any)=>x.peerId===peerId);
  if(!pairing?.verified || pairing.role!=='sender')throw new Error('Verify this recipient device first.');
  if(!profiles.length)throw new Error('Add a portal profile first.');
  const m=modal('Send an encrypted credential',`<p>Send one credential to <strong>${esc(peerId)}</strong>, verified with code <strong>${esc(pairing.code)}</strong>, for local reauthentication. This is not a session transfer. The recipient must explicitly accept it before it is saved.</p><div class="banner warn">${icon('warning',17)}<div>Only continue if you verified the code with the person holding the receiving device.</div></div><form><div class="field"><label for="transfer-profile">Portal profile</label><select id="transfer-profile" name="profile">${profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.label)} — ${esc(p.origin)}</option>`).join('')}</select><small>Encrypted over Bluetooth; delivery expires in two minutes. Once accepted, the credential remains valid until changed.</small></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Approve & send</button></div></form>`);m.root.querySelector('.cancel')!.addEventListener('click',m.close);
  bindForm(m,async d=>{const p=getProfile(String(d.get('profile')));
    // Firefox treats native credential transfer as optional authentication-info processing outside the add-on.
    const gecko=(api?.runtime.getManifest() as any)?.browser_specific_settings?.gecko;
    if(gecko?.data_collection_permissions){const granted=await api!.permissions.request({data_collection:['authenticationInfo']} as unknown as chrome.permissions.Permissions);if(!granted)throw new Error('Firefox authentication-info permission was not granted.');}
    const r=await call<{logFailed?:boolean}>('NATIVE_SEND_PROFILE',{id:p.id,origin:p.origin,peerId});toast(r.logFailed?'Transfer sent, but activity could not be recorded. Recipient approval is pending.':'Encrypted transfer sent; recipient approval is pending.');});
}
function acceptTransferDialog(id:string) {
  if(!status.unlocked){unlockDialog();return;}
  const grant=nativeInfo?.incoming?.find((g:any)=>g.id===id);if(!grant)throw new Error('Transfer no longer available. Refresh companion status.');
  const m=modal('Accept this credential?',`<p>A verified nearby device sent a credential for <strong>${esc(grant.origin)}</strong>. Accepting adds it to this device’s encrypted vault. You will still sign in locally.</p><form><div class="field"><label for="transfer-label">Profile name</label><input id="transfer-label" name="label" maxlength="80" required placeholder="e.g. Work portal"></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Accept & save locally</button></div></form>`);m.root.querySelector('.cancel')!.addEventListener('click',m.close);
  bindForm(m,async d=>{const gecko=(api?.runtime.getManifest() as any)?.browser_specific_settings?.gecko;
    if(gecko?.data_collection_permissions){const granted=await api!.permissions.request({data_collection:['authenticationInfo']} as unknown as chrome.permissions.Permissions);if(!granted)throw new Error('Firefox authentication-info permission was not granted.');}
    await call('NATIVE_ACCEPT_PROFILE',{id,origin:grant.origin,label:String(d.get('label'))});toast('Credential saved in your local vault.');});
}
async function action(name:string,id?:string) {
  switch(name){
    case 'mobile-more': { mobileMenuOpen=!mobileMenuOpen; render(); app.querySelector<HTMLButtonElement>('[data-action=mobile-more]')?.focus({preventScroll:true}); break; }
    case 'close-mobile-menu': { mobileMenuOpen=false; render(); app.querySelector<HTMLButtonElement>('[data-action=mobile-more]')?.focus({preventScroll:true}); break; }
    case 'theme': { const theme=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=theme;localStorage.setItem('ghoststate-theme',theme);render();app.querySelector<HTMLButtonElement>('[data-action=theme]')?.focus();break; }
    case 'sort-profiles': sortDescending=!sortDescending;render();app.querySelector<HTMLButtonElement>('[data-action=sort-profiles]')?.focus();break;
    case 'welcome': screen='welcome';render();app.querySelector<HTMLElement>('h1')?.focus({preventScroll:true});break;
    case 'help': screen='help';render();app.querySelector<HTMLElement>('h1')?.focus({preventScroll:true});break;
    case 'unlock': unlockDialog();break;
    case 'lock': await call('LOCK');toast('Vault locked.');await refresh();break;
    case 'add-profile':profileDialog();break;
    case 'edit-profile':if(id)profileDialog(id);break;
    case 'import-csv':importCsvDialog();break;
    case 'reveal-profile':if(id)revealProfileDialog(id);break;
    case 'auto-enable': { if(!status.unlocked){unlockDialog();break;} if(!id)break;const p=getProfile(id);if(!ext)throw new Error('Automatic fill requires the installed browser extension.');if(!target || target.origin!==p.origin)throw new Error('Select this exact site and learn a state first.');if(!p.stateCount)throw new Error('Learn a sign-in state first.');confirmDialog('Enable temporary automatic fill?',`For the next 10 minutes, GhostState may fill the learned fields for ${p.label} on ${p.origin} in the selected, focused tab while the vault is unlocked. A compromised site can read filled credentials. It will never submit for you. Turn it off anytime.`, 'Enable for 10 minutes',async()=>{await call('AUTO_ENABLE',{id});toast('Automatic fill enabled. Return to the selected site tab.');});break; }
    case 'auto-disable': await call('AUTO_DISABLE');await refresh();toast('Automatic fill turned off.');break;
    case 'select-site':selectSiteDialog();break;
    case 'learn':if(id)await learnDialog(id);break;
    case 'fill':if(id)await fillDialog(id);break;
    case 'workflow-detail':if(id)await workflowDetail(id);break;
    case 'delete-profile':if(id){const p=getProfile(id);confirmDialog('Delete this profile?',`Delete ${p.label} and its learned workflow? This cannot be undone.`, 'Delete profile',async()=>{await call('DELETE_PROFILE',{id});toast('Profile deleted.');},true);}break;
    case 'clear-events':confirmDialog('Clear activity?', 'Delete all activity entries from this encrypted vault?', 'Clear activity',async()=>{await call('CLEAR_EVENTS');toast('Activity cleared.');},true);break;
    case 'reset':confirmDialog('Delete the entire vault?', 'This permanently removes all local credentials, workflows, and activity. Make an encrypted backup first if you might need them.', 'Delete vault',async()=>{await call('RESET');toast('Local vault deleted.');},true);break;
    case 'revoke-site': {if(!target||!ext)throw new Error('No selected site to revoke.');const origin=target.origin;confirmDialog('Revoke site access?',`Remove the browser permission for ${origin}? Other ports on this host are also covered by the browser permission.`, 'Revoke access',async()=>{const u=new URL(origin);await call('CLEAR_TARGET');const removed=await api!.permissions.remove({origins:[`${u.protocol}//${u.hostname}/*`]});if(!removed)throw new Error('Browser did not revoke this site permission. Check extension settings.');toast('Site access revoked.');},true);break;}
    case 'export': {const data=await call<string>('EXPORT');const a=document.createElement('a');const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.href=url;a.download='ghoststate-encrypted-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('Encrypted backup downloaded.');break;}
    case 'restore-info':toast('Delete the existing vault, then choose “Restore it instead” from vault setup.');break;
    case 'cloud-info': { const m=modal('Store an encrypted backup in the cloud',`<p>GhostState has no cloud sync service. You can choose to store an encrypted backup file with a cloud provider you trust.</p><ol class="plain-steps"><li>Use <strong>Export encrypted backup</strong> and download the file.</li><li>Sign in to your chosen cloud storage and upload that file yourself. Enable its two-factor authentication.</li><li>Keep the original master passphrase somewhere safe, separate from the backup. Without it, the file cannot be restored.</li><li>After changes, export and upload a new dated copy. Backups do not merge or sync automatically. Test restore in a separate vault.</li></ol><p>The provider can see file metadata, and someone with the file can try to guess a weak passphrase offline. See <strong>docs/CLOUD_BACKUP_AND_SYNC.md</strong> for recovery, conflict and architecture details.</p><div class="dialog-actions"><button type="button" class="btn primary done-cloud">Done</button></div>`);m.root.querySelector('.done-cloud')!.addEventListener('click',m.close);break; }
    case 'connect-native': {
      if(!ext)throw new Error('Install the extension and native companion first.');
      if(connectingNative)break;
      connectingNative = true;
      try {
        // This request must run immediately in the user's click gesture.
        const granted=await api!.permissions.request({permissions:['nativeMessaging']});if(!granted)throw new Error('Companion permission was not granted.');
        const connection = await call<{bridgeRequired?:boolean;bridgeToken?:string}>('NATIVE_CONNECT');
        if (connection?.bridgeRequired) {
          if(typeof connection.bridgeToken !== 'string')throw new Error('Could not authorize the local companion bridge.');
          await openNativeBridge(connection.bridgeToken); await call('NATIVE_CONNECT');
        }
        await refresh(); toast('Companion connected.');
      } catch (e) { removeNativeBridge(); throw e; }
      finally { connectingNative = false; }
      break;
    }
    case 'disconnect-native': await call('NATIVE_DISCONNECT');removeNativeBridge();nativeInfo=null;nearby=[];await refresh();toast('Companion disconnected.');break;
    case 'discover': {const r=await call<{devices:{id:string;name:string}[]}>('NATIVE_REQUEST',{op:'discover'});nearby=Array.isArray(r.devices)?r.devices:[];await refresh();toast(nearby.length?`${nearby.length} nearby device(s) found.`:'No nearby GhostState devices found.');break;}
    case 'listen': await call('NATIVE_REQUEST',{op:'listen'});await refresh();toast('Discovery is active for up to five minutes; radio visibility depends on your adapter.');break;
    case 'stop-listen': await call('NATIVE_REQUEST',{op:'stop_listen'});await refresh();toast('Discovery stopped.');break;
    case 'native-status': await refresh();toast('Companion status refreshed.');break;
    case 'pair': if(id){await call('NATIVE_REQUEST',{op:'pair',data:{id}});await refresh();toast('Compare the code on both devices.');}break;
    case 'confirm-pair': {const pair=id?(Array.isArray(nativeInfo?.pairings)?nativeInfo.pairings:[]).find((x:any)=>x.peerId===id):nativeInfo?.receiverPairing;if(!pair)throw new Error('No pairing is active.');confirmDialog('Verify both devices',`Does the other device display all eight digits ${pair.code}? Only confirm if the codes match over a trusted channel.`,pair.localConfirmed?'Check confirmation':'Codes match',async()=>{await call('NATIVE_REQUEST',{op:'confirm_pair',data:id?{peerId:id}:{}});toast('Pairing confirmation sent.');});break;}
    case 'cancel-pair': await call('NATIVE_REQUEST',{op:'cancel_pair',data:id?{peerId:id}:{}});await refresh();toast('Pairing ended.');break;
    case 'send-profile': if(id)sendProfileDialog(id);else throw new Error('Choose a verified recipient.');break;
    case 'accept-transfer': if(id) acceptTransferDialog(id);break;
    case 'reject-transfer': if(id){await call('NATIVE_REQUEST',{op:'reject_transfer',data:{id}});await refresh();toast('Transfer rejected.');}break;
  }
}
app.addEventListener('click',e=>{
  const el=(e.target as HTMLElement).closest<HTMLElement>('[data-screen],[data-action],[data-filter]');if(!el)return;
  const filter=el.dataset.filter as OverviewFilter|undefined;
  if(filter && ['all','learned','unlearned'].includes(filter) && status.unlocked){overviewFilter=filter;render();app.querySelector<HTMLButtonElement>(`[data-filter="${filter}"]`)?.focus();return;}
  const dest=el.dataset.screen as Screen|undefined;
  if(dest&&labels[dest]){mobileMenuOpen=false;screen=dest;render();window.scrollTo(0,0);app.querySelector<HTMLElement>('h1')?.focus({preventScroll:true});return;}
  if(el.dataset.action) {
    const name=el.dataset.action, id=el.dataset.id;
    if(mobileMenuOpen && name!=='mobile-more' && name!=='close-mobile-menu'){mobileMenuOpen=false;render();app.querySelector<HTMLButtonElement>('[data-action=mobile-more]')?.focus({preventScroll:true});}
    void action(name,id).catch(err=>toast(err instanceof Error?err.message:'Action failed.'));
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape' && mobileMenuOpen && !document.querySelector('.dialog-backdrop')){e.preventDefault();mobileMenuOpen=false;render();app.querySelector<HTMLButtonElement>('[data-action=mobile-more]')?.focus({preventScroll:true});}});
// Close the disclosure when a resize/rotation switches to the desktop layout.
const mobileLayout=matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)');
mobileLayout.addEventListener('change',e=>{
  const focused=document.activeElement as HTMLElement|null;
  const inMobile=!!focused?.closest('.mobile-nav-shell');
  const inSidebar=!!focused?.closest('.side-nav, .sidebar-bottom');
  if(!e.matches && mobileMenuOpen){mobileMenuOpen=false;render();}
  if(document.querySelector('.dialog-backdrop'))return;
  if(e.matches && inSidebar){
    const target=moreScreens.includes(screen)?'[data-action=mobile-more]':`.mobile-nav [data-screen="${screen}"]`;
    app.querySelector<HTMLElement>(target)?.focus({preventScroll:true});
  } else if(!e.matches && inMobile){app.querySelector<HTMLElement>(`.nav-button[data-screen="${screen}"]`)?.focus({preventScroll:true});}
});
app.addEventListener('input',e=>{const el=e.target as HTMLInputElement;if(el.id==='profile-search'){const pos=el.selectionStart;profileSearch=el.value;render();const next=app.querySelector<HTMLInputElement>('#profile-search');next?.focus();if(pos!==null)next?.setSelectionRange(pos,pos);}});
app.addEventListener('change',e=>{const el=e.target as HTMLInputElement|HTMLSelectElement;if(el.id==='auto-lock'||el.id==='logging'){const minutes=Number(document.querySelector<HTMLSelectElement>('#auto-lock')?.value);const logging=!!document.querySelector<HTMLInputElement>('#logging')?.checked;void call('SET_SETTINGS',{minutes,logging}).then(()=>toast('Security settings saved.')).catch(err=>toast(err instanceof Error?err.message:'Could not save settings.'));}});
document.documentElement.dataset.theme=localStorage.getItem('ghoststate-theme')==='dark'?'dark':'light';
void refresh().catch(e=>{app.innerHTML=`<div class="boot">Unable to open local workspace: ${esc(e instanceof Error?e.message:'Unknown error')}</div>`;});
setInterval(()=>{void call<Status>('STATUS').then(async s=>{if(s.unlocked!==status.unlocked||s.initialized!==status.initialized){await refresh();return;}if(screen==='workflows'&&!document.querySelector('.dialog-backdrop')){const next=await call<AutoStatus|null>('AUTO_STATUS');if((next?.expiresAt||0)!==(autoStatus?.expiresAt||0)){autoStatus=next;render();}}}).catch(()=>{});},15000);

// Poll the companion without reading the vault: passive UI refresh must not extend vault inactivity.
// Avoid replacing the focused controls every five seconds when nothing changed.
setInterval(()=>{if(screen==='devices'&&native.connected&&!document.querySelector('.dialog-backdrop'))void call('NATIVE_STATUS').then(async (n:NativeStatus)=>{const info=n.connected?await call('NATIVE_REQUEST',{op:'status'}).catch(()=>null):null;if(JSON.stringify(n)===JSON.stringify(native)&&JSON.stringify(info)===JSON.stringify(nativeInfo))return;const focused=document.activeElement as HTMLElement|null;const action=focused?.dataset.action;const id=focused?.dataset.id;native=n;nativeInfo=info;if(!n.connected)nearby=[];render();if(action){const buttons=Array.from(app.querySelectorAll<HTMLElement>('[data-action]'));buttons.find(b=>b.dataset.action===action&&b.dataset.id===id)?.focus({preventScroll:true});}}).catch(()=>{});},5000);
