import { detectChallenges, fingerprint, normalizedPath, observeDocument, visible } from '../../../packages/dom-fingerprinter/src/index';
import type { FieldKind } from '../../../packages/shared-types/src/index';
import { extensionApi as api } from '../../../packages/browser-adapters/src/index';

/** Conservative automatic-only visibility: fully inside the viewport and not
 * hidden behind an overlay or nearly transparent ancestor. A user may always
 * take over manually if a legitimate layout fails this check. */
function exposedForAutomatic(el:HTMLInputElement):boolean {
  const rect=el.getBoundingClientRect();
  if(rect.width < 8 || rect.height < 8 || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return false;
  for(let p:Element|null=el;p;p=p.parentElement) {
    const opacity=Number(getComputedStyle(p).opacity || '1');if(!Number.isFinite(opacity) || opacity < 0.5) return false;
  }
  const inset=Math.min(3,rect.width/4,rect.height/4);
  const points=[[rect.left+inset,rect.top+inset],[rect.right-inset,rect.top+inset],[rect.left+inset,rect.bottom-inset],[rect.right-inset,rect.bottom-inset],[(rect.left+rect.right)/2,(rect.top+rect.bottom)/2]];
  return points.every(([x,y])=>document.elementFromPoint(x,y)===el);
}

const root = globalThis as typeof globalThis & { __ghoststateStop?: () => void };
if (!root.__ghoststateStop && api) {
  // Unique to this top-level document; a later navigation cannot reuse a stale approval.
  const documentId = crypto.randomUUID();
  const stopObservation = observeDocument(document, snapshot => { void api!.runtime.sendMessage({ type: 'GS_OBSERVATION', snapshot }).catch(() => {}); });
  const listener: Parameters<typeof api.runtime.onMessage.addListener>[0] = (message, sender, respond) => {
    if (sender.id !== api!.runtime.id || !message || typeof message !== 'object') return false;
    if (message.type === 'GS_STOP') { stopObservation(); api!.runtime.onMessage.removeListener(listener); delete root.__ghoststateStop; respond({ok:true}); return false; }
    if (message.type === 'GS_SCAN') {
      fingerprint(document, location.origin).then(snapshot => respond({ ok: true, snapshot, documentId }), () => respond({ ok: false, error: 'Unable to scan this page.' })); return true;
    }
    if (message.type === 'GS_FILL') {
      (async () => {
        if (typeof message.origin !== 'string' || location.origin !== message.origin || message.documentId !== documentId || typeof message.fingerprint !== 'string' || !Array.isArray(message.fields) || message.fields.length > 20 || (message.automatic !== undefined && typeof message.automatic !== 'boolean')) throw new Error('Invalid fill request or page changed.');
        const automatic = message.automatic === true;
        if (automatic && (document.visibilityState !== 'visible' || !document.hasFocus())) throw new Error('Automatic fill requires a visible, focused page.');
        const snap = await fingerprint(document, location.origin);
        if (snap.challenges.length) throw new Error('Challenge detected. Continue manually.');
        if (snap.fingerprint !== message.fingerprint) throw new Error('The page changed. Review it before filling.');
        // Digesting is asynchronous; re-check challenge hints in the current live DOM.
        if (detectChallenges(document).length) throw new Error('Challenge detected. Continue manually.');
        const seen = new Set<string>();
        // Validate *all* targets before mutating any field.
        const targets = message.fields.map((field: { path: string; kind: FieldKind; value: string }) => {
          if (!field || typeof field.path !== 'string' || typeof field.value !== 'string' || field.value.length > 4096 || !['username', 'password'].includes(field.kind) || seen.has(field.path)) throw new Error('Invalid fill target.');
          seen.add(field.path); const n = snap.nodes.find(x => x.path === field.path);
          if (!n || n.tag !== 'input' || n.autocomplete.includes('one-time-code') || n.autocomplete.includes('new-password') || n.autocomplete.includes('webauthn')) throw new Error('Unsafe fill target.');
          if (field.kind === 'password' && n.type !== 'password') throw new Error('Unsafe password target.');
          if (field.kind === 'username' && !['text','email','search','url'].includes(n.type)) throw new Error('Unsafe username target.');
          const el = Array.from(document.querySelectorAll('input')).find(x => normalizedPath(x) === field.path);
          if (!el || !el.isConnected || el.disabled || el.readOnly || !visible(el)) throw new Error('Field is unavailable.');
          const liveType = (el.getAttribute('type') || 'text').toLowerCase();
          const liveAutocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
          if (liveType !== n.type || /one-time-code|new-password|webauthn/.test(liveAutocomplete)) throw new Error('The page changed. Review it before filling.');
          if (automatic) {
            if (!exposedForAutomatic(el)) throw new Error('Automatic fill requires fully visible, unobstructed fields.');
            if (el.value !== '') throw new Error('Automatic fill will not overwrite existing input.');
            if (el.form && new URL(el.form.getAttribute('action') || location.href, location.href).origin !== location.origin) throw new Error('Automatic fill blocked for a cross-origin form action.');
          }
          return { el, value: field.value };
        });
        if (automatic && (document.visibilityState !== 'visible' || !document.hasFocus())) throw new Error('Automatic fill requires a visible, focused page.');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('Input setter unavailable.');
        // Set all values before firing site event handlers that may synchronously change the DOM.
        for (const {el, value} of targets) setter.call(el, value);
        for (const {el} of targets) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
        return { count: targets.length };
      })().then(data => respond({ ok: true, data }), e => respond({ ok: false, error: e instanceof Error ? e.message : 'Fill failed.' }));
      return true;
    }
    return false;
  };
  root.__ghoststateStop = () => { stopObservation(); api!.runtime.onMessage.removeListener(listener); delete root.__ghoststateStop; };
  api.runtime.onMessage.addListener(listener);
}
