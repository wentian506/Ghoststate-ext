"use strict";
(() => {
  // packages/crypto-core/src/index.ts
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  async function sha256(input) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(input)));
    return [...digest].map((n) => n.toString(16).padStart(2, "0")).join("");
  }

  // packages/shared-types/src/index.ts
  function canonicalOrigin(input) {
    if (typeof input !== "string" || input.length > 2048) throw new Error("Invalid site URL.");
    let u;
    try {
      u = new URL(input);
    } catch {
      throw new Error("Enter a valid site URL, including https://.");
    }
    if (u.username || u.password) throw new Error("URLs containing credentials are not allowed.");
    const local = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
      throw new Error("Only HTTPS sites are supported (HTTP is allowed for loopback testing only).");
    }
    if (u.origin === "null") throw new Error("Unsupported site origin.");
    return u.origin;
  }

  // packages/dom-fingerprinter/src/index.ts
  var allowedRoles = /* @__PURE__ */ new Set(["textbox", "button", "combobox", "checkbox", "radio", "searchbox", "switch"]);
  var allowedTypes = /* @__PURE__ */ new Set(["text", "email", "password", "tel", "number", "search", "url", "submit", "button", "checkbox", "radio"]);
  var allowedAuto = /* @__PURE__ */ new Set(["username", "email", "current-password", "new-password", "one-time-code", "webauthn"]);
  var allowedPathTags = /* @__PURE__ */ new Set(["a", "article", "aside", "body", "button", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "input", "label", "legend", "li", "main", "nav", "ol", "option", "p", "section", "select", "span", "summary", "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "tr", "ul"]);
  var pathTag = (el) => {
    const tag = el.tagName.toLowerCase();
    return allowedPathTags.has(tag) ? tag : "element";
  };
  var signal = (el) => ["name", "id", "autocomplete", "aria-label", "placeholder", "type", "class"].map((a) => (el.getAttribute(a) || "").slice(0, 512)).join(" ").toLowerCase();
  function normalizedPath(el) {
    const parts = [];
    const body = el.ownerDocument.body;
    if (!body || !body.contains(el)) return "";
    let p = el;
    while (p && p !== body && parts.length < 20) {
      const tag = pathTag(p);
      let index = 0;
      for (let sib = p.previousElementSibling; sib; sib = sib.previousElementSibling) if (pathTag(sib) === tag) index++;
      parts.push(`${tag}:${index}`);
      p = p.parentElement;
    }
    return p === body ? parts.reverse().join("/") : "";
  }
  function visible(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const win = el.ownerDocument.defaultView;
    const style = win?.getComputedStyle(el);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
    if (el.type === "hidden") return false;
    if (win) {
      for (let p = el; p; p = p.parentElement) if (Number(win.getComputedStyle(p).opacity || "1") === 0) return false;
      if (!Array.from(el.getClientRects()).some((r) => r.width > 0 && r.height > 0)) return false;
    }
    return true;
  }
  function detectChallenges(doc) {
    const found = /* @__PURE__ */ new Set();
    for (const el of Array.from(doc.querySelectorAll('input,button,select,textarea,iframe,[data-sitekey],[class*="captcha" i],[id*="captcha" i]')).slice(0, 1500)) {
      if (!(el instanceof HTMLElement) || !visible(el)) continue;
      const s = signal(el);
      const src = el.tagName === "IFRAME" ? (el.getAttribute("src") || "").slice(0, 1024).toLowerCase() : "";
      if (/one[-_ ]?time|otp|totp|2fa|mfa|verification[-_ ]?code|auth[-_ ]?code|(?:^|[^a-z])(code|pin)(?:[^a-z]|$)/.test(s)) found.add("otp");
      if (/captcha|turnstile|hcaptcha|recaptcha/.test(s + " " + src) || el.hasAttribute("data-sitekey")) found.add("captcha");
      if (/webauthn|passkey|security[-_ ]?key/.test(s)) found.add("passkey");
      if (/security[-_ ]?question|recovery[-_ ]?question/.test(s)) found.add("security-question");
    }
    return [...found].sort();
  }
  async function fingerprint(doc, origin) {
    const nodes = [];
    const candidates = Array.from(doc.querySelectorAll("input,button,select,textarea")).slice(0, 1e3);
    for (const el of candidates) {
      if (!visible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const rawType = (el.getAttribute("type") || (tag === "button" ? "submit" : "text")).toLowerCase();
      const type = allowedTypes.has(rawType) ? rawType : "other";
      const r = (el.getAttribute("role") || "").toLowerCase();
      const role = allowedRoles.has(r) ? r : "";
      const words = (el.getAttribute("autocomplete") || "").slice(0, 1024).toLowerCase().split(/\s+/);
      const autocomplete = [...new Set(words.filter((x) => allowedAuto.has(x)))].sort().join(" ");
      const s = signal(el);
      const isOtp = /one[-_ ]?time|otp|totp|2fa|mfa|verification[-_ ]?code|auth[-_ ]?code|(?:^|[^a-z])(code|pin)(?:[^a-z]|$)/.test(s);
      const suggested = !isOtp && tag === "input" && type === "password" && !autocomplete.includes("new-password") ? "password" : !isOtp && tag === "input" && (type === "email" || /username|email|login[-_ ]?id/.test(s) || autocomplete.includes("username")) ? "username" : null;
      const path = normalizedPath(el);
      if (path) nodes.push({ path, tag, type, role, depth: path.split("/").length, autocomplete, suggested });
    }
    const challenges = detectChallenges(doc);
    const canonical = nodes.map(({ path, tag, type, role, depth, autocomplete }) => ({ path, tag, type, role, depth, autocomplete }));
    const digest = await sha256(JSON.stringify({ schema: 1, nodes: canonical }));
    return { schema: 1, origin: canonicalOrigin(origin), fingerprint: digest, nodes, challenges };
  }
  function observeDocument(doc, callback) {
    let timer;
    let busy = false;
    let last = "";
    let lastUrl = doc.location.href;
    const scan = async () => {
      if (busy) return;
      busy = true;
      try {
        const snap = await fingerprint(doc, doc.location.origin);
        const key = `${snap.fingerprint}:${snap.challenges.join(",")}`;
        if (key !== last) {
          last = key;
          callback(snap);
        }
      } catch {
      } finally {
        busy = false;
      }
    };
    const queue = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void scan(), 180);
    };
    const observer = new MutationObserver(queue);
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["type", "role", "autocomplete", "hidden", "aria-hidden", "style", "class", "id", "name", "src"] });
    const interval = setInterval(() => {
      if (doc.location.href !== lastUrl) {
        lastUrl = doc.location.href;
        last = "";
        queue();
      }
    }, 1e3);
    doc.defaultView?.addEventListener("popstate", queue);
    doc.defaultView?.addEventListener("hashchange", queue);
    void scan();
    return () => {
      observer.disconnect();
      clearInterval(interval);
      if (timer) clearTimeout(timer);
      doc.defaultView?.removeEventListener("popstate", queue);
      doc.defaultView?.removeEventListener("hashchange", queue);
    };
  }

  // packages/browser-adapters/src/index.ts
  var extensionApi = globalThis.browser || (typeof chrome !== "undefined" && chrome.runtime?.id ? chrome : void 0);

  // apps/browser-extension/src/content.ts
  function exposedForAutomatic(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8 || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return false;
    for (let p = el; p; p = p.parentElement) {
      const opacity = Number(getComputedStyle(p).opacity || "1");
      if (!Number.isFinite(opacity) || opacity < 0.5) return false;
    }
    const inset = Math.min(3, rect.width / 4, rect.height / 4);
    const points = [[rect.left + inset, rect.top + inset], [rect.right - inset, rect.top + inset], [rect.left + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset], [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2]];
    return points.every(([x, y]) => document.elementFromPoint(x, y) === el);
  }
  var root = globalThis;
  if (!root.__ghoststateStop && extensionApi) {
    const documentId = crypto.randomUUID();
    const stopObservation = observeDocument(document, (snapshot) => {
      void extensionApi.runtime.sendMessage({ type: "GS_OBSERVATION", snapshot }).catch(() => {
      });
    });
    const listener = (message, sender, respond) => {
      if (sender.id !== extensionApi.runtime.id || !message || typeof message !== "object") return false;
      if (message.type === "GS_STOP") {
        stopObservation();
        extensionApi.runtime.onMessage.removeListener(listener);
        delete root.__ghoststateStop;
        respond({ ok: true });
        return false;
      }
      if (message.type === "GS_SCAN") {
        fingerprint(document, location.origin).then((snapshot) => respond({ ok: true, snapshot, documentId }), () => respond({ ok: false, error: "Unable to scan this page." }));
        return true;
      }
      if (message.type === "GS_FILL") {
        (async () => {
          if (typeof message.origin !== "string" || location.origin !== message.origin || message.documentId !== documentId || typeof message.fingerprint !== "string" || !Array.isArray(message.fields) || message.fields.length > 20 || message.automatic !== void 0 && typeof message.automatic !== "boolean") throw new Error("Invalid fill request or page changed.");
          const automatic = message.automatic === true;
          if (automatic && (document.visibilityState !== "visible" || !document.hasFocus())) throw new Error("Automatic fill requires a visible, focused page.");
          const snap = await fingerprint(document, location.origin);
          if (snap.challenges.length) throw new Error("Challenge detected. Continue manually.");
          if (snap.fingerprint !== message.fingerprint) throw new Error("The page changed. Review it before filling.");
          if (detectChallenges(document).length) throw new Error("Challenge detected. Continue manually.");
          const seen = /* @__PURE__ */ new Set();
          const targets = message.fields.map((field) => {
            if (!field || typeof field.path !== "string" || typeof field.value !== "string" || field.value.length > 4096 || !["username", "password"].includes(field.kind) || seen.has(field.path)) throw new Error("Invalid fill target.");
            seen.add(field.path);
            const n = snap.nodes.find((x) => x.path === field.path);
            if (!n || n.tag !== "input" || n.autocomplete.includes("one-time-code") || n.autocomplete.includes("new-password") || n.autocomplete.includes("webauthn")) throw new Error("Unsafe fill target.");
            if (field.kind === "password" && n.type !== "password") throw new Error("Unsafe password target.");
            if (field.kind === "username" && !["text", "email", "search", "url"].includes(n.type)) throw new Error("Unsafe username target.");
            const el = Array.from(document.querySelectorAll("input")).find((x) => normalizedPath(x) === field.path);
            if (!el || !el.isConnected || el.disabled || el.readOnly || !visible(el)) throw new Error("Field is unavailable.");
            const liveType = (el.getAttribute("type") || "text").toLowerCase();
            const liveAutocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
            if (liveType !== n.type || /one-time-code|new-password|webauthn/.test(liveAutocomplete)) throw new Error("The page changed. Review it before filling.");
            if (automatic) {
              if (!exposedForAutomatic(el)) throw new Error("Automatic fill requires fully visible, unobstructed fields.");
              if (el.value !== "") throw new Error("Automatic fill will not overwrite existing input.");
              if (el.form && new URL(el.form.getAttribute("action") || location.href, location.href).origin !== location.origin) throw new Error("Automatic fill blocked for a cross-origin form action.");
            }
            return { el, value: field.value };
          });
          if (automatic && (document.visibilityState !== "visible" || !document.hasFocus())) throw new Error("Automatic fill requires a visible, focused page.");
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          if (!setter) throw new Error("Input setter unavailable.");
          for (const { el, value } of targets) setter.call(el, value);
          for (const { el } of targets) {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
          return { count: targets.length };
        })().then((data) => respond({ ok: true, data }), (e) => respond({ ok: false, error: e instanceof Error ? e.message : "Fill failed." }));
        return true;
      }
      return false;
    };
    root.__ghoststateStop = () => {
      stopObservation();
      extensionApi.runtime.onMessage.removeListener(listener);
      delete root.__ghoststateStop;
    };
    extensionApi.runtime.onMessage.addListener(listener);
  }
})();
