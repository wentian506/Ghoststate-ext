import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
describe('browser-specific manifest hardening',()=>{
 it('requires neither broad host nor cookies permission',()=>{for(const family of ['chromium','firefox']){const m=read(`release/${family}/manifest.json`);expect(m.host_permissions).toBeUndefined();expect(m.permissions).not.toContain('cookies');expect(m.permissions).not.toContain('nativeMessaging');expect(m.optional_permissions).toContain('nativeMessaging');expect(m.externally_connectable).toBeUndefined();expect(m.content_scripts).toBeUndefined();expect(m.content_security_policy.extension_pages).toContain("script-src 'self'");}});
 it('ships the supplied local logo, toolbar icons and licensed offline font in both packages',()=>{
  const version=read('package.json').version;
  expect(readFileSync('apps/dashboard/src/main.ts','utf8')).toContain(`GhostState ${version} <span>`);
  const original=readFileSync('apps/dashboard/assets/ghoststate-logo-original.png');
  expect(createHash('sha256').update(original).digest('hex')).toBe('5ff49f1d1c104f050d128d8e343a0a8739f129e3e01d953e154415cf7b275733');
  const logo=readFileSync('apps/dashboard/assets/ghoststate-logo.png');
  expect(logo.readUInt32BE(16)).toBe(512);expect(logo.readUInt32BE(20)).toBe(512);
  const guide=readFileSync('docs/GhostState_Simple_Guide.html','utf8');
  const guideLogos=[...guide.matchAll(/<img class="logo" src="data:image\/png;base64,([^"]+)"/g)];
  expect(guideLogos).toHaveLength(4);
  for(const match of guideLogos) expect(Buffer.from(match[1],'base64')).toEqual(logo);
  const font=readFileSync('apps/dashboard/assets/inter-latin.woff2');
  for(const family of ['chromium','firefox']) {
   const m=read(`release/${family}/manifest.json`);
   expect(m.version).toBe(version);
   expect(readFileSync(`release/${family}/assets/ghoststate-logo.png`)).toEqual(logo);
   expect(readFileSync(`release/${family}/assets/inter-latin.woff2`)).toEqual(font);
   expect(readFileSync(`release/${family}/assets/INTER-OFL.txt`,'utf8')).toContain('SIL OPEN FONT LICENSE');
   for(const size of [16,48,128]) {
    expect(m.action.default_icon[String(size)]).toBe(`icon${size}.png`);
    const bytes=readFileSync(`release/${family}/icon${size}.png`);
    expect(bytes.readUInt32BE(16)).toBe(size);expect(bytes.readUInt32BE(20)).toBe(size);
    expect(bytes).toEqual(readFileSync(`apps/browser-extension/icon${size}.png`));
   }
  }
 });
 it('keeps the optional native fallback bundled locally and unavailable to websites',()=>{
  for(const family of ['chromium','firefox']) {
   const m=read(`release/${family}/manifest.json`);
   expect(m.web_accessible_resources).toBeUndefined();
   const html=readFileSync(`release/${family}/native-bridge.html`,'utf8');
   expect(html).toContain('<script src="native-bridge.js"></script>');
   expect(html).not.toMatch(/https?:\/\//);
   expect(readFileSync(`release/${family}/native-bridge.js`).length).toBeGreaterThan(300);
  }
 });
 it('uses the correct browser background and Firefox consent declarations',()=>{const c=read('release/chromium/manifest.json'),f=read('release/firefox/manifest.json');expect(c.background.service_worker).toBe('background.js');expect(f.background.scripts).toEqual(['background.js']);expect(f.browser_specific_settings.gecko.id).toBe('ghoststate@local.invalid');expect(f.browser_specific_settings.gecko.data_collection_permissions.optional).toContain('authenticationInfo');});
});
