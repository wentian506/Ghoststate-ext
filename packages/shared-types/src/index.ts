/** Data shared between trusted GhostState components. Never include field values in snapshots. */
export type FieldKind = 'username' | 'password';
export type Challenge = 'otp' | 'captcha' | 'passkey' | 'security-question';
export interface StructuralNode {
  path: string; tag: 'input' | 'button' | 'select' | 'textarea'; type: string;
  role: string; depth: number; autocomplete: string; suggested: FieldKind | null;
}
export interface Snapshot {
  schema: 1; origin: string; fingerprint: string; nodes: StructuralNode[]; challenges: Challenge[];
}
export interface FieldMapping { path: string; kind: FieldKind }
export interface WorkflowState { id: string; fingerprint: string; nodes: StructuralNode[]; mappings: FieldMapping[]; addedAt: number }
export interface WorkflowEdge { from: string; to: string; action: 'manual-submit-or-navigation' }
export interface Workflow { schema: 1; id: string; origin: string; version: number; states: WorkflowState[]; edges: WorkflowEdge[]; updatedAt: number }
export interface Profile { id: string; label: string; origin: string; username: string; password: string; workflow: Workflow | null; createdAt: number }
export interface ProfileView { id: string; label: string; origin: string; createdAt: number; stateCount: number; workflowVersion: number; weakPassword: boolean; reusedPassword: boolean }
export interface AuditEvent { id: string; at: number; action: string; origin?: string; detail?: string }
export interface VaultData { schema: 1; profiles: Profile[]; events: AuditEvent[]; autoLockMinutes: number; logging: boolean }
export const MAX_PROFILES = 200;

/** Exact origin (including scheme and port); no paths, queries or credentials retained. */
export function canonicalOrigin(input: string): string {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Invalid site URL.');
  let u: URL;
  try { u = new URL(input); } catch { throw new Error('Enter a valid site URL, including https://.'); }
  if (u.username || u.password) throw new Error('URLs containing credentials are not allowed.');
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new Error('Only HTTPS sites are supported (HTTP is allowed for loopback testing only).');
  }
  if (u.origin === 'null') throw new Error('Unsupported site origin.');
  return u.origin;
}
export function requireOrigin(actual: string, expected: string): void {
  if (canonicalOrigin(actual) !== canonicalOrigin(expected)) throw new Error('Origin mismatch. No credentials were released.');
}
export function uid(): string { return crypto.randomUUID(); }
export function assertText(value: unknown, name: string, max = 1024, min = 1): asserts value is string {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error(`Invalid ${name}.`);
}
