import { requireOrigin, uid, type FieldMapping, type Snapshot, type Workflow, type WorkflowState } from '../../shared-types/src/index';
export function createWorkflow(origin: string): Workflow { return { schema: 1, id: uid(), origin, version: 1, states: [], edges: [], updatedAt: Date.now() }; }
export function addState(w: Workflow, snap: Snapshot, mappings: FieldMapping[]): Workflow {
  requireOrigin(snap.origin, w.origin);
  if (snap.schema !== 1 || !/^[0-9a-f]{64}$/.test(snap.fingerprint) || snap.nodes.length > 1000) throw new Error('Invalid structural snapshot.');
  if (snap.challenges.length) throw new Error('A challenge is visible. Complete it manually before recording.');
  if (w.states.length >= 50) throw new Error('Workflow state limit reached.');
  if (!Array.isArray(mappings) || mappings.length > 20) throw new Error('Invalid mappings.');
  const seen = new Set<string>();
  for (const mapping of mappings) {
    const n = snap.nodes.find(x => x.path === mapping.path);
    if (seen.has(mapping.path) || !n || n.tag !== 'input' || !['username','password'].includes(mapping.kind)) throw new Error('Invalid field mapping.');
    if (n.autocomplete.includes('one-time-code') || n.autocomplete.includes('webauthn') || n.autocomplete.includes('new-password')) throw new Error('Challenge or new-password fields cannot be mapped.');
    if (mapping.kind === 'password' && n.type !== 'password') throw new Error('Passwords can only be mapped to password fields.');
    if (mapping.kind === 'username' && !['text','email','search','url'].includes(n.type)) throw new Error('Username requires a text-like field.');
    seen.add(mapping.path);
  }
  if (!mappings.length) throw new Error('Choose at least one username or password field.');
  const existing = w.states.find(s => s.fingerprint === snap.fingerprint);
  if (existing) throw new Error('This state is already recorded.');
  const s: WorkflowState = { id: uid(), fingerprint: snap.fingerprint, nodes: snap.nodes, mappings, addedAt: Date.now() };
  const prev = w.states.at(-1);
  return { ...w, version: w.version + 1, states: [...w.states, s], edges: prev ? [...w.edges, { from: prev.id, to: s.id, action: 'manual-submit-or-navigation' }] : w.edges, updatedAt: Date.now() };
}
export type Recognition = { status: 'matched'; state: WorkflowState; confidence: 1 } | { status: 'pause'; reason: string; confidence: number };
export function recognize(w: Workflow, s: Snapshot): Recognition {
  try { requireOrigin(s.origin, w.origin); } catch { return { status: 'pause', reason: 'This site has a different origin. Switch sites and approve it separately.', confidence: 0 }; }
  if (s.challenges.length) return { status: 'pause', reason: `Complete ${s.challenges.join(', ')} manually.`, confidence: 0 };
  const exact = w.states.find(x => x.fingerprint === s.fingerprint);
  if (exact) return { status: 'matched', state: exact, confidence: 1 };
  let best = 0; const incoming = new Set(s.nodes.map(n => `${n.path}|${n.tag}|${n.type}|${n.role}`));
  for (const state of w.states) {
    const saved = new Set(state.nodes.map(n => `${n.path}|${n.tag}|${n.type}|${n.role}`));
    const intersection = [...saved].filter(x => incoming.has(x)).length;
    const union = new Set([...saved, ...incoming]).size;
    best = Math.max(best, union ? intersection / union : 0);
  }
  return { status: 'pause', reason: 'The page does not exactly match a learned state. Take over manually or record the changed state.', confidence: best };
}

/** Validate a live, user-driven transition. A visit to the first state explicitly restarts the workflow. */
export function canTransition(w: Workflow, previousId: string | null, nextId: string): boolean {
  if (!w.states.some(s => s.id === nextId)) return false;
  if (!previousId || previousId === nextId || w.states[0]?.id === nextId) return true;
  return w.edges.some(e => e.from === previousId && e.to === nextId && e.action === 'manual-submit-or-navigation');
}
