"use strict";
(() => {
  // packages/browser-adapters/src/index.ts
  var extensionApi = globalThis.browser || (typeof chrome !== "undefined" && chrome.runtime?.id ? chrome : void 0);

  // packages/crypto-core/src/index.ts
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  var KDF_ITERATIONS = 6e5;
  var randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
  function b64(bytes) {
    let s = "";
    for (const v of bytes) s += String.fromCharCode(v);
    return btoa(s);
  }
  function unb64(s) {
    if (typeof s !== "string" || s.length > 12e6) throw new Error("Invalid encoded data.");
    try {
      return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    } catch {
      throw new Error("Invalid encoded data.");
    }
  }
  async function deriveVaultKey(passphrase, salt, iterations = KDF_ITERATIONS) {
    if (salt.length !== 16 || !Number.isSafeInteger(iterations) || iterations < 6e5 || iterations > 2e6) throw new Error("Unsupported KDF parameters.");
    const material = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function seal(key, value, context) {
    const iv = randomBytes(12);
    const plaintext = enc.encode(JSON.stringify(value));
    try {
      const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(context), tagLength: 128 }, key, plaintext);
      return { iv: b64(iv), ciphertext: b64(new Uint8Array(bytes)) };
    } finally {
      plaintext.fill(0);
    }
  }
  async function open(key, value, context) {
    const iv = unb64(value.iv);
    if (iv.length !== 12) throw new Error("Invalid nonce.");
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(context), tagLength: 128 }, key, unb64(value.ciphertext));
    const plain = new Uint8Array(bytes);
    try {
      return JSON.parse(dec.decode(plain));
    } finally {
      plain.fill(0);
    }
  }

  // packages/shared-types/src/index.ts
  var MAX_PROFILES = 200;
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
  function requireOrigin(actual, expected) {
    if (canonicalOrigin(actual) !== canonicalOrigin(expected)) throw new Error("Origin mismatch. No credentials were released.");
  }
  function uid() {
    return crypto.randomUUID();
  }
  function assertText(value, name, max = 1024, min = 1) {
    if (typeof value !== "string" || value.length < min || value.length > max) throw new Error(`Invalid ${name}.`);
  }

  // packages/state-machine/src/index.ts
  function createWorkflow(origin2) {
    return { schema: 1, id: uid(), origin: origin2, version: 1, states: [], edges: [], updatedAt: Date.now() };
  }
  function addState(w, snap, mappings) {
    requireOrigin(snap.origin, w.origin);
    if (snap.schema !== 1 || !/^[0-9a-f]{64}$/.test(snap.fingerprint) || snap.nodes.length > 1e3) throw new Error("Invalid structural snapshot.");
    if (snap.challenges.length) throw new Error("A challenge is visible. Complete it manually before recording.");
    if (w.states.length >= 50) throw new Error("Workflow state limit reached.");
    if (!Array.isArray(mappings) || mappings.length > 20) throw new Error("Invalid mappings.");
    const seen = /* @__PURE__ */ new Set();
    for (const mapping of mappings) {
      const n = snap.nodes.find((x) => x.path === mapping.path);
      if (seen.has(mapping.path) || !n || n.tag !== "input" || !["username", "password"].includes(mapping.kind)) throw new Error("Invalid field mapping.");
      if (n.autocomplete.includes("one-time-code") || n.autocomplete.includes("webauthn") || n.autocomplete.includes("new-password")) throw new Error("Challenge or new-password fields cannot be mapped.");
      if (mapping.kind === "password" && n.type !== "password") throw new Error("Passwords can only be mapped to password fields.");
      if (mapping.kind === "username" && !["text", "email", "search", "url"].includes(n.type)) throw new Error("Username requires a text-like field.");
      seen.add(mapping.path);
    }
    if (!mappings.length) throw new Error("Choose at least one username or password field.");
    const existing = w.states.find((s2) => s2.fingerprint === snap.fingerprint);
    if (existing) throw new Error("This state is already recorded.");
    const s = { id: uid(), fingerprint: snap.fingerprint, nodes: snap.nodes, mappings, addedAt: Date.now() };
    const prev = w.states.at(-1);
    return { ...w, version: w.version + 1, states: [...w.states, s], edges: prev ? [...w.edges, { from: prev.id, to: s.id, action: "manual-submit-or-navigation" }] : w.edges, updatedAt: Date.now() };
  }
  function recognize(w, s) {
    try {
      requireOrigin(s.origin, w.origin);
    } catch {
      return { status: "pause", reason: "This site has a different origin. Switch sites and approve it separately.", confidence: 0 };
    }
    if (s.challenges.length) return { status: "pause", reason: `Complete ${s.challenges.join(", ")} manually.`, confidence: 0 };
    const exact = w.states.find((x) => x.fingerprint === s.fingerprint);
    if (exact) return { status: "matched", state: exact, confidence: 1 };
    let best = 0;
    const incoming = new Set(s.nodes.map((n) => `${n.path}|${n.tag}|${n.type}|${n.role}`));
    for (const state of w.states) {
      const saved = new Set(state.nodes.map((n) => `${n.path}|${n.tag}|${n.type}|${n.role}`));
      const intersection = [...saved].filter((x) => incoming.has(x)).length;
      const union = (/* @__PURE__ */ new Set([...saved, ...incoming])).size;
      best = Math.max(best, union ? intersection / union : 0);
    }
    return { status: "pause", reason: "The page does not exactly match a learned state. Take over manually or record the changed state.", confidence: best };
  }
  function canTransition(w, previousId, nextId) {
    if (!w.states.some((s) => s.id === nextId)) return false;
    if (!previousId || previousId === nextId || w.states[0]?.id === nextId) return true;
    return w.edges.some((e) => e.from === previousId && e.to === nextId && e.action === "manual-submit-or-navigation");
  }

  // packages/vault/src/validation.ts
  var object = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  var keys = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));
  var text = (x, max, min = 1) => typeof x === "string" && x.length >= min && x.length <= max;
  var timestamp = (x) => Number.isSafeInteger(x) && x >= 0 && x <= 864e13;
  var origin = (x) => {
    try {
      return text(x, 2048) && canonicalOrigin(x) === x;
    } catch {
      return false;
    }
  };
  var types = /* @__PURE__ */ new Set(["text", "email", "password", "tel", "number", "search", "url", "submit", "button", "checkbox", "radio", "other"]);
  var roles = /* @__PURE__ */ new Set(["", "textbox", "button", "combobox", "checkbox", "radio", "searchbox", "switch"]);
  var autos = /* @__PURE__ */ new Set(["username", "email", "current-password", "new-password", "one-time-code", "webauthn"]);
  var pathPattern = /^(?:[a-z][a-z0-9-]{0,29}:\d{1,9})(?:\/[a-z][a-z0-9-]{0,29}:\d{1,9}){0,19}$/;
  function node(x) {
    if (!object(x) || !keys(x, ["path", "tag", "type", "role", "depth", "autocomplete", "suggested"])) return false;
    return text(x.path, 800) && pathPattern.test(x.path) && Number.isInteger(x.depth) && x.depth === x.path.split("/").length && typeof x.tag === "string" && ["input", "button", "select", "textarea"].includes(x.tag) && typeof x.type === "string" && types.has(x.type) && typeof x.role === "string" && roles.has(x.role) && text(x.autocomplete, 128, 0) && (!x.autocomplete || x.autocomplete.split(" ").every((v) => autos.has(v))) && (x.suggested === null || x.suggested === "username" || x.suggested === "password");
  }
  function workflow(x, expectedOrigin) {
    if (!object(x) || !keys(x, ["schema", "id", "origin", "version", "states", "edges", "updatedAt"]) || x.schema !== 1 || !text(x.id, 64) || x.origin !== expectedOrigin || !Number.isSafeInteger(x.version) || x.version < 1 || x.version > 1e6 || !Array.isArray(x.states) || x.states.length > 50 || !Array.isArray(x.edges) || x.edges.length > 100 || !timestamp(x.updatedAt)) return false;
    const stateIds = /* @__PURE__ */ new Set();
    const fingerprints = /* @__PURE__ */ new Set();
    for (const s of x.states) {
      if (!object(s) || !keys(s, ["id", "fingerprint", "nodes", "mappings", "addedAt"]) || !text(s.id, 64) || stateIds.has(s.id) || !text(s.fingerprint, 64, 64) || !/^[0-9a-f]{64}$/.test(s.fingerprint) || fingerprints.has(s.fingerprint) || !Array.isArray(s.nodes) || s.nodes.length > 1e3 || !s.nodes.every(node) || !Array.isArray(s.mappings) || !s.mappings.length || s.mappings.length > 20 || !timestamp(s.addedAt)) return false;
      stateIds.add(s.id);
      fingerprints.add(s.fingerprint);
      const nodes = /* @__PURE__ */ new Map();
      for (const n of s.nodes) {
        const p = n.path;
        if (nodes.has(p)) return false;
        nodes.set(p, n);
      }
      const mapped = /* @__PURE__ */ new Set();
      for (const m of s.mappings) {
        if (!object(m) || !keys(m, ["path", "kind"]) || !text(m.path, 800) || mapped.has(m.path) || (typeof m.kind !== "string" || !["username", "password"].includes(m.kind))) return false;
        const n = nodes.get(m.path);
        if (!n || n.tag !== "input" || typeof n.autocomplete !== "string" || /one-time-code|new-password|webauthn/.test(n.autocomplete)) return false;
        if (m.kind === "password" && n.type !== "password" || m.kind === "username" && (typeof n.type !== "string" || !["text", "email", "search", "url"].includes(n.type))) return false;
        mapped.add(m.path);
      }
    }
    return x.edges.every((e) => object(e) && keys(e, ["from", "to", "action"]) && typeof e.from === "string" && typeof e.to === "string" && stateIds.has(e.from) && stateIds.has(e.to) && e.action === "manual-submit-or-navigation");
  }
  function validVaultData(x) {
    if (!object(x) || !keys(x, ["schema", "profiles", "events", "autoLockMinutes", "logging"]) || x.schema !== 1 || !Array.isArray(x.profiles) || x.profiles.length > MAX_PROFILES || !Array.isArray(x.events) || x.events.length > 200 || !Number.isInteger(x.autoLockMinutes) || x.autoLockMinutes < 1 || x.autoLockMinutes > 30 || typeof x.logging !== "boolean") return false;
    const ids = /* @__PURE__ */ new Set();
    for (const p of x.profiles) {
      if (!object(p) || !keys(p, ["id", "label", "origin", "username", "password", "workflow", "createdAt"]) || !text(p.id, 64) || ids.has(p.id) || !text(p.label, 80) || !p.label.trim() || !origin(p.origin) || !text(p.username, 512) || !text(p.password, 4096) || !timestamp(p.createdAt) || !(p.workflow === null || workflow(p.workflow, p.origin))) return false;
      ids.add(p.id);
    }
    return x.events.every((e) => object(e) && keys(e, ["id", "at", "action", "origin", "detail"]) && text(e.id, 64) && timestamp(e.at) && text(e.action, 120) && (e.origin === void 0 || origin(e.origin)) && (e.detail === void 0 || text(e.detail, 512, 0)));
  }

  // packages/vault/src/passwords.ts
  function potentiallyWeak(password) {
    const p = password.toLowerCase();
    return password.length < 12 || /^(.)\1+$/u.test(password) || ["password", "qwerty", "123456", "letmein", "iloveyou"].some((x) => p.includes(x));
  }

  // packages/vault/src/index.ts
  var CHECK = "ghoststate:v1:verifier";
  var DATA = "ghoststate:v1:vault";
  var fresh = () => ({ schema: 1, profiles: [], events: [], autoLockMinutes: 5, logging: false });
  function log(d, action, origin2, detail) {
    if (!d.logging) return;
    d.events.unshift({ id: uid(), at: Date.now(), action, ...origin2 ? { origin: origin2 } : {}, ...detail ? { detail } : {} });
    d.events.length = Math.min(d.events.length, 200);
  }
  function validHeader(h) {
    return !!h && h.schema === 1 && h.kdf === "PBKDF2-SHA256" && h.iterations >= KDF_ITERATIONS && h.iterations <= 2e6 && typeof h.salt === "string" && !!h.verifier;
  }
  var Vault = class {
    db;
    key = null;
    expiresAt = 0;
    timeoutMinutes = 5;
    generation = 0;
    queue = Promise.resolve();
    timer;
    constructor(name = "ghoststate-vault-v1") {
      this.db = new Promise((resolve, reject) => {
        const r = indexedDB.open(name, 1);
        r.onupgradeneeded = () => r.result.createObjectStore("items");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    async get(key) {
      const db = await this.db;
      return new Promise((resolve, reject) => {
        const req = db.transaction("items").objectStore("items").get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    async writeMany(entries) {
      const db = await this.db;
      await new Promise((resolve, reject) => {
        const tx = db.transaction("items", "readwrite");
        for (const [k, v] of entries) tx.objectStore("items").put(v, k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
    serialized(fn) {
      const p = this.queue.then(fn, fn);
      this.queue = p.catch(() => {
      });
      return p;
    }
    touch() {
      this.expiresAt = Date.now() + this.timeoutMinutes * 6e4;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.lock(), this.timeoutMinutes * 6e4);
    }
    requireKey(touch = true) {
      if (!this.key || Date.now() >= this.expiresAt) {
        this.lock();
        throw new Error("Vault is locked.");
      }
      if (touch) this.touch();
      return this.key;
    }
    async status() {
      if (this.key && Date.now() >= this.expiresAt) this.lock();
      return { initialized: !!await this.get("header"), unlocked: !!this.key, timeoutMinutes: this.timeoutMinutes };
    }
    async setup(pass) {
      return this.serialized(async () => {
        if (await this.get("header")) throw new Error("Vault already exists.");
        assertText(pass, "master passphrase", 1024, 12);
        const salt = randomBytes(16);
        const key = await deriveVaultKey(pass, salt);
        const header = { schema: 1, kdf: "PBKDF2-SHA256", iterations: KDF_ITERATIONS, salt: b64(salt), verifier: await seal(key, { check: "ghoststate-vault" }, CHECK) };
        await this.writeMany([["header", header], ["data", await seal(key, fresh(), DATA)]]);
        this.key = key;
        this.generation++;
        this.timeoutMinutes = 5;
        this.touch();
      });
    }
    async unlock(pass) {
      return this.serialized(async () => {
        assertText(pass, "master passphrase", 1024, 1);
        const h = await this.get("header");
        if (!h || !validHeader(h)) throw new Error("Vault is missing or corrupt.");
        try {
          const key = await deriveVaultKey(pass, unb64(h.salt), h.iterations);
          const v = await open(key, h.verifier, CHECK);
          const data = await this.get("data");
          if (v.check !== "ghoststate-vault" || !data) throw new Error();
          const parsed = await open(key, data, DATA);
          if (!validVaultData(parsed)) throw new Error();
          this.timeoutMinutes = Math.min(30, Math.max(1, parsed.autoLockMinutes));
          this.key = key;
          this.generation++;
          this.touch();
        } catch {
          this.lock();
          throw new Error("Incorrect passphrase or damaged vault.");
        }
      });
    }
    lock() {
      this.key = null;
      this.generation++;
      this.expiresAt = 0;
      if (this.timer) clearTimeout(this.timer);
      this.timer = void 0;
    }
    /** Opaque in-memory lease for trusted operations that must not outlive a lock/re-unlock. */
    captureLease(touch = true) {
      this.requireKey(touch);
      return this.generation;
    }
    assertLease(lease) {
      if (!this.key || Date.now() >= this.expiresAt) {
        this.lock();
        throw new Error("Vault is locked.");
      }
      if (lease !== this.generation) throw new Error("Vault session changed. Approve the operation again.");
    }
    async read(touch = true) {
      const lease = this.captureLease(touch);
      const k = this.key;
      const v = await this.get("data");
      if (!v) throw new Error("Vault data missing.");
      const d = await open(k, v, DATA);
      this.assertLease(lease);
      if (!validVaultData(d)) throw new Error("Vault data corrupt.");
      return d;
    }
    change(fn, touch = true) {
      return this.serialized(async () => {
        const k = this.requireKey(touch);
        const d = await this.read(touch);
        const result = await fn(d);
        if (!validVaultData(d)) throw new Error("Invalid vault operation; no data was saved.");
        if (this.key !== k || Date.now() >= this.expiresAt) throw new Error("Vault locked during operation.");
        const encrypted = await seal(k, d, DATA);
        if (this.key !== k || Date.now() >= this.expiresAt) throw new Error("Vault locked during operation.");
        await this.writeMany([["data", encrypted]]);
        return result;
      });
    }
    async listProfiles() {
      const d = await this.read();
      const counts = /* @__PURE__ */ new Map();
      for (const p of d.profiles) counts.set(p.password, (counts.get(p.password) || 0) + 1);
      return d.profiles.map((p) => ({ id: p.id, label: p.label, origin: p.origin, createdAt: p.createdAt, stateCount: p.workflow?.states.length || 0, workflowVersion: p.workflow?.version || 0, weakPassword: potentiallyWeak(p.password), reusedPassword: (counts.get(p.password) || 0) > 1 }));
    }
    async listEvents() {
      return (await this.read()).events;
    }
    async getSettings() {
      const d = await this.read();
      return { autoLockMinutes: d.autoLockMinutes, logging: d.logging };
    }
    async setSettings(mins, logging) {
      if (!Number.isInteger(mins) || mins < 1 || mins > 30 || typeof logging !== "boolean") throw new Error("Invalid security settings.");
      await this.change((d) => {
        d.autoLockMinutes = mins;
        d.logging = logging;
        log(d, "Security settings changed");
      });
      this.timeoutMinutes = mins;
      this.touch();
    }
    async addProfile(label, url, username, password) {
      assertText(label, "profile name", 80);
      assertText(username, "username", 512);
      assertText(password, "password", 4096);
      const origin2 = canonicalOrigin(url);
      if (!label.trim()) throw new Error("Profile name cannot be blank.");
      return this.change((d) => {
        if (d.profiles.length >= MAX_PROFILES) throw new Error("Profile limit reached.");
        const id = uid();
        d.profiles.push({ id, label: label.trim(), origin: origin2, username, password, workflow: null, createdAt: Date.now() });
        log(d, "Profile saved", origin2);
        return id;
      });
    }
    /** Reauthenticate without unlocking/replacing an existing session; preserve the original lease. */
    async verifyMaster(pass) {
      assertText(pass, "master passphrase", 1024, 1);
      const lease = this.captureLease();
      const h = await this.get("header");
      if (!h || !validHeader(h)) throw new Error("Vault is missing or corrupt.");
      let valid = false;
      try {
        const key = await deriveVaultKey(pass, unb64(h.salt), h.iterations);
        valid = (await open(key, h.verifier, CHECK)).check === "ghoststate-vault";
      } catch {
      }
      this.assertLease(lease);
      if (!valid) throw new Error("Incorrect master passphrase.");
      return lease;
    }
    /** Only a trusted dashboard may request this, after a fresh master-passphrase check. */
    async revealProfile(id, pass) {
      assertText(id, "profile ID", 64);
      const lease = await this.verifyMaster(pass);
      const d = await this.read();
      this.assertLease(lease);
      const p = d.profiles.find((p2) => p2.id === id);
      if (!p) throw new Error("Profile not found.");
      return { username: p.username, password: p.password };
    }
    async updateProfile(id, label, url, username, password, pass) {
      assertText(id, "profile ID", 64);
      assertText(label, "profile name", 80);
      if (!label.trim()) throw new Error("Profile name cannot be blank.");
      assertText(username, "username", 512, 0);
      assertText(password, "password", 4096, 0);
      const origin2 = canonicalOrigin(url);
      const lease = await this.verifyMaster(pass);
      await this.change((d) => {
        this.assertLease(lease);
        const p = d.profiles.find((p2) => p2.id === id);
        if (!p) throw new Error("Profile not found.");
        if (p.origin !== origin2) {
          p.origin = origin2;
          p.workflow = null;
        }
        p.label = label.trim();
        if (username) p.username = username;
        if (password) p.password = password;
        log(d, "Profile updated", origin2);
      });
    }
    /** Atomic, explicit CSV import. Exact duplicate origin+username pairs are skipped. */
    async importProfiles(input, pass) {
      if (!Array.isArray(input) || !input.length || input.length > MAX_PROFILES) throw new Error("Invalid import size.");
      const records = input.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid import record.");
        const v = value;
        if (Object.keys(v).some((k) => !["label", "url", "username", "password"].includes(k))) throw new Error("Unsupported import field.");
        assertText(v.label, "profile name", 80);
        assertText(v.url, "site URL", 2048);
        assertText(v.username, "username", 512);
        assertText(v.password, "password", 4096);
        if (!v.label.trim()) throw new Error("Profile name cannot be blank.");
        return { label: v.label.trim(), origin: canonicalOrigin(v.url), username: v.username, password: v.password };
      });
      const lease = await this.verifyMaster(pass);
      return this.change((d) => {
        this.assertLease(lease);
        const seen = new Set(d.profiles.map((p) => `${p.origin}\0${p.username}`));
        const add = [];
        let duplicates = 0;
        for (const p of records) {
          const key = `${p.origin}\0${p.username}`;
          if (seen.has(key)) {
            duplicates++;
            continue;
          }
          seen.add(key);
          add.push(p);
        }
        if (d.profiles.length + add.length > MAX_PROFILES) throw new Error("Import exceeds the 200-profile vault limit; nothing was imported.");
        for (const p of add) d.profiles.push({ ...p, id: uid(), workflow: null, createdAt: Date.now() });
        log(d, "Profiles imported", void 0, `${add.length} imported; ${duplicates} duplicates skipped`);
        return { imported: add.length, duplicates };
      });
    }
    async deleteProfile(id) {
      assertText(id, "profile ID", 64);
      await this.change((d) => {
        const i = d.profiles.findIndex((p2) => p2.id === id);
        if (i < 0) throw new Error("Profile not found.");
        const [p] = d.profiles.splice(i, 1);
        log(d, "Profile deleted", p.origin);
      });
    }
    async clearEvents() {
      await this.change((d) => {
        d.events = [];
      });
    }
    async getWorkflow(id, touch = true) {
      const p = (await this.read(touch)).profiles.find((p2) => p2.id === id);
      if (!p) throw new Error("Profile not found.");
      return p.workflow;
    }
    async recordState(id, snap, mappings) {
      return this.change((d) => {
        const p = d.profiles.find((p2) => p2.id === id);
        if (!p) throw new Error("Profile not found.");
        requireOrigin(snap.origin, p.origin);
        p.workflow = addState(p.workflow || createWorkflow(p.origin), snap, mappings);
        log(d, "Workflow state learned", p.origin);
        return p.workflow;
      });
    }
    async clearWorkflow(id) {
      await this.change((d) => {
        const p = d.profiles.find((p2) => p2.id === id);
        if (!p) throw new Error("Profile not found.");
        p.workflow = null;
        log(d, "Workflow removed", p.origin);
      });
    }
    /** Exact origin is mandatory; this method is called only by the trusted extension background. */
    async getFill(id, actualOrigin, snap, touch = true) {
      const d = await this.read(touch);
      const p = d.profiles.find((p2) => p2.id === id);
      if (!p) throw new Error("Profile not found.");
      requireOrigin(actualOrigin, p.origin);
      requireOrigin(snap.origin, p.origin);
      if (!p.workflow) throw new Error("No learned workflow.");
      const r = recognize(p.workflow, snap);
      if (r.status !== "matched") throw new Error(r.reason);
      return { stateId: r.state.id, workflowId: p.workflow.id, mappings: r.state.mappings, values: { username: p.username, password: p.password } };
    }
    async recordFill(id, automatic = false) {
      await this.change((d) => {
        const p = d.profiles.find((p2) => p2.id === id);
        if (p) log(d, automatic ? "Opt-in automatic fill" : "Approved field fill", p.origin);
      }, !automatic);
    }
    async credentialForTransfer(id, expectedOrigin) {
      const d = await this.read();
      const p = d.profiles.find((p2) => p2.id === id);
      if (!p) throw new Error("Profile not found.");
      requireOrigin(expectedOrigin, p.origin);
      return { origin: p.origin, username: p.username, password: p.password };
    }
    async recordTransfer(id) {
      await this.change((d) => {
        const p = d.profiles.find((p2) => p2.id === id);
        if (p) log(d, "Approved credential transfer", p.origin);
      });
    }
    async exportBackup() {
      const header = await this.get("header");
      const data = await this.get("data");
      if (!header || !data) throw new Error("No vault to export.");
      return JSON.stringify({ format: "ghoststate-encrypted-backup", version: 1, header, data }, null, 2);
    }
    async restoreBackup(json, pass) {
      return this.serialized(async () => {
        if (await this.get("header")) throw new Error("Reset the existing vault before restoring.");
        if (json.length > 1e7) throw new Error("Backup is too large.");
        let b;
        try {
          b = JSON.parse(json);
        } catch {
          throw new Error("Invalid backup.");
        }
        if (b.format !== "ghoststate-encrypted-backup" || b.version !== 1 || !validHeader(b.header) || !b.data) throw new Error("Unsupported backup.");
        try {
          const key = await deriveVaultKey(pass, unb64(b.header.salt), b.header.iterations);
          const verifier = await open(key, b.header.verifier, CHECK);
          const data = await open(key, b.data, DATA);
          if (verifier.check !== "ghoststate-vault" || !validVaultData(data)) throw new Error();
          await this.writeMany([["header", b.header], ["data", b.data]]);
          this.key = key;
          this.generation++;
          this.timeoutMinutes = Math.min(30, Math.max(1, data.autoLockMinutes));
          this.touch();
        } catch {
          this.lock();
          throw new Error("Incorrect passphrase or damaged backup.");
        }
      });
    }
    async reset() {
      await this.serialized(async () => {
        this.lock();
        const db = await this.db;
        await new Promise((resolve, reject) => {
          const tx = db.transaction("items", "readwrite");
          tx.objectStore("items").clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      });
    }
  };

  // packages/vault/src/service.ts
  var VaultService = class {
    constructor(vault2 = new Vault()) {
      this.vault = vault2;
    }
    async execute(type, p = {}) {
      switch (type) {
        case "STATUS":
          return this.vault.status();
        case "SETUP":
          return this.vault.setup(p.passphrase);
        case "UNLOCK":
          return this.vault.unlock(p.passphrase);
        case "LOCK":
          this.vault.lock();
          return null;
        case "LIST_PROFILES":
          return this.vault.listProfiles();
        case "LIST_EVENTS":
          return this.vault.listEvents();
        case "GET_SETTINGS":
          return this.vault.getSettings();
        case "SET_SETTINGS":
          return this.vault.setSettings(p.minutes, p.logging);
        case "ADD_PROFILE":
          return this.vault.addProfile(p.label, p.url, p.username, p.password);
        case "REVEAL_PROFILE":
          return this.vault.revealProfile(p.id, p.passphrase);
        case "UPDATE_PROFILE":
          return this.vault.updateProfile(p.id, p.label, p.url, p.username, p.password, p.passphrase);
        case "IMPORT_PROFILES":
          return this.vault.importProfiles(p.records, p.passphrase);
        case "DELETE_PROFILE":
          return this.vault.deleteProfile(p.id);
        case "CLEAR_EVENTS":
          return this.vault.clearEvents();
        case "GET_WORKFLOW":
          return this.vault.getWorkflow(p.id);
        case "CLEAR_WORKFLOW":
          return this.vault.clearWorkflow(p.id);
        case "EXPORT":
          return this.vault.exportBackup();
        case "RESTORE":
          assertText(p.backup, "backup", 1e7);
          return this.vault.restoreBackup(p.backup, p.passphrase);
        case "RESET":
          return this.vault.reset();
        default:
          throw new Error("Unknown or unavailable command.");
      }
    }
  };

  // apps/browser-extension/src/background.ts
  var api = extensionApi;
  var service = new VaultService();
  var vault = service.vault;
  var memoryTarget = null;
  var execution = /* @__PURE__ */ new Map();
  var auto = null;
  var autoTimer;
  var autoBusy = false;
  var autoRetry = false;
  function disableAuto() {
    auto = null;
    autoRetry = false;
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = void 0;
  }
  async function autoStatus() {
    const a = auto;
    if (!a) return null;
    if (Date.now() >= a.expiresAt || !(await vault.status()).unlocked) {
      if (auto === a) disableAuto();
      return null;
    }
    return { tabId: a.tabId, origin: a.origin, profileId: a.profileId, expiresAt: a.expiresAt };
  }
  function scheduleAuto(tabId) {
    if (!auto || auto.tabId !== tabId) return;
    if (autoBusy) {
      autoRetry = true;
      return;
    }
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      autoTimer = void 0;
      void runAuto(tabId);
    }, 180);
  }
  var nativePort = null;
  var nativeMode = null;
  var nativeReady = false;
  var nativeError = null;
  var bridgePending = null;
  var nativeSeq = 0;
  var pending = /* @__PURE__ */ new Map();
  var nativeEvent = null;
  async function getTarget() {
    if (api.storage.session) {
      const s = await api.storage.session.get("target");
      return s.target || null;
    }
    return memoryTarget;
  }
  async function setTarget(target) {
    memoryTarget = target;
    if (api.storage.session) await api.storage.session.set({ target });
  }
  async function checkedTarget() {
    const t = await getTarget();
    if (!t || !Number.isInteger(t.tabId)) throw new Error("Choose a site with the GhostState toolbar button first.");
    const tab = await api.tabs.get(t.tabId);
    if (!tab.url) throw new Error("The selected tab is unavailable.");
    requireOrigin(tab.url, t.origin);
    return t;
  }
  async function stopObservation(t) {
    if (!t) return;
    try {
      await api.tabs.sendMessage(t.tabId, { type: "GS_STOP" });
    } catch {
    }
  }
  async function requireTransferConsent() {
    const manifest = api.runtime.getManifest();
    if (!manifest.browser_specific_settings?.gecko?.data_collection_permissions) return;
    const granted = await api.permissions.getAll();
    if (!Array.isArray(granted.data_collection) || !granted.data_collection.includes("authenticationInfo")) throw new Error("Firefox authentication-info consent is required for credential transfer.");
  }
  async function scanDetailed() {
    const t = await checkedTarget();
    await api.scripting.executeScript({ target: { tabId: t.tabId, frameIds: [0] }, files: ["content.js"] });
    const current = await getTarget();
    if (!current || current.tabId !== t.tabId || current.origin !== t.origin) {
      await stopObservation(t);
      throw new Error("Selected site changed.");
    }
    const response = await api.tabs.sendMessage(t.tabId, { type: "GS_SCAN" }, { frameId: 0 });
    if (!response?.ok || !response.snapshot || typeof response.documentId !== "string" || response.documentId.length > 64) throw new Error(response?.error || "Could not scan the selected page.");
    requireOrigin(response.snapshot.origin, t.origin);
    return { snapshot: response.snapshot, documentId: response.documentId };
  }
  async function scan() {
    return (await scanDetailed()).snapshot;
  }
  async function activeVisibleTab(a) {
    const t = await checkedTarget();
    if (t.tabId !== a.tabId || t.origin !== a.origin) return false;
    const tab = await api.tabs.get(a.tabId);
    if (!tab.active) return false;
    const win = await api.windows.get(tab.windowId);
    if (!win.focused) return false;
    const u = new URL(a.origin);
    return api.permissions.contains({ origins: [`${u.protocol}//${u.hostname}/*`] });
  }
  async function runAuto(tabId) {
    const a = auto;
    if (!a || a.tabId !== tabId || autoBusy) return;
    autoBusy = true;
    try {
      if (!await autoStatus() || auto !== a || !await activeVisibleTab(a)) return;
      const lease = vault.captureLease(false);
      const { snapshot: snap, documentId } = await scanDetailed();
      const fill = await vault.getFill(a.profileId, a.origin, snap, false);
      const workflow2 = await vault.getWorkflow(a.profileId, false);
      if (!workflow2) return;
      const executionKey = `${a.tabId}:${a.profileId}`;
      const previous = execution.get(executionKey);
      if (previous && previous.workflowId === fill.workflowId && !canTransition(workflow2, previous.stateId, fill.stateId)) return;
      const onceKey = `${documentId}:${fill.stateId}`;
      if (a.filled.has(onceKey) || a.filled.size >= 50) return;
      if (auto !== a || Date.now() >= a.expiresAt || !await activeVisibleTab(a) || auto !== a || Date.now() >= a.expiresAt) return;
      const fields = fill.mappings.map((m) => ({ ...m, value: fill.values[m.kind] }));
      vault.assertLease(lease);
      const result = await api.tabs.sendMessage(a.tabId, { type: "GS_FILL", origin: a.origin, documentId, fingerprint: snap.fingerprint, fields, automatic: true }, { frameId: 0 });
      if (!result?.ok) return;
      if (auto === a) a.filled.add(onceKey);
      execution.set(executionKey, { workflowId: fill.workflowId, stateId: fill.stateId });
      try {
        await vault.recordFill(a.profileId, true);
      } catch {
      }
    } catch {
    } finally {
      autoBusy = false;
      if (autoRetry) {
        autoRetry = false;
        if (auto) scheduleAuto(auto.tabId);
      }
    }
  }
  function pageKind(sender) {
    if (sender.id !== api.runtime.id || !sender.url) return null;
    const root = api.runtime.getURL("");
    if (!sender.url.startsWith(root)) return null;
    const path = sender.url.slice(root.length).split(/[?#]/)[0];
    return path === "dashboard.html" ? "dashboard" : path === "popup.html" ? "popup" : null;
  }
  function rejectNativePending(reason) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
  }
  function closeNative(reason) {
    const port = nativePort;
    nativePort = null;
    nativeMode = null;
    nativeReady = false;
    nativeEvent = null;
    nativeError = reason;
    bridgePending = null;
    rejectNativePending(reason);
    try {
      port?.disconnect();
    } catch {
    }
  }
  async function nativeRequest(op, payload = {}) {
    const port = nativePort;
    if (!port || !nativeReady) throw new Error("Companion is not connected.");
    const id = ++nativeSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (nativePort === port) closeNative("Companion timed out. Reconnect and check Bluetooth setup.");
      }, 45e3);
      pending.set(id, { resolve, reject, timer });
      const request = { id, op, payload };
      try {
        port.postMessage(nativeMode === "bridge" ? { bridgeRequest: request } : request);
      } catch {
        if (nativePort === port) closeNative("Could not send to the companion. Reconnect and check its installation.");
      }
    });
  }
  function attachNative(port, mode) {
    nativePort = port;
    nativeMode = mode;
    nativeReady = mode === "direct";
    nativeError = null;
    port.onMessage.addListener((raw) => {
      if (nativePort !== port) return;
      let m = raw;
      if (mode === "bridge") {
        if (raw?.bridgeReady === true) {
          nativeReady = true;
          return;
        }
        if (typeof raw?.bridgeError === "string") {
          closeNative(raw.bridgeError.slice(0, 300));
          return;
        }
        if (!raw || !Object.prototype.hasOwnProperty.call(raw, "nativeMessage")) return;
        m = raw.nativeMessage;
      }
      if (m && Number.isSafeInteger(m.id) && pending.has(m.id)) {
        const p = pending.get(m.id);
        clearTimeout(p.timer);
        pending.delete(m.id);
        if (m.ok) p.resolve(m.data);
        else p.reject(new Error(typeof m.error === "string" ? m.error.slice(0, 300) : "Companion error."));
      } else if (m && typeof m.event === "string") nativeEvent = m;
    });
    port.onDisconnect.addListener(() => {
      const reason = api.runtime.lastError?.message || "Companion disconnected.";
      if (nativePort !== port) return;
      nativePort = null;
      nativeMode = null;
      nativeReady = false;
      nativeEvent = null;
      nativeError = reason;
      rejectNativePending(reason);
    });
  }
  function connectNative(sender) {
    if (nativePort) {
      if (!nativeReady) throw new Error("A companion connection is already starting; try again shortly.");
      return null;
    }
    if (typeof api.runtime.connectNative !== "function") {
      const tabId = sender.tab?.id;
      if (!Number.isInteger(tabId) || sender.frameId !== 0) throw new Error("Open the dashboard in a browser tab to connect the companion.");
      if (bridgePending && Date.now() <= bridgePending.deadline) throw new Error("A companion connection is already starting; try again shortly.");
      const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      bridgePending = { token, tabId, deadline: Date.now() + 15e3 };
      nativeError = null;
      return { bridgeRequired: true, bridgeToken: token };
    }
    bridgePending = null;
    attachNative(api.runtime.connectNative("com.ghoststate.bridge"), "direct");
    return null;
  }
  api.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith("ghoststate.native-bridge.v1")) return;
    const sender = port.sender, pendingBridge = bridgePending;
    const path = sender?.url?.split("#")[0];
    const valid = !!pendingBridge && Date.now() <= pendingBridge.deadline && !nativePort && port.name === `ghoststate.native-bridge.v1:${pendingBridge.token}` && sender?.id === api.runtime.id && path === api.runtime.getURL("native-bridge.html") && sender.tab?.id === pendingBridge.tabId && typeof sender.frameId === "number" && sender.frameId > 0;
    if (!valid) {
      try {
        port.disconnect();
      } catch {
      }
      return;
    }
    bridgePending = null;
    attachNative(port, "bridge");
    try {
      port.postMessage({ bridgeArm: true });
    } catch {
      closeNative("Could not start the companion bridge.");
    }
  });
  async function dispatch(message, sender) {
    if (!message || typeof message !== "object" || typeof message.type !== "string" || message.type.length > 80) throw new Error("Invalid message.");
    if (message.type === "GS_OBSERVATION") {
      const t = await getTarget();
      if (!t || sender.id !== api.runtime.id || sender.tab?.id !== t.tabId || sender.frameId !== 0 || !sender.url) throw new Error("Unauthorized observation.");
      requireOrigin(sender.url, t.origin);
      requireOrigin(message.snapshot?.origin, t.origin);
      scheduleAuto(t.tabId);
      return null;
    }
    const kind = pageKind(sender);
    if (!kind) throw new Error("Unauthorized extension caller.");
    const p = message.payload && typeof message.payload === "object" ? message.payload : {};
    if (message.type === "SELECT_TAB") {
      if (!Number.isInteger(p.tabId) || typeof p.origin !== "string") throw new Error("Invalid tab.");
      const tab = await api.tabs.get(p.tabId);
      if (!tab.url) throw new Error("Cannot access tab.");
      const actual = canonicalOrigin(tab.url);
      requireOrigin(actual, p.origin);
      const u = new URL(actual);
      const has = await api.permissions.contains({ origins: [`${u.protocol}//${u.hostname}/*`] });
      if (!has) throw new Error("Site permission has not been granted.");
      const old = await getTarget();
      disableAuto();
      execution.clear();
      await setTarget({ tabId: p.tabId, origin: actual });
      if (old && (old.tabId !== p.tabId || old.origin !== actual)) await stopObservation(old);
      return { origin: actual };
    }
    if (kind === "popup" && message.type !== "STATUS" && message.type !== "TARGET") throw new Error("Command not allowed from popup.");
    switch (message.type) {
      case "LOCK":
        disableAuto();
        execution.clear();
        vault.lock();
        await stopObservation(await getTarget());
        return null;
      case "CLEAR_TARGET": {
        const old = await getTarget();
        disableAuto();
        execution.clear();
        await setTarget(null);
        await stopObservation(old);
        return null;
      }
      case "TARGET": {
        const t = await getTarget();
        if (!t) return null;
        try {
          return await checkedTarget();
        } catch {
          return null;
        }
      }
      case "SCAN":
        return scan();
      case "AUTO_STATUS":
        return autoStatus();
      case "AUTO_DISABLE":
        disableAuto();
        return null;
      case "AUTO_ENABLE": {
        if (typeof p.id !== "string" || !p.id || p.id.length > 64) throw new Error("Choose a profile.");
        const t = await checkedTarget();
        const lease = vault.captureLease();
        const selected = (await vault.listProfiles()).find((x) => x.id === p.id);
        if (!selected || !selected.stateCount) throw new Error("Learn a sign-in state for this profile first.");
        requireOrigin(t.origin, selected.origin);
        const u = new URL(t.origin);
        if (!await api.permissions.contains({ origins: [`${u.protocol}//${u.hostname}/*`] })) throw new Error("Site permission has been revoked.");
        const fresh2 = await checkedTarget();
        if (fresh2.tabId !== t.tabId || fresh2.origin !== t.origin) throw new Error("Selected site changed.");
        vault.assertLease(lease);
        disableAuto();
        execution.clear();
        auto = { tabId: t.tabId, origin: t.origin, profileId: p.id, expiresAt: Date.now() + 10 * 6e4, filled: /* @__PURE__ */ new Set() };
        scheduleAuto(t.tabId);
        return autoStatus();
      }
      case "RECORD_STATE": {
        disableAuto();
        const s = await scan();
        if (s.fingerprint !== p.fingerprint) throw new Error("The page changed. Scan again before saving.");
        return vault.recordState(p.id, s, p.mappings);
      }
      case "CLEAR_WORKFLOW":
      case "DELETE_PROFILE":
      case "UPDATE_PROFILE":
      case "IMPORT_PROFILES":
      case "RESET": {
        disableAuto();
        execution.clear();
        return service.execute(message.type, p);
      }
      case "FILL_STATE": {
        const t = await checkedTarget();
        const { snapshot: snap, documentId } = await scanDetailed();
        const lease = vault.captureLease();
        const fill = await vault.getFill(p.id, t.origin, snap);
        const workflow2 = await vault.getWorkflow(p.id);
        if (!workflow2) throw new Error("Workflow not found.");
        const executionKey = `${t.tabId}:${p.id}`;
        const previous = execution.get(executionKey);
        if (previous && previous.workflowId === fill.workflowId && !canTransition(workflow2, previous.stateId, fill.stateId)) throw new Error("Unexpected workflow transition. Take over manually or start again at the first state.");
        const fresh2 = await checkedTarget();
        if (fresh2.tabId !== t.tabId || fresh2.origin !== t.origin) throw new Error("Selected site changed.");
        const fields = fill.mappings.map((m) => ({ ...m, value: fill.values[m.kind] }));
        vault.assertLease(lease);
        const result = await api.tabs.sendMessage(t.tabId, { type: "GS_FILL", origin: t.origin, documentId, fingerprint: snap.fingerprint, fields }, { frameId: 0 });
        if (!result?.ok) throw new Error(result?.error || "Fill failed.");
        execution.set(executionKey, { workflowId: fill.workflowId, stateId: fill.stateId });
        let logFailed = false;
        try {
          await vault.recordFill(p.id);
        } catch {
          logFailed = true;
        }
        return { ...result.data, logFailed };
      }
      case "NATIVE_CONNECT": {
        const has = await api.permissions.contains({ permissions: ["nativeMessaging"] });
        if (!has) throw new Error("Native messaging permission has not been granted.");
        let connection = null;
        try {
          const bridge = connectNative(sender);
          if (bridge) return bridge;
          connection = nativePort;
          return await nativeRequest("status");
        } catch (e) {
          const detail = e instanceof Error ? e.message : "Connection failed.";
          if (connection && nativePort === connection) closeNative("Companion connection failed.");
          throw new Error(`${detail} Check the companion installation and exact extension ID; see Installation help.`);
        }
      }
      case "NATIVE_STATUS":
        return { connected: !!nativePort && nativeReady, event: nativeEvent, error: nativeError };
      case "NATIVE_SEND_PROFILE": {
        if (!nativePort) throw new Error("Companion is not connected.");
        if (typeof p.peerId !== "string" || !p.peerId || p.peerId.length > 256) throw new Error("Choose a verified recipient.");
        const lease = vault.captureLease();
        const credential = await vault.credentialForTransfer(p.id, p.origin);
        await requireTransferConsent();
        vault.assertLease(lease);
        const result = await nativeRequest("send_grant", { ...credential, peerId: p.peerId });
        let logFailed = false;
        try {
          await vault.recordTransfer(p.id);
        } catch {
          logFailed = true;
        }
        return { ...result, logFailed };
      }
      case "NATIVE_ACCEPT_PROFILE": {
        if (!nativePort) throw new Error("Companion is not connected.");
        const lease = vault.captureLease();
        await requireTransferConsent();
        vault.assertLease(lease);
        const result = await nativeRequest("accept_transfer", { id: p.id });
        vault.assertLease(lease);
        if (!result || result.id !== p.id || typeof result.origin !== "string") throw new Error("Invalid companion response.");
        requireOrigin(result.origin, p.origin);
        return vault.addProfile(p.label, result.origin, result.username, result.password);
      }
      case "NATIVE_DISCONNECT":
        closeNative("Companion disconnected.");
        return null;
      case "NATIVE_REQUEST": {
        const allowed = ["status", "discover", "listen", "stop_listen", "pair", "confirm_pair", "cancel_pair", "incoming", "reject_transfer"];
        if (typeof p.op !== "string" || !allowed.includes(p.op)) throw new Error("Native operation not allowed.");
        return nativeRequest(p.op, p.data || {});
      }
      default:
        return service.execute(message.type, p);
    }
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    dispatch(message, sender).then((data) => respond({ ok: true, data }), (e) => respond({ ok: false, error: e instanceof Error ? e.message : "Request failed." }));
    return true;
  });
  api.tabs.onRemoved.addListener((tabId) => {
    if (auto?.tabId === tabId) disableAuto();
    if (bridgePending?.tabId === tabId) {
      bridgePending = null;
      nativeError = "Companion dashboard closed.";
    }
    void getTarget().then((t) => {
      if (t?.tabId === tabId) {
        execution.clear();
        return setTarget(null);
      }
    });
  });
  api.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "complete") scheduleAuto(tabId);
  });
  api.tabs.onActivated.addListener(({ tabId }) => scheduleAuto(tabId));
  api.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== api.windows.WINDOW_ID_NONE && auto) void api.tabs.query({ active: true, windowId }).then((tabs) => {
      if (tabs[0]?.id) scheduleAuto(tabs[0].id);
    }).catch(() => {
    });
  });
  api.permissions.onRemoved.addListener((removed) => {
    if (auto) disableAuto();
    if (removed.permissions?.includes("nativeMessaging")) closeNative("Native messaging permission was revoked.");
  });
})();
