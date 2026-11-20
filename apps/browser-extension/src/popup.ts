import { extensionApi as api } from '../../../packages/browser-adapters/src/index';
import { canonicalOrigin } from '../../../packages/shared-types/src/index';
// Extension pages share this non-sensitive appearance preference; no network is used.
document.documentElement.dataset.theme = localStorage.getItem('ghoststate-theme') === 'dark' ? 'dark' : 'light';
const status = document.querySelector<HTMLElement>('#popup-status')!;
const select = document.querySelector<HTMLButtonElement>('#use-site')!;
const open = document.querySelector<HTMLButtonElement>('#open-dashboard')!;
let current: {tabId:number;origin:string}|null = null;
select.disabled = true;
// Resolve the active tab before the click so permissions.request is called in the user gesture.
void api!.tabs.query({active:true,currentWindow:true}).then(([tab]) => {
  if (!tab?.id || !tab.url) throw new Error('Open a supported site and click the toolbar button again.');
  current = {tabId:tab.id,origin:canonicalOrigin(tab.url)}; select.disabled = false;
}).catch(e => { status.textContent = e instanceof Error ? e.message : 'Could not select this site.'; });
select.addEventListener('click', async () => {
  try {
    if (!current) throw new Error('Open a supported site first.');
    const {tabId,origin} = current; const u = new URL(origin);
    const granted = await api!.permissions.request({origins:[`${u.protocol}//${u.hostname}/*`]}); if (!granted) throw new Error('Site access was not granted.');
    const result = await api!.runtime.sendMessage({type:'SELECT_TAB',payload:{tabId,origin}}) as {ok:boolean;error?:string}; if (!result.ok) throw new Error(result.error);
    status.textContent = `Selected ${origin}.`; await api!.tabs.create({url:api!.runtime.getURL('dashboard.html')}); window.close();
  } catch (e) { status.textContent = e instanceof Error ? e.message : 'Could not select this site.'; }
});
open.addEventListener('click', () => { void api!.tabs.create({url:api!.runtime.getURL('dashboard.html')}); window.close(); });
