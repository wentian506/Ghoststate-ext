// Synthetic sites and test-only pregranted localhost permissions. No real credentials.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

let rogueOrigin='';
const handler=(req,res)=>{
  const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','text/html; charset=utf-8');
  if(url.pathname==='/frame') {res.end('<!doctype html><html><body><iframe src="/login" style="width:500px;height:300px"></iframe></body></html>');return;}
  const action=url.searchParams.has('cross')?rogueOrigin+'/capture':'/welcome';
  const prefill=url.searchParams.has('prefill')?' value="user-typed"':'';
  const otp=url.searchParams.has('otp')?'<input autocomplete="one-time-code" name="otp">':'';
  const change=url.searchParams.has('changed')?'<input type="text" name="extra">':'';
  const hidden=url.searchParams.has('hidden')?' hidden':'';
  const offscreen=url.searchParams.has('offscreen')?' style="position:absolute;left:-10000px"':'';
  const transparent=url.searchParams.has('transparent')?' style="opacity:.01"':'';
  const overlay=url.searchParams.has('covered')?'<div style="position:fixed;inset:0;background:#fff;z-index:999"></div>':'';
  res.end(`<!doctype html><html><body><h1>Only synthetic sign-in</h1><form action="${action}"><input type="email" autocomplete="username"${prefill}><input type="password" autocomplete="current-password"${hidden}${offscreen}${transparent}>${otp}${change}<button type="submit">Sign in</button></form>${overlay}<script>window.submissions=0;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submissions++})</script></body></html>`);
};
const siteServer=createServer(handler), rogueServer=createServer(handler);
await new Promise(r=>rogueServer.listen(0,'127.0.0.1',r));rogueOrigin=`http://127.0.0.1:${rogueServer.address().port}`;
await new Promise(r=>siteServer.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${siteServer.address().port}`;
const dir=await mkdtemp(path.join(tmpdir(),'gs-auto-e2e-'));const extension=path.join(dir,'extension');
await cp(path.resolve('release/chromium'),extension,{recursive:true});const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
let context;
try {
  context=await chromium.launchPersistentContext(path.join(dir,'profile'),{channel:'chromium',headless:true,args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const site=await context.newPage();await site.goto(origin+'/login');
  const dash=await context.newPage();const errors=[];dash.on('pageerror',e=>errors.push(e.message));await dash.goto(`chrome-extension://${id}/dashboard.html`);
  const message=(type,payload={})=>dash.evaluate(({type,payload})=>chrome.runtime.sendMessage({type,payload}),{type,payload});
  await dash.getByRole('button',{name:'Get started',exact:true}).click();await dash.locator('#passphrase').fill('synthetic auto test passphrase');await dash.locator('#confirm-pass').fill('synthetic auto test passphrase');await dash.getByRole('dialog').getByRole('button',{name:'Create vault'}).click();await dash.locator('.dialog-backdrop').waitFor({state:'detached'});
  await dash.getByRole('button',{name:'New portal'}).click();await dash.locator('#label').fill('Autofill test');await dash.locator('#url').fill(origin);await dash.locator('#username').fill('auto-user@example.test');await dash.locator('#password').fill('synthetic-only-password');await dash.getByRole('button',{name:'Save encrypted profile'}).click();await dash.locator('.dialog-backdrop').waitFor({state:'detached'});
  await dash.getByRole('button',{name:'Workflows',exact:true}).click();await dash.getByRole('button',{name:'Choose a site'}).click();await dash.locator('#site-url').fill(origin);await dash.getByRole('button',{name:'Allow & select site'}).click();await dash.locator('.dialog-backdrop').waitFor({state:'detached'});
  await dash.getByRole('button',{name:'Learn a state'}).click();await dash.getByRole('button',{name:'Save this state'}).click();await dash.locator('.dialog-backdrop').waitFor({state:'detached'});
  const target=(await message('TARGET')).data;assert.equal(target.origin,origin);
  const pid=(await message('LIST_PROFILES')).data[0].id;
  assert.equal((await message('AUTO_STATUS')).data,null);
  await site.goto(origin+'/login');await site.bringToFront();await site.waitForTimeout(700);assert.equal(await site.locator('input[type=password]').inputValue(),'');
  console.log('PASS automatic fill is off by default');

  await dash.bringToFront();await dash.getByRole('button',{name:'Enable auto-fill'}).click();await dash.getByRole('dialog').getByRole('button',{name:'Enable for 10 minutes'}).click();await dash.locator('.dialog-backdrop').waitFor({state:'detached'});
  const authorization=(await message('AUTO_STATUS')).data;assert.equal(authorization.profileId,pid);assert.equal(authorization.tabId,target.tabId);assert(authorization.expiresAt-Date.now()<=600_000);
  await site.waitForTimeout(700);assert.equal(await site.locator('input[type=password]').inputValue(),''); // selected site is in the background
  await site.bringToFront();await site.waitForFunction(()=>document.querySelector('input[type=password]').value==='synthetic-only-password');
  assert.equal(await site.locator('input[type=email]').inputValue(),'auto-user@example.test');assert.equal(await site.evaluate(()=>window.submissions),0);
  const scanned=await dash.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'GS_SCAN'},{frameId:0}),target.tabId);assert(scanned.documentId);
  await site.evaluate(()=>{for(const e of document.querySelectorAll('input'))e.value='';document.querySelector('form').classList.toggle('mutated');});
  await site.waitForTimeout(800);assert.equal(await site.locator('input[type=password]').inputValue(),'');
  console.log('PASS explicit approval, focused tab, no submission, and at most once per document/state');

  await site.goto(origin+'/login');await site.waitForFunction(()=>document.querySelector('input[type=password]').value==='synthetic-only-password');
  const current=await dash.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'GS_SCAN'},{frameId:0}),target.tabId);
  assert.notEqual(current.documentId,scanned.documentId);
  const stale=await dash.evaluate(({tabId,origin,oldId,fingerprint})=>chrome.tabs.sendMessage(tabId,{type:'GS_FILL',origin,documentId:oldId,fingerprint,fields:[{path:'form:0/input:1',kind:'password',value:'fake'}],automatic:true},{frameId:0}),{tabId:target.tabId,origin,oldId:scanned.documentId,fingerprint:current.snapshot.fingerprint});
  assert.equal(stale.ok,false);
  await site.goto(origin+'/login?prefill=1');await site.waitForTimeout(800);assert.equal(await site.locator('input[type=email]').inputValue(),'user-typed');assert.equal(await site.locator('input[type=password]').inputValue(),'');
  await site.goto(origin+'/login?cross=1');await site.waitForTimeout(800);assert.equal(await site.locator('input[type=password]').inputValue(),'');
  await site.goto(origin+'/login?otp=1');await site.waitForTimeout(800);assert.equal(await site.locator('input[type=password]').inputValue(),'');assert.equal(await site.locator('[autocomplete=one-time-code]').inputValue(),'');
  await site.goto(origin+'/login?changed=1');await site.waitForTimeout(800);assert.equal(await site.locator('input[type=password]').inputValue(),'');
  await site.goto(origin+'/login?hidden=1');await site.waitForTimeout(800);assert.equal(await site.locator('input[type=password]').inputValue(),'');
  for(const condition of ['offscreen','transparent','covered']){await site.goto(origin+`/login?${condition}=1`);await site.waitForTimeout(800);assert.equal(await site.locator('input[type=password]').inputValue(),'');}
  console.log('PASS stale document, already-entered input, cross-origin action, OTP, changed page and hidden/offscreen/covered fields fail closed');

  await site.goto(rogueOrigin+'/login');await site.waitForTimeout(800);assert.equal(await site.locator('input[type=password]').inputValue(),'');
  await site.goto(origin+'/frame');await site.waitForTimeout(800);const child=site.frame({url:origin+'/login'});assert(child);assert.equal(await child.locator('input[type=password]').inputValue(),'');
  const other=await context.newPage();await other.goto(origin+'/login');await other.bringToFront();await other.waitForTimeout(700);assert.equal(await other.locator('input[type=password]').inputValue(),'');
  await site.goto(origin+'/login');await other.bringToFront();await site.waitForTimeout(700);assert.equal(await site.locator('input[type=password]').inputValue(),'');
  await site.bringToFront();await site.waitForFunction(()=>document.querySelector('input[type=password]').value==='synthetic-only-password');
  console.log('PASS exact-port, top-frame, selected-tab and background-tab isolation');

  // Advance the worker clock in this isolated test: authorization expires at ten minutes
  // while a separately configured 30-minute vault remains unlocked.
  assert.equal((await message('SET_SETTINGS',{minutes:30,logging:false})).ok,true);
  await worker.evaluate(()=>{globalThis.__realNow=Date.now;Date.now=()=>globalThis.__realNow()+601_000;});
  assert.equal((await message('AUTO_STATUS')).data,null);assert.equal((await message('STATUS')).data.unlocked,true);
  await worker.evaluate(()=>{Date.now=globalThis.__realNow;delete globalThis.__realNow;});
  await dash.bringToFront();await dash.reload();await dash.getByRole('button',{name:'Workflows',exact:true}).click();
  await dash.getByRole('button',{name:'Enable auto-fill'}).click();await dash.getByRole('dialog').getByRole('button',{name:'Enable for 10 minutes'}).click();await dash.locator('.dialog-backdrop').waitFor({state:'detached'});
  await dash.getByRole('button',{name:'Turn off',exact:true}).click();assert.equal((await message('AUTO_STATUS')).data,null);
  await site.goto(origin+'/login');await site.bringToFront();await site.waitForTimeout(700);assert.equal(await site.locator('input[type=password]').inputValue(),'');
  await dash.bringToFront();await dash.getByRole('button',{name:'Enable auto-fill'}).click();await dash.getByRole('dialog').getByRole('button',{name:'Enable for 10 minutes'}).click();await dash.locator('.dialog-backdrop').waitFor({state:'detached'});
  await dash.locator('button[data-action=lock]').first().click();assert.equal((await message('AUTO_STATUS')).data,null);
  await site.goto(origin+'/login');await site.bringToFront();await site.waitForTimeout(700);assert.equal(await site.locator('input[type=password]').inputValue(),'');
  assert.deepEqual(errors,[]);console.log('PASS ten-minute expiry, disabling and vault lock revoke automatic fill');
  console.log('PASS Chromium opt-in automatic-fill end-to-end');
} finally {await context?.close();siteServer.close();rogueServer.close();await rm(dir,{recursive:true,force:true});}
