// Pure logic: the tolerant parser, domains, regions, vendor tags, minimal-code rule, generation details.
import { expect, test } from '@playwright/test';
import { LOADER_BRANDS, MACKAGE_ID, fixture, openApp, sg } from './helpers.js';

const mackage = fixture('mackage.json');

test.describe('logic', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('the parser reads loose object literals without running them', async ({ page }) => {
    const settings = await sg(
      page,
      (SG, text) => SG.parse(text).merged,
      `<script>
      // a comment
      window.axeptioSettings = {
        clientId: '${MACKAGE_ID}', /* block comment */
        "cookiesVersion": {
          type: "custom_function",
          config: { function: function () { return document.documentElement.lang; } },
          cases: { 'fr': "EU FR", default: "EU EN", },
        },
        userCookiesDuration: 0x10,
        nested: { list: [1, -2, 'three', [true, null]], tpl: \`plain\` },
        computed: window.location.hostname,
        arrow: () => { return 1; },
      };
      window.axeptioSettings.useDocumentLang = true;
      window.axeptioSettings["dataLayerName"] = 'myLayer';
      </script>`,
    );
    expect(settings.clientId).toBe(MACKAGE_ID);
    expect(settings.cookiesVersion.type).toBe('custom_function');
    expect(settings.cookiesVersion.config.function.$raw).toBe('function () { return document.documentElement.lang; }');
    expect(settings.cookiesVersion.cases).toEqual({ fr: 'EU FR', default: 'EU EN' });
    expect(settings.userCookiesDuration).toBe(16);
    expect(settings.nested).toEqual({ list: [1, -2, 'three', [true, null]], tpl: 'plain' });
    expect(settings.computed).toEqual({ $raw: 'window.location.hostname' });
    expect(settings.arrow.$raw).toBe('() => { return 1; }');
    expect(settings.useDocumentLang).toBe(true);
    expect(settings.dataLayerName).toBe('myLayer');
  });

  test('the parser finds loaders, Google scripts and gtag calls in order, even minified', async ({ page }) => {
    const parsed = await sg(
      page,
      (SG, text) => {
        const p = SG.parse(text);
        return { loaders: p.loaders.map((l) => [l.kind, l.module, l.external]), google: p.google.map((g) => g.kind), configs: p.gtag.configs.length, defaults: p.gtag.defaults.map((d) => d.entry), sets: p.gtag.sets.map((s) => [s.key, s.value]) };
      },
      `<script src="https://www.googletagmanager.com/gtag/js?id=AW-1" async></script><script>gtag('consent','default',{ad_storage:'denied'});gtag('set','url_passthrough',true);gtag('config','AW-1')</script><script src='//static.axept.io/tcf/sdk.js' type=module></script><script>var x="/* not a comment */ //static.axept.io/sdk.js";</script>`,
    );
    expect(parsed.loaders).toEqual([['tcf', true, true], ['brands', false, false]]);
    expect(parsed.google).toEqual(['gtagjs']);
    expect(parsed.configs).toBe(1);
    expect(parsed.defaults).toEqual([{ ad_storage: 'denied' }]);
    expect(parsed.sets).toEqual([['url_passthrough', true]]);
  });

  test('regex literals and division do not confuse the tokenizer', async ({ page }) => {
    const settings = await sg(page, (SG, t) => SG.parse(t).merged, `<script>var a = 4 / 2, r = /}"'/g; window.axeptioSettings = { clientId: "${MACKAGE_ID}", x: a / 2 };</script>`);
    expect(settings.clientId).toBe(MACKAGE_ID);
    expect(settings.x).toEqual({ $raw: 'a / 2' });
  });

  test('registrable domains handle two-level suffixes and say when unsure', async ({ page }) => {
    const r = await sg(page, (SG) =>
      ['www.example.com', 'shop.example.co.uk', 'www.example.com.au', 'www.ville.qc.ca', 'www.canada.gc.ca', 'a.b.example.fr', 'example.co.zz', 'localhost', '192.168.0.1'].map((h) => {
        const d = SG.registrableDomain(h);
        return [h, d.domain, d.sure];
      }),
    );
    expect(r).toEqual([
      ['www.example.com', 'example.com', true],
      ['shop.example.co.uk', 'example.co.uk', true],
      ['www.example.com.au', 'example.com.au', true],
      ['www.ville.qc.ca', 'ville.qc.ca', true],
      ['www.canada.gc.ca', 'canada.gc.ca', true],
      ['a.b.example.fr', 'example.fr', true],
      ['example.co.zz', 'example.co.zz', false],
      ['localhost', null, false],
      ['192.168.0.1', null, false],
    ]);
  });

  test('userCookiesDomain is derived from the site address, cleaned when typed', async ({ page }) => {
    const r = await sg(page, (SG) => [
      SG.generate(SG.makeState({ siteUrl: 'https://boutique.exemple.qc.ca/panier', subdomains: true })).settings.userCookiesDomain,
      SG.generate(SG.makeState({ subdomains: true, cookieDomain: 'https://www.Example.com/' })).settings.userCookiesDomain,
      SG.generate(SG.makeState({ subdomains: true })).settings.userCookiesDomain,
      SG.cleanDomain(' https://www.monblog.com/a ').issues,
    ]);
    expect(r).toEqual(['exemple.qc.ca', 'example.com', 'YOUR_DOMAIN', ['space', 'protocol', 'path', 'www']]);
  });

  test('region codes: presets, fixes, and only valid codes are written', async ({ page }) => {
    const entries = await sg(page, (SG) =>
      SG.gcmEntries(SG.makeState({ google: { on: true, optout: { region: ['us', 'US-PR', 'UK', 'CA-XX', 'US'], values: { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' } }, extra: [{ region: ['CA-QC'], values: { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' } }] } })),
    );
    expect(entries).toEqual([
      { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 },
      { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', region: ['US', 'PR', 'GB'] },
      { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500, region: ['CA-QC'] },
    ]);
    const suggest = await sg(page, (SG, file, id) => SG.suggestOptOutRegions(SG.projectFromFiles(id, file, null).project), mackage, MACKAGE_ID);
    expect(suggest).toEqual(['US', 'CA-AB', 'CA-BC', 'CA-MB', 'CA-NB', 'CA-NL', 'CA-NS', 'CA-NT', 'CA-NU', 'CA-ON', 'CA-PE', 'CA-SK', 'CA-YT']);
  });

  test('useDocumentLang: written only when the SDK can pick a banner by language', async ({ page }) => {
    const r = await sg(
      page,
      (SG, file, id) => {
        const project = SG.projectFromFiles(id, file, null).project;
        const loaded = SG.applyProject(SG.makeState({}), project);
        const d = (s) => SG.languageDecision(SG.makeState(s)).reason;
        return [
          d({ ...loaded }),
          d({ ...loaded, htmlLang: 'no' }),
          d({ ...loaded, project: { ...project, geo: false } }),
          d({ ...loaded, langs: ['fr'] }),
          d({ langs: ['fr', 'en'] }),
          d({ langs: ['fr', 'en'], pin: 'browser' }),
          d({ sdk: 'tcf', langs: ['fr', 'en'] }),
          d({ langLogic: 'page' }),
          SG.languageDecision(SG.makeState(loaded)).pairs,
        ];
      },
      mackage,
      MACKAGE_ID,
    );
    expect(r.slice(0, 8)).toEqual(['pageProject', 'html', 'geoOff', 'single', 'pageManual', 'pinBrowser', 'tcf', 'forcedPage']);
    expect(r[8]).toEqual([['CA-QC EN', 'CA-QC FR'], ['EU EN', 'EU FR']]);
  });

  test('cookiesVersion: never added unless asked, then string or dynamic object', async ({ page }) => {
    const r = await sg(page, (SG) => [
      SG.generate(SG.makeState({ langs: ['fr', 'en'] })).settings.cookiesVersion,
      SG.generate(SG.makeState({ pin: 'config', pinConfig: 'EU FR' })).settings.cookiesVersion,
      SG.generate(SG.makeState({ pin: 'page', pinCases: [{ lang: 'fr', config: 'site-fr' }, { lang: 'en', config: 'site-en' }], pinDefault: 'site-en' })).head,
      SG.generate(SG.makeState({ pin: 'browser', pinCases: [{ lang: 'fr', config: 'site-fr' }], pinDefault: 'site-en' })).settings.cookiesVersion,
    ]);
    expect(r[0]).toBeUndefined();
    expect(r[1]).toBe('EU FR');
    expect(r[2]).toContain(
      'cookiesVersion: {\n    type: "custom_function",\n    config: { function: function () { return document.documentElement.lang; } },\n    cases: { "fr": "site-fr", "en": "site-en", "default": "site-en" }\n  },',
    );
    expect(r[3]).toEqual({ type: 'browser_locale', cases: { fr: 'site-fr', default: 'site-en' } });
  });

  test('minimal code: only what differs from the SDK default, unless pinned', async ({ page }) => {
    const r = await sg(page, (SG) => [
      SG.generate(SG.makeState({ duration: '190', secure: true, gtmEvents: 'true', dataLayerName: 'dataLayer' })).settings,
      SG.generate(SG.makeState({ duration: '365', secure: false, gtmEvents: 'update_only', dataLayerName: 'dl' })).settings,
      SG.generate(SG.makeState({ expert: { set: { jsonCookieName: 'axeptio_cookies', mountClassName: 'x' }, pin: ['userCookiesSecure'], custom: [{ key: 'extra', value: '[1, "a"]' }] } })).settings,
    ]);
    expect(r[0]).toEqual({ clientId: 'PROJECT_ID' });
    expect(r[1]).toEqual({ clientId: 'PROJECT_ID', userCookiesDuration: 365, userCookiesSecure: false, triggerGTMEvents: 'update_only', dataLayerName: 'dl' });
    expect(r[2]).toEqual({ clientId: 'PROJECT_ID', userCookiesSecure: true, mountClassName: 'x', extra: [1, 'a'] });
  });

  test('TCF drops the keys tcf/sdk.js ignores, and mode B follows a custom dataLayer', async ({ page }) => {
    const r = await sg(page, (SG) => {
      const tcf = SG.generate(SG.makeState({ sdk: 'tcf', duration: '30', langLogic: 'page', expert: { set: { jsonCookieName: 'x', metadataPrefix: '@@' } } }));
      const b = SG.generate(SG.makeState({ dataLayerName: 'myLayer', google: { on: true, owner: 'inline', redaction: true, passthrough: true } }));
      return { settings: tcf.settings, dropped: tcf.dropped, gcm: b.blocks.find((x) => x.id === 'gcm').code };
    });
    expect(r.settings).toEqual({ clientId: 'PROJECT_ID', metadataPrefix: '@@' });
    expect(r.dropped).toEqual(['userCookiesDuration', 'jsonCookieName']);
    expect(r.gcm).toContain('window.myLayer = window.myLayer || [];\nfunction gtag(){myLayer.push(arguments);}');
    expect(r.gcm).toContain("gtag('set', 'ads_data_redaction', true);\ngtag('set', 'url_passthrough', true);");
  });

  test('vendor tags: external scripts, chains, globals, noscript, and </script> in strings', async ({ page }) => {
    const r = await sg(page, (SG) => {
      const gtag = `<script async src="https://www.googletagmanager.com/gtag/js?id=AW-1"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n  gtag('config', 'AW-1');\n</script>\n<noscript><img src="https://px.example/1.gif"></noscript>`;
      const tricky = `<script>document.body.insertAdjacentHTML("beforeend", "<script src='x.js'><\\/script>"); var a = "</scr" + "ipt>";</script>`;
      const s = SG.makeState({ vendors: [{ name: 'google_ads', title: 'Google Ads', on: true, code: gtag }, { name: 'shopify.com', title: 'Shopify', on: true, code: tricky }] });
      return { code: SG.generate(s).blocks.find((b) => b.id === 'callbacks').code, split: SG.splitVendorTag(gtag) };
    });
    expect(r.split.notes).toEqual(['external', 'noscript']);
    expect(r.split.globals).toEqual(['gtag']);
    expect(r.code).toContain('var s = document.createElement("script");\n        s.src = "https://www.googletagmanager.com/gtag/js?id=AW-1";');
    expect(r.code).toContain('s.onload = function () {');
    expect(r.code).toContain('window.gtag = gtag; // kept global, as in the original tag');
    expect(r.code).toContain('if (choices["shopify.com"]) {');
    expect(r.code).not.toMatch(/<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/);
    expect(r.code.match(/<\/script>/g)).toHaveLength(1);
  });

  test('CSP nonce: on every generated script, in axeptioSettings, and the link avoids inline handlers', async ({ page }) => {
    const out = await sg(page, (SG) =>
      SG.generate(SG.makeState({ csp: true, nonce: '{{ n }}', link: true, hideButton: true, google: { on: true, owner: 'inline' }, vendors: [{ name: 'x', title: 'X', on: true, code: '<script src="https://x.example/x.js"></script>' }] })),
    );
    const all = `${out.head}\n${out.footer}`;
    expect(all.match(/<script>/g)).toBeNull();
    expect(all.match(/<script nonce="\{\{ n \}\}">/g).length).toBe(4);
    expect(out.settings.nonce).toBe('{{ n }}');
    expect(out.footer).not.toContain('onclick');
    expect(out.footer).toContain('class="axeptio-reopen"');
    expect(out.head).toContain('if (axeptioNonce) { s.nonce = axeptioNonce; }');
  });

  test('footer link: one per site language, and hiding the button hooks the ready event', async ({ page }) => {
    const out = await sg(page, (SG) => SG.generate(SG.makeState({ langs: ['fr', 'en'], hideButton: true })));
    expect(out.footer).toBe(
      [
        '<!-- Reopens the cookie choices -->',
        '<!-- French pages -->',
        '<a href="#" onclick="if (window.openAxeptioCookies) { window.openAxeptioCookies(); } return false;">Gérer mes cookies</a>',
        '<!-- English pages -->',
        '<a href="#" onclick="if (window.openAxeptioCookies) { window.openAxeptioCookies(); } return false;">Manage cookies</a>',
      ].join('\n'),
    );
    expect(out.head).toContain('axeptio.on("ready", function () {');
    expect(out.head).toContain('window.hideAxeptioButton();');
    const tcf = await sg(page, (SG) => SG.generate(SG.makeState({ sdk: 'tcf', hideButton: true })));
    expect(tcf.head).not.toContain('hideAxeptioButton');
    expect(tcf.footer).toBe('');
  });

  test('state checks: placeholders, missing pieces, G1, P1, P2', async ({ page }) => {
    const r = await sg(
      page,
      (SG, file, id) => {
        const project = SG.projectFromFiles(id, file, null).project;
        const ids = (s) => SG.checkState(SG.makeState(s)).map((c) => [c.id, c.kind, c.severity].filter(Boolean).join(':'));
        return [
          ids({}),
          ids({ projectId: id, subdomains: true, csp: true, vendors: [{ name: 'x', on: true, code: '' }] }),
          ids({ projectId: id, project: { ...project, configs: project.configs.map((c) => ({ ...c, gcm: false })) }, google: { on: true } }),
          ids({ projectId: id, project: { ...project, restriction: true, domains: ['mackage.com'] }, siteUrl: 'https://www.mackage.ca' }),
          ids({ projectId: id, project: { ...project, geo: false } }),
          ids({ projectId: id, project, pin: 'config', pinConfig: 'Nope' }),
          ids({ projectId: id, siteUrl: 'https://shop.example.com', subdomains: true, cookieDomain: 'other.com' }),
        ];
      },
      mackage,
      MACKAGE_ID,
    );
    expect(r).toEqual([
      ['N1:id:warning'],
      ['N1:domain:warning', 'N1:vendorCode:warning', 'N1:nonce:warning'],
      ['G1:error'],
      ['P1:error'],
      ['P2:warning'],
      ['A1:warning'],
      ['A6:domainHost:error'],
    ]);
  });

  test('a project with both a standard and a TCF file, or TCF only, or nothing', async ({ page }) => {
    const tcf = fixture('tcf-dev.json');
    const r = await sg(
      page,
      (SG, b, t, id) => [
        SG.projectFromFiles(id, b, t).project.sdk,
        SG.projectFromFiles(id, { isEmpty: true }, t).project.sdk,
        SG.projectFromFiles(id, { projectId: id, cookies: [] }, t).project.tcfConfigs.map((c) => c.sub),
        SG.projectFromFiles(id, { isEmpty: true }, { isEmpty: true }).error,
        SG.projectFromFiles(id, { projectId: id, cookies: [] }, { isEmpty: true }).error,
        SG.projectFromFiles(id, { hello: 1 }, null).error,
      ],
      mackage,
      tcf,
      MACKAGE_ID,
    );
    expect(r).toEqual(['both', 'tcf', [['CA-QC']], 'notFound', 'empty', 'invalid']);
  });

  test('highlighting escapes HTML and marks tokens', async ({ page }) => {
    const html = await sg(page, (SG, loader) => SG.highlight(`<script>\nwindow.axeptioSettings = { clientId: "<b>" };\n${loader}\n</script>`), LOADER_BRANDS);
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('<span class="tk-p">clientId</span>');
    expect(html).toContain('<span class="tk-k">function</span>');
    expect(html).toContain('e.async');
  });
});
