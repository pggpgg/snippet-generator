// The generated code runs. Each snippet is served as a page on https://www.example.com with a
// stand-in sdk.js that does what the real one does with it: reads window.axeptioSettings and the
// dataLayer at load, drains and patches window._axcb, defines hideAxeptioButton before "ready",
// and lets the test fire "cookies:complete" with the visitor's choices keyed by vendor name.
// Nothing reaches Axeptio: every request is answered by route interception.
import { expect, test } from '@playwright/test';
import { CA_EXCEPT_QC, HOTJAR_TAG, MACKAGE_ID, TCF_ID, fixture, openApp, sg } from './helpers.js';

const mackage = fixture('mackage.json');
const SITE = 'https://www.example.com/';
const NONCE = 'abc123';

const FAKE_SDK = `(function () {
  var handlers = {};
  var settings = window.axeptioSettings || {};
  var layer = window[settings.dataLayerName || 'dataLayer'] || [];
  var copy = function (x) {
    return JSON.parse(JSON.stringify(x, function (k, v) { return typeof v === 'function' ? 'function:' + v() : v; }));
  };
  window.__fake = {
    settings: copy(settings),
    layerAtLoad: layer.map(function (a) { return Array.prototype.slice.call(a); }),
    opened: 0,
    hidden: 0,
    ready: false,
    fire: function (event, payload) { (handlers[event] || []).slice().forEach(function (cb) { cb(payload); }); },
  };
  var api = {
    on: function (event, cb) { (handlers[event] = handlers[event] || []).push(cb); },
    getToken: function () { return 'tok123'; },
  };
  window.openAxeptioCookies = function () { window.__fake.opened++; };
  var queue = window._axcb || [];
  window._axcb = { push: function (cb) { cb(api); } };
  queue.forEach(function (cb) { cb(api); });
  setTimeout(function () {
    window.hideAxeptioButton = function () { window.__fake.hidden++; };
    window.__fake.ready = true;
    window.__fake.fire('ready');
  }, 0);
})();`;

const LINKS =
  '<p><a id="other-site" href="https://shop.example.org/x?a=1">x</a> <a id="same-site" href="https://www.example.com/page">y</a>' +
  ' <a id="outside" href="https://other.net/">z</a> <a id="mail" href="mailto:hello@example.org">m</a></p>';

/** The page a site would serve with the generated head and footer. */
async function runOnSite(context, gen, { lang = 'en', csp = false } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Site</title>\n${gen.head}\n</head><body>${LINKS}\n${gen.footer}\n</body></html>`;
  const headers = { 'content-type': 'text/html; charset=utf-8' };
  if (csp) headers['content-security-policy'] = `script-src 'nonce-${NONCE}' https://static.axept.io https://static.hotjar.com; object-src 'none'; base-uri 'none'`;
  await page.route('https://www.example.com/**', (r) => r.fulfill({ status: 200, headers, body: html }));
  await page.route(/^https:\/\/static\.axept\.io\/(tcf\/)?sdk\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SDK }));
  await page.route('https://static.hotjar.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('https://client.axept.io/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"isEmpty":true}' }));
  await page.goto(SITE);
  await page.waitForFunction(() => window.__fake && window.__fake.ready);
  return { page, errors };
}

