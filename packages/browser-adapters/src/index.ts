/** Browser-family boundary. Firefox exposes promise-based browser.*, Chromium exposes chrome.*. */
export const extensionApi: typeof chrome | undefined = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser || (typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome : undefined);
export function isExtension(): boolean { return !!extensionApi?.runtime?.id; }
export function runtimeUrl(path: string): string { return extensionApi ? extensionApi.runtime.getURL(path) : path; }
