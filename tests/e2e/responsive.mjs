// Layout checks use viewport/touch emulation, not real phones or assistive technology.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {navigate,screens} from './ui-navigation.mjs';

const sizes=[
  [240,500],[280,653],[320,568],[320,480],[320,240],[360,640],[390,844],[414,896],
  [540,720],[667,375],[844,390],[1000,500],[760,800],[761,800],[768,1024],
  [900,600],[1024,600],[1024,360],[1180,800],[1440,900],[1920,1080],[2560,1440],
];
const lockedSizes=[[240,500],[390,844],[844,390],[768,1024],[1440,900],[2560,1440]];
const titles={overview:'Dashboard',portals:'Portal profiles',workflows:'Workflows',devices:'Devices & transfer',activity:'Activity log',security:'Privacy & security',compatibility:'Compatibility',welcome:'Getting started',help:'Help & support'};
const server=await createServer({configFile:'vite.config.ts',server:{host:'127.0.0.1',port:0,strictPort:false}});await server.listen();
const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--no-sandbox']});
const temp=await mkdtemp(path.join(tmpdir(),'ghoststate-responsive-'));
let extensionContext;
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('h1').waitFor();

  async function fits(label) {
    const {client,scroll}=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    assert(scroll<=client+1,`${label}: document is ${scroll}px wide in a ${client}px viewport`);
  }
  async function navigationFits(label) {
    if(!await page.locator('.mobile-nav').isVisible()) return;
    const info=await page.locator('.mobile-nav').evaluate(nav=>({
      top:nav.getBoundingClientRect().top,bottom:nav.getBoundingClientRect().bottom,
      viewport:innerHeight,buttons:[...nav.querySelectorAll('button')].map(b=>({label:b.textContent.trim(),...(({x,y,width,height})=>({x,y,width,height}))(b.getBoundingClientRect())}))
    }));
    assert(Math.abs(info.bottom-info.viewport)<1,`${label}: bottom navigation is not anchored in the viewport`);
    assert.equal(info.buttons.length,5);
    for(const button of info.buttons) {
      assert(button.width>=44-1 && button.height>=44-1,`${label}: ${button.label} does not have a roughly 44px touch target`);
      assert(button.x>=-1 && button.x+button.width<=page.viewportSize().width+1,`${label}: ${button.label} is clipped`);
    }
    // Content at the end of a screen can scroll entirely above the fixed navigation.
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    const footer=await page.locator('.app-footer').boundingBox();
    assert(footer && footer.y+footer.height<=info.top+1,`${label}: footer cannot scroll above navigation`);
  }
  async function matrix(state,dimensions) {
    for(const theme of ['light','dark']) {
      if(await page.locator('html').getAttribute('data-theme')!==theme) await page.getByRole('button',{name:'Toggle light and dark theme'}).click();
      for(const [width,height] of dimensions) {
        await page.setViewportSize({width,height});
        for(const screen of screens) {
          await navigate(page,screen);
          const label=`${state}, ${theme}, ${width}x${height}, ${screen}`;
          assert.equal(await page.locator('h1').innerText(),titles[screen],label);
          await fits(label);
          await navigationFits(label);
        }
      }
    }
  }
  await matrix('locked / fresh',lockedSizes);

  await page.setViewportSize({width:1440,height:900});await navigate(page,'overview');
  await page.getByRole('button',{name:'Get started',exact:true}).click();
  await page.locator('#passphrase').fill('synthetic responsive passphrase');await page.locator('#confirm-pass').fill('synthetic responsive passphrase');
  await page.getByRole('dialog').getByRole('button',{name:'Create vault'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  for(const [label,url] of [
    ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','https://long-synthetic-subdomain-for-layout-testing.example.test'],
    ['Second synthetic portal','https://second.example.test'],
  ]) {
    await page.getByRole('button',{name:'New portal'}).click();
    await page.locator('#label').fill(label);await page.locator('#url').fill(url);await page.locator('#username').fill('synthetic-user');await page.locator('#password').fill('synthetic-responsive-password');
    await page.getByRole('dialog').getByRole('button',{name:'Save encrypted profile'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  }
  await page.waitForFunction(()=>document.querySelectorAll('.portal-row').length===2);
  assert(!(await page.locator('body').innerText()).includes('synthetic-responsive-password'));
  await matrix('unlocked / populated',sizes);

  // The disclosure supports keyboard entry, escape and focus restoration.
  await page.setViewportSize({width:390,height:844});await navigate(page,'overview');
  const more=page.locator('.mobile-nav [data-action=mobile-more]');
  await more.focus();await page.keyboard.press('Enter');
  assert.equal(await more.getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-screen')),'welcome');
  await page.keyboard.press('Escape');
  assert.equal(await more.getAttribute('aria-expanded'),'false');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-action')),'mobile-more');
  await more.click();await page.mouse.click(5,150);
  assert.equal(await more.getAttribute('aria-expanded'),'false');
  await more.click();
  await page.setViewportSize({width:1024,height:768});
  await page.waitForFunction(()=>document.querySelector('[data-action=mobile-more]')?.getAttribute('aria-expanded')==='false');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await more.getAttribute('aria-expanded'),'false');
  await more.click();await page.locator('.mobile-more-panel [data-screen=security]').click();
  assert.equal(await page.locator('h1').innerText(),'Privacy & security');
  assert.equal(await page.locator('.mobile-nav [data-action=mobile-more]').getAttribute('aria-expanded'),'false');
  assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'H1');
  await page.setViewportSize({width:240,height:500});await navigate(page,'compatibility');
  const table=page.getByRole('region',{name:'Browser compatibility table, scroll horizontally if needed'});
  assert(await table.evaluate(el=>el.scrollWidth>el.clientWidth),'narrow compatibility table should have a scrollable region');
  await table.focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('.table-scroll')?.scrollLeft>0,null,{timeout:3000});

  // A short phone, a narrow phone and a landscape phone must allow dialog scrolling and closing.
  for(const [width,height] of [[240,500],[320,240],[390,844],[844,390]]) {
    await page.setViewportSize({width,height});await navigate(page,'overview');
    await page.getByRole('button',{name:'New portal'}).click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();await fits(`${width}x${height} dialog`);
    await dialog.getByRole('button',{name:'Close dialog'}).focus();await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('type')),'submit',`${width}x${height}: modal focus should wrap from first to last visible control`);
    const box=await dialog.boundingBox();
    assert(box && box.x>=-1 && box.x+box.width<=width+1 && box.y>=-1 && box.y+box.height<=height+1,`${width}x${height}: dialog exceeds viewport`);
    await page.locator('.generator summary').click();
    await page.locator('#generate-password').click();assert.equal((await page.locator('#password').inputValue()).length,20);
    await dialog.getByRole('button',{name:'Cancel'}).click();assert.equal(await page.locator('#app').evaluate(el=>el.inert),false);
  }
  assert.deepEqual(errors,[]);

  // Separate fresh context approximates a phone viewport with touch events; it is not a physical-device test.
  const touch=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const phone=await touch.newPage();await phone.goto(origin);await phone.locator('h1').waitFor();
  assert.equal(await phone.evaluate(()=>document.documentElement.clientWidth),390);
  await phone.locator('.mobile-nav [data-action=mobile-more]').tap();
  await phone.locator('.mobile-more-panel [data-screen=welcome]').tap();assert.equal(await phone.locator('h1').innerText(),'Getting started');
  await phone.getByRole('button',{name:'Create your vault'}).tap();
  await phone.locator('#passphrase').fill('synthetic touchscreen passphrase');await phone.locator('#confirm-pass').fill('synthetic touchscreen passphrase');
  await phone.getByRole('dialog').getByRole('button',{name:'Create vault'}).tap();await phone.locator('.dialog-backdrop').waitFor({state:'detached'});
  await phone.locator('.mobile-nav [data-screen=portals]').tap();
  await phone.getByRole('button',{name:'New portal'}).tap();
  await phone.locator('#label').fill('Touchscreen fixture');await phone.locator('#url').fill('https://touchscreen.example.test');
  await phone.locator('#username').fill('synthetic-user');await phone.locator('#password').fill('synthetic-touch-password');
  await phone.getByRole('dialog').getByRole('button',{name:'Save encrypted profile'}).tap();await phone.locator('.dialog-backdrop').waitFor({state:'detached'});
  await phone.getByText('Touchscreen fixture',{exact:true}).waitFor();
  await phone.locator('.mobile-nav [data-action=mobile-more]').tap();await phone.locator('.mobile-more-panel [data-action=lock]').tap();
  await phone.getByText('Your vault is locked',{exact:true}).waitFor();
  await phone.locator('.mobile-nav [data-action=mobile-more]').tap();await phone.locator('.mobile-more-panel [data-action=unlock]').tap();
  await phone.locator('#passphrase').fill('synthetic touchscreen passphrase');await phone.getByRole('dialog').getByRole('button',{name:'Unlock vault'}).tap();
  await phone.locator('.dialog-backdrop').waitFor({state:'detached'});await phone.getByText('Touchscreen fixture',{exact:true}).waitFor();
  await touch.close();

  // The packaged popup remains usable in its normal width and narrower emulated viewports.
  const ext=path.resolve('release/chromium');
  extensionContext=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  const worker=extensionContext.serviceWorkers()[0]||await extensionContext.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const popup=await extensionContext.newPage();
  for(const theme of ['light','dark']) for(const width of [240,280,320,344]) {
    await popup.setViewportSize({width,height:700});
    await popup.goto(`chrome-extension://${id}/popup.html`);await popup.evaluate(theme=>localStorage.setItem('ghoststate-theme',theme),theme);await popup.reload();
    await popup.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
    const s=await popup.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,logo:document.querySelector('.mark').naturalWidth}));
    assert(s.scroll<=s.client+1,`popup ${theme} ${width}px overflows`);assert(s.logo>0);
  }
  console.log(`PASS ${sizes.length} populated and ${lockedSizes.length} fresh/locked emulated viewports, 9 screens, both themes, portrait/landscape/short sizes, touch and keyboard navigation, dialog scrolling, and 240–344px packaged popups. Real devices remain untested.`);
} finally {
  await extensionContext?.close();await browser.close();await server.close();await rm(temp,{recursive:true,force:true});
}