/** Builds the states in the app page and returns what generate() wrote for each, in both languages. */
async function generated(page) {
  return sg(
    page,
    (SG, file, id, tcfId, regions, hotjar, nonce) => {
      const loaded = SG.applyProject(SG.makeState({}), SG.projectFromFiles(id, file, null).project);
      const granted = { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' };
      const google = (owner) => ({ ...loaded.google, on: true, owner, optout: { region: regions, values: granted } });
      const full = SG.makeState({
        ...loaded,
        siteUrl: 'https://www.example.com',
        google: google('inline'),
        vendors: loaded.vendors.map((v) => (v.name === 'hotjar' ? { ...v, on: true, code: hotjar } : v)),
        crossDomain: true,
        crossDomains: ['example.com', 'example.org'],
        link: true,
        hideButton: true,
        preconnect: true,
      });
      const states = {
        minimal: SG.makeState({ projectId: id }),
        settingsMode: SG.makeState({ ...loaded, google: google('settings') }),
        full,
        csp: SG.makeState({ ...full, csp: true, nonce }),
        dynamic: SG.makeState({ projectId: id, langs: ['fr', 'en'], pin: 'page', pinCases: [{ lang: 'fr', config: 'CA-QC FR' }, { lang: 'en', config: 'CA-QC EN' }], pinDefault: 'CA-QC EN', dataLayerName: 'myLayer', google: { on: true, owner: 'inline' } }),
        tcf: SG.makeState({ sdk: 'tcf', projectId: tcfId, crossDomain: true, crossDomains: ['example.com', 'example.org'], google: { on: true, owner: 'settings' }, preconnect: true }),
      };
      const out = {};
      for (const [name, s] of Object.entries(states))
        for (const ui of ['en', 'fr']) {
          const g = SG.generate(s, { ui });
          out[`${name}:${ui}`] = { head: g.head, footer: g.footer, settings: g.settings, entries: s.google.on ? SG.gcmEntries(s) : [] };
        }
      return out;
    },
    mackage,
    MACKAGE_ID,
    TCF_ID,
    ['US', ...CA_EXCEPT_QC],
    HOTJAR_TAG,
    NONCE,
  );
}

const gtagArgs = (entries) => entries.map((e) => ['consent', 'default', e]);

test.describe('the generated code runs on a site', () => {
  let out;
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    out = await generated(page);
  });

  for (const ui of ['en', 'fr']) {
    test(`minimal and Consent Mode in axeptioSettings (${ui})`, async ({ context }) => {
      for (const name of ['minimal', 'settingsMode']) {
        const gen = out[`${name}:${ui}`];
        const { page, errors } = await runOnSite(context, gen, { lang: ui });
        const fake = await page.evaluate(() => window.__fake);
        expect(errors, name).toEqual([]);
        expect(fake.settings, name).toEqual(gen.settings);
        expect(fake.layerAtLoad, name).toEqual([]);
        if (name === 'settingsMode') expect(fake.settings.googleConsentMode.default).toEqual(gen.entries);
        await page.close();
      }
    });

    test(`inline Consent Mode, blocked tool, hidden button, footer link, cross-domain (${ui})`, async ({ context }) => {
      const gen = out[`full:${ui}`];
      const { page, errors } = await runOnSite(context, gen, { lang: ui });
      expect(errors).toEqual([]);
      const fake = await page.evaluate(() => window.__fake);
      // The inline block ran before sdk.js: both defaults are already in the dataLayer, in order.
      expect(fake.layerAtLoad).toEqual(gtagArgs(gen.entries));
      expect(gen.entries.length).toBe(2);
      expect(fake.settings).toEqual(gen.settings);
      expect(fake.settings.googleConsentMode).toBeUndefined();
      // hideAxeptioButton exists at "ready", not before: the callback waits for it.
      expect(fake.hidden).toBe(1);

      const hotjar = () => page.evaluate(() => document.querySelectorAll('script[src*="static.hotjar.com"]').length);
      expect(await hotjar()).toBe(0);
      await page.evaluate(() => window.__fake.fire('cookies:complete', { hotjar: false }));
      expect(await hotjar()).toBe(0);
      await page.evaluate(() => window.__fake.fire('cookies:complete', { hotjar: true, $$completed: true }));
      await page.evaluate(() => window.__fake.fire('cookies:complete', { hotjar: true, $$completed: true }));
      expect(await hotjar()).toBe(1);
      expect(await page.evaluate(() => typeof window.hj)).toBe('function');

      // The cross-domain script decorated links to the other site only.
      const hrefs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('p a')].map((a) => [a.id, a.getAttribute('href')])));
      expect(hrefs).toEqual({
        'other-site': 'https://shop.example.org/x?a=1&axeptio_token=tok123',
        'same-site': 'https://www.example.com/page',
        outside: 'https://other.net/',
        mail: 'mailto:hello@example.org',
      });

      // Each footer link reopens the choices without navigating.
      const links = page.locator('body > a');
      await expect(links).toHaveCount(2);
      await links.first().click();
      await links.last().click();
      expect(await page.evaluate(() => window.__fake.opened)).toBe(2);
      expect(page.url()).toBe(SITE);
      expect(errors).toEqual([]);
    });

    test(`the CSP variant runs under a strict nonce policy (${ui})`, async ({ context }) => {
      const gen = out[`csp:${ui}`];
      expect(gen.footer).toContain('axeptio-reopen');
      expect(gen.footer).not.toContain('onclick');
      const { page, errors } = await runOnSite(context, gen, { lang: ui, csp: true });
      const fake = await page.evaluate(() => window.__fake);
      expect(fake.settings.nonce).toBe(NONCE);
      expect(fake.layerAtLoad).toEqual(gtagArgs(gen.entries));
      expect(fake.hidden).toBe(1);
      await page.evaluate(() => window.__fake.fire('cookies:complete', { hotjar: true }));
      expect(await page.evaluate(() => document.querySelectorAll('script[src*="static.hotjar.com"]').length)).toBe(1);
      await page.locator('body > a').first().click();
      expect(await page.evaluate(() => window.__fake.opened)).toBe(1);
      expect(page.url()).toBe(SITE);
      expect(await page.evaluate(() => window.__csp)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`banner picked by page language, custom dataLayer name (${ui})`, async ({ context }) => {
      const gen = out[`dynamic:${ui}`];
      for (const lang of ['fr', 'en']) {
        const { page, errors } = await runOnSite(context, gen, { lang });
        const fake = await page.evaluate(() => window.__fake);
        expect(errors).toEqual([]);
        expect(fake.settings.cookiesVersion).toEqual({
          type: 'custom_function',
          config: { function: `function:${lang}` },
          cases: { fr: 'CA-QC FR', en: 'CA-QC EN', default: 'CA-QC EN' },
        });
        expect(fake.settings.dataLayerName).toBe('myLayer');
        expect(fake.layerAtLoad).toEqual(gtagArgs(gen.entries));
        expect(await page.evaluate(() => window.dataLayer)).toBeUndefined();
        await page.close();
      }
    });

    test(`TCF: module loader, Consent Mode and shared domains in the settings (${ui})`, async ({ context }) => {
      const gen = out[`tcf:${ui}`];
      const { page, errors } = await runOnSite(context, gen, { lang: ui });
      const fake = await page.evaluate(() => window.__fake);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.querySelector('script[src$="/tcf/sdk.js"]').type)).toBe('module');
      expect(fake.settings).toEqual(gen.settings);
      expect(fake.settings.userCrossCookiesDomain).toEqual(['example.com', 'example.org']);
      expect(fake.settings.googleConsentMode.default).toEqual(gen.entries);
    });
  }
});
