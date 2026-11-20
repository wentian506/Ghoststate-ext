// Exercise the exact release archives on Linux. No Windows OS or Bluetooth radio is simulated.
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd(),version=JSON.parse(await readFile('package.json','utf8')).version;
const release=path.resolve('release'),prefix=`ghoststate-${version}`;
const archives={store:`${prefix}-chrome-store.zip`,dev:`${prefix}-chrome-dev-unpacked.zip`,win:`${prefix}-companion-windows-x64-experimental.zip`,linux:`${prefix}-companion-linux-x64-experimental.zip`,assets:`${prefix}-store-listing-assets.zip`,preview:`${prefix}-web-preview.zip`,firefox:`${prefix}-firefox.zip`,kit:`${prefix}-developer-kit.zip`,project:`${prefix}-project.zip`,complete:`${prefix}-complete-package.zip`};
const temp=await mkdtemp(path.join(tmpdir(),'gs-release-check-'));let ctx,previewServer,previewBrowser;
async function files(dir,sub=''){
  let out=[];
  for(const ent of await readdir(path.join(dir,sub),{withFileTypes:true})){
    const rel=path.posix.join(sub,ent.name);
    if(ent.isDirectory())out.push(...await files(dir,rel));else if(ent.isFile())out.push(rel);else throw new Error(`Unexpected link in extracted archive: ${rel}`);
  }
  return out.sort();
}
async function extract(name,label){
  const archive=path.join(release,name),out=path.join(temp,label);await mkdir(out);
  const entries=execFileSync('unzip',['-Z1',archive],{encoding:'utf8'}).trim().split('\n');
  assert.equal(new Set(entries).size,entries.length,'duplicate ZIP names');
  for(const entry of entries)assert(!entry.startsWith('/')&&!entry.includes('\\')&&!entry.split('/').includes('..'),`unsafe ZIP name ${entry}`);
  execFileSync('unzip',['-tq',archive],{stdio:'ignore'});execFileSync('unzip',['-qq',archive,'-d',out]);return out;
}
try {
  execFileSync('sha256sum',['-c','SHA256SUMS'],{cwd:release,stdio:'ignore'});
  const store=await extract(archives.store,'store'),dev=await extract(archives.dev,'dev'),kit=await extract(archives.kit,'kit'),complete=await extract(archives.complete,'complete');
  const assets=await extract(archives.assets,'assets'),win=await extract(archives.win,'win'),linux=await extract(archives.linux,'linux'),project=await extract(archives.project,'project');
  const preview=path.join(await extract(archives.preview,'preview'),'GhostState-Preview'),firefox=await extract(archives.firefox,'firefox');
  const unpacked=path.join(dev,'GhostState-Unpacked');const storeFiles=await files(store);
  assert(storeFiles.includes('manifest.json'),'Store ZIP must have root manifest.json');
  assert.deepEqual(await files(unpacked),storeFiles,'developer build must contain the same extension files');
  for(const name of storeFiles)assert.deepEqual(await readFile(path.join(unpacked,name)),await readFile(path.join(store,name)),`developer file differs: ${name}`);
  assert(!storeFiles.some(name=>/server|vite|\.exe$|\.jpg$/i.test(name)),'Chrome package must not include a server, executable or old JPEG');
  const manifest=JSON.parse(await readFile(path.join(store,'manifest.json'),'utf8'));
  assert.equal(manifest.version,version);assert.equal(manifest.manifest_version,3);assert.equal(manifest.background.service_worker,'background.js');
  assert.equal(manifest.host_permissions,undefined);assert(manifest.optional_permissions.includes('nativeMessaging'));
  assert.equal(manifest.web_accessible_resources,undefined,'the native bridge is not exposed as a web-accessible resource');
  assert(storeFiles.includes('native-bridge.html')&&storeFiles.includes('native-bridge.js'),'bundled local native bridge is present');
  for(const label of ['store','dev','win','linux','assets','preview'])assert.deepEqual(await readFile(path.join(kit,archives[label])),await readFile(path.join(release,archives[label])),`${label} archive inside kit differs`);
  for(const label of ['store','dev','win','linux','assets','preview','firefox','project','kit'])assert.deepEqual(await readFile(path.join(complete,archives[label])),await readFile(path.join(release,archives[label])),`${label} archive inside complete package differs`);
  execFileSync('sha256sum',['-c','SHA256SUMS'],{cwd:kit,stdio:'ignore'});
  execFileSync('sha256sum',['-c','SHA256SUMS'],{cwd:complete,stdio:'ignore'});
  assert.deepEqual(await readFile(path.join(kit,'DEPLOYMENT-GUIDE.md')),await readFile('docs/DEPLOYMENT_GUIDE.md'));
  assert.deepEqual(await readFile(path.join(complete,'START-HERE.md')),await readFile('docs/DEPLOYMENT_GUIDE.md'));
  assert.deepEqual(await readFile(path.join(complete,'GhostState-Simple-Guide.pdf')),await readFile('docs/GhostState_Simple_Guide.pdf'));
  const previewFiles=await files(preview);
  assert.deepEqual(previewFiles,['README.md','assets/INTER-OFL.txt','assets/ghoststate-logo.png','assets/inter-latin.woff2','dashboard.css','dashboard.js','index.html'].sort());
  for(const name of ['dashboard.css','dashboard.js','assets/INTER-OFL.txt','assets/ghoststate-logo.png','assets/inter-latin.woff2'])assert.deepEqual(await readFile(path.join(preview,name)),await readFile(path.join(store,name)),`preview asset differs: ${name}`);
  assert.deepEqual(await readFile(path.join(preview,'index.html')),await readFile(path.join(store,'dashboard.html')));
  assert.deepEqual(await readFile(path.join(firefox,'manifest.json')),await readFile(path.join(release,'firefox/manifest.json')));
  assert.equal((await readFile(path.join(win,'ghoststate-companion.exe'))).subarray(0,2).toString(),'MZ');
  assert.deepEqual((await readFile(path.join(linux,'ghoststate-companion'))).subarray(0,4),Buffer.from([0x7f,0x45,0x4c,0x46]));
  assert.equal((await stat(path.join(linux,'install-native.sh'))).mode&0o111,0o111);
  assert.deepEqual(await readFile(path.join(win,'ghoststate-companion.exe')),await readFile(path.join(release,'native-windows-x64/ghoststate-companion.exe')));
  assert.deepEqual(await readFile(path.join(linux,'ghoststate-companion')),await readFile(path.join(release,'native-linux-x86_64/ghoststate-companion')));
  for(const name of ['CHROME_STORE_RELEASE.md','PRIVACY_POLICY_TEMPLATE.md','BLUETOOTH_TEST_PLAN.md','REVIEWER_INSTRUCTIONS.md'])assert((await stat(path.join(assets,name))).isFile());
  for(const [name,w,h] of [['01-dashboard.png',1280,800],['02-portal-profiles.png',1280,800],['03-workflows.png',1280,800],['04-experimental-bluetooth.png',1280,800],['store-icon-128.png',128,128],['optional-promo-440x280.png',440,280]]){
    const png=await readFile(path.join(assets,name));assert.deepEqual(png.subarray(0,8),Buffer.from('89504e470d0a1a0a','hex'));
    assert.equal(png.readUInt32BE(16),w);assert.equal(png.readUInt32BE(20),h);assert.equal(png[25],2,`${name} must be RGB PNG`);
    assert.deepEqual(png,await readFile(path.join(release,'store-listing',name)),`${name} asset is stale`);
  }
  assert((await stat(path.join(project,'apps/dashboard/assets/ghoststate-logo-original.png'))).isFile());
  // Run the extracted STORE ZIP itself, not the build directory. A persistent browser
  // profile verifies that the synthetic encrypted vault survives a real restart.
  const profile=path.join(temp,'profile');
  const launch=()=>chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--no-sandbox',`--disable-extensions-except=${store}`,`--load-extension=${store}`]});
  ctx=await launch();let worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker',{timeout:15000}),id=new URL(worker.url()).host;
  let page=await ctx.newPage();await page.goto(`chrome-extension://${id}/dashboard.html`);
  assert.equal(await page.locator('h1').innerText(),'Dashboard');
  await page.getByRole('button',{name:'Get started',exact:true}).click();await page.locator('#passphrase').fill('package synthetic passphrase');await page.locator('#confirm-pass').fill('package synthetic passphrase');
  await page.getByRole('dialog').getByRole('button',{name:'Create vault'}).click();await page.getByText('Your encrypted vault is ready.').waitFor();
  await page.getByRole('button',{name:'New portal'}).click();await page.locator('#label').fill('Package smoke test');await page.locator('#url').fill('https://example.test');await page.locator('#username').fill('synthetic');await page.locator('#password').fill('synthetic only');
  await page.getByRole('button',{name:'Save encrypted profile'}).click();await page.getByText('Portal profile saved locally.').waitFor();
  await ctx.close();ctx=await launch();worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker',{timeout:15000});assert.equal(new URL(worker.url()).host,id);
  page=await ctx.newPage();await page.goto(`chrome-extension://${id}/dashboard.html`);await page.locator('button[data-action=unlock]').first().click();await page.locator('#passphrase').fill('package synthetic passphrase');
  await page.getByRole('dialog').getByRole('button',{name:'Unlock vault',exact:true}).click();await page.getByText('Vault unlocked.').waitFor();await page.getByText('Package smoke test',{exact:true}).first().waitFor();
  await ctx.close();ctx=undefined;
  console.log('PASS exact root-manifest Store archive loaded in Chromium; synthetic vault/profile persisted after browser restart.');
  // Serve the exact extracted static preview over loopback, just as the
  // accompanying README describes. It must remain a clearly labeled demo.
  previewServer=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url||'/', 'http://127.0.0.1');const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file=path.resolve(preview,relative);if(!file.startsWith(preview+path.sep)){res.writeHead(403).end();return;}
      const data=await readFile(file);const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.woff2':'font/woff2'}[path.extname(file)]||'text/plain; charset=utf-8';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'}).end(data);
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve=>previewServer.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${previewServer.address().port}`;previewBrowser=await chromium.launch({channel:'chromium',headless:true,args:['--no-sandbox']});
  const previewPage=await previewBrowser.newPage();const external=[];previewPage.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(origin+'/'))external.push(request.url());});
  await previewPage.goto(origin,{waitUntil:'networkidle'});assert.equal(await previewPage.locator('h1').innerText(),'Dashboard');
  const notice=previewPage.getByRole('complementary',{name:'Preview limitations'});assert.match(await notice.innerText(),/Use sample data only/);assert.match(await notice.innerText(),/Bluetooth also needs a separate companion/);
  await previewPage.getByRole('button',{name:'Get started',exact:true}).click();await previewPage.locator('#passphrase').fill('preview synthetic passphrase');await previewPage.locator('#confirm-pass').fill('preview synthetic passphrase');
  await previewPage.getByRole('dialog').getByRole('button',{name:'Create vault'}).click();await previewPage.getByText('Your encrypted vault is ready.').waitFor();
  await previewPage.getByRole('button',{name:'New portal'}).click();await previewPage.locator('#label').fill('Preview sample');await previewPage.locator('#url').fill('https://preview.example.test');await previewPage.locator('#username').fill('sample-user');await previewPage.locator('#password').fill('sample-only');await previewPage.getByRole('button',{name:'Save encrypted profile'}).click();await previewPage.getByText('Portal profile saved locally.').waitFor();
  await previewPage.locator('.nav-button[data-screen=devices]').click();await previewPage.locator('button[data-action=connect-native]').first().click();await previewPage.getByText('Install the extension and native companion first.').waitFor();
  assert.deepEqual(external,[],'static preview must not fetch remote resources');
  await previewBrowser.close();previewBrowser=undefined;await new Promise(resolve=>previewServer.close(resolve));previewServer=undefined;
  console.log('PASS exact static preview: local assets only, clear limitations, synthetic vault/profile, and native companion unavailable.');
  // Exercise the actual extracted Store archive through the browser's real
  // optional-permission prompt, first with the real Linux host and then with a
  // synthetic transfer double. Neither test exercises a physical radio.
  for(const test of ['native-permission-prompt.mjs','native-bridge-transfer.mjs']) {
    execFileSync('xvfb-run',['-a','-s','-screen 0 1440x1000x24','node',`tests/e2e/${test}`],{cwd:root,env:{...process.env,GS_EXTENSION_PATH:store},stdio:'inherit',timeout:90_000});
  }
  console.log('PASS ZIP safety/integrity, matching developer build, complete package and nested kit/checksums, staged binaries, listing images and source archive. No Windows or BLE test.');
} finally {
  await ctx?.close();await previewBrowser?.close();
  if(previewServer)await new Promise(resolve=>previewServer.close(resolve));
  await rm(temp,{recursive:true,force:true});
}
