// Automated checks are not a substitute for manual screen-reader and accessibility review.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import axe from 'axe-core';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {navigate,screens} from './ui-navigation.mjs';

const tags=['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
let checks=0;
async function inject(page) { await page.addScriptTag({content:axe.source}); }
async function audit(page,label) {
  const result=await page.evaluate(async tags=>window.axe.run(document,{runOnly:{type:'tag',values:tags}}),tags);
  checks++;
  if(result.violations.length) {
    for(const item of result.violations) console.error(`${label}: ${item.id} (${item.impact}): ${item.nodes.map(n=>n.target.join(' ')).join('; ')}`);
    throw new Error(`${label} has ${result.violations.length} automated accessibility violation(s)`);
  }
}
const server=await createServer({configFile:'vite.config.ts',server:{host:'127.0.0.1',port:0,strictPort:false}});await server.listen();
const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--no-sandbox']});
let extContext;const temp=await mkdtemp(path.join(tmpdir(),'ghoststate-accessibility-'));
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await page.goto(origin);await page.locator('h1').waitFor();await inject(page);
  await audit(page,'fresh dashboard / light');
  await page.getByRole('button',{name:'Get started',exact:true}).click();await audit(page,'create-vault dialog');
  await page.locator('#passphrase').fill('synthetic accessibility passphrase');await page.locator('#confirm-pass').fill('synthetic accessibility passphrase');
  await page.getByRole('dialog').getByRole('button',{name:'Create vault'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.getByRole('button',{name:'New portal'}).click();await audit(page,'add-portal dialog');await page.locator('.generator summary').click();await audit(page,'password generator options');
  await page.locator('#label').fill('Accessibility fixture');await page.locator('#url').fill('https://accessibility.example.test');
  await page.locator('#username').fill('synthetic-user');await page.locator('#password').fill('synthetic-password');
  await page.getByRole('dialog').getByRole('button',{name:'Save encrypted profile'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.locator('.nav-button[data-screen=portals]').click();await page.getByRole('button',{name:'Import CSV'}).click();await audit(page,'CSV selection dialog');
  await page.locator('#import-file').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from('name,url,username,password\nImported,https://imported.example.test,test,synthetic\nSkipped,http://unsafe.example,test,synthetic\n')});await page.getByRole('button',{name:'Review logins'}).click();await page.getByRole('dialog',{name:'Review CSV import'}).waitFor();await audit(page,'CSV review dialog');await page.getByText('Why some rows were skipped').click();await audit(page,'CSV skipped-row explanation');await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click();
  await page.getByRole('button',{name:'Edit',exact:true}).click();await audit(page,'edit profile dialog');await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click();
  await page.getByRole('button',{name:'Reveal',exact:true}).click();await audit(page,'reauthenticate to reveal dialog');await page.locator('#reveal-pass').fill('synthetic accessibility passphrase');await page.getByRole('button',{name:'Reveal credential'}).click();await page.locator('#revealed-password').waitFor();await audit(page,'revealed credential dialog');await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.locator('.nav-button[data-screen=security]').click();await page.getByRole('button',{name:'Cloud backup guidance'}).click();await audit(page,'cloud backup guidance dialog');await page.getByRole('button',{name:'Done',exact:true}).click();
  for(const theme of ['light','dark']) {
    if(theme==='dark')await page.getByRole('button',{name:'Toggle light and dark theme'}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
    for(const [width,height] of [[1440,900],[390,900],[844,390],[240,500]]) {
      await page.setViewportSize({width,height});
      for(const screen of screens) {
        await navigate(page,screen);
        await audit(page,`${screen} / ${theme} / ${width}px`);
      }
      if(await page.locator('.mobile-nav').isVisible()) {
        await page.locator('.mobile-nav [data-action=mobile-more]').click();
        await audit(page,`expanded mobile navigation / ${theme} / ${width}x${height}`);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.mobile-nav [data-action=mobile-more]').getAttribute('aria-expanded'),'false');
        await page.getByRole('button',{name:'New portal'}).click();
        await audit(page,`mobile add-portal dialog / ${theme} / ${width}x${height}`);
        await page.locator('.generator summary').click();
        await audit(page,`mobile password generator / ${theme} / ${width}x${height}`);
        await page.keyboard.press('Escape');
      }
    }
  }
  await browser.close();
  // Bypass CSP only in this test browser so the local axe script can be injected.
  // The shipped extension and its CSP are unmodified.
  const ext=path.resolve('release/chromium');
  extContext=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,bypassCSP:true,reducedMotion:'reduce',args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  const worker=extContext.serviceWorkers()[0]||await extContext.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const popup=await extContext.newPage();await popup.setViewportSize({width:344,height:650});await popup.goto(`chrome-extension://${id}/popup.html`);await inject(popup);await audit(popup,'popup / light');
  await popup.evaluate(()=>localStorage.setItem('ghoststate-theme','dark'));await popup.reload();await popup.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await inject(popup);await audit(popup,'popup / dark');
  console.log(`PASS ${checks} automated axe-core WCAG 2.0/2.1/2.2 A/AA checks across dialogs, populated and empty dashboard states, light/dark, desktop/mobile and popup. Manual accessibility review remains necessary.`);
} finally {await extContext?.close();await browser.close().catch(()=>{});await server.close();await rm(temp,{recursive:true,force:true});}
