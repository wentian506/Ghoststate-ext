"use strict";
(() => {
  // packages/browser-adapters/src/index.ts
  var extensionApi = globalThis.browser || (typeof chrome !== "undefined" && chrome.runtime?.id ? chrome : void 0);
  function isExtension() {
    return !!extensionApi?.runtime?.id;
  }

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
  var classes = {
    lowercase: "abcdefghijkmnopqrstuvwxyz",
    uppercase: "ABCDEFGHJKLMNPQRSTUVWXYZ",
    numbers: "23456789",
    symbols: "!@#$%^&*_-+="
  };
  function randomIndex(size) {
    if (!Number.isInteger(size) || size < 1 || size > 4294967296) throw new Error("Invalid random range.");
    const limit = Math.floor(4294967296 / size) * size;
    const word = new Uint32Array(1);
    do {
      crypto.getRandomValues(word);
    } while (word[0] >= limit);
    return word[0] % size;
  }
  function generatePassword(options) {
    if (!Number.isInteger(options.length) || options.length < 12 || options.length > 128) throw new Error("Choose a length from 12 to 128.");
    const selected = Object.keys(classes).filter((k) => options[k] === true).map((k) => classes[k]);
    if (!selected.length) throw new Error("Choose at least one character set.");
    const pool = selected.join("");
    const characters = selected.map((set) => set[randomIndex(set.length)]);
    while (characters.length < options.length) characters.push(pool[randomIndex(pool.length)]);
    for (let i = characters.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [characters[i], characters[j]] = [characters[j], characters[i]];
    }
    return characters.join("");
  }
  function potentiallyWeak(password) {
    const p = password.toLowerCase();
    return password.length < 12 || /^(.)\1+$/u.test(password) || ["password", "qwerty", "123456", "letmein", "iloveyou"].some((x) => p.includes(x));
  }

  // packages/vault/src/index.ts
  var CHECK = "ghoststate:v1:verifier";
  var DATA = "ghoststate:v1:vault";
  var fresh = () => ({ schema: 1, profiles: [], events: [], autoLockMinutes: 5, logging: false });
  function log(d, action2, origin2, detail) {
    if (!d.logging) return;
    d.events.unshift({ id: uid(), at: Date.now(), action: action2, ...origin2 ? { origin: origin2 } : {}, ...detail ? { detail } : {} });
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
        const header2 = { schema: 1, kdf: "PBKDF2-SHA256", iterations: KDF_ITERATIONS, salt: b64(salt), verifier: await seal(key, { check: "ghoststate-vault" }, CHECK) };
        await this.writeMany([["header", header2], ["data", await seal(key, fresh(), DATA)]]);
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
      const header2 = await this.get("header");
      const data = await this.get("data");
      if (!header2 || !data) throw new Error("No vault to export.");
      return JSON.stringify({ format: "ghoststate-encrypted-backup", version: 1, header: header2, data }, null, 2);
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
    constructor(vault = new Vault()) {
      this.vault = vault;
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

  // packages/vault/src/import-csv.ts
  var MAX_FILE_CHARS = 2e6;
  var MAX_ROWS = 1e3;
  var MAX_FIELD = 16384;
  var MAX_COLUMNS = 80;
  function parseCsv(text2) {
    if (typeof text2 !== "string" || text2.length > MAX_FILE_CHARS) throw new Error("CSV must be under 2 MB.");
    if (text2.startsWith("\uFEFF")) text2 = text2.slice(1);
    const rows = [];
    let row = [], field = "", quoted = false, afterQuote = false;
    const fieldDone = () => {
      row.push(field);
      field = "";
      afterQuote = false;
      if (row.length > MAX_COLUMNS) throw new Error("CSV has too many columns.");
    };
    const rowDone = () => {
      fieldDone();
      rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new Error("CSV has more than 1,000 rows.");
    };
    for (let i = 0; i < text2.length; i++) {
      const c = text2[i];
      if (quoted) {
        if (c === '"') {
          if (text2[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            quoted = false;
            afterQuote = true;
          }
        } else field += c;
      } else if (c === ",") fieldDone();
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text2[i + 1] === "\n") i++;
        rowDone();
      } else if (c === '"' && field === "" && !afterQuote) quoted = true;
      else {
        if (c === '"' || afterQuote) throw new Error("Malformed quoted CSV field.");
        field += c;
      }
      if (field.length > MAX_FIELD) throw new Error("CSV field is too long.");
    }
    if (quoted) throw new Error("Unclosed quoted CSV field.");
    if (field.length || row.length || afterQuote) rowDone();
    return rows;
  }
  function readLoginCsv(text2) {
    const rows = parseCsv(text2);
    if (rows.length < 2) throw new Error("CSV has no login rows.");
    const header2 = rows[0].map((v) => v.trim().toLowerCase());
    if (new Set(header2).size !== header2.length) throw new Error("CSV has duplicate column names.");
    const index = (name) => header2.indexOf(name);
    const standard = ["url", "username", "password"].every((h) => index(h) >= 0);
    const bitwarden = ["login_uri", "login_username", "login_password"].every((h) => index(h) >= 0);
    if (standard === bitwarden) throw new Error("Use a standard name,url,username,password CSV or a Bitwarden login CSV.");
    const format = bitwarden ? "bitwarden" : "standard";
    const urlIndex = index(bitwarden ? "login_uri" : "url"), userIndex = index(bitwarden ? "login_username" : "username"), passIndex = index(bitwarden ? "login_password" : "password");
    const nameIndex = index("name"), typeIndex = index("type");
    let skipped = 0;
    const skippedRows = [];
    const skip = (row, reason) => {
      skipped++;
      skippedRows.push({ row, reason });
    };
    const records = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.every((v) => v === "")) continue;
      if (row.length !== header2.length) throw new Error(`CSV row ${r + 1} has the wrong number of columns.`);
      if (bitwarden && typeIndex >= 0 && row[typeIndex].trim().toLowerCase() !== "login") {
        skip(r + 1, "Not a login item");
        continue;
      }
      const username = row[userIndex], password = row[passIndex];
      let origin2;
      try {
        origin2 = canonicalOrigin(row[urlIndex].trim());
      } catch {
        skip(r + 1, "Unsupported or invalid site URL");
        continue;
      }
      const label = (nameIndex >= 0 ? row[nameIndex].trim() : "") || new URL(origin2).hostname;
      if (!label || label.length > 80 || !username || username.length > 512 || !password || password.length > 4096) {
        skip(r + 1, "Missing or oversized login field");
        continue;
      }
      records.push({ label, url: origin2, username, password });
      if (records.length > MAX_PROFILES) throw new Error("CSV has more than 200 supported logins. Split it into smaller files.");
    }
    if (!records.length) throw new Error("No supported logins found. HTTPS URL, username and password are required.");
    return { format, records, skipped, skippedRows };
  }

  // apps/dashboard/src/main.ts
  var app = document.querySelector("#app");
  var toastEl = document.querySelector("#toast");
  var web = isExtension() ? null : new VaultService();
  var overviewFilter = "all";
  var sortDescending = false;
  var profileSearch = "";
  var autoStatus = null;
  var screen = "overview";
  var mobileMenuOpen = false;
  var status = { initialized: false, unlocked: false, timeoutMinutes: 5 };
  var profiles = [];
  var events = [];
  var target = null;
  var native = { connected: false };
  var nativeInfo = null;
  var nearby = [];
  var toastTimer;
  var nativeBridgeFrame = null;
  var connectingNative = false;
  var ext = isExtension();
  var esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var icons = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    flow: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h4a4 4 0 0 1 4 4v5M14 12l3 3 3-3"/>',
    device: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M10 18h4"/>',
    activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M19.4 15a8 8 0 0 0 .1-6l1.3-1-2-3.5-1.6.6A8 8 0 0 0 12 3l-.8-1H9l-.5 1.7A8 8 0 0 0 6 5l-1.6-.5-2 3.5L3.7 9a8 8 0 0 0 0 6l-1.3 1 2 3.5L6 19a8 8 0 0 0 3 1.3L9.5 22h4l.5-1.7A8 8 0 0 0 17 19l1.6.5 2-3.5Z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    cloud: '<path d="M6 18a4 4 0 0 1-.5-8A6.5 6.5 0 0 1 18 9a4.5 4.5 0 0 1 0 9H6ZM3 3l18 18"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-2 2 1 1-2 2-1-1-3 3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    close: '<path d="M5 5l14 14M19 5 5 19"/>',
    warning: '<path d="M12 3 2 21h20L12 3ZM12 9v5m0 3h.01"/>',
    bluetooth: '<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
    monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    spark: '<path d="m12 2 1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2ZM19 15l.6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6L19 15Z"/>'
  };
  function icon(name, size = 17) {
    return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.info}</svg>`;
  }
  var mark = '<img src="./assets/ghoststate-logo.png" alt="" width="40" height="40">';
  async function call(type, payload = {}) {
    if (web) {
      if (type === "TARGET" || type === "AUTO_STATUS") return null;
      if (type === "NATIVE_STATUS") return { connected: false };
      if (["SCAN", "RECORD_STATE", "FILL_STATE"].includes(type) || type.startsWith("AUTO_") || type.startsWith("NATIVE_")) throw new Error("This feature requires the installed browser extension.");
      return await web.execute(type, payload);
    }
    const response = await extensionApi.runtime.sendMessage({ type, payload });
    if (!response?.ok) throw new Error(response?.error || "The extension could not complete this request.");
    return response.data;
  }
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 4e3);
  }
  function removeNativeBridge() {
    nativeBridgeFrame?.remove();
    nativeBridgeFrame = null;
  }
  async function openNativeBridge(challenge) {
    if (!/^[a-f0-9]{32}$/.test(challenge)) throw new Error("Invalid companion bridge challenge.");
    removeNativeBridge();
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.title = "Local companion bridge";
    frame.src = `${extensionApi.runtime.getURL("native-bridge.html")}#${challenge}`;
    nativeBridgeFrame = frame;
    document.body.append(frame);
    const deadline = Date.now() + 1e4;
    try {
      while (Date.now() < deadline) {
        const state = await call("NATIVE_STATUS");
        if (state.connected) return;
        if (state.error) throw new Error(`${state.error} Check the companion installation and exact extension ID; see Installation help.`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("The local companion bridge did not start. Restart the browser and check the installation.");
    } catch (e) {
      removeNativeBridge();
      await call("NATIVE_DISCONNECT").catch(() => null);
      throw e;
    }
  }
  async function refresh(renderNow = true) {
    status = await call("STATUS");
    if (status.unlocked) {
      [profiles, events] = await Promise.all([call("LIST_PROFILES"), call("LIST_EVENTS")]);
    } else {
      profiles = [];
      events = [];
    }
    target = await call("TARGET").catch(() => null);
    autoStatus = await call("AUTO_STATUS").catch(() => null);
    native = await call("NATIVE_STATUS").catch(() => ({ connected: false }));
    if (native.connected) nativeInfo = await call("NATIVE_REQUEST", { op: "status" }).catch(() => null);
    else {
      nativeInfo = null;
      nearby = [];
    }
    if (renderNow) render();
  }
  function navButton(id, label, ic, count) {
    return `<button class="nav-button ${screen === id ? "active" : ""}" data-screen="${id}" ${screen === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span>${count !== void 0 && count > 0 ? `<span class="nav-count" aria-label="${count} saved">${count}</span>` : ""}</button>`;
  }
  var labels = { overview: "Dashboard", welcome: "Getting started", portals: "Portal profiles", workflows: "Workflows", devices: "Devices & transfer", activity: "Activity log", security: "Privacy & security", compatibility: "Compatibility", help: "Help & support" };
  var moreScreens = ["welcome", "activity", "security", "compatibility", "help"];
  function mobileTab(id, label, ic) {
    return `<button class="mobile-tab ${screen === id ? "active" : ""}" data-screen="${id}" ${screen === id ? 'aria-current="page"' : ""}>${icon(ic, 19)}<span>${label}</span></button>`;
  }
  function mobileMenuLink(id, ic) {
    return `<button class="mobile-menu-link ${screen === id ? "active" : ""}" data-screen="${id}" ${screen === id ? 'aria-current="page"' : ""}>${icon(ic, 18)}<span>${labels[id]}</span>${icon("arrow", 15)}</button>`;
  }
  function mobileNavigation() {
    return `<div class="mobile-nav-shell">${mobileMenuOpen ? '<div class="mobile-menu-dismiss" data-action="close-mobile-menu" aria-hidden="true"></div>' : ""}
    <nav class="mobile-nav" aria-label="Mobile navigation">${mobileTab("overview", "Home", "grid")}${mobileTab("portals", "Vault", "globe")}${mobileTab("workflows", "Flows", "flow")}${mobileTab("devices", "Devices", "device")}<button class="mobile-tab ${mobileMenuOpen || moreScreens.includes(screen) ? "active" : ""}" data-action="mobile-more" aria-expanded="${mobileMenuOpen}" aria-controls="mobile-more-panel">${icon("more", 19)}<span>More</span></button></nav>
    <section class="mobile-more-panel" id="mobile-more-panel" ${mobileMenuOpen ? "" : "hidden"} aria-label="More sections"><div class="mobile-more-title">YOUR WORKSPACE <span>EXPLORE</span></div>${mobileMenuLink("welcome", "spark")}${mobileMenuLink("activity", "activity")}${mobileMenuLink("security", "shield")}${mobileMenuLink("compatibility", "monitor")}${mobileMenuLink("help", "help")}<button class="mobile-menu-link mobile-lock" data-action="${status.unlocked ? "lock" : "unlock"}">${icon(status.unlocked ? "lock" : "unlock", 18)}<span>${status.unlocked ? "Lock vault" : status.initialized ? "Unlock vault" : "Create vault"}</span>${icon("arrow", 15)}</button></section>
  </div>`;
  }
  function shell(body) {
    const locked = !status.unlocked;
    return `<div class="app-shell"><a class="skip-link" href="#main-content">Skip to content</a><aside class="sidebar"><div class="brand"><div class="brand-mark">${mark}</div><div><div class="brand-name">GhostState</div><div class="brand-sub">PRIVATE WORKSPACE</div></div><span class="brand-indicator"><i class="dot good"></i> LOCAL ONLY</span></div>
    <div class="side-nav"><div class="nav-label">Navigation</div><nav class="nav" aria-label="Workspace">${navButton("overview", "Dashboard", "grid")}${navButton("portals", "Portal profiles", "globe", profiles.length)}${navButton("workflows", "Workflows", "flow")}${navButton("devices", "Devices & transfer", "device")}${navButton("activity", "Activity log", "activity")}</nav>
    <div class="nav-label">Preferences</div><nav class="nav" aria-label="Preferences">${navButton("security", "Privacy & security", "shield")}${navButton("compatibility", "Compatibility", "monitor")}${navButton("welcome", "Getting started", "spark")}${navButton("help", "Help & support", "help")}</nav></div>
    <div class="sidebar-bottom"><div class="privacy-note"><div class="privacy-title">${icon("shield", 15)} Private by design</div><div class="privacy-copy">Your vault stays on this device. No cloud account required.</div></div><div class="side-lock"><div class="lock-blob">${icon(locked ? "lock" : "unlock", 15)}</div><div><strong>${!status.initialized ? "Vault not set up" : locked ? "Vault locked" : "Vault unlocked"}</strong><small>${locked ? "Your local workspace" : "Only on this device"}</small></div><button data-action="${locked ? "unlock" : "lock"}" aria-label="${locked ? "Unlock" : "Lock"} vault">${icon("arrow", 15)}</button></div></div></aside>
    <main class="main" id="main-content" tabindex="-1"><header class="topbar"><h1 tabindex="-1">${esc(labels[screen])}</h1><div class="top-right"><span class="top-status"><i class="dot ${ext ? "good" : ""}"></i>${ext ? "Extension active" : "Local web workspace"}</span><button class="icon-button" data-action="theme" title="Toggle light and dark theme" aria-label="Toggle light and dark theme" aria-pressed="${document.documentElement.dataset.theme === "dark"}">${icon(document.documentElement.dataset.theme === "light" ? "moon" : "sun", 17)}</button><button class="icon-button help-button" data-screen="help" title="Help and support" aria-label="Open help">${icon("help", 17)}</button>${btn("add-profile", "New portal", "plus", "primary top-create")}</div></header><div class="content">${ext ? "" : `<aside class="preview-notice" aria-label="Preview limitations"><strong>Interface preview</strong><span>Use sample data only. Preview data is separate and may be cleared. Site access needs the extension; Bluetooth also needs a separate companion.</span></aside>`}${body}<footer class="app-footer"><span><i class="dot good"></i> PRIVATE BY DESIGN <span>\xB7</span> LOCAL BY DEFAULT</span><span>GhostState 0.2.2 <span>\xB7</span> No cloud account</span></footer></div></main>${mobileNavigation()}</div>`;
  }
  function header(title, description, actions = "", eyebrow = "YOUR WORKSPACE") {
    return `<div class="heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2><p>${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
  }
  function btn(action2, label, ic = "", classes2 = "", extra = "") {
    return `<button class="btn ${classes2}" data-action="${action2}" ${extra}>${ic ? icon(ic, 15) : ""}${label}</button>`;
  }
  function activityRows(items) {
    return items.map((e) => `<div class="event"><div class="event-dot">${icon("check", 13)}</div><div><strong>${esc(e.action)}</strong>${e.origin ? `<small>${esc(e.origin)}</small>` : ""}</div><span class="event-time">${esc(new Date(e.at).toLocaleString(void 0, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</span></div>`).join("");
  }
  function guideRow(number, title, description, actionLabel, actionAttr, complete = false) {
    return `<div class="workspace-row guide-row"><span class="row-symbol ${complete ? "complete" : ""}" aria-hidden="true">${complete ? icon("check", 13) : number}</span><div class="workspace-row-main"><strong>${title}</strong><small>${description}</small></div><span class="row-indicator">${complete ? "Ready" : "GET STARTED"}</span><button class="row-link" ${actionAttr}>${actionLabel} ${icon("arrow", 13)}</button></div>`;
  }
  function overview() {
    const states = profiles.reduce((n, p) => n + p.stateCount, 0);
    const vaultWord = !status.initialized ? "Not created" : status.unlocked ? "Unlocked" : "Locked";
    const vaultAction = status.unlocked ? "lock" : "unlock";
    const vaultActionLabel = status.unlocked ? "Lock vault" : status.initialized ? "Unlock vault" : "Get started";
    const filtered = profiles.filter((p) => overviewFilter === "all" || (overviewFilter === "learned" ? p.stateCount > 0 : p.stateCount === 0)).slice().sort((a, b) => sortDescending ? b.label.localeCompare(a.label) : a.label.localeCompare(b.label));
    const filters = [{ id: "all", label: "All portals" }, { id: "learned", label: "Learned" }, { id: "unlearned", label: "Needs setup" }];
    const guides = [
      guideRow("01", status.unlocked ? "Your local vault is ready" : status.initialized ? "Unlock your local vault" : "Create your local vault", status.unlocked ? "Your passphrase protects your encrypted data." : status.initialized ? "Enter your master passphrase to access the vault." : "Choose a unique passphrase to protect your data.", status.unlocked ? "Security" : status.initialized ? "Unlock" : "Create vault", status.unlocked ? 'data-screen="security"' : 'data-action="unlock"', status.unlocked),
      guideRow("02", "Add a portal profile", "Save a sign-in for one exact site origin.", "Add portal", 'data-action="add-profile"'),
      guideRow("03", "Choose the sign-in site", ext ? "Grant access only to a site you trust." : "Site selection requires the browser extension.", "Choose site", 'data-action="select-site"', !!target),
      guideRow("04", "Learn the sign-in steps", "Capture structure, never page content or field values.", "Open workflows", 'data-screen="workflows"'),
      guideRow("05", "Choose how to fill", "Approve each fill, or enable temporary automatic fill. Submit forms yourself.", "How it works", 'data-action="welcome"')
    ].join("");
    let rows;
    if (!status.unlocked || profiles.length === 0 && overviewFilter === "all") {
      rows = `<div class="list-note">${!status.unlocked ? "Your profiles stay private until the vault is unlocked." : "No profiles yet. Follow these steps to get started."}</div>${guides}`;
    } else if (!filtered.length) {
      rows = `<div class="workspace-empty"><div class="empty-icon">${icon("flow", 19)}</div><strong>${overviewFilter === "learned" ? "No learned profiles yet" : overviewFilter === "unlearned" ? "No profiles need setup" : "No portal profiles yet"}</strong><p>${overviewFilter === "learned" ? "Capture a sign-in step from Workflows to see it here." : overviewFilter === "unlearned" ? "Profiles without a learned state will appear here." : "Add a portal to start a private workflow."}</p><button class="text-button" data-screen="workflows">Open workflows ${icon("arrow", 13)}</button></div>`;
    } else {
      rows = filtered.map((p) => `<div class="workspace-row portal-row"><span class="row-symbol record" aria-hidden="true">${icon("globe", 15)}</span><div class="workspace-row-main"><strong>${esc(p.label)}</strong><small>${esc(p.origin)}</small></div><span class="row-indicator ${p.stateCount ? "learned" : ""}">${p.stateCount ? `${p.stateCount} ${p.stateCount === 1 ? "state" : "states"}` : "Not learned"}</span><div class="row-buttons"><button class="row-link" data-action="learn" data-id="${esc(p.id)}" aria-label="Learn a state for ${esc(p.label)}">Learn</button><button class="row-link" data-action="fill" data-id="${esc(p.id)}" aria-label="Review and fill ${esc(p.label)}">Fill ${icon("arrow", 13)}</button></div></div>`).join("");
    }
    return `<div class="dashboard-intro"><div class="intro-copy"><span class="eyebrow">YOUR PRIVATE WORKSPACE</span><h2>Your sign-ins, your control.</h2><p>Everything you need for a more private sign-in, all in one place.</p></div><span class="intro-meta">${icon("shield", 15)} LOCAL BY DEFAULT</span></div>
  <div class="metrics-row" aria-label="Workspace summary">
    <section class="metric-card"><div class="metric-title"><h2>Local vault</h2>${icon("lock", 17)}</div><div class="metric-middle"><span>Vault status</span><strong>${vaultWord}</strong></div><div class="metric-rule mint" aria-hidden="true"></div><div class="metric-bottom"><span class="metric-tag">ENCRYPTED STORAGE</span><button class="inline-action" data-action="${vaultAction}">${vaultActionLabel} ${icon("arrow", 13)}</button></div></section>
    <section class="metric-card"><div class="metric-title"><h2>Portal profiles</h2>${icon("globe", 17)}</div><div class="metric-middle"><span>Saved profiles</span><strong>${status.unlocked ? profiles.length : "\u2014"}</strong></div><div class="metric-rule lavender" aria-hidden="true"></div><div class="metric-bottom"><span class="metric-tag">EXACT ORIGIN</span><button class="inline-action" data-screen="portals">View profiles ${icon("arrow", 13)}</button></div></section>
    <section class="metric-card"><div class="metric-title"><h2>Sign-in steps</h2>${icon("flow", 17)}</div><div class="metric-middle"><span>Learned states</span><strong>${status.unlocked ? states : "\u2014"}</strong></div><div class="metric-rule sand" aria-hidden="true"></div><div class="metric-bottom"><span class="metric-tag">YOU APPROVE</span><button class="inline-action" data-screen="workflows">View workflows ${icon("arrow", 13)}</button></div></section>
  </div>
  <div class="workspace-grid"><section class="workspace-main" aria-label="Portal workspace"><div class="overview-toolbar"><div class="filter-group" role="group" aria-label="Filter portal profiles">${filters.map((f) => `<button class="filter-button ${overviewFilter === f.id ? "active" : ""}" data-filter="${f.id}" aria-pressed="${overviewFilter === f.id}" ${!status.unlocked ? 'disabled title="Unlock your vault to filter profiles"' : ""}>${f.label}</button>`).join("")}</div><button class="sort-button" data-action="sort-profiles" ${!status.unlocked || profiles.length < 2 ? "disabled" : ""} aria-label="Sort: ${sortDescending ? "Z\u2013A" : "A\u2013Z"} (portal profiles, ${sortDescending ? "descending" : "ascending"})">${icon("flow", 14)} Sort: ${sortDescending ? "Z\u2013A" : "A\u2013Z"}</button></div>
    <div class="workspace-list"><div class="list-heading"><div><span class="list-heading-icon">${icon("globe", 17)}</span><div><strong>${status.unlocked && profiles.length ? "Your portal profiles" : "Get started with GhostState"}</strong><small>${status.unlocked && profiles.length ? "Manage your saved sign-ins" : "A few simple steps to a private workspace"}</small></div></div><button class="btn small" data-action="add-profile">${icon("plus", 14)} Add portal</button></div><div class="overview-rows" aria-live="polite">${rows}</div></div>
  </section><aside class="workspace-aside" aria-label="More workspace information"><div class="aside-title"><span>At a glance</span><span>YOUR WORKSPACE</span></div>
    <section class="card aside-card"><div class="aside-card-label">${icon("device", 15)} COMPANION <span class="aside-status ${native.connected ? "connected" : ""}"><i class="dot ${native.connected ? "good" : ""}"></i>${native.connected ? "Connected" : "Offline"}</span></div><h3>${native.connected ? "Companion connected" : "Connect a nearby device"}</h3><p>${native.connected ? "Pair explicitly and compare verification codes before sharing a credential." : "Use the local companion for an explicitly approved credential transfer. No cookies or active sessions are copied."}</p><button class="aside-action" data-screen="devices">Manage devices ${icon("arrow", 13)}</button></section>
    <section class="card aside-card activity-summary"><div class="aside-card-label">${icon("activity", 15)} RECENT ACTIVITY</div>${status.unlocked && events.length ? `<div class="summary-events">${activityRows(events.slice(0, 2))}</div>` : `<h3>${status.unlocked ? "Nothing to show yet" : "Activity stays private"}</h3><p>${status.unlocked ? "Optional activity logging records authorized operations, not your browsing history." : "Unlock your vault to view the optional encrypted activity log."}</p>`}<button class="aside-action" data-screen="activity">View activity ${icon("arrow", 13)}</button></section>
    <div class="aside-caption">${icon("shield", 14)} Your sign-ins. Your control.</div></aside></div>`;
  }
  function welcome() {
    return `${header("A little more control,\nfor every sign-in.", "Three simple steps to a more private workflow.", status.unlocked ? btn("add-profile", "Add a portal", "plus", "primary") : btn("unlock", status.initialized ? "Unlock vault" : "Create your vault", "arrow", "primary"), "WELCOME TO GHOSTSTATE")}
  <div class="split"><div class="card panel"><h2>Start with your vault</h2><p>Your vault is protected with a master passphrase that never leaves this device. Choose a long, unique passphrase and keep it somewhere safe.</p><div class="steps"><div class="step"><div class="step-number">1</div><div><strong>Create a private vault</strong><p>Set a master passphrase. It is not stored or recoverable by us.</p></div></div><div class="step"><div class="step-number">2</div><div><strong>Add a portal profile</strong><p>Save the exact site origin and credentials you want to use.</p></div></div><div class="step"><div class="step-number">3</div><div><strong>Teach the sign-in steps</strong><p>Select your site and capture each form. Approve each fill or opt in to temporary automatic fill.</p></div></div></div></div><div class="card panel"><h2>What GhostState will never do</h2><p>Trust works best when expectations are clear.</p><div class="steps"><div class="step"><div class="assurance-icon">${icon("cloud", 16)}</div><div><strong>No cloud sync</strong><p>Your vault is local. Make an encrypted backup if you need one.</p></div></div><div class="step"><div class="assurance-icon">${icon("shield", 16)}</div><div><strong>No challenge bypass</strong><p>CAPTCHA, one-time codes, passkeys, and security keys remain yours to complete.</p></div></div><div class="step"><div class="assurance-icon">${icon("check", 16)}</div><div><strong>No GhostState form submission</strong><p>Review and submit yourself; websites may still react automatically to filled fields.</p></div></div></div></div></div>`;
  }
  function lockedContent(text2) {
    return `<div class="card empty"><div class="empty-icon">${icon("lock", 20)}</div><h3>${status.initialized ? "Your vault is locked" : "Start with a private vault"}</h3><p>${text2}</p>${btn("unlock", status.initialized ? "Unlock vault" : "Create vault", "lock", "primary")}</div>`;
  }
  function portals() {
    const q = profileSearch.trim().toLocaleLowerCase();
    const matches = profiles.filter((p) => !q || `${p.label} ${p.origin}`.toLocaleLowerCase().includes(q));
    return `${header("Portal profiles", "Credentials are isolated to the exact site origin you choose.", btn("import-csv", "Import CSV", "download", "") + btn("add-profile", "Add portal", "plus", "primary"), "YOUR VAULT")}${!status.unlocked ? lockedContent("Unlock to view or add your locally encrypted portal profiles.") : profiles.length ? `<div class="banner">${icon("shield", 17)}<div>Passwords stay hidden until you deliberately reveal one and re-enter your master passphrase. Health checks are local and do not check data breaches.</div></div><div class="profile-search"><label for="profile-search">Search profiles by name or site</label><input type="search" id="profile-search" value="${esc(profileSearch)}" placeholder="Search names or websites" maxlength="200"></div>${matches.length ? `<div class="list">${matches.map((p) => `<div class="list-row"><div class="list-icon">${icon("globe", 18)}</div><div class="list-main"><strong>${esc(p.label)}</strong><small>${esc(p.origin)}</small><small>${p.weakPassword ? "Potentially weak password \xB7 " : ""}${p.reusedPassword ? "Password reused in this vault \xB7 " : ""}${p.stateCount} learned ${p.stateCount === 1 ? "state" : "states"}</small></div><div class="row-actions">${btn("learn", "Learn", "flow", "small", `data-id="${esc(p.id)}"`)}${btn("fill", "Fill", "key", "small", `data-id="${esc(p.id)}"`)}${btn("edit-profile", "Edit", "", "small", `data-id="${esc(p.id)}"`)}${btn("reveal-profile", "Reveal", "", "small", `data-id="${esc(p.id)}"`)}${btn("delete-profile", "Delete", "", "small danger", `data-id="${esc(p.id)}"`)}</div></div>`).join("")}</div>` : `<div class="card empty"><h3>No matching profiles</h3><p>Try a different name or website.</p></div>`}` : `<div class="card empty"><div class="empty-icon">${icon("globe", 20)}</div><h3>No portal profiles yet</h3><p>Add a site and your credentials to start building a private, site-specific workflow.</p>${btn("add-profile", "Add your first portal", "plus", "primary")}</div>`}`;
  }
  function workflows() {
    return `${header("Learned workflows", "Recognize the steps of a sign-in, while keeping you in control.", btn("select-site", "Choose a site", "globe", ""), "AUTHENTICATION")}${!status.unlocked ? lockedContent("Unlock to see and manage the workflows protected in your vault.") : `<div class="banner ${target ? "" : "warn"}">${icon(target ? "globe" : "info", 17)}<div>${target ? `Selected site: <strong>${esc(target.origin)}</strong>. Capture each new screen after navigating or submitting manually.` : "Select a site with the GhostState toolbar button, or choose one here. Only that exact origin can receive its credentials."}</div></div>${autoStatus ? `<div class="banner warn">${icon("warning", 17)}<div>Temporary automatic fill is on for <strong>${esc(autoStatus.origin)}</strong>, this selected tab only, until ${esc(new Date(autoStatus.expiresAt).toLocaleTimeString())}. Return to that tab; GhostState never submits the form.</div>${btn("auto-disable", "Turn off", "", "small")}</div>` : `<div class="banner">${icon("info", 17)}<div>Automatic filling is off by default. You may enable it for one learned profile and selected tab for up to 10 minutes. A compromised site can read anything filled.</div></div>`}${profiles.length ? `<div class="list">${profiles.map((p) => `<div class="list-row"><div class="list-icon">${icon("flow", 19)}</div><div class="list-main"><strong>${esc(p.label)}</strong><small>${esc(p.origin)} \xB7 ${p.stateCount} ${p.stateCount === 1 ? "state" : "states"}${p.workflowVersion ? ` \xB7 v${esc(p.workflowVersion)}` : ""}</small></div><span class="pill ${p.stateCount ? "green" : ""}">${p.stateCount ? "Learned" : "Not learned"}</span><div class="row-actions">${btn("learn", p.stateCount ? "Capture next state" : "Learn a state", "plus", "small", `data-id="${esc(p.id)}"`)}${btn("fill", "Review & fill", "key", "small", `data-id="${esc(p.id)}"`)}${p.stateCount ? btn("auto-enable", autoStatus?.profileId === p.id ? "Restart auto-fill" : "Enable auto-fill", "", "small", `data-id="${esc(p.id)}"`) : ""}${p.stateCount ? btn("workflow-detail", "Details", "", "small", `data-id="${esc(p.id)}"`) : ""}</div></div>`).join("")}</div>` : `<div class="card empty"><div class="empty-icon">${icon("flow", 20)}</div><h3>Teach your first workflow</h3><p>Start by creating a portal profile. You can then capture each sign-in screen without saving its HTML.</p>${btn("add-profile", "Add a portal", "plus", "primary")}</div>`}`}`;
  }
  function devices() {
    const senders = Array.isArray(nativeInfo?.pairings) ? nativeInfo.pairings : [];
    const receiver = nativeInfo?.receiverPairing;
    const pairings = receiver ? [...senders, receiver] : senders;
    const incoming = Array.isArray(nativeInfo?.incoming) ? nativeInfo.incoming : [];
    const canSend = nativeInfo?.centralSupported === true;
    const canReceive = nativeInfo?.peripheralSupported === true;
    const discoveryDisabled = nativeInfo?.listening || !canSend ? 'disabled title="Stop receiving or refresh companion status"' : "";
    const listenDisabled = senders.length || !canReceive ? 'disabled title="Receiving is unavailable, or sender pairings are active"' : "";
    const connection = native.connected ? `<div class="row-actions">${btn("discover", "Discover nearby", "bluetooth", "small", discoveryDisabled)}${nativeInfo?.listening ? btn("stop-listen", "Stop discovery", "", "small") : btn("listen", "Make discoverable", "device", "small", listenDisabled)}${btn("native-status", "Refresh", "activity", "small")}</div>` : `<div class="row-actions">${btn("connect-native", "Connect companion", "bluetooth", "small primary")}${btn("help", "Installation help", "help", "small")}</div>`;
    const platformStatus = native.connected ? nativeInfo ? `<p class="ble-capability">Companion ${esc(nativeInfo.version || "unknown version")} \xB7 ${esc(nativeInfo.platform || "unknown platform")} \xB7 sender ${canSend ? "implemented" : "unavailable"} \xB7 receiver ${canReceive ? "implemented" : "unavailable"}. Implementation does not guarantee that this adapter or OS supports it.</p>` : `<p class="ble-capability">Companion status unavailable. Refresh or reconnect before scanning.</p>` : `<p class="ble-capability">Install the separate companion and register this exact extension ID. See Installation help.</p>`;
    const nearbyList = nearby.length ? `<div class="list">${nearby.map((d) => `<div class="list-row"><div class="list-icon">${icon("bluetooth", 17)}</div><div class="list-main"><strong>${esc(d.name || "GhostState device")}</strong><small>${esc(d.id)}</small></div>${btn("pair", senders.some((p) => p.peerId === d.id) ? "Already paired" : "Pair", "", "small", `data-id="${esc(d.id)}" ${senders.some((p) => p.peerId === d.id) ? "disabled" : ""}`)}</div>`).join("")}</div>` : `<div class="empty-activity"><div class="empty-icon">${icon("device", 20)}</div><strong>No nearby devices listed</strong><p>${native.connected ? "Make a second device discoverable, then scan nearby." : "Connect your companion to start discovery."}</p></div>`;
    const pairPanels = pairings.map((pairing) => {
      const id = pairing.role === "sender" ? String(pairing.peerId) : "";
      const attr = id ? `data-id="${esc(id)}"` : "";
      return `<div class="card panel" style="margin-top:15px"><div class="panel-head"><div><h2>${pairing.verified ? "Verified device" : "Verify this pairing"}</h2><p>${pairing.verified ? "This verified connection is temporary and will expire." : "Compare all eight digits on both devices in person or over a trusted channel."}${id ? ` Recipient: ${esc(id)}.` : " Receiving device."}</p></div><span class="pill ${pairing.verified ? "green" : ""}">${pairing.verified ? "Verified" : "Confirmation required"}</span></div><div class="setting-row"><div><strong>Verification code</strong><p>Peer key fingerprint: ${esc(pairing.peerFingerprint)}</p></div><strong style="font-size:25px;letter-spacing:.12em;color:var(--accent)">${esc(pairing.code)}</strong></div><div class="row-actions">${!pairing.verified ? btn("confirm-pair", pairing.localConfirmed ? "Check other device" : "Codes match \u2014 confirm", "check", "small primary", attr) : ""}${pairing.verified && pairing.role === "sender" ? btn("send-profile", "Send a credential", "key", "small primary", attr) : ""}${btn("cancel-pair", "End pairing", "", "small", attr)}</div>${pairing.localConfirmed && !pairing.verified ? "<p>Waiting for the other device. Confirm there, then check again.</p>" : ""}</div>`;
    }).join("");
    const transfers = incoming.length ? `<div class="card panel"><h2>Incoming transfers</h2><p>Nothing is saved until you explicitly accept it. Grants expire quickly.</p><div class="list">${incoming.map((g) => `<div class="list-row"><div class="list-icon">${icon("key", 18)}</div><div class="list-main"><strong>${esc(g.origin)}</strong><small>Credential-assisted sign-in \xB7 expires ${esc(new Date(g.expires * 1e3).toLocaleTimeString())}</small></div>${btn("accept-transfer", "Review", "", "small primary", `data-id="${esc(g.id)}"`)}${btn("reject-transfer", "Reject", "", "small danger", `data-id="${esc(g.id)}"`)}</div>`).join("")}</div></div>` : "";
    return `${header("Devices & transfer", "Pair nearby devices and approve a credential-assisted sign-in.", native.connected ? btn("disconnect-native", "Disconnect", "close", "") : btn("connect-native", "Connect companion", "bluetooth", "primary"), "PROXIMITY BRIDGE")}
  <div class="banner warn">${icon("info", 17)}<div><strong>Experimental Bluetooth:</strong> compare all eight digits separately with each recipient and approve every transfer. Windows and Linux receiver implementations and all physical radio paths are untested. Android and iPhone companion apps are not included. Use synthetic credentials only.</div></div><div class="split"><div class="card panel"><div class="panel-head"><div><h2>Companion connection</h2><p>The native helper provides local Bluetooth access and requires a separate installation. ${!native.connected ? "Connect to check this device\u2019s capabilities." : nativeInfo?.listening ? "Discovery is active for up to five minutes; radio visibility depends on your adapter." : `${senders.length} of ${esc(nativeInfo?.connectionLimit || 8)} sender connections active.`}</p></div><span class="pill ${native.connected ? "green" : ""}">${native.connected ? "Connected" : "Not connected"}</span></div>${platformStatus}${connection}</div><div class="card panel"><h2>Nearby devices</h2><p>Only devices advertising the GhostState service are listed. Names and addresses are not identity verification.</p>${nearbyList}</div></div>${pairPanels}${transfers ? `<div style="margin-top:15px">${transfers}</div>` : ""}`;
  }
  function activity() {
    return `${header("Activity & security log", "A local record of actions you explicitly authorize.", status.unlocked && events.length ? btn("clear-events", "Clear activity", "", "") : "", "YOUR HISTORY")}${!status.unlocked ? lockedContent("Your activity log is encrypted with your vault and is only visible while unlocked.") : events.length ? `<div class="card panel"><div class="events">${activityRows(events)}</div></div>` : `<div class="card empty"><div class="empty-icon">${icon("activity", 20)}</div><h3>Nothing to show yet</h3><p>Profile and workflow actions appear here if activity logging is enabled. We do not record browsing history.</p></div>`}`;
  }
  function security() {
    return `${header("Privacy & security", "Make your local workspace work the way you want.", "", "YOUR PREFERENCES")}${!status.unlocked ? lockedContent("Unlock to change vault settings or manage an encrypted backup.") : `<div class="card panel"><h2>Vault protection</h2><p>Your master passphrase is never stored. Locking clears the in-memory key.</p><div class="setting-row"><div><strong>Automatic lock</strong><p>Lock after a period of inactivity. Browser worker suspension may lock it sooner.</p></div><select id="auto-lock" aria-label="Automatic lock timeout"><option value="1">1 minute</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option></select></div><div class="setting-row"><div><strong>Activity log</strong><p>Optional, off by default. Record authorized operations inside the encrypted vault; never page content.</p></div><label><input id="logging" type="checkbox" aria-label="Enable activity logging"> Enabled</label></div><div class="setting-row"><div><strong>Offline password health</strong><p>${profiles.filter((p) => p.weakPassword).length} potentially weak and ${profiles.filter((p) => p.reusedPassword).length} reused profile(s). This basic local check cannot detect breaches or guarantee strength.</p></div></div><div class="setting-row"><div><strong>Lock vault now</strong><p>Clear the in-memory encryption key.</p></div>${btn("lock", "Lock vault", "lock", "small")}</div><div class="setting-row"><div><strong>Selected-site access</strong><p>${target ? `Currently ${esc(target.origin)}. Revocation removes browser access for that host.` : "No site currently selected. Manage other grants in your browser\u2019s extension settings."}</p></div>${btn("revoke-site", "Revoke selected site", "", "small", target && ext ? "" : "disabled")}</div></div><div class="card panel"><h2>Backup & recovery</h2><p>Backups are encrypted, but protect the file. You will still need your master passphrase to restore it. A forgotten passphrase cannot be recovered.</p><div class="row-actions">${btn("export", "Export encrypted backup", "download", "small")}${btn("restore-info", "Restore a backup", "", "small")}${btn("cloud-info", "Cloud backup guidance", "cloud", "small")}${btn("reset", "Delete this vault", "", "small danger")}</div></div>`}`;
  }
  function compatibility() {
    return `${header("Browser compatibility", "One local workspace, with capabilities that vary by platform.", "", "PLATFORM SUPPORT")}<div class="card panel"><h2>Extension support</h2><p>Package and test in your own browser before relying on it. See installation documentation for exact steps.</p><div class="table-scroll" role="region" tabindex="0" aria-label="Browser compatibility table, scroll horizontally if needed"><table class="table"><thead><tr><th>Browser</th><th>Extension</th><th>Companion</th></tr></thead><tbody><tr><td><strong>Chromium family</strong><br>Chrome, Edge, Brave, Opera</td><td>Manifest V3 build; per-site permission</td><td>Native messaging requires a local host registration.</td></tr><tr><td><strong>Firefox</strong></td><td>Separate MV3 manifest; verify on target version</td><td>Separate host manifest and fixed add-on ID required.</td></tr><tr><td><strong>Safari on macOS</strong></td><td>Requires Xcode conversion and a containing app</td><td>Safari uses an app extension handler, not Chrome native messaging.</td></tr><tr><td><strong>Android & iPhone</strong></td><td>The standard mobile Chrome apps do not install this desktop Chrome extension.</td><td>No Android or iPhone GhostState companion app is included.</td></tr><tr><td><strong>Mobile captive portals</strong></td><td>Not supported in OS captive-portal mini-browsers</td><td>Open a normal supported browser where possible.</td></tr></tbody></table></div></div>`;
  }
  function help() {
    return `${header("Help & troubleshooting", "The details you need, right when you need them.", "", "HERE TO HELP")}<div class="split"><div class="card panel"><h2>Getting started</h2><div class="steps"><div class="step"><div class="step-number">1</div><div><strong>Install the browser extension</strong><p>Load the desktop browser extension using the separate developer guide. The dashboard opens directly in the browser.</p></div></div><div class="step"><div class="step-number">2</div><div><strong>Select the site you trust</strong><p>On the sign-in page, click the GhostState toolbar icon and choose \u201CUse this site.\u201D Allow access to that site when asked.</p></div></div><div class="step"><div class="step-number">3</div><div><strong>Capture, then fill</strong><p>Add a profile with the exact origin. Capture each sign-in screen, review the mappings, then approve filling. Submit manually.</p></div></div></div></div><div class="card panel"><h2>When something changes</h2><div class="steps"><div class="step"><div class="assurance-icon">${icon("warning", 16)}</div><div><strong>Page not recognized?</strong><p>Website changes can alter the structure. Take over manually, then capture the new screen.</p></div></div><div class="step"><div class="assurance-icon">${icon("shield", 16)}</div><div><strong>Challenge detected?</strong><p>Complete OTP, CAPTCHA, passkeys, and security questions yourself. The assistant will not solve them.</p></div></div><div class="step"><div class="assurance-icon">${icon("key", 16)}</div><div><strong>Forgot the passphrase?</strong><p>There is no recovery service. Restore an encrypted backup only if you still know its passphrase; otherwise reset the vault.</p></div></div></div></div></div><div class="card panel" style="margin-top:16px"><h2>Bluetooth setup & limits</h2><p>The Bluetooth companion is a separate local program. Install it, register the extension ID shown below, restart the browser, then choose <strong>Devices &amp; transfer \u2192 Connect companion</strong> and grant the optional permission. Keep the dashboard used to connect open during nearby transfers; closing it may disconnect the companion.</p><p>${ext ? `This installation\u2019s extension ID: <code class="extension-id">${esc(extensionApi.runtime.id)}</code>` : "Load the extension to see its ID."} A store installation may have a different ID from an unpacked test installation. Register the ID of the one you actually use.</p><p>Windows and Linux sender/receiver code is experimental; real radios have not been tested. macOS has sender code only. Android and iPhone apps are not included. Discovery and pairing exchange Bluetooth identifiers and handshake data. A credential is sent only after you verify a peer and approve the transfer.</p><p>If the host is not found, check the companion installation, the exact extension ID and your browser's native-messaging registration; then restart the browser. If discovery fails, check that Bluetooth is on and both adapters support the required roles. Consult the separate developer guide for platform-specific steps.</p></div>`;
  }
  function render() {
    const body = { overview, welcome, portals, workflows, devices, activity, security, compatibility, help }[screen]();
    app.innerHTML = shell(body);
    document.title = `${labels[screen]} \u2014 GhostState`;
    if (screen === "security" && status.unlocked) void loadSettings();
  }
  async function loadSettings() {
    try {
      const s = await call("GET_SETTINGS");
      const select = document.querySelector("#auto-lock");
      const checkbox = document.querySelector("#logging");
      if (select && checkbox) {
        select.value = String(s.autoLockMinutes);
        checkbox.checked = s.logging;
      }
    } catch {
    }
  }
  function modal(title, body, options = {}) {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<section class="dialog ${options.wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="close" aria-label="Close dialog">${icon("close", 19)}</button></div>${body}<div class="error" role="alert"></div></section>`;
    const previous = document.activeElement;
    app.inert = true;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", key);
      backdrop.remove();
      app.inert = false;
      previous?.focus();
    };
    const key = (e) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key === "Tab") {
        const nodes = Array.from(backdrop.querySelectorAll('button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])')).filter((el) => el.getClientRects().length > 0);
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.body.append(backdrop);
    backdrop.querySelector(".close").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    document.addEventListener("keydown", key);
    (backdrop.querySelector("input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled)") || backdrop.querySelector("button:not(:disabled)"))?.focus();
    return { root: backdrop, close, error: (s) => {
      backdrop.querySelector(".error").textContent = s;
    } };
  }
  function bindForm(m, run) {
    const form = m.root.querySelector("form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = form.querySelector("[type=submit]");
      if (button) button.disabled = true;
      m.error("");
      try {
        await run(new FormData(form));
        m.close();
        await refresh();
      } catch (err) {
        if (m.root.isConnected) m.error(err instanceof Error ? err.message : "Could not complete this action.");
        else toast("Action completed, but the workspace could not refresh. Reload to check its state.");
      } finally {
        if (button) button.disabled = false;
      }
    });
  }
  function unlockDialog() {
    if (status.unlocked) {
      toast("Your vault is already unlocked.");
      return;
    }
    const setup = !status.initialized;
    const m = modal(setup ? "Create your vault" : "Unlock your vault", `<p>${setup ? "Choose a unique passphrase of at least 12 characters. It never leaves your device and cannot be recovered if forgotten." : "Enter your master passphrase to access your local vault."}</p><form><div class="field"><label for="passphrase">Master passphrase</label><input id="passphrase" name="passphrase" type="password" autocomplete="off" minlength="${setup ? 12 : 1}" maxlength="1024" required placeholder="${setup ? "At least 12 characters" : "Enter your passphrase"}"></div>${setup ? '<div class="field"><label for="confirm-pass">Confirm passphrase</label><input id="confirm-pass" name="confirm" type="password" autocomplete="off" required placeholder="Repeat your passphrase"></div>' : ""}<div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">${setup ? "Create vault" : "Unlock vault"} ${icon("arrow", 15)}</button></div></form>${setup ? '<p>Have an encrypted backup? <a href="#" class="restore-link">Restore it instead</a>.</p>' : ""}`);
    m.root.querySelector(".cancel").addEventListener("click", m.close);
    m.root.querySelector(".restore-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      m.close();
      restoreDialog();
    });
    bindForm(m, async (d) => {
      const pass = String(d.get("passphrase") || "");
      if (setup && pass !== String(d.get("confirm"))) throw new Error("Passphrases do not match.");
      await call(setup ? "SETUP" : "UNLOCK", { passphrase: pass });
      toast(setup ? "Your encrypted vault is ready." : "Vault unlocked.");
    });
  }
  function profileDialog(id) {
    if (!status.unlocked) {
      unlockDialog();
      return;
    }
    const p = id ? getProfile(id) : null;
    const m = modal(p ? "Edit portal" : "Add a portal", `<p>${p ? "Leave username or password blank to keep the current value. Changing the site clears the learned workflow; it does not change your password at the website." : "Save credentials for one exact origin. They are stored encrypted on this device; GhostState fills only the exact site you select."}</p><form><div class="field"><label for="label">Profile name</label><input id="label" name="label" maxlength="80" required placeholder="e.g. University portal" value="${esc(p?.label || "")}"></div><div class="field"><label for="url">Site URL</label><input id="url" name="url" type="url" maxlength="2048" required placeholder="https://portal.example" value="${esc(p?.origin || target?.origin || "")}"><small>HTTPS only; the scheme, hostname, and port must match exactly.</small></div><div class="field"><label for="username">${p ? "New username or email (optional)" : "Username or email"}</label><input id="username" name="username" maxlength="512" ${p ? "" : "required"} autocomplete="off" placeholder="${p ? "Leave blank to keep current" : "Your username"}"></div><div class="field"><label for="password">${p ? "New password (optional)" : "Password"}</label><input id="password" name="password" type="password" maxlength="4096" ${p ? "" : "required"} autocomplete="new-password" placeholder="${p ? "Leave blank to keep current" : "Your password"}"><label class="check-line"><input type="checkbox" id="show-generated"> Show the password being entered</label></div><details class="generator"><summary>Generate a password locally</summary><p>Longer passwords and more character sets are generally harder to guess. Change it on the website too; saving here alone does not update the site.</p><div class="generator-options"><label for="gen-length">Length</label><input id="gen-length" type="number" min="12" max="128" value="20"><label><input id="gen-lower" type="checkbox" checked> Lowercase</label><label><input id="gen-upper" type="checkbox" checked> Uppercase</label><label><input id="gen-numbers" type="checkbox" checked> Numbers</label><label><input id="gen-symbols" type="checkbox" checked> Symbols</label></div><button type="button" class="btn small" id="generate-password">Generate password</button></details>${p ? '<div class="field"><label for="edit-pass">Confirm master passphrase</label><input id="edit-pass" name="master" type="password" autocomplete="off" required></div>' : ""}<div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button class="btn primary" type="submit">${p ? "Save profile changes" : "Save encrypted profile"} ${icon("arrow", 15)}</button></div></form>`);
    m.root.querySelector(".cancel").addEventListener("click", m.close);
    const password = m.root.querySelector("#password");
    m.root.querySelector("#show-generated").addEventListener("change", (e) => {
      password.type = e.target.checked ? "text" : "password";
    });
    m.root.querySelector("#generate-password").addEventListener("click", () => {
      try {
        password.value = generatePassword({ length: Number(m.root.querySelector("#gen-length").value), lowercase: m.root.querySelector("#gen-lower").checked, uppercase: m.root.querySelector("#gen-upper").checked, numbers: m.root.querySelector("#gen-numbers").checked, symbols: m.root.querySelector("#gen-symbols").checked });
        m.error("");
        toast("New password generated locally.");
      } catch (e) {
        m.error(e instanceof Error ? e.message : "Could not generate a password.");
      }
    });
    bindForm(m, async (d) => {
      const fields = { label: String(d.get("label")), url: String(d.get("url")), username: String(d.get("username")), password: String(d.get("password")) };
      if (p) {
        await call("UPDATE_PROFILE", { id: p.id, ...fields, passphrase: String(d.get("master")) });
        toast("Profile updated locally.");
      } else {
        await call("ADD_PROFILE", fields);
        toast("Portal profile saved locally.");
      }
    });
  }
  function revealProfileDialog(id) {
    if (!status.unlocked) {
      unlockDialog();
      return;
    }
    const p = getProfile(id);
    const m = modal("Confirm before revealing", `<p>Re-enter your master passphrase to show the credential for <strong>${esc(p.label)}</strong>. Others who can see your screen or clipboard may be able to read it.</p><form><div class="field"><label for="reveal-pass">Master passphrase</label><input id="reveal-pass" name="passphrase" type="password" autocomplete="off" required maxlength="1024"></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Reveal credential</button></div></form>`);
    m.root.querySelector(".cancel").addEventListener("click", m.close);
    m.root.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      m.error("");
      try {
        const secret = await call("REVEAL_PROFILE", { id, passphrase: String(new FormData(form).get("passphrase")) });
        const live = await call("STATUS");
        if (!live.unlocked) throw new Error("Vault is locked.");
        m.close();
        const result = modal("Revealed credential", `<p>For <strong>${esc(p.label)}</strong> \xB7 ${esc(p.origin)}. This view closes after 30 seconds or when the vault locks.</p><div class="field"><label for="revealed-username">Username</label><input id="revealed-username" readonly></div><div class="field"><label for="revealed-password">Password</label><input id="revealed-password" readonly></div><p>Copying uses the system clipboard, which other applications or clipboard history may retain.</p><div class="dialog-actions"><button type="button" class="btn copy-secret">Copy password</button><button type="button" class="btn primary done-secret">Done</button></div>`);
        result.root.querySelector("#revealed-username").value = secret.username;
        result.root.querySelector("#revealed-password").value = secret.password;
        result.root.querySelector(".done-secret").addEventListener("click", result.close);
        result.root.querySelector(".copy-secret").addEventListener("click", () => {
          if (!navigator.clipboard?.writeText) {
            result.error("Clipboard unavailable. Select the password and copy it manually.");
            return;
          }
          void navigator.clipboard.writeText(secret.password).then(() => toast("Copied. Clipboard history may retain it."), () => result.error("Clipboard unavailable. Select the password and copy it manually."));
        });
        const deadline = Date.now() + 3e4;
        const timer = setInterval(() => {
          if (!result.root.isConnected) {
            clearInterval(timer);
            return;
          }
          if (Date.now() >= deadline) {
            result.close();
            clearInterval(timer);
            return;
          }
          void call("STATUS").then((s) => {
            if (!s.unlocked) {
              result.close();
              clearInterval(timer);
            }
          }).catch(() => {
            result.close();
            clearInterval(timer);
          });
        }, 1e3);
      } catch (err) {
        m.error(err instanceof Error ? err.message : "Could not reveal credential.");
        button.disabled = false;
      }
    });
  }
  function importCsvDialog() {
    if (!status.unlocked) {
      unlockDialog();
      return;
    }
    const m = modal("Import login CSV", `<p>Choose a standard CSV with <strong>url, username, password</strong> columns (name is optional), or a Bitwarden CSV export. This reads the file locally; nothing is uploaded.</p><div class="banner warn">${icon("warning", 17)}<div>CSV exports are usually unencrypted: anyone with the file can read them. Notes, one-time codes/seeds, passkeys and other fields are not imported. Afterward, remove the plaintext file safely.</div></div><form><div class="field"><label for="import-file">CSV file (up to 2 MB)</label><input type="file" id="import-file" name="file" accept=".csv,text/csv" required></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Review logins</button></div></form>`);
    m.root.querySelector(".cancel").addEventListener("click", m.close);
    m.root.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      m.error("");
      try {
        const file = new FormData(form).get("file");
        if (!(file instanceof File) || file.size > 2e6) throw new Error("Choose a CSV under 2 MB.");
        const preview = readLoginCsv(await file.text());
        m.close();
        const review = modal("Review CSV import", `<p>${preview.records.length} supported login(s) found; ${preview.skipped} unsupported or incomplete row(s) skipped. Existing exact origin-and-username duplicates will be skipped; passwords are not shown here. URL paths are discarded. Imported profiles have no learned steps.</p><div class="import-preview">${preview.records.map((r) => `<div><strong>${esc(r.label)}</strong><small>${esc(r.url)}</small></div>`).join("")}</div>${preview.skipped ? `<details><summary>Why some rows were skipped</summary><ul>${preview.skippedRows.slice(0, 50).map((r) => `<li>Row ${r.row}: ${esc(r.reason)}</li>`).join("")}</ul>${preview.skipped > 50 ? "<p>Only the first 50 skipped rows are shown.</p>" : ""}</details>` : ""}<form><div class="field"><label for="import-pass">Confirm master passphrase</label><input type="password" id="import-pass" name="passphrase" autocomplete="off" maxlength="1024" required></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Import into vault</button></div></form>`, { wide: true });
        review.root.querySelector(".cancel").addEventListener("click", review.close);
        bindForm(review, async (d) => {
          const result = await call("IMPORT_PROFILES", { records: preview.records, passphrase: String(d.get("passphrase")) });
          toast(`${result.imported} login(s) imported; ${result.duplicates} duplicate(s) skipped.`);
        });
      } catch (err) {
        m.error(err instanceof Error ? err.message : "Could not read the CSV.");
        button.disabled = false;
      }
    });
  }
  function confirmDialog(title, message, yes, fn, danger = false) {
    const m = modal(title, `<p>${esc(message)}</p><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="button" class="btn ${danger ? "danger" : "primary"} accept">${esc(yes)}</button></div>`);
    m.root.querySelector(".cancel").addEventListener("click", m.close);
    const button = m.root.querySelector(".accept");
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await fn();
        m.close();
        await refresh();
      } catch (e) {
        m.error(e instanceof Error ? e.message : "Action failed.");
        button.disabled = false;
      }
    });
  }
  function restoreDialog() {
    if (status.initialized) {
      toast("Reset the existing vault before restoring a backup.");
      return;
    }
    const m = modal("Restore an encrypted backup", `<p>Select a GhostState backup and enter the master passphrase used when it was created. No data leaves this device.</p><form><div class="field"><label for="backup">Encrypted backup file</label><input id="backup" name="backup" type="file" accept="application/json,.json" required></div><div class="field"><label for="restore-pass">Master passphrase</label><input id="restore-pass" name="passphrase" type="password" required autocomplete="off"></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Restore vault</button></div></form>`);
    m.root.querySelector(".cancel").addEventListener("click", m.close);
    bindForm(m, async (d) => {
      const file = d.get("backup");
      if (!(file instanceof File) || file.size > 1e7) throw new Error("Choose a valid backup under 10 MB.");
      await call("RESTORE", { backup: await file.text(), passphrase: String(d.get("passphrase")) });
      toast("Encrypted vault restored.");
    });
  }
  function selectSiteDialog() {
    if (!ext) {
      toast("Install the browser extension to select and scan a site.");
      return;
    }
    const m = modal("Choose a site", `<p>Enter the site origin to grant access. If the site is already open, GhostState will select its tab; otherwise it opens one in the background. You can also use the toolbar button while on the site.</p><form><div class="field"><label for="site-url">Site URL</label><input id="site-url" name="url" type="url" required placeholder="https://portal.example"><small>The browser permission covers the host; GhostState separately enforces the exact origin including its port.</small></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Allow & select site</button></div></form>`);
    m.root.querySelector(".cancel").addEventListener("click", m.close);
    bindForm(m, async (d) => {
      const origin2 = canonicalOrigin(String(d.get("url")));
      const u = new URL(origin2);
      const pattern = `${u.protocol}//${u.hostname}/*`;
      const granted = await extensionApi.permissions.request({ origins: [pattern] });
      if (!granted) throw new Error("Site permission was not granted.");
      const tabs = await extensionApi.tabs.query({});
      let tab = tabs.find((t) => {
        try {
          return !!t.url && canonicalOrigin(t.url) === origin2;
        } catch {
          return false;
        }
      });
      if (!tab) tab = await extensionApi.tabs.create({ url: origin2, active: false });
      if (!tab.id) throw new Error("Could not select that tab.");
      await call("SELECT_TAB", { tabId: tab.id, origin: origin2 });
      toast(`Selected ${origin2}.`);
    });
  }
  function getProfile(id) {
    const p = profiles.find((p2) => p2.id === id);
    if (!p) throw new Error("Profile not found.");
    return p;
  }
  async function learnDialog(id) {
    if (!status.unlocked) {
      unlockDialog();
      return;
    }
    const p = getProfile(id);
    if (!target) {
      selectSiteDialog();
      return;
    }
    if (target.origin !== p.origin) throw new Error("The selected tab is not the exact origin of this profile.");
    const snap = await call("SCAN");
    if (snap.challenges.length) throw new Error(`Complete ${snap.challenges.join(", ")} manually before capturing this state.`);
    const inputs = snap.nodes.filter((n) => n.tag === "input" && ["text", "email", "password", "search", "url"].includes(n.type) && !n.autocomplete.includes("new-password") && !n.autocomplete.includes("one-time-code") && !n.autocomplete.includes("webauthn"));
    if (!inputs.length) throw new Error("No eligible visible username or password fields were found on the selected page.");
    const m = modal("Review this sign-in step", `<p>Map the fields on <strong>${esc(p.origin)}</strong>. Only the structural path and your mapping are saved, never page text, HTML, or field values.</p><form><div>${inputs.map((n, i) => `<div class="mapping-row"><div><strong>${esc(n.type === "password" ? "Password field" : n.type === "email" ? "Email field" : "Text field")} ${i + 1}</strong><small>${esc(n.path)}</small></div><select aria-label="Mapping for field ${i + 1}" name="field-${i}"><option value="">Do not fill</option>${n.type !== "password" ? `<option value="username" ${n.suggested === "username" ? "selected" : ""}>Username</option>` : ""}${n.type === "password" ? `<option value="password" ${n.suggested === "password" ? "selected" : ""}>Password</option>` : ""}</select></div>`).join("")}</div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Save this state</button></div></form>`, { wide: true });
    m.root.querySelector(".cancel").addEventListener("click", m.close);
    bindForm(m, async (d) => {
      const mappings = inputs.flatMap((n, i) => {
        const kind = String(d.get(`field-${i}`));
        return kind === "username" || kind === "password" ? [{ path: n.path, kind }] : [];
      });
      if (!mappings.length) throw new Error("Choose at least one field to fill.");
      await call("RECORD_STATE", { id, mappings, fingerprint: snap.fingerprint });
      toast("Workflow state saved. Continue to the next screen manually.");
    });
  }
  async function fillDialog(id) {
    if (!status.unlocked) {
      unlockDialog();
      return;
    }
    const p = getProfile(id);
    if (!target) {
      selectSiteDialog();
      return;
    }
    if (target.origin !== p.origin) throw new Error("Selected site and profile origin do not match. No credentials were released.");
    const [snap, w] = await Promise.all([call("SCAN"), call("GET_WORKFLOW", { id })]);
    if (!w) throw new Error("Capture a workflow state first.");
    if (snap.challenges.length) throw new Error(`Complete ${snap.challenges.join(", ")} manually. GhostState will not fill this screen.`);
    const matched = w.states.find((s) => s.fingerprint === snap.fingerprint);
    if (!matched) throw new Error("The current screen does not match a learned state. Take over manually or capture the changed screen.");
    const kinds = [...new Set(matched.mappings.map((m) => m.kind))].join(" and ");
    confirmDialog("Approve this fill?", `Fill ${kinds} for \u201C${p.label}\u201D on ${p.origin}? GhostState will not submit the form. Review the page before continuing.`, "Fill this step", async () => {
      const r = await call("FILL_STATE", { id });
      toast(r.logFailed ? "Fields filled, but activity could not be recorded. Review and submit manually." : "Fields filled. Review and submit the form yourself.");
    });
  }
  async function workflowDetail(id) {
    const p = getProfile(id), w = await call("GET_WORKFLOW", { id });
    if (!w) throw new Error("No workflow recorded.");
    const m = modal("Workflow details", `<p><strong>${esc(p.label)}</strong> \xB7 ${esc(p.origin)} \xB7 version ${esc(w.version)}</p><div class="list">${w.states.map((s, i) => `<div class="list-row"><div class="step-number">${i + 1}</div><div class="list-main"><strong>${s.mappings.map((x) => esc(x.kind)).join(" + ")}</strong><small>Fingerprint ${esc(s.fingerprint.slice(0, 16))}\u2026 \xB7 ${s.nodes.length} structural nodes</small></div></div>`).join("")}</div><p>Transitions represent manual submissions or navigation. Unexpected screens pause the workflow.</p><div class="dialog-actions"><button type="button" class="btn danger clear">Remove workflow</button><button type="button" class="btn close-detail">Done</button></div>`, { wide: true });
    m.root.querySelector(".close-detail").addEventListener("click", m.close);
    m.root.querySelector(".clear").addEventListener("click", () => {
      m.close();
      confirmDialog("Remove workflow?", `Remove the learned workflow for ${p.label}? Your credentials will remain.`, "Remove workflow", async () => {
        await call("CLEAR_WORKFLOW", { id });
        toast("Workflow removed.");
      }, true);
    });
  }
  function sendProfileDialog(peerId) {
    if (!status.unlocked) {
      unlockDialog();
      return;
    }
    const pairing = (Array.isArray(nativeInfo?.pairings) ? nativeInfo.pairings : []).find((x) => x.peerId === peerId);
    if (!pairing?.verified || pairing.role !== "sender") throw new Error("Verify this recipient device first.");
    if (!profiles.length) throw new Error("Add a portal profile first.");
    const m = modal("Send an encrypted credential", `<p>Send one credential to <strong>${esc(peerId)}</strong>, verified with code <strong>${esc(pairing.code)}</strong>, for local reauthentication. This is not a session transfer. The recipient must explicitly accept it before it is saved.</p><div class="banner warn">${icon("warning", 17)}<div>Only continue if you verified the code with the person holding the receiving device.</div></div><form><div class="field"><label for="transfer-profile">Portal profile</label><select id="transfer-profile" name="profile">${profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.label)} \u2014 ${esc(p.origin)}</option>`).join("")}</select><small>Encrypted over Bluetooth; delivery expires in two minutes. Once accepted, the credential remains valid until changed.</small></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Approve & send</button></div></form>`);
    m.root.querySelector(".cancel").addEventListener("click", m.close);
    bindForm(m, async (d) => {
      const p = getProfile(String(d.get("profile")));
      const gecko = extensionApi?.runtime.getManifest()?.browser_specific_settings?.gecko;
      if (gecko?.data_collection_permissions) {
        const granted = await extensionApi.permissions.request({ data_collection: ["authenticationInfo"] });
        if (!granted) throw new Error("Firefox authentication-info permission was not granted.");
      }
      const r = await call("NATIVE_SEND_PROFILE", { id: p.id, origin: p.origin, peerId });
      toast(r.logFailed ? "Transfer sent, but activity could not be recorded. Recipient approval is pending." : "Encrypted transfer sent; recipient approval is pending.");
    });
  }
  function acceptTransferDialog(id) {
    if (!status.unlocked) {
      unlockDialog();
      return;
    }
    const grant = nativeInfo?.incoming?.find((g) => g.id === id);
    if (!grant) throw new Error("Transfer no longer available. Refresh companion status.");
    const m = modal("Accept this credential?", `<p>A verified nearby device sent a credential for <strong>${esc(grant.origin)}</strong>. Accepting adds it to this device\u2019s encrypted vault. You will still sign in locally.</p><form><div class="field"><label for="transfer-label">Profile name</label><input id="transfer-label" name="label" maxlength="80" required placeholder="e.g. Work portal"></div><div class="dialog-actions"><button type="button" class="btn ghost cancel">Cancel</button><button type="submit" class="btn primary">Accept & save locally</button></div></form>`);
    m.root.querySelector(".cancel").addEventListener("click", m.close);
    bindForm(m, async (d) => {
      const gecko = extensionApi?.runtime.getManifest()?.browser_specific_settings?.gecko;
      if (gecko?.data_collection_permissions) {
        const granted = await extensionApi.permissions.request({ data_collection: ["authenticationInfo"] });
        if (!granted) throw new Error("Firefox authentication-info permission was not granted.");
      }
      await call("NATIVE_ACCEPT_PROFILE", { id, origin: grant.origin, label: String(d.get("label")) });
      toast("Credential saved in your local vault.");
    });
  }
  async function action(name, id) {
    switch (name) {
      case "mobile-more": {
        mobileMenuOpen = !mobileMenuOpen;
        render();
        app.querySelector("[data-action=mobile-more]")?.focus({ preventScroll: true });
        break;
      }
      case "close-mobile-menu": {
        mobileMenuOpen = false;
        render();
        app.querySelector("[data-action=mobile-more]")?.focus({ preventScroll: true });
        break;
      }
      case "theme": {
        const theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("ghoststate-theme", theme);
        render();
        app.querySelector("[data-action=theme]")?.focus();
        break;
      }
      case "sort-profiles":
        sortDescending = !sortDescending;
        render();
        app.querySelector("[data-action=sort-profiles]")?.focus();
        break;
      case "welcome":
        screen = "welcome";
        render();
        app.querySelector("h1")?.focus({ preventScroll: true });
        break;
      case "help":
        screen = "help";
        render();
        app.querySelector("h1")?.focus({ preventScroll: true });
        break;
      case "unlock":
        unlockDialog();
        break;
      case "lock":
        await call("LOCK");
        toast("Vault locked.");
        await refresh();
        break;
      case "add-profile":
        profileDialog();
        break;
      case "edit-profile":
        if (id) profileDialog(id);
        break;
      case "import-csv":
        importCsvDialog();
        break;
      case "reveal-profile":
        if (id) revealProfileDialog(id);
        break;
      case "auto-enable": {
        if (!status.unlocked) {
          unlockDialog();
          break;
        }
        if (!id) break;
        const p = getProfile(id);
        if (!ext) throw new Error("Automatic fill requires the installed browser extension.");
        if (!target || target.origin !== p.origin) throw new Error("Select this exact site and learn a state first.");
        if (!p.stateCount) throw new Error("Learn a sign-in state first.");
        confirmDialog("Enable temporary automatic fill?", `For the next 10 minutes, GhostState may fill the learned fields for ${p.label} on ${p.origin} in the selected, focused tab while the vault is unlocked. A compromised site can read filled credentials. It will never submit for you. Turn it off anytime.`, "Enable for 10 minutes", async () => {
          await call("AUTO_ENABLE", { id });
          toast("Automatic fill enabled. Return to the selected site tab.");
        });
        break;
      }
      case "auto-disable":
        await call("AUTO_DISABLE");
        await refresh();
        toast("Automatic fill turned off.");
        break;
      case "select-site":
        selectSiteDialog();
        break;
      case "learn":
        if (id) await learnDialog(id);
        break;
      case "fill":
        if (id) await fillDialog(id);
        break;
      case "workflow-detail":
        if (id) await workflowDetail(id);
        break;
      case "delete-profile":
        if (id) {
          const p = getProfile(id);
          confirmDialog("Delete this profile?", `Delete ${p.label} and its learned workflow? This cannot be undone.`, "Delete profile", async () => {
            await call("DELETE_PROFILE", { id });
            toast("Profile deleted.");
          }, true);
        }
        break;
      case "clear-events":
        confirmDialog("Clear activity?", "Delete all activity entries from this encrypted vault?", "Clear activity", async () => {
          await call("CLEAR_EVENTS");
          toast("Activity cleared.");
        }, true);
        break;
      case "reset":
        confirmDialog("Delete the entire vault?", "This permanently removes all local credentials, workflows, and activity. Make an encrypted backup first if you might need them.", "Delete vault", async () => {
          await call("RESET");
          toast("Local vault deleted.");
        }, true);
        break;
      case "revoke-site": {
        if (!target || !ext) throw new Error("No selected site to revoke.");
        const origin2 = target.origin;
        confirmDialog("Revoke site access?", `Remove the browser permission for ${origin2}? Other ports on this host are also covered by the browser permission.`, "Revoke access", async () => {
          const u = new URL(origin2);
          await call("CLEAR_TARGET");
          const removed = await extensionApi.permissions.remove({ origins: [`${u.protocol}//${u.hostname}/*`] });
          if (!removed) throw new Error("Browser did not revoke this site permission. Check extension settings.");
          toast("Site access revoked.");
        }, true);
        break;
      }
      case "export": {
        const data = await call("EXPORT");
        const a = document.createElement("a");
        const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
        a.href = url;
        a.download = "ghoststate-encrypted-backup.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2e3);
        toast("Encrypted backup downloaded.");
        break;
      }
      case "restore-info":
        toast("Delete the existing vault, then choose \u201CRestore it instead\u201D from vault setup.");
        break;
      case "cloud-info": {
        const m = modal("Store an encrypted backup in the cloud", `<p>GhostState has no cloud sync service. You can choose to store an encrypted backup file with a cloud provider you trust.</p><ol class="plain-steps"><li>Use <strong>Export encrypted backup</strong> and download the file.</li><li>Sign in to your chosen cloud storage and upload that file yourself. Enable its two-factor authentication.</li><li>Keep the original master passphrase somewhere safe, separate from the backup. Without it, the file cannot be restored.</li><li>After changes, export and upload a new dated copy. Backups do not merge or sync automatically. Test restore in a separate vault.</li></ol><p>The provider can see file metadata, and someone with the file can try to guess a weak passphrase offline. See <strong>docs/CLOUD_BACKUP_AND_SYNC.md</strong> for recovery, conflict and architecture details.</p><div class="dialog-actions"><button type="button" class="btn primary done-cloud">Done</button></div>`);
        m.root.querySelector(".done-cloud").addEventListener("click", m.close);
        break;
      }
      case "connect-native": {
        if (!ext) throw new Error("Install the extension and native companion first.");
        if (connectingNative) break;
        connectingNative = true;
        try {
          const granted = await extensionApi.permissions.request({ permissions: ["nativeMessaging"] });
          if (!granted) throw new Error("Companion permission was not granted.");
          const connection = await call("NATIVE_CONNECT");
          if (connection?.bridgeRequired) {
            if (typeof connection.bridgeToken !== "string") throw new Error("Could not authorize the local companion bridge.");
            await openNativeBridge(connection.bridgeToken);
            await call("NATIVE_CONNECT");
          }
          await refresh();
          toast("Companion connected.");
        } catch (e) {
          removeNativeBridge();
          throw e;
        } finally {
          connectingNative = false;
        }
        break;
      }
      case "disconnect-native":
        await call("NATIVE_DISCONNECT");
        removeNativeBridge();
        nativeInfo = null;
        nearby = [];
        await refresh();
        toast("Companion disconnected.");
        break;
      case "discover": {
        const r = await call("NATIVE_REQUEST", { op: "discover" });
        nearby = Array.isArray(r.devices) ? r.devices : [];
        await refresh();
        toast(nearby.length ? `${nearby.length} nearby device(s) found.` : "No nearby GhostState devices found.");
        break;
      }
      case "listen":
        await call("NATIVE_REQUEST", { op: "listen" });
        await refresh();
        toast("Discovery is active for up to five minutes; radio visibility depends on your adapter.");
        break;
      case "stop-listen":
        await call("NATIVE_REQUEST", { op: "stop_listen" });
        await refresh();
        toast("Discovery stopped.");
        break;
      case "native-status":
        await refresh();
        toast("Companion status refreshed.");
        break;
      case "pair":
        if (id) {
          await call("NATIVE_REQUEST", { op: "pair", data: { id } });
          await refresh();
          toast("Compare the code on both devices.");
        }
        break;
      case "confirm-pair": {
        const pair = id ? (Array.isArray(nativeInfo?.pairings) ? nativeInfo.pairings : []).find((x) => x.peerId === id) : nativeInfo?.receiverPairing;
        if (!pair) throw new Error("No pairing is active.");
        confirmDialog("Verify both devices", `Does the other device display all eight digits ${pair.code}? Only confirm if the codes match over a trusted channel.`, pair.localConfirmed ? "Check confirmation" : "Codes match", async () => {
          await call("NATIVE_REQUEST", { op: "confirm_pair", data: id ? { peerId: id } : {} });
          toast("Pairing confirmation sent.");
        });
        break;
      }
      case "cancel-pair":
        await call("NATIVE_REQUEST", { op: "cancel_pair", data: id ? { peerId: id } : {} });
        await refresh();
        toast("Pairing ended.");
        break;
      case "send-profile":
        if (id) sendProfileDialog(id);
        else throw new Error("Choose a verified recipient.");
        break;
      case "accept-transfer":
        if (id) acceptTransferDialog(id);
        break;
      case "reject-transfer":
        if (id) {
          await call("NATIVE_REQUEST", { op: "reject_transfer", data: { id } });
          await refresh();
          toast("Transfer rejected.");
        }
        break;
    }
  }
  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-screen],[data-action],[data-filter]");
    if (!el) return;
    const filter = el.dataset.filter;
    if (filter && ["all", "learned", "unlearned"].includes(filter) && status.unlocked) {
      overviewFilter = filter;
      render();
      app.querySelector(`[data-filter="${filter}"]`)?.focus();
      return;
    }
    const dest = el.dataset.screen;
    if (dest && labels[dest]) {
      mobileMenuOpen = false;
      screen = dest;
      render();
      window.scrollTo(0, 0);
      app.querySelector("h1")?.focus({ preventScroll: true });
      return;
    }
    if (el.dataset.action) {
      const name = el.dataset.action, id = el.dataset.id;
      if (mobileMenuOpen && name !== "mobile-more" && name !== "close-mobile-menu") {
        mobileMenuOpen = false;
        render();
        app.querySelector("[data-action=mobile-more]")?.focus({ preventScroll: true });
      }
      void action(name, id).catch((err) => toast(err instanceof Error ? err.message : "Action failed."));
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mobileMenuOpen && !document.querySelector(".dialog-backdrop")) {
      e.preventDefault();
      mobileMenuOpen = false;
      render();
      app.querySelector("[data-action=mobile-more]")?.focus({ preventScroll: true });
    }
  });
  var mobileLayout = matchMedia("(max-width: 760px), (max-width: 1000px) and (max-height: 500px)");
  mobileLayout.addEventListener("change", (e) => {
    const focused = document.activeElement;
    const inMobile = !!focused?.closest(".mobile-nav-shell");
    const inSidebar = !!focused?.closest(".side-nav, .sidebar-bottom");
    if (!e.matches && mobileMenuOpen) {
      mobileMenuOpen = false;
      render();
    }
    if (document.querySelector(".dialog-backdrop")) return;
    if (e.matches && inSidebar) {
      const target2 = moreScreens.includes(screen) ? "[data-action=mobile-more]" : `.mobile-nav [data-screen="${screen}"]`;
      app.querySelector(target2)?.focus({ preventScroll: true });
    } else if (!e.matches && inMobile) {
      app.querySelector(`.nav-button[data-screen="${screen}"]`)?.focus({ preventScroll: true });
    }
  });
  app.addEventListener("input", (e) => {
    const el = e.target;
    if (el.id === "profile-search") {
      const pos = el.selectionStart;
      profileSearch = el.value;
      render();
      const next = app.querySelector("#profile-search");
      next?.focus();
      if (pos !== null) next?.setSelectionRange(pos, pos);
    }
  });
  app.addEventListener("change", (e) => {
    const el = e.target;
    if (el.id === "auto-lock" || el.id === "logging") {
      const minutes = Number(document.querySelector("#auto-lock")?.value);
      const logging = !!document.querySelector("#logging")?.checked;
      void call("SET_SETTINGS", { minutes, logging }).then(() => toast("Security settings saved.")).catch((err) => toast(err instanceof Error ? err.message : "Could not save settings."));
    }
  });
  document.documentElement.dataset.theme = localStorage.getItem("ghoststate-theme") === "dark" ? "dark" : "light";
  void refresh().catch((e) => {
    app.innerHTML = `<div class="boot">Unable to open local workspace: ${esc(e instanceof Error ? e.message : "Unknown error")}</div>`;
  });
  setInterval(() => {
    void call("STATUS").then(async (s) => {
      if (s.unlocked !== status.unlocked || s.initialized !== status.initialized) {
        await refresh();
        return;
      }
      if (screen === "workflows" && !document.querySelector(".dialog-backdrop")) {
        const next = await call("AUTO_STATUS");
        if ((next?.expiresAt || 0) !== (autoStatus?.expiresAt || 0)) {
          autoStatus = next;
          render();
        }
      }
    }).catch(() => {
    });
  }, 15e3);
  setInterval(() => {
    if (screen === "devices" && native.connected && !document.querySelector(".dialog-backdrop")) void call("NATIVE_STATUS").then(async (n) => {
      const info = n.connected ? await call("NATIVE_REQUEST", { op: "status" }).catch(() => null) : null;
      if (JSON.stringify(n) === JSON.stringify(native) && JSON.stringify(info) === JSON.stringify(nativeInfo)) return;
      const focused = document.activeElement;
      const action2 = focused?.dataset.action;
      const id = focused?.dataset.id;
      native = n;
      nativeInfo = info;
      if (!n.connected) nearby = [];
      render();
      if (action2) {
        const buttons = Array.from(app.querySelectorAll("[data-action]"));
        buttons.find((b) => b.dataset.action === action2 && b.dataset.id === id)?.focus({ preventScroll: true });
      }
    }).catch(() => {
    });
  }, 5e3);
})();
