import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { generatePassword, potentiallyWeak } from '../../packages/vault/src/passwords';
import { Vault } from '../../packages/vault/src/index';
import type { Snapshot } from '../../packages/shared-types/src/index';
const fresh = () => new Vault('manager-test-'+crypto.randomUUID());
const snapshot:Snapshot={schema:1,origin:'https://example.test',fingerprint:'b'.repeat(64),nodes:[{path:'form:0/input:0',tag:'input',type:'password',role:'',depth:2,autocomplete:'current-password',suggested:'password'}],challenges:[]};

describe('local password tools',()=>{
  it('generates requested character classes using Web Crypto, with bounds and no fixed output',()=>{
    const options={length:24,lowercase:true,uppercase:true,numbers:true,symbols:true};
    const a=generatePassword(options), b=generatePassword(options);
    expect(a).toHaveLength(24);expect(a).toMatch(/[a-z]/);expect(a).toMatch(/[A-Z]/);expect(a).toMatch(/[2-9]/);expect(a).toMatch(/[!@#$%^&*_=+\-]/);expect(a).not.toBe(b);
    const digits=generatePassword({...options,length:12,lowercase:false,uppercase:false,symbols:false});expect(digits).toMatch(/^[2-9]{12}$/);
    expect(()=>generatePassword({...options,length:11})).toThrow();expect(()=>generatePassword({...options,length:129})).toThrow();
    expect(()=>generatePassword({...options,lowercase:false,uppercase:false,numbers:false,symbols:false})).toThrow();
  });
  it('reports only limited local hygiene signals',()=>{
    expect(potentiallyWeak('Password12345')).toBe(true);expect(potentiallyWeak('111111111111')).toBe(true);
    expect(potentiallyWeak('short')).toBe(true);expect(potentiallyWeak('Yx8@Gm2^Fh4+Rp6!')).toBe(false);
  });
  it('requires a fresh correct master passphrase for reveal and edit, and clears a workflow when origin changes',async()=>{
    const v=fresh();const master='synthetic master passphrase';await v.setup(master);
    const id=await v.addProfile('First','https://example.test','synthetic-user-one','same-secret-password');
    await v.addProfile('Second','https://other.test','two','same-secret-password');
    await v.recordState(id,snapshot,[{path:snapshot.nodes[0].path,kind:'password'}]);
    const views=await v.listProfiles();expect(views.every(p=>p.reusedPassword)).toBe(true);expect(JSON.stringify(views)).not.toContain('same-secret-password');
    await expect(v.revealProfile(id,'wrong')).rejects.toThrow(/incorrect/i);
    expect((await v.status()).unlocked).toBe(true);
    await expect(v.updateProfile(id,'Other','https://example.test','','new-value','wrong')).rejects.toThrow(/incorrect/i);
    expect((await v.revealProfile(id,master)).password).toBe('same-secret-password');
    await v.updateProfile(id,'Updated','https://example.test','','new-value',master);
    expect((await v.revealProfile(id,master)).username).toBe('synthetic-user-one');expect((await v.revealProfile(id,master)).password).toBe('new-value');
    expect((await v.getWorkflow(id))?.states).toHaveLength(1);expect((await v.listProfiles()).every(p=>!p.reusedPassword)).toBe(true);
    await v.updateProfile(id,'Updated','https://elsewhere.test','','',master);
    expect(await v.getWorkflow(id)).toBeNull();await expect(v.getFill(id,'https://example.test',snapshot)).rejects.toThrow(/origin mismatch/i);
    const backup=await v.exportBackup();expect(backup).not.toContain('new-value');expect(backup).not.toContain('synthetic-user-one');
    v.lock();await expect(v.revealProfile(id,master)).rejects.toThrow(/locked/i);
  });
  it('does not extend inactivity from passive automatic-fill reads or logging',async()=>{
    const v=fresh();let now=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
    try {await v.setup('synthetic idle passphrase');await v.setSettings(1,true);const id=await v.addProfile('Test','https://example.test','person','secret');await v.recordState(id,snapshot,[{path:snapshot.nodes[0].path,kind:'password'}]);
      now+=59_000;v.captureLease(false);await v.getFill(id,'https://example.test',snapshot,false);await v.getWorkflow(id,false);await v.recordFill(id,true);
      now+=2_000;expect((await v.status()).unlocked).toBe(false);await expect(v.getFill(id,'https://example.test',snapshot,false)).rejects.toThrow(/locked/i);
    } finally {v.lock();clock.mockRestore();}
  });
});
