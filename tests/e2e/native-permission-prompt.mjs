// Real Chromium optional native-messaging permission prompt against the unmodified
// shipping extension and an actual local Linux host. Run on Linux under Xvfb/xdotool.
// It tests registration/consent only, not Bluetooth or a remote peer.
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(tmpdir(),'gs-native-prompt-'));
const home=path.join(dir,'home'),profile=path.join(dir,'profile'),ext=path.resolve(process.env.GS_EXTENSION_PATH||'release/chromium');
await mkdir(home,{recursive:true});let ctx;
// Playwright's waitForFunction treats a returned Promise as truthy even when
// that Promise resolves to false. Poll the resolved extension response instead.
async function waitConnection(page,expected){
  const deadline=Date.now()+10000;let result;
  do {
    result=await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_STATUS'}));
    if(result.ok&&result.data.connected===expected)return result.data;
    await page.waitForTimeout(100);
  } while(Date.now()<deadline);
  throw new Error(`Native connection did not become ${expected}: ${JSON.stringify(result)}`);
}
try {
  ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,env:{...process.env,HOME:home},args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(worker.url()).host,caller=`chrome-extension://${id}/`;
  const config=path.join(home,'.config/ghoststate');await mkdir(config,{recursive:true});await writeFile(path.join(config,'allowed-callers.json'),JSON.stringify({allowed:[caller]}),{mode:0o600});
  const host=path.resolve('release/native-linux-x86_64/ghoststate-companion'),wrapper=path.join(dir,'host-wrapper.py');
  // Count launches without logging native messages or credentials, then exec the real host.
  await writeFile(wrapper,`#!/usr/bin/env python3\nimport os,sys\nwith open(os.path.join(os.environ['HOME'],'launch-count'),'a') as f:f.write('1\\n')\nos.execv(${JSON.stringify(host)},[${JSON.stringify(host)},*sys.argv[1:]])\n`,{mode:0o755});
  const manifest={name:'com.ghoststate.bridge',description:'GhostState permission test',path:wrapper,type:'stdio',allowed_origins:[caller]};
  const page=await ctx.newPage();await page.goto(`chrome-extension://${id}/dashboard.html`);await page.locator('.nav-button[data-screen=devices]').click();
  assert.equal(await page.evaluate(()=>chrome.permissions.contains({permissions:['nativeMessaging']})),false);
  // The browser focuses Deny by default. Test denial before allowing the real prompt.
  await page.getByRole('button',{name:'Connect companion',exact:true}).first().click();await page.waitForTimeout(1200);execFileSync('xdotool',['key','Return']);
  await page.getByText('Companion permission was not granted.').waitFor({timeout:10000});
  assert.equal(await page.evaluate(()=>chrome.permissions.contains({permissions:['nativeMessaging']})),false);
  assert.equal((await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_STATUS'}))).data.connected,false);
  await page.getByRole('button',{name:'Connect companion',exact:true}).first().click();await page.waitForTimeout(1200);execFileSync('xdotool',['key','Tab']);execFileSync('xdotool',['key','Return']);
  // Actual grant with no installed host must fail clearly, not report success.
  await page.locator('#toast').filter({hasText:'Check the companion installation and exact extension ID'}).waitFor({timeout:12000});
  assert.equal(await page.evaluate(()=>chrome.permissions.contains({permissions:['nativeMessaging']})),true);
  await waitConnection(page,false);
  // Register the actual host, then retry without re-prompting or reloading.
  for(const name of ['google-chrome','google-chrome-for-testing','chromium']){const d=path.join(home,'.config',name,'NativeMessagingHosts');await mkdir(d,{recursive:true});await writeFile(path.join(d,'com.ghoststate.bridge.json'),JSON.stringify(manifest));}
  const profileNative=path.join(profile,'NativeMessagingHosts');await mkdir(profileNative,{recursive:true});await writeFile(path.join(profileNative,'com.ghoststate.bridge.json'),JSON.stringify(manifest));
  await page.getByRole('button',{name:'Connect companion',exact:true}).first().click();
  await page.getByText('Companion connected.').waitFor({timeout:12000}).catch(async e=>{
    console.error('Native permission:',await page.evaluate(()=>chrome.permissions.contains({permissions:['nativeMessaging']})));
    console.error('Native status:',await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_STATUS'})));
    console.error('UI notice:',await page.locator('#toast').textContent());
    throw e;
  });
  assert.equal(await page.evaluate(()=>chrome.permissions.contains({permissions:['nativeMessaging']})),true);
  const status=await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_REQUEST',payload:{op:'status'}}));assert.equal(status.ok,true);assert.equal(status.data.platform,'linux');
  const staleWorker=await worker.evaluate(()=>typeof chrome.runtime.connectNative)==='undefined';
  if(staleWorker) assert.equal(await page.locator('iframe[title="Local companion bridge"]').count(),1,'a stale worker needs the fresh extension frame');
  assert.equal((await readFile(path.join(home,'launch-count'),'utf8')).trim().split('\n').length,1);
  await page.getByRole('button',{name:'Disconnect',exact:true}).click();assert.equal((await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_STATUS'}))).data.connected,false);
  // A directly opened bridge page has the right URL but was not armed by a dashboard.
  // It must not launch the host or claim a connection.
  const unsolicited=await ctx.newPage();await unsolicited.goto(`chrome-extension://${id}/native-bridge.html`);await unsolicited.waitForTimeout(500);
  assert.equal((await readFile(path.join(home,'launch-count'),'utf8')).trim().split('\n').length,1,'unarmed bridge must not start a native host');
  assert.equal((await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_STATUS'}))).data.connected,false);await unsolicited.close();
  // An ordinary popup cannot impersonate the bundled bridge even with its port name.
  const popup=await ctx.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
  const rejected=await popup.evaluate(()=>new Promise(resolve=>{const p=chrome.runtime.connect({name:'ghoststate.native-bridge.v1'});p.onDisconnect.addListener(()=>resolve(true));setTimeout(()=>resolve(false),2500);}));assert.equal(rejected,true);await popup.close();
  let launches=1;
  if(staleWorker) {
    // During an armed window, neither the correct page in the wrong tab nor a
    // wrong challenge in the requesting tab can consume the one-use challenge.
    const arm=await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_CONNECT'}));assert.equal(arm.ok,true);assert.equal(arm.data.bridgeRequired,true);
    const token=arm.data.bridgeToken;assert.match(token,/^[a-f0-9]{32}$/);
    const other=await ctx.newPage();await other.goto(`chrome-extension://${id}/dashboard.html`);
    await other.evaluate(token=>{const f=document.createElement('iframe');f.hidden=true;f.src=chrome.runtime.getURL('native-bridge.html')+'#'+token;document.body.append(f);},token);
    await other.waitForTimeout(400);assert.equal((await readFile(path.join(home,'launch-count'),'utf8')).trim().split('\n').length,launches,'wrong-tab frame must not launch host');await other.close();
    const top=await ctx.newPage();await top.goto(`chrome-extension://${id}/native-bridge.html#${token}`);await top.waitForTimeout(300);
    assert.equal((await readFile(path.join(home,'launch-count'),'utf8')).trim().split('\n').length,launches,'top-level page must not launch host');await top.close();
    const wrong=(token[0]==='0'?'1':'0')+token.slice(1);
    await page.evaluate(token=>{const f=document.createElement('iframe');f.id='wrong-test-frame';f.hidden=true;f.src=chrome.runtime.getURL('native-bridge.html')+'#'+token;document.body.append(f);},wrong);
    await page.waitForTimeout(300);assert.equal((await readFile(path.join(home,'launch-count'),'utf8')).trim().split('\n').length,launches,'wrong challenge must not launch host');await page.locator('#wrong-test-frame').evaluate(f=>f.remove());
    const busy=await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_CONNECT'}));assert.equal(busy.ok,false);assert.match(busy.error,/already starting/);
    await page.evaluate(token=>{const f=document.createElement('iframe');f.id='valid-test-frame';f.hidden=true;f.src=chrome.runtime.getURL('native-bridge.html')+'#'+token;document.body.append(f);},token);
    await waitConnection(page,true);
    const actual=await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_REQUEST',payload:{op:'status'}}));assert.equal(actual.ok,true,JSON.stringify({actual,status:await page.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_STATUS'})),launches:await readFile(path.join(home,'launch-count'),'utf8')}));assert.equal(actual.data.platform,'linux');
    launches++;assert.equal((await readFile(path.join(home,'launch-count'),'utf8')).trim().split('\n').length,launches);
    await page.locator('#valid-test-frame').evaluate(f=>f.remove());await waitConnection(page,false);
    await page.evaluate(token=>{const f=document.createElement('iframe');f.id='replay-test-frame';f.hidden=true;f.src=chrome.runtime.getURL('native-bridge.html')+'#'+token;document.body.append(f);},token);
    await page.waitForTimeout(300);assert.equal((await readFile(path.join(home,'launch-count'),'utf8')).trim().split('\n').length,launches,'challenge replay must not launch host');await page.locator('#replay-test-frame').evaluate(f=>f.remove());
  }
  await page.bringToFront();await page.getByRole('button',{name:'Connect companion',exact:true}).first().click();await page.getByText('Companion connected.').waitFor({timeout:12000});
  launches++;assert.equal((await readFile(path.join(home,'launch-count'),'utf8')).trim().split('\n').length,launches);
  let active=page;
  if(staleWorker) {
    // Closing the dashboard that owns the fallback frame closes its native port.
    active=await ctx.newPage();await active.goto(`chrome-extension://${id}/dashboard.html`);await page.close();
    await waitConnection(active,false);
    await active.locator('.nav-button[data-screen=devices]').click();await active.getByRole('button',{name:'Connect companion',exact:true}).first().click();await active.getByText('Companion connected.').waitFor({timeout:12000});
    launches++;assert.equal((await readFile(path.join(home,'launch-count'),'utf8')).trim().split('\n').length,launches);
  }
  // Removing native permission closes an active port; it must not retain a live connection.
  assert.equal(await active.evaluate(()=>chrome.permissions.remove({permissions:['nativeMessaging']})),true);
  await waitConnection(active,false);
  assert.equal(await active.evaluate(()=>chrome.permissions.contains({permissions:['nativeMessaging']})),false);
  const denied=await active.evaluate(()=>chrome.runtime.sendMessage({type:'NATIVE_CONNECT'}));assert.equal(denied.ok,false);assert.match(denied.error,/permission/i);
  console.log(`PASS real Chromium native-permission denial/acceptance, actual Linux host, disconnect and active-permission revocation${staleWorker?', one-use/tab-bound bridge, wrong-token/top-level/wrong-tab/replay rejection and frame-close':''}. No Bluetooth test.`);
} finally {await ctx?.close();await rm(dir,{recursive:true,force:true});}
