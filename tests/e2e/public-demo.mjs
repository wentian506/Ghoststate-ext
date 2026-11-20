// Optional network-dependent demo-site smoke test. The target publicly publishes these fake
// credentials. This test fills but DOES NOT SUBMIT the form. It is not a security or BLE test.
import {chromium} from 'playwright';
import {mkdtemp,rm,cp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin='https://the-internet.herokuapp.com';
const dir=await mkdtemp(path.join(tmpdir(),'gs-public-demo-'));
const ext=path.join(dir,'ext');await cp(path.resolve('release/chromium'),ext,{recursive:true});
// Headless test-only copy pregrants this host. Separate prompt tests use the shipping manifest.
const file=path.join(ext,'manifest.json'),manifest=JSON.parse(await readFile(file,'utf8'));
manifest.host_permissions=[`${origin}/*`];await writeFile(file,JSON.stringify(manifest));
let ctx;
try {
  ctx=await chromium.launchPersistentContext(path.join(dir,'profile'),{channel:'chromium',headless:true,ignoreHTTPSErrors:true,args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker',{timeout:15000}),id=new URL(worker.url()).host;
  const site=await ctx.newPage();await site.goto(`${origin}/login`,{waitUntil:'domcontentloaded',timeout:30000});
  await site.locator('#username').waitFor();await site.locator('#password').waitFor();
  const dashboard=await ctx.newPage();await dashboard.goto(`chrome-extension://${id}/dashboard.html`);
  await dashboard.evaluate(async origin=>{
    const call=async(type,payload)=>{const r=await chrome.runtime.sendMessage({type,payload});if(!r.ok)throw new Error(r.error);return r.data;};
    await call('SETUP',{passphrase:'synthetic demo passphrase'});
    await call('ADD_PROFILE',{label:'Public test demo',url:origin,username:'tomsmith',password:'SuperSecretPassword!'});
  },origin);
  await dashboard.reload();await dashboard.getByRole('button',{name:'Workflows',exact:true}).click();
  await dashboard.getByRole('button',{name:'Choose a site'}).click();await dashboard.locator('#site-url').fill(origin);
  await dashboard.getByRole('button',{name:'Allow & select site'}).click();await dashboard.getByText(`Selected ${origin}.`,{exact:true}).waitFor({timeout:15000});
  await dashboard.getByRole('button',{name:'Learn a state'}).click();const dialog=dashboard.getByRole('dialog');await dialog.waitFor();
  // Explicit mappings work even when a third-party page has no autocomplete attributes.
  await dialog.getByLabel('Mapping for field 1').selectOption('username');
  await dialog.getByLabel('Mapping for field 2').selectOption('password');
  await dialog.getByRole('button',{name:'Save this state'}).click();await dashboard.getByText('Workflow state saved.',{exact:false}).waitFor();
  await dashboard.getByRole('button',{name:'Review & fill'}).click();await dashboard.getByRole('button',{name:'Fill this step'}).click();
  await site.waitForFunction(()=>document.querySelector('#username')?.value==='tomsmith');
  assert.equal(await site.locator('#password').inputValue(),'SuperSecretPassword!');assert.equal(new URL(site.url()).pathname,'/login');
  console.log('PASS optional third-party public demo: explicit mappings and reviewed fill of published fake credentials; form was not submitted. Uses a test-only pregrant.');
} finally {await ctx?.close();await rm(dir,{recursive:true,force:true});}
