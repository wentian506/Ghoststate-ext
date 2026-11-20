import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const handler=(req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  const step=req.url?.startsWith('/password')?'password':req.url?.startsWith('/otp')?'otp':'email';
  const body=step==='email'?'<form><input type="email" autocomplete="username" name="email"><button type="submit">Continue</button></form>' : step==='password'?'<form><input type="password" autocomplete="current-password" name="password"><button type="submit">Sign in</button></form>' : '<form><input name="otp" autocomplete="one-time-code"><button type="submit">Verify</button></form>';
  res.end(`<!doctype html><html><body><h1>Synthetic ${step}</h1>${body}<script>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();location.href='${step==='email'?'/password':'/otp'}'})</script></body></html>`);
};
const server=createServer(handler), rogue=createServer(handler);
await new Promise(r=>rogue.listen(0,'127.0.0.1',r)); const rogueOrigin=`http://127.0.0.1:${rogue.address().port}`;
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`;
const dir=await mkdtemp(path.join(tmpdir(),'ghoststate-e2e-')); const extension=path.join(dir,'fixture-extension'); const home=path.join(dir,'home');await mkdir(home,{recursive:true});
// Headless Chromium cannot interact with the browser's optional-permission prompt.
// Use an otherwise identical test-only copy with a required localhost host permission.
// The real distribution remains optional-permission-only.
await cp(path.resolve('release/chromium'),extension,{recursive:true});const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];manifest.permissions.push('nativeMessaging');manifest.optional_permissions=[];await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const profileDir=path.join(dir,'profile');
async function launch(){return chromium.launchPersistentContext(profileDir,{channel:'chromium',headless:true,env:{...process.env,HOME:home},args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});}
let context;
try {
  // First load the unmodified distributable and verify its least-privilege manifest.
  const prodPath=path.resolve('release/chromium'); const prodManifest=JSON.parse(await readFile(path.join(prodPath,'manifest.json'),'utf8'));assert.equal(prodManifest.host_permissions,undefined);assert(!prodManifest.permissions.includes('cookies'));
  const prod=await chromium.launchPersistentContext(path.join(dir,'prod-profile'),{channel:'chromium',headless:true,args:['--no-sandbox',`--disable-extensions-except=${prodPath}`,`--load-extension=${prodPath}`]});
  let prodWorker=prod.serviceWorkers()[0]||await prod.waitForEvent('serviceworker',{timeout:15000});const prodId=new URL(prodWorker.url()).host;const prodPage=await prod.newPage();await prodPage.goto(`chrome-extension://${prodId}/dashboard.html`);assert.equal(await prodPage.locator('h1').innerText(),'Dashboard');assert.equal(await prodPage.locator('.brand-mark img').evaluate(img=>img.naturalWidth>0),true);assert.equal(await prodPage.locator('.preview-notice').count(),0,'web-only preview notice must not appear in the extension');
  await prodPage.getByRole('button',{name:'Toggle light and dark theme'}).click();assert.equal(await prodPage.locator('html').getAttribute('data-theme'),'dark');
  const prodPopup=await prod.newPage();await prodPopup.goto(`chrome-extension://${prodId}/popup.html`);assert.equal(await prodPopup.locator('.mark').evaluate(img=>img.naturalWidth>0),true);assert.equal(await prodPopup.locator('link[rel=icon]').getAttribute('href'),'./assets/ghoststate-logo.png');await prodPopup.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  const [opened]=await Promise.all([prod.waitForEvent('page',{timeout:10000}),prodPopup.getByRole('button',{name:'Open dashboard'}).click()]);await opened.waitForLoadState();assert.match(opened.url(),/dashboard\.html$/);assert.equal(await opened.locator('h1').innerText(),'Dashboard');
  await prod.close();console.log('Unmodified least-privilege distribution, local logo and popup dashboard action loaded in Chromium');
  context=await launch(); let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000}); const id=new URL(worker.url()).host; console.log('Loaded Chromium test fixture extension',id);
  // Register the real native host only for this temporary browser home and extension ID.
  const caller=`chrome-extension://${id}/`;await mkdir(path.join(home,'.config/ghoststate'),{recursive:true});await writeFile(path.join(home,'.config/ghoststate/allowed-callers.json'),JSON.stringify({allowed:[caller]}),{mode:0o600});
  const host={name:'com.ghoststate.bridge',description:'GhostState test host',path:path.resolve('release/native-linux-x86_64/ghoststate-companion'),type:'stdio',allowed_origins:[caller]};
  for(const browserDir of ['google-chrome','google-chrome-for-testing','chromium']){const d=path.join(home,'.config',browserDir,'NativeMessagingHosts');await mkdir(d,{recursive:true});await writeFile(path.join(d,'com.ghoststate.bridge.json'),JSON.stringify(host));}
  const profileNative=path.join(profileDir,'NativeMessagingHosts');await mkdir(profileNative,{recursive:true});await writeFile(path.join(profileNative,'com.ghoststate.bridge.json'),JSON.stringify(host));
  const site=await context.newPage();await site.goto(`${origin}/login`);
  // Exercise the redesigned popup page against the synthetic site. The test-only fixture
  // has pregranted localhost permission; the separate prompt suite tests real consent.
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await site.bringToFront();await popup.reload();
  await popup.waitForFunction(()=>!document.querySelector('#use-site').disabled);assert.equal(await popup.locator('.mark').evaluate(img=>img.naturalWidth>0),true);
  const [popupDashboard]=await Promise.all([context.waitForEvent('page',{timeout:10000}),popup.getByRole('button',{name:'Use this site'}).click()]);await popupDashboard.waitForLoadState();
  const popupTarget=await popupDashboard.evaluate(()=>chrome.runtime.sendMessage({type:'TARGET'}));assert.equal(popupTarget.data.origin,origin);await popupDashboard.close();console.log('Popup selected the synthetic active site and opened its dashboard');
  let dashboard=await context.newPage(); dashboard.on('pageerror',e=>console.error('Dashboard JS error:',e.message)); await dashboard.goto(`chrome-extension://${id}/dashboard.html`);
  await dashboard.getByRole('button',{name:'Get started',exact:true}).click(); await dashboard.locator('#passphrase').fill('synthetic master passphrase'); await dashboard.locator('#confirm-pass').fill('synthetic master passphrase'); await dashboard.getByRole('dialog').getByRole('button',{name:'Create vault'}).click(); await dashboard.getByText('Your encrypted vault is ready.').waitFor();
  await dashboard.getByRole('button',{name:'New portal'}).click();await dashboard.locator('#label').fill('Synthetic portal');await dashboard.locator('#url').fill(origin);await dashboard.locator('#username').fill('synthetic@example.test');await dashboard.locator('#password').fill('synthetic-password');await dashboard.getByRole('button',{name:'Save encrypted profile'}).click();await dashboard.getByText('Portal profile saved locally.').waitFor();
  await dashboard.getByRole('button',{name:'Workflows',exact:true}).click();await dashboard.getByRole('button',{name:'Choose a site'}).click();await dashboard.locator('#site-url').fill(origin);await dashboard.getByRole('button',{name:'Allow & select site'}).click();
  await dashboard.getByText(`Selected ${origin}.`,{exact:true}).waitFor({timeout:12000}).catch(async e=>{ console.error('dialog:',await dashboard.getByRole('dialog').allTextContents()); console.error('toast:',await dashboard.locator('#toast').textContent()); throw e; });console.log('Test-only pregranted localhost permission and site selection work');
  await dashboard.getByRole('button',{name:'Learn a state'}).click();await dashboard.getByRole('dialog').waitFor();await dashboard.getByRole('button',{name:'Save this state'}).click();await dashboard.getByText('Workflow state saved.',{exact:false}).waitFor();
  await site.locator('input').fill('synthetic@example.test');await site.getByRole('button',{name:'Continue'}).click();await site.waitForURL('**/password');
  await dashboard.getByRole('button',{name:'Capture next state'}).click();await dashboard.getByRole('dialog').waitFor();await dashboard.getByRole('button',{name:'Save this state'}).click();await dashboard.getByText('Workflow state saved.',{exact:false}).waitFor();
  await dashboard.getByText(/2 states/).waitFor({timeout:10000});assert.match(await dashboard.locator('.list-main').last().innerText(),/2 states/);console.log('Learned two real same-origin navigation states');
  await dashboard.locator('.nav-button[data-screen=overview]').click();await dashboard.locator('[data-filter=learned]').click();assert.match(await dashboard.locator('.portal-row').innerText(),/2 states/);
  await dashboard.locator('[data-filter=unlearned]').click();assert.equal(await dashboard.locator('.portal-row').count(),0);await dashboard.getByText('No profiles need setup').waitFor();
  await dashboard.locator('.nav-button[data-screen=workflows]').click();console.log('Dashboard filters reflect actual learned state');
  await site.goto(`${origin}/login`);await dashboard.getByRole('button',{name:'Review & fill'}).click();await dashboard.getByRole('button',{name:'Fill this step'}).click();await site.waitForFunction(()=>document.querySelector('input')?.value==='synthetic@example.test');assert.equal(await site.locator('input').inputValue(),'synthetic@example.test');
  await site.getByRole('button',{name:'Continue'}).click();await site.waitForURL('**/password');await dashboard.getByRole('button',{name:'Review & fill'}).click();await dashboard.getByRole('button',{name:'Fill this step'}).click();await site.waitForFunction(()=>document.querySelector('input')?.value==='synthetic-password');assert.equal(await site.locator('input').inputValue(),'synthetic-password');
  assert.equal(new URL(site.url()).pathname,'/password'); // never auto-submit
  await site.getByRole('button',{name:'Sign in'}).click();await site.waitForURL('**/otp');await dashboard.getByRole('button',{name:'Review & fill'}).click();await dashboard.getByText(/Complete otp manually/).waitFor();assert.equal(await site.locator('input').inputValue(),'');console.log('Two-step replay works; OTP pauses and submissions are manual');
  const profileId=await dashboard.locator('button[data-action=fill]').first().getAttribute('data-id');await site.goto(`${rogueOrigin}/password`);const blocked=await dashboard.evaluate(async id=>chrome.runtime.sendMessage({type:'FILL_STATE',payload:{id}}),profileId);assert.equal(blocked.ok,false);assert.match(blocked.error,/Origin mismatch/);assert.equal(await site.locator('input').inputValue(),'');assert.equal(await site.evaluate(()=>!!globalThis.chrome?.runtime?.id),false);console.log('Different port is denied even with host permission; page cannot call extension API');
  // Clearing a selected site tears down the injected observer instead of watching a former target.
  await site.goto(`${origin}/login`); const target=await dashboard.evaluate(()=>chrome.runtime.sendMessage({type:'TARGET'})); assert.equal(target.ok,true);
  assert.equal((await dashboard.evaluate(()=>chrome.runtime.sendMessage({type:'SCAN'}))).ok,true);
  const before=await dashboard.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'GS_SCAN'}),target.data.tabId);assert.equal(before.ok,true);
  assert.equal((await dashboard.evaluate(()=>chrome.runtime.sendMessage({type:'CLEAR_TARGET'}))).ok,true);
  const stopped=await dashboard.evaluate(async tabId=>{try{await chrome.tabs.sendMessage(tabId,{type:'GS_SCAN'});return false;}catch{return true;}},target.data.tabId);assert.equal(stopped,true);console.log('Clearing target removes its content observer');
  await dashboard.getByRole('button',{name:'Devices & transfer'}).click();await dashboard.getByRole('button',{name:'Connect companion',exact:true}).first().click();await dashboard.getByText('Companion connected.').waitFor({timeout:12000}).catch(async e=>{console.error('native toast:',await dashboard.locator('#toast').textContent());throw e;});const nativeStatus=await dashboard.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_REQUEST',payload:{op:'status'}}));assert.equal(nativeStatus.ok,true);assert.equal(nativeStatus.data.platform,'linux');console.log('Actual extension connected to real allowlisted Rust native host');
  await context.close();context=await launch();worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});dashboard=await context.newPage();await dashboard.goto(`chrome-extension://${new URL(worker.url()).host}/dashboard.html`);await dashboard.locator('button[data-action=unlock]').first().click();await dashboard.locator('#passphrase').fill('synthetic master passphrase');await dashboard.getByRole('dialog').getByRole('button',{name:'Unlock vault',exact:true}).click();await dashboard.getByText('Vault unlocked.').waitFor();await dashboard.getByRole('button',{name:'Workflows',exact:true}).click();assert.match(await dashboard.locator('.list-main').last().innerText(),/2 states/);console.log('Encrypted workflow survived an actual browser restart');
  const injected=await dashboard.evaluate(()=>chrome.runtime.sendMessage({type:'ADD_PROFILE',payload:{label:'<img src=x onerror=alert(1)>',url:'https://xss.example',username:'test',password:'test'}}));assert.equal(injected.ok,true);await dashboard.reload();await dashboard.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor();assert.equal(await dashboard.locator('.portal-row img').count(),0);await dashboard.locator('.nav-button[data-screen=portals]').click();await dashboard.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor();assert.equal(await dashboard.locator('.list-main img').count(),0);console.log('Untrusted profile labels are escaped in both overview and profile views');
  console.log('PASS Chromium extension end-to-end');
} finally { if(context)await context.close();server.close();rogue.close();await rm(dir,{recursive:true,force:true}); }
