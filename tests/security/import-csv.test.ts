import 'fake-indexeddb/auto';
import {describe,it,expect} from 'vitest';
import {readLoginCsv} from '../../packages/vault/src/import-csv';
import {Vault} from '../../packages/vault/src/index';
const fresh=()=>new Vault('import-test-'+crypto.randomUUID());

describe('explicit local CSV import',()=>{
  it('parses quoted standard logins and skips unsupported origins without retaining extras',()=>{
    const csv='name,url,username,password,note,otp\r\n"My, Site",https://example.test/login,"a,b","pass""word",SENSITIVE-NOTE,SECRET-OTP\r\nBad,http://unsafe.example,u,p,ignored,ignored\r\n';
    const result=readLoginCsv(csv);expect(result.format).toBe('standard');expect(result.skipped).toBe(1);
    expect(result.skippedRows).toEqual([{row:3,reason:'Unsupported or invalid site URL'}]);
    expect(result.records).toEqual([{label:'My, Site',url:'https://example.test',username:'a,b',password:'pass"word'}]);
    expect(JSON.stringify(result)).not.toContain('SENSITIVE-NOTE');expect(JSON.stringify(result)).not.toContain('SECRET-OTP');
  });
  it('understands Bitwarden login headers while excluding OTP, notes and non-login rows',()=>{
    const csv='folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Site,private note,,,https://example.test/path,person,pass,SECRET-TOTP\n,,note,Note,hello,,,,,,\n';
    const result=readLoginCsv(csv);expect(result.format).toBe('bitwarden');expect(result.records).toHaveLength(1);expect(result.skipped).toBe(1);expect(JSON.stringify(result)).not.toContain('SECRET-TOTP');expect(JSON.stringify(result)).not.toContain('private note');
  });
  it('rejects malformed, ambiguous, oversized and unsupported CSVs',()=>{
    expect(()=>readLoginCsv('url,url,username,password\nhttps://example.test,a,b,c')).toThrow(/duplicate/i);
    expect(()=>readLoginCsv('url,username,password\n"https://example.test,u,p')).toThrow(/unclosed/i);
    expect(()=>readLoginCsv('url,username,password\nhttps://example.test,u')).toThrow(/number of columns/i);
    expect(()=>readLoginCsv('secret,username,password\nx,u,p')).toThrow(/standard/i);
    expect(()=>readLoginCsv('x'.repeat(2_000_001))).toThrow(/2 MB/i);
  });
  it('reauthenticates, skips exact duplicate accounts, rejects extra fields, and encrypts imported secrets',async()=>{
    const v=fresh();const pass='import synthetic passphrase';await v.setup(pass);
    await v.addProfile('Existing','https://example.test','person','old-secret');
    const rows=[{label:'Duplicate',url:'https://example.test/path',username:'person',password:'duplicate-secret'},
      {label:'Imported',url:'https://second.test',username:'second',password:'new-secret'},
      {label:'Second duplicate',url:'https://second.test',username:'second',password:'ignored-secret'}];
    await expect(v.importProfiles(rows,'wrong')).rejects.toThrow(/incorrect/i);expect(await v.listProfiles()).toHaveLength(1);
    await expect(v.importProfiles([{...rows[1],otp:'not-allowed'}],pass)).rejects.toThrow(/unsupported/i);
    expect(await v.importProfiles(rows,pass)).toEqual({imported:1,duplicates:2});expect(await v.listProfiles()).toHaveLength(2);
    expect(await v.exportBackup()).not.toContain('new-secret');v.lock();
  });
  it('keeps the batch atomic when the vault profile cap would be exceeded',async()=>{
    const v=fresh();const pass='capacity test passphrase';await v.setup(pass);
    const many=Array.from({length:199},(_,i)=>({label:`Site ${i}`,url:`https://s${i}.example.test`,username:'user',password:'synthetic'}));
    expect((await v.importProfiles(many,pass)).imported).toBe(199);
    const extra=[{label:'One',url:'https://one.test',username:'user',password:'p'},{label:'Two',url:'https://two.test',username:'user',password:'p'}];
    await expect(v.importProfiles(extra,pass)).rejects.toThrow(/200-profile/);expect(await v.listProfiles()).toHaveLength(199);v.lock();
  });
});
