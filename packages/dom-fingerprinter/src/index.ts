import { sha256 } from '../../crypto-core/src/index';
import { canonicalOrigin, type Challenge, type Snapshot, type StructuralNode } from '../../shared-types/src/index';

const allowedRoles = new Set(['textbox', 'button', 'combobox', 'checkbox', 'radio', 'searchbox', 'switch']);
const allowedTypes = new Set(['text', 'email', 'password', 'tel', 'number', 'search', 'url', 'submit', 'button', 'checkbox', 'radio']);
const allowedAuto = new Set(['username', 'email', 'current-password', 'new-password', 'one-time-code', 'webauthn']);
// Unknown/custom element names can contain arbitrary site or user data. Replace them
// with a structural token before persistence, including in sibling indexing.
const allowedPathTags = new Set(['a','article','aside','body','button','dd','details','dialog','div','dl','dt','fieldset','footer','form','h1','h2','h3','h4','h5','h6','header','input','label','legend','li','main','nav','ol','option','p','section','select','span','summary','table','tbody','td','textarea','tfoot','th','thead','tr','ul']);
const pathTag = (el: Element): string => { const tag=el.tagName.toLowerCase(); return allowedPathTags.has(tag) ? tag : 'element'; };
const signal = (el: Element): string => ['name', 'id', 'autocomplete', 'aria-label', 'placeholder', 'type', 'class'].map(a => (el.getAttribute(a) || '').slice(0,512)).join(' ').toLowerCase();

/** Path has only tag names and same-tag sibling indices; never IDs, labels, text or values. */
export function normalizedPath(el: Element): string {
  const parts: string[] = []; const body = el.ownerDocument.body;
  if (!body || !body.contains(el)) return '';
  let p: Element | null = el;
  while (p && p !== body && parts.length < 20) {
    const tag = pathTag(p);
    let index = 0; for (let sib = p.previousElementSibling; sib; sib = sib.previousElementSibling) if (pathTag(sib) === tag) index++;
    parts.push(`${tag}:${index}`); p = p.parentElement;
  }
  // Never truncate the ancestry: two deep branches could otherwise get the same path.
  return p === body ? parts.reverse().join('/') : '';
}
export function visible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const win = el.ownerDocument.defaultView;
  const style = win?.getComputedStyle(el);
  if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  if ((el as HTMLInputElement).type === 'hidden') return false;
  if (win) {
    // Opacity is not inherited, so inspect ancestors as well.
    for (let p: Element | null = el; p; p = p.parentElement) if (Number(win.getComputedStyle(p).opacity || '1') === 0) return false;
    // Require a nonzero rendered box regardless of user-agent strings.
    if (!Array.from(el.getClientRects()).some(r => r.width > 0 && r.height > 0)) return false;
  }
  return true;
}
export function detectChallenges(doc: Document): Challenge[] {
  const found = new Set<Challenge>();
  for (const el of Array.from(doc.querySelectorAll('input,button,select,textarea,iframe,[data-sitekey],[class*="captcha" i],[id*="captcha" i]')).slice(0, 1500)) {
    if (!(el instanceof HTMLElement) || !visible(el)) continue;
    const s = signal(el);
    const src = el.tagName === 'IFRAME' ? (el.getAttribute('src') || '').slice(0,1024).toLowerCase() : '';
    if (/one[-_ ]?time|otp|totp|2fa|mfa|verification[-_ ]?code|auth[-_ ]?code|(?:^|[^a-z])(code|pin)(?:[^a-z]|$)/.test(s)) found.add('otp');
    if (/captcha|turnstile|hcaptcha|recaptcha/.test(s + ' ' + src) || el.hasAttribute('data-sitekey')) found.add('captcha');
    if (/webauthn|passkey|security[-_ ]?key/.test(s)) found.add('passkey');
    if (/security[-_ ]?question|recovery[-_ ]?question/.test(s)) found.add('security-question');
  }
  return [...found].sort();
}
export async function fingerprint(doc: Document, origin: string): Promise<Snapshot> {
  const nodes: StructuralNode[] = [];
  const candidates = Array.from(doc.querySelectorAll('input,button,select,textarea')).slice(0, 1000);
  for (const el of candidates) {
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase() as StructuralNode['tag'];
    const rawType = (el.getAttribute('type') || (tag === 'button' ? 'submit' : 'text')).toLowerCase();
    const type = allowedTypes.has(rawType) ? rawType : 'other';
    const r = (el.getAttribute('role') || '').toLowerCase();
    const role = allowedRoles.has(r) ? r : '';
    const words = (el.getAttribute('autocomplete') || '').slice(0,1024).toLowerCase().split(/\s+/);
    const autocomplete = [...new Set(words.filter(x => allowedAuto.has(x)))].sort().join(' ');
    const s = signal(el);
    const isOtp = /one[-_ ]?time|otp|totp|2fa|mfa|verification[-_ ]?code|auth[-_ ]?code|(?:^|[^a-z])(code|pin)(?:[^a-z]|$)/.test(s);
    const suggested = !isOtp && tag === 'input' && type === 'password' && !autocomplete.includes('new-password') ? 'password'
      : !isOtp && tag === 'input' && (type === 'email' || /username|email|login[-_ ]?id/.test(s) || autocomplete.includes('username')) ? 'username' : null;
    const path = normalizedPath(el);
    if (path) nodes.push({ path, tag, type, role, depth: path.split('/').length, autocomplete, suggested });
  }
  const challenges = detectChallenges(doc);
  // Suggested role uses temporary DOM signals but only the enum, never the signal, is persisted.
  // Excluding it from the digest keeps cosmetic name/placeholder changes from changing identity.
  const canonical = nodes.map(({ path, tag, type, role, depth, autocomplete }) => ({ path, tag, type, role, depth, autocomplete }));
  const digest = await sha256(JSON.stringify({ schema: 1, nodes: canonical }));
  return { schema: 1, origin: canonicalOrigin(origin), fingerprint: digest, nodes, challenges };
}
/** Watches rendered structure and SPA location changes; no input event or value is read. */
export function observeDocument(doc: Document, callback: (s: Snapshot) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined; let busy = false; let last = ''; let lastUrl = doc.location.href;
  const scan = async () => {
    if (busy) return; busy = true;
    try { const snap = await fingerprint(doc, doc.location.origin); const key = `${snap.fingerprint}:${snap.challenges.join(',')}`; if (key !== last) { last = key; callback(snap); } } catch { /* unsupported origin or document in transition */ } finally { busy = false; }
  };
  const queue = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void scan(), 180); };
  const observer = new MutationObserver(queue);
  observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['type', 'role', 'autocomplete', 'hidden', 'aria-hidden', 'style', 'class', 'id', 'name', 'src'] });
  const interval = setInterval(() => { if (doc.location.href !== lastUrl) { lastUrl = doc.location.href; last = ''; queue(); } }, 1000);
  doc.defaultView?.addEventListener('popstate', queue); doc.defaultView?.addEventListener('hashchange', queue);
  void scan();
  return () => { observer.disconnect(); clearInterval(interval); if (timer) clearTimeout(timer); doc.defaultView?.removeEventListener('popstate', queue); doc.defaultView?.removeEventListener('hashchange', queue); };
}
