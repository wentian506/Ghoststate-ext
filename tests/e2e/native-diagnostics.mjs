// Test-only pregranted nativeMessaging and synthetic status host. No Bluetooth radio is used.
import {chromium} from 'playwright';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(tmpdir(),'gs-native-ui-'));
const home=path.join(dir,'home'),ext=path.join(dir,'fixture'),profile=path.join(dir,'profile');
await mkdir(home,{recursive:true});await cp(path.resolve('release/chromium'),ext,{recursive:true});
const m=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));m.permissions.push('nativeMessaging');m.optional_permissions=[];await writeFile(path.join(ext,'manifest.json'),JSON.stringify(m));
let ctx;
try {
  ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,env:{...process.env,HOME:home},args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const page=await ctx.newPage();await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.locator('.nav-button[data-screen=help]').click();assert.equal(await page.locator('.extension-id').innerText(),id);
  await page.getByText(/Discovery and pairing exchange Bluetooth identifiers and handshake data/).waitFor();
  await page.locator('.nav-button[data-screen=devices]').click();
  await page.getByRole('button',{name:'Connect companion',exact:true}).first().click();
  await page.getByText(/Check the companion installation and exact extension ID/).waitFor({timeout:12000});
  assert.equal((await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_STATUS'}))).data.connected,false);
  const status={version:'test-only',platform:'mock',centralSupported:true,peripheralSupported:false,listening:false,connectionLimit:8,pairings:[],receiverPairing:null,incoming:[]};
  await writeFile(path.join(home,'diagnostic-status.json'),JSON.stringify(status));
  const host=path.resolve('tests/e2e/fixtures/diagnostic-native-host.py');await chmod(host,0o755);
  const manifest={name:'com.ghoststate.bridge',description:'test only',path:host,type:'stdio',allowed_origins:[`chrome-extension://${id}/`]};
  for(const name of ['google-chrome','google-chrome-for-testing','chromium']){const d=path.join(home,'.config',name,'NativeMessagingHosts');await mkdir(d,{recursive:true});await writeFile(path.join(d,'com.ghoststate.bridge.json'),JSON.stringify(manifest));}
  const profileNative=path.join(profile,'NativeMessagingHosts');await mkdir(profileNative,{recursive:true});await writeFile(path.join(profileNative,'com.ghoststate.bridge.json'),JSON.stringify(manifest));
  await page.getByRole('button',{name:'Connect companion',exact:true}).first().click();await page.getByText('Companion connected.').waitFor({timeout:12000}).catch(async e=>{console.error('Companion toast:',await page.locator('#toast').textContent());console.error('Status:',await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_STATUS'})));throw e;});
  await page.getByText(/sender implemented · receiver unavailable/).waitFor();
  assert.equal(await page.getByRole('button',{name:'Make discoverable'}).isDisabled(),true);
  const discover=page.getByRole('button',{name:'Discover nearby'});await discover.focus();await page.waitForTimeout(6500);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-action')),'discover','unchanged polling must not steal keyboard focus');
  status.peripheralSupported=true;await writeFile(path.join(home,'diagnostic-status.json'),JSON.stringify(status));
  await page.getByText(/sender implemented · receiver implemented/).waitFor({timeout:12000});
  assert.equal(await page.getByRole('button',{name:'Make discoverable'}).isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-action')),'discover','focus is restored after a status update');
  await page.getByRole('button',{name:'Disconnect',exact:true}).click();
  assert.equal((await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_STATUS'}))).data.connected,false);
  console.log('PASS missing-host guidance, installed ID display, capability gating and stable focus using a synthetic native host (no Bluetooth).');
} finally {await ctx?.close();await rm(dir,{recursive:true,force:true});}
