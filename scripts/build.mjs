import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=process.cwd(); const base=JSON.parse(await readFile('apps/browser-extension/manifest.base.json','utf8'));
for (const family of ['chromium','firefox']) {
  const out=resolve(root,'release',family); await rm(out,{recursive:true,force:true}); await mkdir(out,{recursive:true});
  const manifest={...base, ...(family==='chromium'?{background:{service_worker:'background.js'}}:{background:{scripts:['background.js']},browser_specific_settings:{gecko:{id:'ghoststate@local.invalid',strict_min_version:'142.0',data_collection_permissions:{required:['none'],optional:['authenticationInfo']}}}})};
  await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2));
  await Promise.all([
    build({entryPoints:['apps/browser-extension/src/background.ts'],bundle:true,format:'iife',platform:'browser',target:['chrome110','firefox115'],outfile:`${out}/background.js`,legalComments:'none'}),
    build({entryPoints:['apps/browser-extension/src/content.ts'],bundle:true,format:'iife',platform:'browser',target:['chrome110','firefox115'],outfile:`${out}/content.js`,legalComments:'none'}),
    build({entryPoints:['apps/browser-extension/src/popup.ts'],bundle:true,format:'iife',platform:'browser',target:['chrome110','firefox115'],outfile:`${out}/popup.js`,legalComments:'none'}),
    build({entryPoints:['apps/browser-extension/src/native-bridge.ts'],bundle:true,format:'iife',platform:'browser',target:['chrome110','firefox115'],outfile:`${out}/native-bridge.js`,legalComments:'none'}),
    build({entryPoints:['apps/dashboard/src/main.ts'],bundle:true,format:'iife',platform:'browser',target:['chrome110','firefox115'],outfile:`${out}/dashboard.js`,legalComments:'none'})
  ]);
  const html=(await readFile('apps/dashboard/index.html','utf8')).replace('./style.css','./dashboard.css').replace('./src/main.ts','./dashboard.js');
  await writeFile(`${out}/dashboard.html`,html); await copyFile('apps/dashboard/style.css',`${out}/dashboard.css`); await copyFile('apps/browser-extension/popup.html',`${out}/popup.html`); await copyFile('apps/browser-extension/popup.css',`${out}/popup.css`); await copyFile('apps/browser-extension/native-bridge.html',`${out}/native-bridge.html`);
  await mkdir(`${out}/assets`,{recursive:true});
  for(const asset of ['ghoststate-logo.png','inter-latin.woff2','INTER-OFL.txt']) await copyFile(`apps/dashboard/assets/${asset}`,`${out}/assets/${asset}`);
  for(const size of [16,48,128]) await copyFile(`apps/browser-extension/icon${size}.png`,`${out}/icon${size}.png`);
  console.log(`Built ${family} extension: ${out}`);
}
