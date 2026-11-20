"use strict";
(() => {
  // packages/browser-adapters/src/index.ts
  var extensionApi = globalThis.browser || (typeof chrome !== "undefined" && chrome.runtime?.id ? chrome : void 0);

  // apps/browser-extension/src/native-bridge.ts
  if (!extensionApi) throw new Error("GhostState extension context is required.");
  var browserApi = extensionApi;
  var challenge = location.hash.slice(1);
  if (!/^[a-f0-9]{32}$/.test(challenge)) throw new Error("A local dashboard challenge is required.");
  var relay = browserApi.runtime.connect({ name: `ghoststate.native-bridge.v1:${challenge}` });
  var allowed = /* @__PURE__ */ new Set(["status", "discover", "listen", "stop_listen", "pair", "confirm_pair", "cancel_pair", "incoming", "reject_transfer", "send_grant", "accept_transfer"]);
  var host = null;
  var closed = false;
  var armed = false;
  function fail(reason) {
    if (closed) return;
    closed = true;
    try {
      relay.postMessage({ bridgeError: reason.slice(0, 300) });
    } catch {
    }
    try {
      relay.disconnect();
    } catch {
    }
    try {
      host?.disconnect();
    } catch {
    }
  }
  relay.onDisconnect.addListener(() => {
    void browserApi.runtime.lastError;
    if (closed) return;
    closed = true;
    try {
      host?.disconnect();
    } catch {
    }
  });
  relay.onMessage.addListener((message) => {
    if (closed || !message || typeof message !== "object") return;
    if (message.bridgeArm === true && !armed) {
      armed = true;
      void start().catch(() => fail("Could not start the companion bridge."));
      return;
    }
    if (!host) return;
    const req = message.bridgeRequest;
    if (!req || typeof req !== "object") return fail("Invalid internal companion request.");
    const r = req;
    if (!Number.isSafeInteger(r.id) || typeof r.op !== "string" || !allowed.has(r.op) || !r.payload || typeof r.payload !== "object" || Array.isArray(r.payload)) return fail("Invalid internal companion request.");
    try {
      host.postMessage(req);
    } catch {
      fail("Could not send to the companion.");
    }
  });
  async function start() {
    const granted = await browserApi.permissions.contains({ permissions: ["nativeMessaging"] });
    if (closed) return;
    if (!granted) return fail("Native messaging permission was not granted.");
    if (typeof browserApi.runtime.connectNative !== "function") return fail("This browser did not enable native messaging. Restart the browser and try again.");
    host = browserApi.runtime.connectNative("com.ghoststate.bridge");
    host.onMessage.addListener((message) => {
      if (!closed) {
        try {
          relay.postMessage({ nativeMessage: message });
        } catch {
          fail("Companion bridge disconnected.");
        }
      }
    });
    host.onDisconnect.addListener(() => fail(browserApi.runtime.lastError?.message || "Companion disconnected."));
    if (!closed) relay.postMessage({ bridgeReady: true });
  }
})();
