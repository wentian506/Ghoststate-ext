import { canonicalOrigin, MAX_PROFILES, type VaultData } from '../../shared-types/src/index';

// Decrypted data and user-supplied encrypted backups are not trusted merely because
// AES-GCM verified. Bound and validate every persisted object before rendering or use.
type Obj = Record<string, unknown>;
const object = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (o: Obj, allowed: string[]) => Object.keys(o).every(k => allowed.includes(k));
const text = (x: unknown, max: number, min = 1): x is string => typeof x === 'string' && x.length >= min && x.length <= max;
const timestamp = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= 8_640_000_000_000_000;
const origin = (x: unknown): x is string => { try { return text(x,2048) && canonicalOrigin(x) === x; } catch { return false; } };
const types = new Set(['text','email','password','tel','number','search','url','submit','button','checkbox','radio','other']);
const roles = new Set(['','textbox','button','combobox','checkbox','radio','searchbox','switch']);
const autos = new Set(['username','email','current-password','new-password','one-time-code','webauthn']);
const pathPattern = /^(?:[a-z][a-z0-9-]{0,29}:\d{1,9})(?:\/[a-z][a-z0-9-]{0,29}:\d{1,9}){0,19}$/;
function node(x: unknown): x is Obj {
  if (!object(x) || !keys(x,['path','tag','type','role','depth','autocomplete','suggested'])) return false;
  return text(x.path,800) && pathPattern.test(x.path) && Number.isInteger(x.depth) && x.depth === x.path.split('/').length &&
    typeof x.tag === 'string' && ['input','button','select','textarea'].includes(x.tag) &&
    typeof x.type === 'string' && types.has(x.type) && typeof x.role === 'string' && roles.has(x.role) &&
    text(x.autocomplete,128,0) && (!x.autocomplete || x.autocomplete.split(' ').every(v => autos.has(v))) &&
    (x.suggested === null || x.suggested === 'username' || x.suggested === 'password');
}
function workflow(x: unknown, expectedOrigin: string): boolean {
  if (!object(x) || !keys(x,['schema','id','origin','version','states','edges','updatedAt']) || x.schema !== 1 ||
      !text(x.id,64) || x.origin !== expectedOrigin || !Number.isSafeInteger(x.version) || (x.version as number) < 1 || (x.version as number) > 1_000_000 ||
      !Array.isArray(x.states) || x.states.length > 50 || !Array.isArray(x.edges) || x.edges.length > 100 || !timestamp(x.updatedAt)) return false;
  const stateIds = new Set<string>(); const fingerprints = new Set<string>();
  for (const s of x.states) {
    if (!object(s) || !keys(s,['id','fingerprint','nodes','mappings','addedAt']) || !text(s.id,64) || stateIds.has(s.id) ||
        !text(s.fingerprint,64,64) || !/^[0-9a-f]{64}$/.test(s.fingerprint) || fingerprints.has(s.fingerprint) ||
        !Array.isArray(s.nodes) || s.nodes.length > 1000 || !s.nodes.every(node) ||
        !Array.isArray(s.mappings) || !s.mappings.length || s.mappings.length > 20 || !timestamp(s.addedAt)) return false;
    stateIds.add(s.id); fingerprints.add(s.fingerprint);
    const nodes = new Map<string, Obj>();
    for (const n of s.nodes as Obj[]) { const p=n.path as string; if (nodes.has(p)) return false; nodes.set(p,n); }
    const mapped = new Set<string>();
    for (const m of s.mappings) {
      if (!object(m) || !keys(m,['path','kind']) || !text(m.path,800) || mapped.has(m.path) || (typeof m.kind !== 'string' || !['username','password'].includes(m.kind))) return false;
      const n=nodes.get(m.path); if (!n || n.tag !== 'input' || typeof n.autocomplete !== 'string' || /one-time-code|new-password|webauthn/.test(n.autocomplete)) return false;
      if ((m.kind === 'password' && n.type !== 'password') || (m.kind === 'username' && (typeof n.type !== 'string' || !['text','email','search','url'].includes(n.type)))) return false;
      mapped.add(m.path);
    }
  }
  return x.edges.every(e => object(e) && keys(e,['from','to','action']) && typeof e.from === 'string' && typeof e.to === 'string' && stateIds.has(e.from) && stateIds.has(e.to) && e.action === 'manual-submit-or-navigation');
}
export function validVaultData(x: unknown): x is VaultData {
  if (!object(x) || !keys(x,['schema','profiles','events','autoLockMinutes','logging']) || x.schema !== 1 ||
      !Array.isArray(x.profiles) || x.profiles.length > MAX_PROFILES || !Array.isArray(x.events) || x.events.length > 200 ||
      !Number.isInteger(x.autoLockMinutes) || (x.autoLockMinutes as number) < 1 || (x.autoLockMinutes as number) > 30 || typeof x.logging !== 'boolean') return false;
  const ids = new Set<string>();
  for (const p of x.profiles) {
    if (!object(p) || !keys(p,['id','label','origin','username','password','workflow','createdAt']) || !text(p.id,64) || ids.has(p.id) ||
        !text(p.label,80) || !p.label.trim() || !origin(p.origin) || !text(p.username,512) || !text(p.password,4096) ||
        !timestamp(p.createdAt) || !(p.workflow === null || workflow(p.workflow,p.origin))) return false;
    ids.add(p.id);
  }
  return x.events.every(e => object(e) && keys(e,['id','at','action','origin','detail']) && text(e.id,64) && timestamp(e.at) && text(e.action,120) &&
    (e.origin === undefined || origin(e.origin)) && (e.detail === undefined || text(e.detail,512,0)));
}
