import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { Vault } from '../../packages/vault/src/index';
import { deriveVaultKey, unb64, open, seal } from '../../packages/crypto-core/src/index';
import type { Snapshot } from '../../packages/shared-types/src/index';
const snap: Snapshot = {schema:1, origin:'https://example.com', fingerprint:'a'.repeat(64), nodes:[{path:'form:0/input:0',tag:'input',type:'password',role:'',depth:2,autocomplete:'current-password',suggested:'password'}], challenges:[]};
function v() { return new Vault('test-'+crypto.randomUUID()); }
describe('encrypted vault security', () => {
  it('encrypts locally, authenticates wrong passwords, persists, exports and restores', async () => {
    const a = v(); await a.setup('a long master passphrase'); const id = await a.addProfile('Test', 'https://example.com/login', 'person', 'S3CRET-PASSWORD'); await a.recordState(id, snap, [{path:snap.nodes[0].path,kind:'password'}]);
    const backup = await a.exportBackup(); expect(backup).not.toContain('S3CRET-PASSWORD'); expect(backup).not.toContain('person'); expect(backup).not.toContain('example.com');
    expect((await a.getFill(id,'https://example.com',snap)).values.password).toBe('S3CRET-PASSWORD');
    await expect(a.getFill(id,'https://evil.example',snap)).rejects.toThrow('Origin mismatch');
    await expect(a.getFill(id,'https://example.com',{...snap,origin:'https://evil.example'})).rejects.toThrow('Origin mismatch');
    a.lock(); await expect(a.listProfiles()).rejects.toThrow('locked'); await expect(a.unlock('not the right password')).rejects.toThrow('Incorrect'); await a.unlock('a long master passphrase'); expect(await a.listProfiles()).toHaveLength(1);
    const restored = v(); await expect(restored.restoreBackup(backup,'wrong password')).rejects.toThrow(); await restored.restoreBackup(backup,'a long master passphrase'); expect((await restored.listProfiles())[0].stateCount).toBe(1);
    await restored.deleteProfile(id); expect(await restored.listProfiles()).toHaveLength(0); restored.lock(); a.lock();
  });
  it('defaults to no activity logging and aborts reads if the vault locks mid-operation', async () => {
    const a=v(); await a.setup('another secure passphrase'); expect((await a.getSettings()).logging).toBe(false);
    await a.addProfile('One','https://example.com','person','secret'); expect(await a.listEvents()).toHaveLength(0);
    await a.setSettings(5,true); expect((await a.listEvents()).some(e=>e.action==='Security settings changed')).toBe(true);
    const lease=a.captureLease(); const pending=a.listProfiles(); a.lock();
    await expect(pending).rejects.toThrow(/locked|session changed/i); expect(()=>a.assertLease(lease)).toThrow(/locked/i);
    await a.unlock('another secure passphrase'); expect(()=>a.assertLease(lease)).toThrow(/session changed/i); a.lock();
  });
  it('locks after the configured idle timeout even without a timer callback', async () => {
    const a=v();try{await a.setup('timeout test passphrase');await a.setSettings(1,true);const future=Date.now()+61_000;vi.spyOn(Date,'now').mockReturnValue(future);expect((await a.status()).unlocked).toBe(false);await expect(a.listProfiles()).rejects.toThrow('locked');}finally{a.lock();vi.restoreAllMocks();}
  });
  it('rejects malformed workflow writes without corrupting the stored vault', async () => {
    const a=v();await a.setup('long and unique passphrase');const id=await a.addProfile('Test','https://example.com','person','password');
    await expect(a.recordState(id,snap,[{path:snap.nodes[0].path,kind:'password',unexpected:'raw'} as any])).rejects.toThrow('Invalid vault operation');
    expect(await a.getWorkflow(id)).toBeNull();expect(await a.listProfiles()).toHaveLength(1);a.lock();
  });
  it('rejects a validly encrypted backup with malformed workflow metadata', async () => {
    const a=v(); const pass='valid backup passphrase'; await a.setup(pass);
    const id=await a.addProfile('Test','https://example.com','person','password'); await a.recordState(id,snap,[{path:snap.nodes[0].path,kind:'password'}]);
    const backup=JSON.parse(await a.exportBackup()); const key=await deriveVaultKey(pass,unb64(backup.header.salt),backup.header.iterations);
    const data:any=await open(key,backup.data,'ghoststate:v1:vault'); data.profiles[0].workflow.version='<img src=x onerror=alert(1)>';
    backup.data=await seal(key,data,'ghoststate:v1:vault'); const other=v();
    await expect(other.restoreBackup(JSON.stringify(backup),pass)).rejects.toThrow(/damaged backup/); expect((await other.status()).initialized).toBe(false);a.lock();other.lock();
  });
  it('uses different nonces and rejects altered ciphertext', async () => {
    const a = v(); await a.setup('another long passphrase'); const first = JSON.parse(await a.exportBackup()); await a.addProfile('One','https://example.com','name','password'); const second = JSON.parse(await a.exportBackup()); expect(first.data.iv).not.toBe(second.data.iv);
    second.data.ciphertext = second.data.ciphertext.slice(0,-3) + 'abc'; const b = v(); await expect(b.restoreBackup(JSON.stringify(second), 'another long passphrase')).rejects.toThrow(); a.lock();
  });
});
