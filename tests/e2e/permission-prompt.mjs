// Run under xvfb-run on Linux; xdotool interacts with Chromium's real native permission UI.
import { chromium } from 'playwright';import { execFileSync } from 'node:child_process';import { createServer } from 'node:http';import { mkdtemp,rm } from 'node:fs/promises';import { tmpdir } from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const server=createServer((_req,res)=>res.end('<html><body><form><input type="password" autocomplete="current-password"><button>Sign in</button></form></body></html>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;const dir=await mkdtemp(path.join(tmpdir(),'gs-prompt-'));const ext=path.resolve('release/chromium');let ctx;
try {
  ctx=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:false,args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const site=await ctx.newPage();await site.goto(origin);const page=await ctx.newPage();await page.goto(`chrome-extension://${id}/dashboard.html`);
  await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByRole('button',{name:'Choose a site'}).click();await page.locator('#site-url').fill(origin);await page.getByRole('button',{name:'Allow & select site'}).click();await page.waitForTimeout(1200);
  // Chrome focuses Deny by default. First exercise refusal, without modifying the package.
  execFileSync('xdotool',['key','Return']);await page.getByText('Site permission was not granted.').waitFor({timeout:10000});
  assert.equal(await page.evaluate(()=>chrome.permissions.contains({origins:['http://127.0.0.1/*']})),false);
  await page.getByRole('button',{name:'Allow & select site'}).click();await page.waitForTimeout(1200);
  // Tab from Deny to Allow, then activate the native browser UI.
  execFileSync('xdotool',['key','Tab']);execFileSync('xdotool',['key','Return']);await page.getByText(`Selected ${origin}.`,{exact:true}).waitFor({timeout:10000});
  assert.equal(await page.evaluate(()=>chrome.permissions.contains({origins:['http://127.0.0.1/*']})),true);
  const result=await page.evaluate(()=>chrome.runtime.sendMessage({type:'TARGET'}));assert.equal(result.ok,true);assert.equal(result.data.origin,origin);
  // The user can revoke the real browser grant through the dashboard.
  await page.locator('button[data-action=unlock]').first().click();await page.locator('#passphrase').fill('synthetic permission passphrase');await page.locator('#confirm-pass').fill('synthetic permission passphrase');await page.getByRole('dialog').getByRole('button',{name:'Create vault'}).click();await page.getByText('Your encrypted vault is ready.').waitFor();
  await page.getByRole('button',{name:'New portal'}).click();await page.locator('#label').fill('Permission test');await page.locator('#url').fill(origin);await page.locator('#username').fill('synthetic');await page.locator('#password').fill('synthetic-password');await page.getByRole('button',{name:'Save encrypted profile'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByRole('button',{name:'Learn a state'}).click();await page.getByRole('button',{name:'Save this state'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Enable auto-fill'}).click();await page.getByRole('dialog').getByRole('button',{name:'Enable for 10 minutes'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});assert((await page.evaluate(()=>chrome.runtime.sendMessage({type:'AUTO_STATUS'}))).data);
  await page.getByRole('button',{name:'Privacy & security'}).click();await page.getByRole('button',{name:'Revoke selected site'}).click();await page.getByRole('dialog').getByRole('button',{name:'Revoke access'}).click();await page.getByText('Site access revoked.').waitFor();
  assert.equal(await page.evaluate(()=>chrome.permissions.contains({origins:['http://127.0.0.1/*']})),false);assert.equal((await page.evaluate(()=>chrome.runtime.sendMessage({type:'TARGET'}))).data,null);assert.equal((await page.evaluate(()=>chrome.runtime.sendMessage({type:'AUTO_STATUS'}))).data,null);
  await site.bringToFront();await site.reload();await site.waitForTimeout(700);assert.equal(await site.locator('input').inputValue(),'');
  console.log('PASS real Chromium optional host-permission denial, acceptance, exact origin selection, and automatic-fill revocation on the unmodified package');
}finally{if(ctx)await ctx.close();server.close();await rm(dir,{recursive:true,force:true});}
