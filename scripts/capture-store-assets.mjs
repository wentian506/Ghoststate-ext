// Capture the actual built extension with synthetic data. No site, native host or BLE is simulated.
import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('release/store-listing');await mkdir(out,{recursive:true});
const temp=await mkdtemp(path.join(tmpdir(),'gs-store-screens-'));
const ext=path.resolve('release/chromium');let ctx;
try {
  ctx=await chromium.launchPersistentContext(temp,{channel:'chromium',headless:true,viewport:{width:1280,height:800},deviceScaleFactor:1,reducedMotion:'reduce',args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const page=await ctx.newPage();const external=[];
  page.on('request',req=>{if(/^https?:/.test(req.url()))external.push(req.url());});
  await page.goto(`chrome-extension://${id}/dashboard.html`);await page.locator('h1').waitFor();
  const seed=await page.evaluate(async()=>{
    const call=async(type,payload)=>{const r=await chrome.runtime.sendMessage({type,payload});if(!r.ok)throw new Error(r.error);return r.data;};
    await call('SETUP',{passphrase:'synthetic demonstration passphrase'});
    await call('ADD_PROFILE',{label:'Demo learning portal',url:'https://learn.example.test',username:'demo-user',password:'synthetic-only'});
    await call('ADD_PROFILE',{label:'Demo workspace',url:'https://work.example.test',username:'demo-user',password:'synthetic-only'});
    return true;
  });assert.equal(seed,true);
  await page.reload();await page.getByText('Demo learning portal',{exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  async function capture(name) {
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,name),animations:'disabled'});
  }
  await capture('01-dashboard.png');
  await page.locator('.nav-button[data-screen=portals]').click();await page.getByText('Demo workspace',{exact:true}).waitFor();await capture('02-portal-profiles.png');
  await page.locator('.nav-button[data-screen=workflows]').click();await page.getByRole('heading',{name:'Learned workflows'}).waitFor();await capture('03-workflows.png');
  await page.locator('.nav-button[data-screen=devices]').click();await page.getByText(/Experimental Bluetooth/).waitFor();await capture('04-experimental-bluetooth.png');
  assert.deepEqual(external,[],'screenshots must not request external resources');
  await copyFile(path.join(ext,'icon128.png'),path.join(out,'store-icon-128.png'));
  execFileSync('python3',['scripts/make-store-promo.py',out],{stdio:'inherit'});
  console.log('Captured actual extension UI with synthetic profiles; all screenshots are 1280×800 RGB. Bluetooth image explicitly says experimental.');
} finally {await ctx?.close();await rm(temp,{recursive:true,force:true});}
