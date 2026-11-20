const enc = new TextEncoder();
const dec = new TextDecoder();
export const KDF_ITERATIONS = 600_000;
export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
export function b64(bytes: Uint8Array): string { let s = ''; for (const v of bytes) s += String.fromCharCode(v); return btoa(s); }
export function unb64(s: string): Uint8Array {
  if (typeof s !== 'string' || s.length > 12_000_000) throw new Error('Invalid encoded data.');
  try { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); } catch { throw new Error('Invalid encoded data.'); }
}
export interface Sealed { iv: string; ciphertext: string }
export async function deriveVaultKey(passphrase: string, salt: Uint8Array, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
  if (salt.length !== 16 || !Number.isSafeInteger(iterations) || iterations < 600_000 || iterations > 2_000_000) throw new Error('Unsupported KDF parameters.');
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(key: CryptoKey, value: unknown, context: string): Promise<Sealed> {
  const iv = randomBytes(12);
  const plaintext = enc.encode(JSON.stringify(value));
  try {
    const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(context), tagLength: 128 }, key, plaintext);
    return { iv: b64(iv), ciphertext: b64(new Uint8Array(bytes)) };
  } finally { plaintext.fill(0); }
}
export async function open<T>(key: CryptoKey, value: Sealed, context: string): Promise<T> {
  const iv = unb64(value.iv); if (iv.length !== 12) throw new Error('Invalid nonce.');
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(context), tagLength: 128 }, key, unb64(value.ciphertext) as BufferSource);
  const plain = new Uint8Array(bytes);
  try { return JSON.parse(dec.decode(plain)) as T; } finally { plain.fill(0); }
}
export async function sha256(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input)));
  return [...digest].map(n => n.toString(16).padStart(2, '0')).join('');
}
