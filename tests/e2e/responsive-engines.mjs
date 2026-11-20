// Playwright engine viewport emulation; this does not establish real mobile-device support.
import {createServer} from 'vite';
import {firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {navigate,screens} from './ui-navigation.mjs';

const kind=process.argv[2];
if(!['firefox','webkit'].includes(kind)) throw new Error('Choose firefox or webkit');
const engine=kind==='firefox'?firefox:webkit;const label=kind==='firefox'?'Firefox':'WebKit';
const sizes=[[240,500],[320,568],[390,844],[667,375],[844,390],[761,800],[768,1024],[1440,900],[1920,1080]];
const server=await createServer({configFile:'vite.config.ts',server:{host:'127.0.0.1',port:0,strictPort:false}});await server.listen();
const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await engine.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('h1').waitFor();
  await page.getByRole('button',{name:'Get started',exact:true}).click();
  await page.locator('#passphrase').fill('synthetic firefox viewport passphrase');await page.locator('#confirm-pass').fill('synthetic firefox viewport passphrase');
  await page.getByRole('dialog').getByRole('button',{name:'Create vault'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.getByRole('button',{name:'New portal'}).click();
  await page.locator('#label').fill(`${label} viewport fixture`);await page.locator('#url').fill('https://responsive.example.test');
  await page.locator('#username').fill('synthetic');await page.locator('#password').fill('synthetic-firefox-password');
  await page.getByRole('dialog').getByRole('button',{name:'Save encrypted profile'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.getByText(`${label} viewport fixture`,{exact:true}).waitFor();
  for(const theme of ['light','dark']) {
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'Toggle light and dark theme'}).click();
    for(const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      for(const screen of screens) {
        await navigate(page,screen);
        const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
        assert(size.scroll<=size.client+1,`${screen}, ${theme}, ${width}x${height}: ${JSON.stringify(size)}`);
        if(await page.locator('.mobile-nav').isVisible()) {
          await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
          const footer=await page.locator('.app-footer').boundingBox();const nav=await page.locator('.mobile-nav').boundingBox();
          assert(footer&&nav&&footer.y+footer.height<=nav.y+1,`${screen}, ${theme}, ${width}x${height}: footer under navigation`);
        }
      }
    }
  }
  await page.setViewportSize({width:390,height:844});await navigate(page,'overview');
  const more=page.locator('.mobile-nav [data-action=mobile-more]');await more.focus();await page.keyboard.press('Enter');
  assert.equal(await more.getAttribute('aria-expanded'),'true');await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-screen')),'welcome');
  await page.keyboard.press('Escape');assert.equal(await more.getAttribute('aria-expanded'),'false');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-action')),'mobile-more');
  await page.evaluate(()=>{document.querySelector('button[data-action=add-profile]').click();document.querySelector('#password').focus();});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,40)));assert.equal(await page.evaluate(()=>document.activeElement?.id),'password');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#app').evaluate(el=>el.inert),false);
  assert(!(await page.locator('body').innerText()).includes('synthetic-firefox-password'));assert.deepEqual(errors,[]);
  if(kind==='webkit') {
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    const phone=await context.newPage();await phone.goto(origin);await phone.locator('h1').waitFor();
    assert.equal(await phone.evaluate(()=>document.documentElement.clientWidth),390);
    await phone.locator('.mobile-nav [data-action=mobile-more]').tap();await phone.locator('.mobile-more-panel [data-screen=welcome]').tap();
    await phone.getByRole('button',{name:'Create your vault'}).tap();
    await phone.locator('#passphrase').fill('synthetic webkit touchscreen passphrase');await phone.locator('#confirm-pass').fill('synthetic webkit touchscreen passphrase');
    await phone.getByRole('dialog').getByRole('button',{name:'Create vault'}).tap();await phone.locator('.dialog-backdrop').waitFor({state:'detached'});
    await phone.locator('.mobile-nav [data-screen=portals]').tap();await phone.getByRole('button',{name:'New portal'}).tap();
    await phone.locator('#label').fill('WebKit touch fixture');await phone.locator('#url').fill('https://touch.example.test');
    await phone.locator('#username').fill('synthetic');await phone.locator('#password').fill('synthetic-webkit-touch-password');
    await phone.getByRole('dialog').getByRole('button',{name:'Save encrypted profile'}).tap();await phone.locator('.dialog-backdrop').waitFor({state:'detached'});
    await phone.getByText('WebKit touch fixture',{exact:true}).waitFor();await context.close();
  }
  console.log(`PASS ${label} engine emulation: ${sizes.length} portrait/landscape/desktop viewports, 9 screens, both themes, keyboard navigation and dialog focus${kind==='webkit'?', plus emulated mobile touch':''}. Real mobile devices and Safari extension functionality remain untested.`);
} finally {await browser.close();await server.close();}
