// Real Chromium optional-permission prompt and bundled fresh-context bridge with
// a synthetic host. Exercises UI/credential routing only: this is NOT a BLE test.
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(tmpdir(),'gs-bridge-transfer-'));
const home=path.join(dir,'home'),profile=path.join(dir,'profile'),ext=path.resolve(process.env.GS_EXTENSION_PATH||'release/chromium');
await mkdir(home,{recursive:true});let ctx;
try {
  ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,env:{...process.env,HOME:home},args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const host=path.resolve('tests/e2e/fixtures/mock-native-host.py');await chmod(host,0o755);
  const manifest={name:'com.ghoststate.bridge',description:'Synthetic bridge transfer test',path:host,type:'stdio',allowed_origins:[`chrome-extension://${id}/`]};
  for(const name of ['google-chrome','google-chrome-for-testing','chromium']){const d=path.join(home,'.config',name,'NativeMessagingHosts');await mkdir(d,{recursive:true});await writeFile(path.join(d,'com.ghoststate.bridge.json'),JSON.stringify(manifest));}
  const native=path.join(profile,'NativeMessagingHosts');await mkdir(native,{recursive:true});await writeFile(path.join(native,'com.ghoststate.bridge.json'),JSON.stringify(manifest));
  const page=await ctx.newPage();await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.getByRole('button',{name:'Get started',exact:true}).click();await page.locator('#passphrase').fill('synthetic master passphrase');await page.locator('#confirm-pass').fill('synthetic master passphrase');await page.getByRole('dialog').getByRole('button',{name:'Create vault'}).click();await page.getByText('Your encrypted vault is ready.').waitFor();
  await page.getByRole('button',{name:'New portal'}).click();await page.locator('#label').fill('Mock profile');await page.locator('#url').fill('https://example.test');await page.locator('#username').fill('test-user');await page.locator('#password').fill('test-password');await page.getByRole('button',{name:'Save encrypted profile'}).click();await page.getByText('Portal profile saved locally.').waitFor();
  await page.locator('.nav-button[data-screen=devices]').click();await page.getByRole('button',{name:'Connect companion',exact:true}).first().click();await page.waitForTimeout(1200);execFileSync('xdotool',['key','Tab']);execFileSync('xdotool',['key','Return']);await page.getByText('Companion connected.').waitFor({timeout:12000});
  if(await worker.evaluate(()=>typeof chrome.runtime.connectNative)==='undefined')assert.equal(await page.locator('iframe[title="Local companion bridge"]').count(),1);
  await page.locator('button[data-action=send-profile][data-id=synthetic-peer]').click();
  await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click();
  await assert.rejects(readFile(path.join(home,'mock-send-count'),'utf8'),{code:'ENOENT'},'cancelling approval must send nothing');
  await page.locator('button[data-action=send-profile][data-id=synthetic-peer]').click();
  await page.getByRole('dialog').getByRole('button',{name:'Approve & send'}).click();await page.getByText('Encrypted transfer sent; recipient approval is pending.').waitFor();
  assert.equal(await readFile(path.join(home,'mock-send-count'),'utf8'),'1');assert.equal((await readFile(path.join(home,'mock-routed-peers'),'utf8')).trim(),'synthetic-peer');
  await page.locator('button[data-action=send-profile][data-id=synthetic-peer-2]').click();
  await page.getByRole('dialog').getByRole('button',{name:'Approve & send'}).click();await page.getByText('Encrypted transfer sent; recipient approval is pending.').waitFor();
  assert.equal(await readFile(path.join(home,'mock-send-count'),'utf8'),'2');assert.deepEqual((await readFile(path.join(home,'mock-routed-peers'),'utf8')).trim().split('\n'),['synthetic-peer','synthetic-peer-2']);
  await page.locator('button[data-action=accept-transfer]').click();await page.locator('#transfer-label').fill('Incoming test');await page.getByRole('dialog').getByRole('button',{name:'Accept & save locally'}).click();await page.getByText('Credential saved in your local vault.').waitFor();
  const profiles=await page.evaluate(()=>chrome.runtime.sendMessage({type:'LIST_PROFILES'}));assert(profiles.data.some(p=>p.origin==='https://incoming.example'));
  // Generic native requests cannot smuggle credential operations through the relay.
  const blocked=await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_REQUEST',payload:{op:'send_grant',data:{peerId:'synthetic-peer'}}}));assert.equal(blocked.ok,false);
  await page.evaluate(()=>chrome.runtime.sendMessage({type:'LOCK'}));
  const locked=await page.evaluate(id=>chrome.runtime.sendMessage({type:'NATIVE_SEND_PROFILE',payload:{id,origin:'https://example.test',peerId:'synthetic-peer'}}),profiles.data.find(p=>p.origin==='https://example.test').id);assert.equal(locked.ok,false);
  assert.equal(await readFile(path.join(home,'mock-send-count'),'utf8'),'2','locked vault must not send');
  console.log('PASS real Chromium native permission + local bridge: cancelled and separately approved synthetic sends to two peers, incoming acceptance, generic-op blocking and locked-vault denial with a MOCK host; no BLE.');
} finally {await ctx?.close();await rm(dir,{recursive:true,force:true});}
