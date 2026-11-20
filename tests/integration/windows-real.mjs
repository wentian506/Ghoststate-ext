// Windows-only CI test of HKCU registration and native framing; does NOT test Bluetooth.
// Intended only for a disposable Windows CI runner; never overwrites an existing registration.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
if(process.platform!=='win32' || process.env.CI!=='true') throw new Error('Run only on a disposable Windows CI runner.');
const key='HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.ghoststate.bridge';
for(const view of ['32','64'])if(spawnSync('reg',['query',key,`/reg:${view}`],{encoding:'utf8'}).status===0)throw new Error(`Host registration exists in the ${view}-bit view; refusing to overwrite it.`);
const temp=await mkdtemp(path.join(tmpdir(),'gs-real-windows-'));
const binary=path.resolve('apps/desktop-companion/target/release/ghoststate-companion.exe');
const id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',caller=`chrome-extension://${id}/`;
const env={...process.env,USERPROFILE:temp,HOME:'C:\\ghoststate-test-invalid-home'};
const readKey=()=>spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',"$k=Get-Item -ErrorAction SilentlyContinue 'HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.ghoststate.bridge'; if ($k) {$k.GetValue('')}"],{env,encoding:'utf8',timeout:30000}).stdout?.trim()||'';
let child;
try {
  const setup=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','scripts/install-native.ps1','-Browser','chrome','-ExtensionId',id,'-Binary',binary],{env,encoding:'utf8',timeout:30000});
  assert.equal(setup.status,0,setup.stderr);const manifestPath=readKey();
  assert.equal(path.resolve(manifestPath).toLowerCase(),path.join(temp,'.config','ghoststate','com.ghoststate.bridge.chrome.json').toLowerCase());
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));assert.deepEqual(manifest.allowed_origins,[caller]);
  assert.equal(manifest.name,'com.ghoststate.bridge');assert.equal(manifest.type,'stdio');
  child=spawn(manifest.path,[caller,'--parent-window=0'],{env,stdio:['pipe','pipe','pipe']});
  let buffer=Buffer.alloc(0),errors='';child.stderr.on('data',d=>{errors+=d.toString()});
  const response=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`native status timed out: ${errors}`)),15000);
    child.stdout.on('data',d=>{
      buffer=Buffer.concat([buffer,d]);
      try {
        if(buffer.length>=4){const n=buffer.readUInt32LE(0);assert(n>0&&n<=65536);if(buffer.length>=4+n){clearTimeout(timer);resolve(JSON.parse(buffer.subarray(4,4+n)));}}
      } catch(e){clearTimeout(timer);reject(e);}
    });
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('exit',code=>{clearTimeout(timer);reject(new Error(`host exited before status (${code}): ${errors}`));});
  });
  const body=Buffer.from(JSON.stringify({id:1,op:'status',payload:{}})),header=Buffer.alloc(4);header.writeUInt32LE(body.length);child.stdin.write(Buffer.concat([header,body]));
  const data=await response;assert.equal(data.ok,true);assert.equal(data.data.platform,'windows');assert.equal(data.data.peripheralSupported,true);assert.equal(data.data.version,JSON.parse(await readFile('package.json','utf8')).version);
  child.stdin.end();const code=await new Promise(r=>child.on('exit',r));assert.equal(code,0);
  const check=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','scripts/check-native.ps1','-Browser','chrome','-ExtensionId',id],{env,encoding:'utf8',timeout:30000});assert.equal(check.status,0,check.stderr);
  console.log('PASS actual Windows registry, native framing and diagnostics; no browser or Bluetooth radio was tested.');
} finally {
  child?.kill();
  // Do not remove a registration if another process has replaced it during this test.
  const current=readKey();const ours=path.join(temp,'.config','ghoststate','com.ghoststate.bridge.chrome.json');
  if(current&&path.resolve(current).toLowerCase()===ours.toLowerCase())spawnSync('reg',['delete',key,'/f','/reg:64'],{encoding:'utf8'});
  await rm(temp,{recursive:true,force:true});
}
