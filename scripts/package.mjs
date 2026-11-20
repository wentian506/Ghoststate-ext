import {execFileSync} from 'node:child_process';
import {copyFile,cp,mkdir,mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),release=path.join(root,'release');await mkdir(release,{recursive:true});
const version=JSON.parse(await readFile('package.json','utf8')).version;
if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
for(const family of ['chromium','firefox']) assert.equal(JSON.parse(await readFile(`release/${family}/manifest.json`,'utf8')).version,version,`${family} build is stale`);
const cargo=await readFile('apps/desktop-companion/Cargo.toml','utf8');
assert.match(cargo,new RegExp(`^version = "${version.replaceAll('.','\\.')}"$`,'m'),'Companion source version does not match the release');
const prefix=`ghoststate-${version}`;
const paths={
  store:`${prefix}-chrome-store.zip`, dev:`${prefix}-chrome-dev-unpacked.zip`,
  windows:`${prefix}-companion-windows-x64-experimental.zip`,linux:`${prefix}-companion-linux-x64-experimental.zip`,
  assets:`${prefix}-store-listing-assets.zip`,firefox:`${prefix}-firefox.zip`,
  preview:`${prefix}-web-preview.zip`,project:`${prefix}-project.zip`,
  kit:`${prefix}-developer-kit.zip`,complete:`${prefix}-complete-package.zip`
};
const output=name=>path.join(release,name);
async function zip(name,cwd,files=['.'],extra=[]){await rm(output(name),{force:true});execFileSync('zip',['-X','-q','-r',output(name),...files,...extra],{cwd});}
async function sha(name){return createHash('sha256').update(await readFile(output(name))).digest('hex');}
async function fileNames(dir,prefix=''){
  const result=[];
  for(const ent of await readdir(path.join(dir,prefix),{withFileTypes:true})) {
    const relative=path.posix.join(prefix,ent.name);
    if(ent.isDirectory()) result.push(...await fileNames(dir,relative));
    else if(ent.isFile()) result.push(relative);
    else throw new Error(`Unexpected non-regular extension resource: ${relative}`);
  }
  return result;
}
const required=['manifest.json','background.js','content.js','dashboard.html','dashboard.css','dashboard.js','popup.html','popup.css','popup.js','native-bridge.html','native-bridge.js','icon16.png','icon48.png','icon128.png','assets/ghoststate-logo.png','assets/inter-latin.woff2','assets/INTER-OFL.txt'];
assert.deepEqual((await fileNames('release/chromium')).sort(),required.sort(),'Chrome package contains unexpected or missing files');
const chrome=JSON.parse(await readFile('release/chromium/manifest.json','utf8'));
assert.equal(chrome.manifest_version,3);assert.equal(chrome.background.service_worker,'background.js');assert.equal(chrome.host_permissions,undefined);assert(!chrome.permissions.includes('cookies'));
for(const p of ['release/native-windows-x64/ghoststate-companion.exe','release/native-windows-x64/README-WINDOWS.md','release/native-linux-x86_64/ghoststate-companion','release/native-linux-x86_64/README.md','release/store-listing/01-dashboard.png','release/store-listing/04-experimental-bluetooth.png','release/store-listing/store-icon-128.png']) if(!(await stat(p)).isFile())throw new Error(`Missing release input ${p}`);
const tmp=await mkdtemp(path.join(os.tmpdir(),'ghoststate-package-'));
try {
  await zip(paths.store,path.join(release,'chromium'));
  const entries=execFileSync('unzip',['-Z1',output(paths.store)],{encoding:'utf8'}).trim().split('\n');
  assert(entries.includes('manifest.json'),'Store ZIP must have root manifest.json');
  assert.deepEqual(entries.filter(x=>!x.endsWith('/')).map(x=>x.replace(/^\.\//,'')).sort(),required.sort(),'Store ZIP content differs from the extension allowlist');
  execFileSync('unzip',['-tq',output(paths.store)],{stdio:'ignore'});

  const dev=path.join(tmp,'dev');await mkdir(dev,{recursive:true});await cp(path.join(release,'chromium'),path.join(dev,'GhostState-Unpacked'),{recursive:true});await zip(paths.dev,dev);
  const win=path.join(tmp,'windows');await mkdir(win);
  for(const [from,to] of [['release/native-windows-x64/ghoststate-companion.exe','ghoststate-companion.exe'],['release/native-windows-x64/README-WINDOWS.md','README-WINDOWS.md'],['scripts/install-native.ps1','install-native.ps1'],['scripts/check-native.ps1','check-native.ps1'],['LICENSE','LICENSE']]) await copyFile(from,path.join(win,to));
  await zip(paths.windows,win);
  const linux=path.join(tmp,'linux');await mkdir(linux);
  for(const [from,to] of [['release/native-linux-x86_64/ghoststate-companion','ghoststate-companion'],['release/native-linux-x86_64/README.md','README-LINUX.md'],['scripts/install-native.sh','install-native.sh'],['LICENSE','LICENSE']]) await copyFile(from,path.join(linux,to));
  await zip(paths.linux,linux);
  const assets=path.join(tmp,'assets');await mkdir(assets);await cp('release/store-listing',assets,{recursive:true});
  for(const f of ['CHROME_STORE_RELEASE.md','PRIVACY_POLICY_TEMPLATE.md','BLUETOOTH_TEST_PLAN.md','REVIEWER_INSTRUCTIONS.md'])await copyFile(`docs/${f}`,path.join(assets,f));
  await zip(paths.assets,assets);
  await zip(paths.firefox,path.join(release,'firefox'));
  // A web-only, static UI preview uses the exact locally bundled dashboard
  // assets, without a manifest, extension background or native executable.
  const preview=path.join(tmp,'preview'),previewRoot=path.join(preview,'GhostState-Preview');await mkdir(previewRoot,{recursive:true});
  for(const [from,to] of [['release/chromium/dashboard.html','index.html'],['release/chromium/dashboard.css','dashboard.css'],['release/chromium/dashboard.js','dashboard.js'],['docs/WEB_PREVIEW_README.md','README.md']]) await copyFile(from,path.join(previewRoot,to));
  await cp('release/chromium/assets',path.join(previewRoot,'assets'),{recursive:true});
  await zip(paths.preview,preview);
  // Explicit allowlist avoids local vaults, exports, credentials, private keys or node_modules.
  const projectFiles=['README.md','LICENSE','DEVELOPMENT_STATUS.md','TASKS.md','BUILD_ERRORS.md','.env.example','package.json','package-lock.json','tsconfig.json','vite.config.ts','vitest.config.ts','.gitignore','.github','apps','packages','tests','scripts','docs','release/chromium','release/firefox','release/store-listing','release/native-linux-x86_64/README.md','release/native-linux-x86_64/ghoststate-companion','release/native-windows-x64/README-WINDOWS.md','release/native-windows-x64/ghoststate-companion.exe'];
  await zip(paths.project,root,projectFiles,['-x','*/node_modules/*','*/target/*','*/__pycache__/*','*/.venv/*','*/.env','*/.env.*','*.log','*.pem','*.key','*.p12','*.pfx']);
  const kit=path.join(tmp,'kit');await mkdir(kit);
  const included=[paths.store,paths.dev,paths.windows,paths.linux,paths.assets,paths.preview];
  for(const name of included) await copyFile(output(name),path.join(kit,name));
  await copyFile('docs/CHROME_STORE_RELEASE.md',path.join(kit,'START-HERE.md'));
  await copyFile('docs/DEPLOYMENT_GUIDE.md',path.join(kit,'DEPLOYMENT-GUIDE.md'));
  await copyFile('docs/GhostState_Simple_Guide.pdf',path.join(kit,'GhostState-Simple-Guide.pdf'));
  const kitFiles=[...included,'START-HERE.md','DEPLOYMENT-GUIDE.md','GhostState-Simple-Guide.pdf'];
  let kitSums='';for(const name of kitFiles)kitSums+=`${createHash('sha256').update(await readFile(path.join(kit,name))).digest('hex')}  ${name}\n`;
  await writeFile(path.join(kit,'SHA256SUMS'),kitSums);
  await zip(paths.kit,kit);
  // A single convenience download includes every separately named deliverable.
  // This archive is never itself a browser Store upload.
  const complete=path.join(tmp,'complete');await mkdir(complete);
  const completeArchives=[paths.store,paths.dev,paths.windows,paths.linux,paths.assets,paths.preview,paths.firefox,paths.project,paths.kit];
  for(const name of completeArchives) await copyFile(output(name),path.join(complete,name));
  await copyFile('docs/DEPLOYMENT_GUIDE.md',path.join(complete,'START-HERE.md'));
  await copyFile('docs/GhostState_Simple_Guide.pdf',path.join(complete,'GhostState-Simple-Guide.pdf'));
  let completeSums='';for(const name of [...completeArchives,'START-HERE.md','GhostState-Simple-Guide.pdf'])completeSums+=`${createHash('sha256').update(await readFile(path.join(complete,name))).digest('hex')}  ${name}\n`;
  await writeFile(path.join(complete,'SHA256SUMS'),completeSums);
  await zip(paths.complete,complete);
  // Previous filenames are compatibility copies of the current packages, not separate builds.
  const aliases={
    'ghoststate-chromium.zip':paths.store,[`${prefix}-chromium.zip`]:paths.store,
    'ghoststate-firefox.zip':paths.firefox,'ghoststate-native-linux-x86_64.zip':paths.linux,
    [`${prefix}-native-linux-x86_64.zip`]:paths.linux,'ghoststate-project.zip':paths.project
  };
  for(const [alias,source] of Object.entries(aliases))await copyFile(output(source),output(alias));
  const all=[...Object.values(paths),...Object.keys(aliases)];
  let sums='';for(const name of all)sums+=`${await sha(name)}  ${name}\n`;
  await writeFile(output('SHA256SUMS'),sums);
  console.log(`Packaged GhostState ${version}: Chrome Store ZIP, unpacked test ZIP, experimental companions, static preview, listing assets, source, developer kit and complete package.`);
  console.log('Only the chrome-store.zip is a Store upload; the complete package and developer kit are not. Checksums are not signatures.');
} finally {await rm(tmp,{recursive:true,force:true});}
