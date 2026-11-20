"use strict";
(() => {
  // packages/browser-adapters/src/index.ts
  var extensionApi = globalThis.browser || (typeof chrome !== "undefined" && chrome.runtime?.id ? chrome : void 0);

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

  // apps/browser-extension/src/popup.ts
  document.documentElement.dataset.theme = localStorage.getItem("ghoststate-theme") === "dark" ? "dark" : "light";
  var status = document.querySelector("#popup-status");
  var select = document.querySelector("#use-site");
  var open = document.querySelector("#open-dashboard");
  var current = null;
  select.disabled = true;
  void extensionApi.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.id || !tab.url) throw new Error("Open a supported site and click the toolbar button again.");
    current = { tabId: tab.id, origin: canonicalOrigin(tab.url) };
    select.disabled = false;
  }).catch((e) => {
    status.textContent = e instanceof Error ? e.message : "Could not select this site.";
  });
  select.addEventListener("click", async () => {
    try {
      if (!current) throw new Error("Open a supported site first.");
      const { tabId, origin } = current;
      const u = new URL(origin);
      const granted = await extensionApi.permissions.request({ origins: [`${u.protocol}//${u.hostname}/*`] });
      if (!granted) throw new Error("Site access was not granted.");
      const result = await extensionApi.runtime.sendMessage({ type: "SELECT_TAB", payload: { tabId, origin } });
      if (!result.ok) throw new Error(result.error);
      status.textContent = `Selected ${origin}.`;
      await extensionApi.tabs.create({ url: extensionApi.runtime.getURL("dashboard.html") });
      window.close();
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : "Could not select this site.";
    }
  });
  open.addEventListener("click", () => {
    void extensionApi.tabs.create({ url: extensionApi.runtime.getURL("dashboard.html") });
    window.close();
  });
})();
