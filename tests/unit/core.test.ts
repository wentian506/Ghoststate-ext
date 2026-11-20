import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { fingerprint, observeDocument } from '../../packages/dom-fingerprinter/src/index';
import { addState, createWorkflow, recognize, canTransition } from '../../packages/state-machine/src/index';
import { canonicalOrigin } from '../../packages/shared-types/src/index';

describe('structural fingerprint and manual workflow', () => {
  let dom: JSDOM; let cleanup: (() => void) | undefined;
  beforeEach(() => { dom = new JSDOM('<html><body><main><form><input type="email" autocomplete="username"><button>Continue</button></form></main></body></html>', { url: 'https://portal.example/login' }); Object.assign(globalThis, { HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver }); Object.defineProperty(dom.window.HTMLElement.prototype,'getClientRects',{value:()=>[new dom.window.DOMRect(0,0,100,20)]}); });
  afterEach(() => { cleanup?.(); cleanup = undefined; dom.window.close(); });
  it('is stable across value, text, id, class, and style changes and excludes secrets', async () => {
    const a = await fingerprint(dom.window.document, dom.window.location.origin); const input = dom.window.document.querySelector('input')!;
    input.value = 'VERY-SECRET'; input.id = 'private-id'; input.className = 'new-layout'; input.placeholder = 'sensitive label'; dom.window.document.querySelector('button')!.textContent = 'Different';
    const b = await fingerprint(dom.window.document, dom.window.location.origin);
    expect(a.fingerprint).toBe(b.fingerprint); expect(JSON.stringify(b)).not.toContain('VERY-SECRET'); expect(JSON.stringify(b)).not.toContain('private-id'); expect(JSON.stringify(b)).not.toContain('sensitive label');
  });
  it('never stores arbitrary custom tag names and disambiguates their siblings', async () => {
    dom.window.document.body.innerHTML='<customer-jane-doe><input type="text"></customer-jane-doe><account-secret-value><input type="text"></account-secret-value>';
    const snap=await fingerprint(dom.window.document,dom.window.location.origin);
    expect(JSON.stringify(snap)).not.toMatch(/customer-jane-doe|account-secret-value/);
    expect(snap.nodes.map(n=>n.path)).toEqual(['element:0/input:0','element:1/input:0']);
  });
  it('does not capture hidden or fully transparent fields', async () => {
    dom.window.document.body.innerHTML='<div style="opacity:0"><input type="text"></div><input type="password" hidden><input type="email">';
    const snap=await fingerprint(dom.window.document,dom.window.location.origin);expect(snap.nodes).toHaveLength(1);expect(snap.nodes[0].type).toBe('email');
  });
  it('skips over-deep fields instead of recording ambiguous truncated paths', async () => {
    const doc=dom.window.document;doc.body.innerHTML='';let parent:HTMLElement=doc.body;
    for(let i=0;i<22;i++){const next=doc.createElement('div');parent.append(next);parent=next;}
    parent.append(doc.createElement('input'));const snap=await fingerprint(doc,dom.window.location.origin);expect(snap.nodes).toHaveLength(0);
  });
  it('changes when a visible form changes and observes SPA route transitions', async () => {
    const snapshots: string[] = []; cleanup = observeDocument(dom.window.document, s => snapshots.push(s.fingerprint));
    await new Promise(r => setTimeout(r, 250)); dom.window.history.pushState({}, '', '/password'); dom.window.document.querySelector('form')!.innerHTML = '<input type="password" autocomplete="current-password">';
    await new Promise(r => setTimeout(r, 350)); expect(new Set(snapshots).size).toBe(2);
  });
  it('records edges across same-origin navigation, recognizes, and pauses for drift and challenges', async () => {
    const doc = dom.window.document; const a = await fingerprint(doc, dom.window.location.origin); let w = createWorkflow(a.origin);
    w = addState(w, a, [{path: a.nodes[0].path, kind: 'username'}]);
    dom.window.history.pushState({}, '', '/next'); doc.querySelector('form')!.innerHTML = '<input type="password" autocomplete="current-password"><button>Sign in</button>';
    const b = await fingerprint(doc, dom.window.location.origin); w = addState(w, b, [{path: b.nodes[0].path, kind: 'password'}]);
    expect(w.edges).toHaveLength(1); expect(recognize(w, b).status).toBe('matched'); expect(canTransition(w, w.states[0].id, w.states[1].id)).toBe(true); expect(canTransition(w, w.states[0].id, 'unknown-state')).toBe(false); expect(canTransition(w, w.states[1].id, w.states[0].id)).toBe(true);
    doc.querySelector('form')!.insertAdjacentHTML('beforeend', '<input autocomplete="one-time-code" value="123456">');
    const otp = await fingerprint(doc, dom.window.location.origin); expect(otp.challenges).toContain('otp'); expect(JSON.stringify(otp)).not.toContain('123456'); expect(recognize(w, otp).status).toBe('pause');
    doc.querySelector('input[autocomplete="one-time-code"]')!.remove(); doc.querySelector('form')!.insertAdjacentHTML('beforeend', '<iframe src="https://www.google.com/recaptcha/abc"></iframe>');
    expect((await fingerprint(doc, dom.window.location.origin)).challenges).toContain('captcha');
    expect(recognize(w, {...b, origin:'https://evil.example'}).status).toBe('pause');
    expect(recognize(w, {...b, fingerprint:'f'.repeat(64)}).status).toBe('pause');
  });
  it('pauses for passkeys, security questions and generic OTP-code fields', async () => {
    const doc=dom.window.document;doc.body.innerHTML='<input name="verification_code"><input autocomplete="webauthn"><input name="security_question">';
    const s=await fingerprint(doc,dom.window.location.origin);expect(s.challenges).toEqual(expect.arrayContaining(['otp','passkey','security-question']));
    const w=createWorkflow(s.origin);expect(()=>addState(w,s,[{path:s.nodes[0].path,kind:'username'}])).toThrow('challenge');
  });
  it('surfaces route changes even when the form stays structurally identical', async () => {
    let calls=0;cleanup=observeDocument(dom.window.document,()=>calls++);await new Promise(r=>setTimeout(r,200));dom.window.history.pushState({},'', '/same-form');await new Promise(r=>setTimeout(r,1250));expect(calls).toBeGreaterThanOrEqual(2);
  });
  it('rejects insecure and embedded-credential origins', () => { expect(() => canonicalOrigin('http://example.com')).toThrow(); expect(() => canonicalOrigin('https://alice:secret@example.com')).toThrow(); expect(canonicalOrigin('http://127.0.0.1:123/x?q=sensitive')).toBe('http://127.0.0.1:123'); });
});
