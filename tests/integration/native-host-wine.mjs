// Optional Windows-binary native messaging smoke test under Wine; not Windows/BLE validation.
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const wine=process.env.WINE64 || '/usr/lib/wine/wine64';
const prefix=process.env.WINEPREFIX;
if(!prefix) throw new Error('Set WINEPREFIX to a disposable Wine prefix before running this test.');
const env={...process.env,WINEDEBUG:'-all'};
const probe=spawnSync(wine,['cmd','/c','echo %USERPROFILE%'],{env,encoding:'utf8',timeout:30000});
if(probe.status!==0)throw new Error(`Could not obtain Wine USERPROFILE: ${probe.stderr}`);
const profile=probe.stdout.trim();
if(!/^C:\\users\\[^\\]+$/i.test(profile))throw new Error(`Unexpected Wine profile: ${profile}`);
const config=path.join(prefix,'drive_c',...profile.slice(3).split('\\'),'.config','ghoststate','allowed-callers.json');
await mkdir(path.dirname(config),{recursive:true});
const id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',caller=`chrome-extension://${id}/`;
await writeFile(config,JSON.stringify({allowed:[caller]}));
const binary=path.resolve('release/native-windows-x64/ghoststate-companion.exe');
const waitExit=child=>new Promise(resolve=>child.on('exit',resolve));
try {
  const bad=spawn(wine,[binary,'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/'],{env,stdio:['ignore','pipe','pipe']});
  assert.equal(await waitExit(bad),1,'unknown callers must fail');
  const child=spawn(wine,[binary,caller,'--parent-window=0'],{env,stdio:['pipe','pipe','pipe']});
  let bytes=Buffer.alloc(0),queue=[],errors='';
  child.stderr.on('data',d=>{errors+=d.toString()});
  child.stdout.on('data',d=>{bytes=Buffer.concat([bytes,d]);while(bytes.length>=4&&bytes.length>=4+bytes.readUInt32LE(0)){const n=bytes.readUInt32LE(0);const msg=JSON.parse(bytes.subarray(4,4+n));bytes=bytes.subarray(4+n);queue.shift()?.(msg);}});
  const req=value=>new Promise((resolve,reject)=>{queue.push(resolve);const body=Buffer.from(JSON.stringify(value)),head=Buffer.alloc(4);head.writeUInt32LE(body.length);child.stdin.write(Buffer.concat([head,body]));const timer=setTimeout(()=>reject(new Error(`Wine host timeout: ${errors}`)),12000);timer.unref();});
  const status=await req({id:1,op:'status',payload:{}});
  assert.equal(status.ok,true);assert.equal(status.data.platform,'windows');assert.equal(status.data.version,JSON.parse(await readFile('package.json','utf8')).version);assert.equal(status.data.bleProtocol,2);assert.equal(status.data.peripheralSupported,true);assert.equal(status.data.listening,false);
  const badOp=await req({id:2,op:'execute_shell',payload:{command:'whoami'}});assert.equal(badOp.ok,false);
  const noPeer=await req({id:3,op:'send_grant',payload:{peerId:'missing',origin:'https://example.test',username:'synthetic',password:'synthetic'}});assert.equal(noPeer.ok,false);assert.doesNotMatch(JSON.stringify(noPeer),/synthetic/);
  child.stdin.end();assert.equal(await waitExit(child),0);
  console.log('PASS Windows EXE under Wine: exact caller, native framing/status, invalid operation and unpaired-transfer rejection. No Windows OS or Bluetooth radio was tested.');
} finally {await rm(config,{force:true});}
