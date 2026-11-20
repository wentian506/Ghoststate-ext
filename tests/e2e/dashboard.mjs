import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {navigate,screens} from './ui-navigation.mjs';

const server=await createServer({configFile:'vite.config.ts',server:{host:'127.0.0.1',port:0,strictPort:false}});await server.listen();
const address=server.httpServer.address();const origin=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--no-sandbox']});
const temp=await mkdtemp(path.join(tmpdir(),'ghoststate-dashboard-test-'));
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()) && !request.url().startsWith(origin+'/')) external.push(request.url());});
  await page.goto(origin);
  await page.getByText('Local web workspace').waitFor();
  const previewNotice=page.getByRole('complementary',{name:'Preview limitations'});
  await previewNotice.getByText('Interface preview').waitFor();
  assert.match(await previewNotice.innerText(),/Use sample data only/);
  assert.match(await previewNotice.innerText(),/Bluetooth also needs a separate companion/);
  assert.equal(await page.locator('h1').innerText(),'Dashboard');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  assert.equal(await page.locator('.brand-mark img').evaluate(img=>img.naturalWidth>0),true);
  assert.equal(await page.locator('link[rel=icon]').getAttribute('href'),'./assets/ghoststate-logo.png');
  assert.equal(await page.locator('.metric-card').count(),3);
  assert.equal(await page.locator('.metric-card').first().locator('.metric-middle strong').innerText(),'Not created');
  assert.equal(await page.locator('[data-filter=learned]').isDisabled(),true);
  assert.equal(await page.locator('.portal-row').count(),0); // no invented records

  await page.getByRole('button',{name:'Get started',exact:true}).click();
  await page.locator('#passphrase').fill('synthetic dashboard passphrase');
  await page.locator('#confirm-pass').fill('synthetic dashboard passphrase');
  await page.getByRole('dialog').getByRole('button',{name:'Create vault'}).click();
  await page.getByText('Your encrypted vault is ready.').waitFor();
  await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.locator('[data-filter=learned]:not(:disabled)').waitFor();

  async function addProfile(label,url) {
    await page.getByRole('button',{name:'New portal'}).click();
    await page.locator('#label').fill(label);await page.locator('#url').fill(url);
    await page.locator('#username').fill('synthetic-user');await page.locator('#password').fill('synthetic-password');
    await page.getByRole('dialog').getByRole('button',{name:'Save encrypted profile'}).click();
    await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  }
  await addProfile('Zeta synthetic portal','https://zeta.example.test');
  await addProfile('Alpha synthetic portal','https://alpha.example.test');
  await page.waitForFunction(()=>document.querySelectorAll('.portal-row').length===2);
  const names=()=>page.locator('.portal-row .workspace-row-main strong').allTextContents();
  assert.deepEqual(await names(),['Alpha synthetic portal','Zeta synthetic portal']);
  assert(!((await page.locator('body').innerText()).includes('synthetic-password')));

  await page.getByRole('button',{name:'Learned',exact:true}).click();
  assert.equal(await page.locator('[data-filter=learned]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-filter')),'learned');
  await page.getByText('No learned profiles yet').waitFor();
  await page.getByRole('button',{name:'Needs setup'}).click();
  assert.deepEqual(await names(),['Alpha synthetic portal','Zeta synthetic portal']);
  await page.locator('button[data-action=sort-profiles]').click();
  assert.deepEqual(await names(),['Zeta synthetic portal','Alpha synthetic portal']);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-action')),'sort-profiles');
  await page.getByRole('button',{name:'All portals'}).click();
  assert.deepEqual(await names(),['Zeta synthetic portal','Alpha synthetic portal']);

  await page.getByRole('button',{name:'Toggle light and dark theme'}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.reload();
  await page.getByText('Local web workspace').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.equal(await page.locator('.metric-card').first().locator('.metric-middle strong').innerText(),'Locked');
  assert(!((await page.locator('body').innerText()).includes('Alpha synthetic portal')));
  await page.locator('button[data-action=unlock]').first().click();
  await page.locator('#passphrase').fill('synthetic dashboard passphrase');
  await page.getByRole('dialog').getByRole('button',{name:'Unlock vault'}).click();
  await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Portal profiles'}).click();
  await page.getByText('Alpha synthetic portal',{exact:true}).waitFor();
  // A dialog must never move focus later after the user has chosen another field.
  // The former deferred initial focus could redirect password typing to the profile name.
  await page.evaluate(()=>{document.querySelector('button[data-action=add-profile]').click();document.querySelector('#password').focus();});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,40)));
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'password');
  await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click();
  // Local generator does not save a profile or alter a website until the user acts.
  await page.getByRole('button',{name:'New portal'}).click();await page.locator('.generator summary').click();
  await page.locator('#generate-password').click();const generated=await page.locator('#password').inputValue();
  assert.equal(generated.length,20);assert.match(generated,/[A-Z]/);assert.match(generated,/[a-z]/);assert.match(generated,/[2-9]/);assert.match(generated,/[!@#$%^&*_=+\-]/);
  await page.locator('#show-generated').check();assert.equal(await page.locator('#password').getAttribute('type'),'text');await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click();
  await page.locator('#profile-search').fill('alpha');assert.equal(await page.locator('.list-row').count(),1);await page.getByText('Alpha synthetic portal',{exact:true}).waitFor();
  await page.locator('#profile-search').fill('nothing-matches');await page.getByText('No matching profiles').waitFor();await page.locator('#profile-search').fill('');
  let alpha=page.locator('.list-row').filter({hasText:'Alpha synthetic portal'});assert.match(await alpha.innerText(),/Password reused in this vault/);
  await alpha.getByRole('button',{name:'Reveal',exact:true}).click();await page.locator('#reveal-pass').fill('wrong');await page.getByRole('dialog').getByRole('button',{name:'Reveal credential'}).click();await page.getByText('Incorrect master passphrase.').waitFor();
  await page.locator('#reveal-pass').fill('synthetic dashboard passphrase');await page.getByRole('dialog').getByRole('button',{name:'Reveal credential'}).click();
  await page.locator('#revealed-password').waitFor();assert.equal(await page.locator('#revealed-password').inputValue(),'synthetic-password');
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin});await page.getByRole('button',{name:'Copy password'}).click();
  await page.getByText('Copied. Clipboard history may retain it.').waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'synthetic-password');await page.getByRole('button',{name:'Done',exact:true}).click();
  alpha=page.locator('.list-row').filter({hasText:'Alpha synthetic portal'});await alpha.getByRole('button',{name:'Edit',exact:true}).click();
  await page.locator('#password').fill('changed-synthetic-password');
  assert.equal(await page.locator('#label').inputValue(),'Alpha synthetic portal');
  assert.equal(await page.locator('#password').inputValue(),'changed-synthetic-password');
  await page.locator('#edit-pass').fill('wrong');await page.getByRole('button',{name:'Save profile changes'}).click();await page.getByText('Incorrect master passphrase.').waitFor();
  await page.locator('#edit-pass').fill('synthetic dashboard passphrase');await page.getByRole('button',{name:'Save profile changes'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  // The form closes before its asynchronous refresh completes; wait for the new vault state.
  await page.waitForFunction(()=>{const row=[...document.querySelectorAll('.list-row')].find(el=>el.textContent?.includes('Alpha synthetic portal'));return row && !row.textContent?.includes('Password reused in this vault');});
  alpha=page.locator('.list-row').filter({hasText:'Alpha synthetic portal'});assert.doesNotMatch(await alpha.innerText(),/Password reused in this vault/);
  assert.equal(await alpha.locator('.list-main strong').innerText(),'Alpha synthetic portal');
  assert(!((await page.locator('body').innerText()).includes('changed-synthetic-password'))); // no accidental secret in the normal profile list
  await alpha.getByRole('button',{name:'Reveal',exact:true}).click();await page.locator('#reveal-pass').fill('synthetic dashboard passphrase');await page.getByRole('button',{name:'Reveal credential'}).click();await page.locator('#revealed-password').waitFor();assert.equal(await page.locator('#revealed-password').inputValue(),'changed-synthetic-password');await page.getByRole('button',{name:'Done',exact:true}).click();
  console.log('PASS local generation, search, reuse warning, reauthenticated reveal/copy and profile editing');
  await page.getByRole('button',{name:'Toggle light and dark theme'}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');

  for(const width of [390,320,768,900]) {
    await page.setViewportSize({width,height:844});
    for(const name of screens) {
      await navigate(page,name);
      const size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      assert(size.scroll<=size.width+1,`${name} overflows at ${width}px: ${JSON.stringify(size)}`);
    }
  }
  await page.setViewportSize({width:390,height:844});
  await navigate(page,'overview');
  const newPortal=page.getByRole('button',{name:'New portal'});
  await newPortal.click();
  assert.equal(await page.locator('#app').evaluate(app=>app.inert),true);
  await page.locator('#label').waitFor();
  await page.waitForFunction(()=>document.activeElement?.id==='label');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app').evaluate(app=>app.inert),false);
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-action')),'add-profile');

  await page.setViewportSize({width:1440,height:900});
  await page.locator('button[data-screen=security]').first().click();
  await page.locator('#logging').waitFor();
  assert.equal(await page.locator('#logging').isChecked(),false); // opt-in by default
  await page.locator('#logging').check();
  await page.getByText('Security settings saved.').waitFor();
  await addProfile('Logged synthetic portal','https://logged.example.test');
  await page.locator('button[data-screen=activity]').first().click();
  await page.getByText('Profile saved',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Clear activity'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Clear activity'}).click();
  await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.getByText('Nothing to show yet').waitFor();

  await page.locator('button[data-screen=security]').first().click();
  await page.getByText('Offline password health').waitFor();await page.getByRole('button',{name:'Cloud backup guidance'}).click();
  await page.getByText('GhostState has no cloud sync service.',{exact:false}).waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export encrypted backup'}).click();
  const download=await downloadPromise;const backup=path.join(temp,'backup.json');await download.saveAs(backup);
  const backupText=await readFile(backup,'utf8');assert(!backupText.includes('synthetic-password'));assert(!backupText.includes('synthetic dashboard passphrase'));
  assert.equal(JSON.parse(backupText).format,'ghoststate-encrypted-backup');
  await page.getByRole('button',{name:'Delete this vault'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Delete vault'}).click();
  await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.locator('button[data-screen=overview]').first().click();
  await page.getByRole('button',{name:'Get started',exact:true}).click();
  await page.getByRole('link',{name:'Restore it instead'}).click();
  await page.locator('#backup').setInputFiles(backup);await page.locator('#restore-pass').fill('synthetic dashboard passphrase');
  await page.getByRole('dialog').getByRole('button',{name:'Restore vault'}).click();
  await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.getByText('Alpha synthetic portal',{exact:true}).waitFor();
  await page.locator('button[data-screen=portals]').first().click();await page.getByRole('button',{name:'Import CSV'}).click();
  const csv='name,url,username,password,note,otp\nAlpha duplicate,https://alpha.example.test,synthetic-user,ignored-secret,NOTE-TO-DROP,OTP-TO-DROP\n"Imported, Example",https://imported.example.test/path,"new,user","long-synthetic-secret",NOTE-TO-DROP,OTP-TO-DROP\nInvalid,http://unsafe.example,u,p,ignore,ignore\n';
  await page.locator('#import-file').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.getByRole('button',{name:'Review logins'}).click();
  await page.getByRole('dialog',{name:'Review CSV import'}).waitFor();assert.match(await page.getByRole('dialog').innerText(),/2 supported login\(s\) found; 1 unsupported/);await page.getByText('Why some rows were skipped').click();await page.getByText('Row 4: Unsupported or invalid site URL').waitFor();
  assert(!((await page.getByRole('dialog').innerText()).includes('OTP-TO-DROP')));assert(!((await page.getByRole('dialog').innerText()).includes('long-synthetic-secret')));
  await page.locator('#import-pass').fill('wrong');await page.getByRole('button',{name:'Import into vault'}).click();await page.getByText('Incorrect master passphrase.').waitFor();
  await page.locator('#import-pass').fill('synthetic dashboard passphrase');await page.getByRole('button',{name:'Import into vault'}).click();await page.locator('.dialog-backdrop').waitFor({state:'detached'});
  await page.getByText('1 login(s) imported; 1 duplicate(s) skipped.').waitFor();await page.getByText('Imported, Example',{exact:true}).waitFor();
  console.log('PASS explicit CSV review, master reauthentication, atomic import and duplicate/unsupported handling');

  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS redesigned dashboard: local branding/assets, honest empty/locked states, vault, profiles, filtering/sorting, persisted themes, mobile/desktop layouts, keyboard dismissal, opt-in activity, encrypted backup and restore');
} finally {await browser.close();await server.close();await rm(temp,{recursive:true,force:true});}
