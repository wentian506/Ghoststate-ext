import { b64, unb64, deriveVaultKey, KDF_ITERATIONS, open, randomBytes, seal, type Sealed } from '../../crypto-core/src/index';
import { assertText, canonicalOrigin, MAX_PROFILES, requireOrigin, uid, type AuditEvent, type FieldMapping, type Profile, type ProfileView, type Snapshot, type VaultData, type Workflow } from '../../shared-types/src/index';
import { addState, createWorkflow, recognize } from '../../state-machine/src/index';
import { validVaultData } from './validation';
import { potentiallyWeak } from './passwords';

interface Header { schema: 1; kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; verifier: Sealed }
interface Backup { format: 'ghoststate-encrypted-backup'; version: 1; header: Header; data: Sealed }
const CHECK = 'ghoststate:v1:verifier'; const DATA = 'ghoststate:v1:vault';
const fresh = (): VaultData => ({ schema: 1, profiles: [], events: [], autoLockMinutes: 5, logging: false });
function log(d: VaultData, action: string, origin?: string, detail?: string) {
  if (!d.logging) return;
  d.events.unshift({ id: uid(), at: Date.now(), action, ...(origin ? { origin } : {}), ...(detail ? { detail } : {}) }); d.events.length = Math.min(d.events.length, 200);
}
function validHeader(h: Header): boolean { return !!h && h.schema === 1 && h.kdf === 'PBKDF2-SHA256' && h.iterations >= KDF_ITERATIONS && h.iterations <= 2_000_000 && typeof h.salt === 'string' && !!h.verifier; }
export class Vault {
  private db: Promise<IDBDatabase>; private key: CryptoKey | null = null; private expiresAt = 0; private timeoutMinutes = 5; private generation = 0;
  private queue: Promise<unknown> = Promise.resolve(); private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(name = 'ghoststate-vault-v1') {
    this.db = new Promise((resolve, reject) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('items'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  }
  private async get<T>(key: string): Promise<T | undefined> { const db = await this.db; return new Promise((resolve, reject) => { const req = db.transaction('items').objectStore('items').get(key); req.onsuccess = () => resolve(req.result as T | undefined); req.onerror = () => reject(req.error); }); }
  private async writeMany(entries: [string, unknown][]): Promise<void> { const db = await this.db; await new Promise<void>((resolve, reject) => { const tx = db.transaction('items', 'readwrite'); for (const [k, v] of entries) tx.objectStore('items').put(v, k); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
  private serialized<T>(fn: () => Promise<T>): Promise<T> { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }
  private touch(): void { this.expiresAt = Date.now() + this.timeoutMinutes * 60_000; if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.lock(), this.timeoutMinutes * 60_000); }
  private requireKey(touch = true): CryptoKey { if (!this.key || Date.now() >= this.expiresAt) { this.lock(); throw new Error('Vault is locked.'); } if (touch) this.touch(); return this.key; }
  async status(): Promise<{ initialized: boolean; unlocked: boolean; timeoutMinutes: number }> { if (this.key && Date.now() >= this.expiresAt) this.lock(); return { initialized: !!(await this.get('header')), unlocked: !!this.key, timeoutMinutes: this.timeoutMinutes }; }
  async setup(pass: string): Promise<void> { return this.serialized(async () => {
    if (await this.get('header')) throw new Error('Vault already exists.');
    assertText(pass, 'master passphrase', 1024, 12);
    const salt = randomBytes(16); const key = await deriveVaultKey(pass, salt);
    const header: Header = { schema: 1, kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS, salt: b64(salt), verifier: await seal(key, { check: 'ghoststate-vault' }, CHECK) };
    await this.writeMany([['header', header], ['data', await seal(key, fresh(), DATA)]]); this.key = key; this.generation++; this.timeoutMinutes = 5; this.touch();
  }); }
  async unlock(pass: string): Promise<void> { return this.serialized(async () => {
    assertText(pass, 'master passphrase', 1024, 1); const h = await this.get<Header>('header'); if (!h || !validHeader(h)) throw new Error('Vault is missing or corrupt.');
    try { const key = await deriveVaultKey(pass, unb64(h.salt), h.iterations); const v = await open<{check:string}>(key, h.verifier, CHECK); const data = await this.get<Sealed>('data'); if (v.check !== 'ghoststate-vault' || !data) throw new Error(); const parsed = await open<VaultData>(key, data, DATA); if (!validVaultData(parsed)) throw new Error(); this.timeoutMinutes = Math.min(30, Math.max(1, parsed.autoLockMinutes)); this.key = key; this.generation++; this.touch(); }
    catch { this.lock(); throw new Error('Incorrect passphrase or damaged vault.'); }
  }); }
  lock(): void { this.key = null; this.generation++; this.expiresAt = 0; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  /** Opaque in-memory lease for trusted operations that must not outlive a lock/re-unlock. */
  captureLease(touch = true): number { this.requireKey(touch); return this.generation; }
  assertLease(lease: number): void { if (!this.key || Date.now() >= this.expiresAt) { this.lock(); throw new Error('Vault is locked.'); } if (lease !== this.generation) throw new Error('Vault session changed. Approve the operation again.'); }
  private async read(touch = true): Promise<VaultData> { const lease = this.captureLease(touch); const k = this.key!; const v = await this.get<Sealed>('data'); if (!v) throw new Error('Vault data missing.'); const d = await open<VaultData>(k, v, DATA); this.assertLease(lease); if (!validVaultData(d)) throw new Error('Vault data corrupt.'); return d; }
  private change<T>(fn: (d: VaultData) => T | Promise<T>, touch = true): Promise<T> { return this.serialized(async () => { const k = this.requireKey(touch); const d = await this.read(touch); const result = await fn(d); if (!validVaultData(d)) throw new Error('Invalid vault operation; no data was saved.'); if (this.key !== k || Date.now() >= this.expiresAt) throw new Error('Vault locked during operation.'); const encrypted = await seal(k, d, DATA); if (this.key !== k || Date.now() >= this.expiresAt) throw new Error('Vault locked during operation.'); await this.writeMany([['data', encrypted]]); return result; }); }
  async listProfiles(): Promise<ProfileView[]> { const d = await this.read(); const counts = new Map<string,number>(); for (const p of d.profiles) counts.set(p.password, (counts.get(p.password) || 0) + 1); return d.profiles.map(p => ({ id: p.id, label: p.label, origin: p.origin, createdAt: p.createdAt, stateCount: p.workflow?.states.length || 0, workflowVersion: p.workflow?.version || 0, weakPassword: potentiallyWeak(p.password), reusedPassword: (counts.get(p.password) || 0) > 1 })); }
  async listEvents(): Promise<AuditEvent[]> { return (await this.read()).events; }
  async getSettings(): Promise<{autoLockMinutes:number;logging:boolean}> { const d = await this.read(); return {autoLockMinutes:d.autoLockMinutes, logging:d.logging}; }
  async setSettings(mins: number, logging: boolean): Promise<void> { if (!Number.isInteger(mins) || mins < 1 || mins > 30 || typeof logging !== 'boolean') throw new Error('Invalid security settings.'); await this.change(d => { d.autoLockMinutes = mins; d.logging = logging; log(d, 'Security settings changed'); }); this.timeoutMinutes = mins; this.touch(); }
  async addProfile(label: string, url: string, username: string, password: string): Promise<string> { assertText(label, 'profile name', 80); assertText(username, 'username', 512); assertText(password, 'password', 4096); const origin = canonicalOrigin(url); if (!label.trim()) throw new Error('Profile name cannot be blank.');
    return this.change(d => { if (d.profiles.length >= MAX_PROFILES) throw new Error('Profile limit reached.'); const id = uid(); d.profiles.push({ id, label: label.trim(), origin, username, password, workflow: null, createdAt: Date.now() }); log(d, 'Profile saved', origin); return id; }); }
  /** Reauthenticate without unlocking/replacing an existing session; preserve the original lease. */
  private async verifyMaster(pass: string): Promise<number> {
    assertText(pass, 'master passphrase', 1024, 1);
    const lease = this.captureLease(); const h = await this.get<Header>('header');
    if (!h || !validHeader(h)) throw new Error('Vault is missing or corrupt.');
    let valid = false;
    try { const key = await deriveVaultKey(pass, unb64(h.salt), h.iterations); valid = (await open<{check:string}>(key, h.verifier, CHECK)).check === 'ghoststate-vault'; } catch { /* uniform error below */ }
    this.assertLease(lease);
    if (!valid) throw new Error('Incorrect master passphrase.');
    return lease;
  }
  /** Only a trusted dashboard may request this, after a fresh master-passphrase check. */
  async revealProfile(id:string, pass:string):Promise<{username:string;password:string}> {
    assertText(id, 'profile ID', 64); const lease = await this.verifyMaster(pass); const d = await this.read(); this.assertLease(lease);
    const p = d.profiles.find(p => p.id === id); if (!p) throw new Error('Profile not found.');
    return { username:p.username, password:p.password };
  }
  async updateProfile(id:string, label:string, url:string, username:string, password:string, pass:string):Promise<void> {
    assertText(id, 'profile ID', 64); assertText(label, 'profile name', 80); if (!label.trim()) throw new Error('Profile name cannot be blank.');
    assertText(username, 'username', 512, 0); assertText(password, 'password', 4096, 0); const origin = canonicalOrigin(url);
    const lease = await this.verifyMaster(pass);
    await this.change(d => { this.assertLease(lease); const p = d.profiles.find(p => p.id === id); if (!p) throw new Error('Profile not found.');
      if (p.origin !== origin) { p.origin = origin; p.workflow = null; } p.label = label.trim(); if (username) p.username = username; if (password) p.password = password;
      log(d, 'Profile updated', origin);
    });
  }
  /** Atomic, explicit CSV import. Exact duplicate origin+username pairs are skipped. */
  async importProfiles(input:unknown, pass:string):Promise<{imported:number;duplicates:number}> {
    if (!Array.isArray(input) || !input.length || input.length > MAX_PROFILES) throw new Error('Invalid import size.');
    const records = input.map((value:unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid import record.');
      const v=value as Record<string,unknown>;
      if (Object.keys(v).some(k=>!['label','url','username','password'].includes(k))) throw new Error('Unsupported import field.');
      assertText(v.label,'profile name',80); assertText(v.url,'site URL',2048); assertText(v.username,'username',512); assertText(v.password,'password',4096);
      if (!v.label.trim()) throw new Error('Profile name cannot be blank.');
      return {label:v.label.trim(),origin:canonicalOrigin(v.url),username:v.username,password:v.password};
    });
    const lease=await this.verifyMaster(pass);
    return this.change(d => {
      this.assertLease(lease); const seen=new Set(d.profiles.map(p=>`${p.origin}\0${p.username}`));
      const add:typeof records=[];let duplicates=0;
      for (const p of records) {const key=`${p.origin}\0${p.username}`;if(seen.has(key)){duplicates++;continue;}seen.add(key);add.push(p);}
      if (d.profiles.length + add.length > MAX_PROFILES) throw new Error('Import exceeds the 200-profile vault limit; nothing was imported.');
      for (const p of add) d.profiles.push({...p,id:uid(),workflow:null,createdAt:Date.now()});
      log(d,'Profiles imported',undefined,`${add.length} imported; ${duplicates} duplicates skipped`);
      return {imported:add.length,duplicates};
    });
  }
  async deleteProfile(id: string): Promise<void> { assertText(id, 'profile ID', 64); await this.change(d => { const i = d.profiles.findIndex(p => p.id === id); if (i < 0) throw new Error('Profile not found.'); const [p] = d.profiles.splice(i, 1); log(d, 'Profile deleted', p.origin); }); }
  async clearEvents(): Promise<void> { await this.change(d => { d.events = []; }); }
  async getWorkflow(id: string, touch = true): Promise<Workflow | null> { const p = (await this.read(touch)).profiles.find(p => p.id === id); if (!p) throw new Error('Profile not found.'); return p.workflow; }
  async recordState(id: string, snap: Snapshot, mappings: FieldMapping[]): Promise<Workflow> { return this.change(d => { const p = d.profiles.find(p => p.id === id); if (!p) throw new Error('Profile not found.'); requireOrigin(snap.origin, p.origin); p.workflow = addState(p.workflow || createWorkflow(p.origin), snap, mappings); log(d, 'Workflow state learned', p.origin); return p.workflow; }); }
  async clearWorkflow(id: string): Promise<void> { await this.change(d => { const p = d.profiles.find(p => p.id === id); if (!p) throw new Error('Profile not found.'); p.workflow = null; log(d, 'Workflow removed', p.origin); }); }
  /** Exact origin is mandatory; this method is called only by the trusted extension background. */
  async getFill(id: string, actualOrigin: string, snap: Snapshot, touch = true): Promise<{stateId:string; workflowId:string; mappings:FieldMapping[]; values:Record<'username'|'password',string>}> {
    const d = await this.read(touch); const p = d.profiles.find(p => p.id === id); if (!p) throw new Error('Profile not found.'); requireOrigin(actualOrigin, p.origin); requireOrigin(snap.origin, p.origin);
    if (!p.workflow) throw new Error('No learned workflow.'); const r = recognize(p.workflow, snap); if (r.status !== 'matched') throw new Error(r.reason);
    return { stateId:r.state.id, workflowId:p.workflow.id, mappings: r.state.mappings, values: { username: p.username, password: p.password } };
  }
  async recordFill(id: string, automatic = false): Promise<void> { await this.change(d => { const p = d.profiles.find(p => p.id === id); if (p) log(d, automatic ? 'Opt-in automatic fill' : 'Approved field fill', p.origin); }, !automatic); }
  async credentialForTransfer(id: string, expectedOrigin: string): Promise<{origin:string;username:string;password:string}> { const d = await this.read(); const p = d.profiles.find(p => p.id === id); if (!p) throw new Error('Profile not found.'); requireOrigin(expectedOrigin, p.origin); return {origin:p.origin,username:p.username,password:p.password}; }
  async recordTransfer(id:string): Promise<void> { await this.change(d => { const p = d.profiles.find(p => p.id === id); if (p) log(d, 'Approved credential transfer', p.origin); }); }
  async exportBackup(): Promise<string> { const header = await this.get<Header>('header'); const data = await this.get<Sealed>('data'); if (!header || !data) throw new Error('No vault to export.'); return JSON.stringify({ format: 'ghoststate-encrypted-backup', version: 1, header, data } satisfies Backup, null, 2); }
  async restoreBackup(json: string, pass: string): Promise<void> { return this.serialized(async () => {
    if (await this.get('header')) throw new Error('Reset the existing vault before restoring.'); if (json.length > 10_000_000) throw new Error('Backup is too large.');
    let b: Backup; try { b = JSON.parse(json) as Backup; } catch { throw new Error('Invalid backup.'); }
    if (b.format !== 'ghoststate-encrypted-backup' || b.version !== 1 || !validHeader(b.header) || !b.data) throw new Error('Unsupported backup.');
    try { const key = await deriveVaultKey(pass, unb64(b.header.salt), b.header.iterations); const verifier = await open<{check:string}>(key, b.header.verifier, CHECK); const data = await open<VaultData>(key, b.data, DATA); if (verifier.check !== 'ghoststate-vault' || !validVaultData(data)) throw new Error(); await this.writeMany([['header', b.header], ['data', b.data]]); this.key = key; this.generation++; this.timeoutMinutes = Math.min(30, Math.max(1, data.autoLockMinutes)); this.touch(); } catch { this.lock(); throw new Error('Incorrect passphrase or damaged backup.'); }
  }); }
  async reset(): Promise<void> { await this.serialized(async () => { this.lock(); const db = await this.db; await new Promise<void>((resolve, reject) => { const tx = db.transaction('items', 'readwrite'); tx.objectStore('items').clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }); }
}
