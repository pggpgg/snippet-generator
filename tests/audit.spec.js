// SPEC 7: every audit rule, with the input that triggers it and the severity it must have.
import { expect, test } from '@playwright/test';
import { LOADER_BRANDS, LOADER_TCF, MACKAGE_ID, fixture, openApp, sg } from './helpers.js';

const mackage = fixture('mackage.json');
const wrap = (settings, loader = LOADER_BRANDS) => `<script>\nwindow.axeptioSettings = ${settings};\n${loader}\n</script>`;

let project;
let geoOff;
let noGcm;
let restricted;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await openApp(page);
  project = await sg(page, (SG, file, id) => SG.projectFromFiles(id, file, null).project, mackage, MACKAGE_ID);
  geoOff = { ...project, geo: false };
  noGcm = { ...project, configs: project.configs.map((c) => ({ ...c, gcm: false })) };
  restricted = { ...project, restriction: true, domains: ['mackage.com'] };
  await page.close();
});

/** "ID:kind:severity" for each finding. */
async function run(page, text, ctx = {}) {
  const r = await sg(page, (SG, text, ctx) => SG.audit(text, ctx), text, ctx);
  return r.findings.map((f) => [f.id, f.kind, f.severity].filter(Boolean).join(':'));
}

test.describe('audit rules', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test('A1 cookiesVersion: warning, error when location-based display is on and it matches no banner', async ({ page }) => {
    const text = wrap(`{ clientId: "${MACKAGE_ID}", cookiesVersion: "EU FR" }`);
    expect(await run(page, text)).toContain('A1:warning');
    expect(await run(page, text, { project })).toContain('A1:warning');
    expect(await run(page, wrap(`{ clientId: "${MACKAGE_ID}", cookiesVersion: "Old banner" }`), { project })).toContain('A1:error');
    expect(await run(page, wrap(`{ clientId: "${MACKAGE_ID}", cookiesVersion: "Old banner" }`), { project: geoOff })).toContain('A1:warning');
    const dynamic = wrap(`{ clientId: "${MACKAGE_ID}", cookiesVersion: { type: "browser_locale", cases: { fr: "EU FR", default: "EU EN" } } }`);
    const r = await sg(page, (SG, t) => SG.audit(t).findings.find((f) => f.id === 'A1'), dynamic);
    expect(r.data.dynamic).toBe('browser_locale');
  });

  test('A2 loaded twice, A3 module type, A7 sdk-slim', async ({ page }) => {
    const twice = `${wrap(`{ clientId: "${MACKAGE_ID}" }`)}\n<script src="https://static.axept.io/tcf/sdk.js" type="module"></script>`;
    expect(await run(page, twice)).toContain('A2:error');
    expect(await run(page, wrap(`{ clientId: "${MACKAGE_ID}" }`, LOADER_TCF.replace(' e.type = "module";', '')))).toContain('A3:tcfNoModule:error');
    expect(await run(page, wrap(`{ clientId: "${MACKAGE_ID}" }`, LOADER_BRANDS.replace('e.async = true;', 'e.async = true; e.type = "module";')))).toContain('A3:brandsModule:error');
    expect(await run(page, wrap(`{ clientId: "${MACKAGE_ID}" }`, LOADER_BRANDS.replace('sdk.js', 'sdk-slim.js')))).toContain('A7:info');
    expect(await run(page, wrap(`{ clientId: "${MACKAGE_ID}" }`))).toEqual([]);
  });

  test('A4 misspelled, unknown, internal and TCF-ignored keys', async ({ page }) => {
    const r = await sg(
      page,
      (SG, text) => SG.audit(text).findings.filter((f) => f.id === 'A4').map((f) => [f.kind, f.data.key, f.data.suggestion || null, f.severity]),
      wrap(`{ clientId: "${MACKAGE_ID}", cookieVersion: "x", useDocumentLanguage: true, userCookieDomain: "example.com", clientID: "y", somethingElse: 1, countryCode: "CA" }`),
    );
    expect(r).toEqual(
      expect.arrayContaining([
        ['typo', 'cookieVersion', 'cookiesVersion', 'warning'],
        ['typo', 'useDocumentLanguage', 'useDocumentLang', 'warning'],
        ['typo', 'userCookieDomain', 'userCookiesDomain', 'warning'],
        ['typo', 'clientID', 'clientId', 'warning'],
        ['unknown', 'somethingElse', null, 'info'],
        ['internal', 'countryCode', null, 'warning'],
      ]),
    );
    const tcf = await run(page, wrap(`{ clientId: "${MACKAGE_ID}", useDocumentLang: true, userCookiesDuration: 30, jsonCookieName: "x", dataLayerName: "dl" }`, LOADER_TCF));
    expect(tcf.filter((x) => x === 'A4:tcf:warning')).toHaveLength(3);
  });

  test('A5 clientId: missing, invalid, dynamic, projectId with sdk.js, another project', async ({ page }) => {
    expect(await run(page, wrap('{ useDocumentLang: true }'))).toContain('A5:missing:error');
    expect(await run(page, wrap('{ clientId: "PROJECT_ID" }'))).toContain('A5:invalid:error');
    expect(await run(page, wrap('{ clientId: window.MY_ID }'))).toContain('A5:dynamic:info');
    expect(await run(page, wrap(`{ projectId: "${MACKAGE_ID}" }`))).toContain('A5:projectId:error');
    expect(await run(page, wrap(`{ projectId: "${MACKAGE_ID}" }`, LOADER_TCF))).not.toContain('A5:projectId:error');
    expect(await run(page, wrap('{ clientId: "aaaaaaaaaaaaaaaaaaaaaaaa" }'), { project })).toContain('A5:mismatch:warning');
  });

  test('A6 bad values', async ({ page }) => {
    const r = (s, ctx) => run(page, wrap(`{ clientId: "${MACKAGE_ID}", ${s} }`), ctx);
    expect(await r('userCookiesDomain: "https://example.com/"')).toContain('A6:domain:error');
    expect(await r('userCookiesDomain: ".example.com"')).toContain('A6:domain:warning');
    expect(await r('userCookiesDomain: "www.example.com"')).toContain('A6:domain:warning');
    expect(await r('userCookiesDomain: "example.com"', { siteUrl: 'https://shop.other.com' })).toContain('A6:domainHost:error');
    expect(await r('userCookiesDomain: "example.com"', { siteUrl: 'https://shop.example.com' })).toEqual([]);
    expect(await r('userCookiesSecure: false')).toContain('A6:secure:warning');
    expect(await r('triggerGTMEvents: "yes"')).toContain('A6:gtmEvents:error');
    expect(await r('triggerGTMEvents: "update_only"')).toEqual([]);
    expect(await r('userCookiesDuration: "forever"')).toContain('A6:duration:warning');
    expect(await r('userCookiesDuration: "session"')).toEqual([]);
    expect(await r('userCookiesSameSite: "lax"')).toEqual([]);
    expect(await r('userCookiesSameSite: "Sometimes"')).toContain('A6:sameSite:warning');
    expect(await r('userCookiesSameSite: "None", userCookiesSecure: false')).toContain('A6:sameSiteNone:warning');
  });

  test('G1 defaults declared without the Consent Mode step', async ({ page }) => {
    const text = wrap(`{ clientId: "${MACKAGE_ID}", googleConsentMode: { default: [{ analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" }] } }`);
    expect(await run(page, text, { project: noGcm })).toContain('G1:error');
    expect(await run(page, text, { project: { ...project, configs: project.configs.map((c, i) => ({ ...c, gcm: i !== 0 })) } })).toContain('G1:warning');
    expect(await run(page, text, { project })).not.toContain('G1:error');
    expect(await run(page, text)).not.toContain('G1:error');
  });

  test('G2 Google before Axeptio, config before default, and the async race', async ({ page }) => {
    const gtm = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-XXXX');</script>`;
    const axeptio = wrap(`{ clientId: "${MACKAGE_ID}" }`);
    expect(await run(page, `${gtm}\n${axeptio}`)).toContain('G2:googleFirst:error');
    expect(await run(page, `${axeptio}\n${gtm}`)).not.toContain('G2:googleFirst:error');
    const settingsDefaults = wrap(`{ clientId: "${MACKAGE_ID}", googleConsentMode: { default: { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" } } }`);
    const config = `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('config','G-1');</script>`;
    expect(await run(page, `${settingsDefaults}\n${config}`)).toContain('G2:race:warning');
    const inline = `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});gtag('config','G-1');</script>`;
    expect((await run(page, `${inline}\n${axeptio}`)).filter((x) => x.startsWith('G2'))).toEqual([]);
  });

  test('G3 defaults set twice', async ({ page }) => {
    const inline = `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});</script>`;
    const settings = wrap(`{ clientId: "${MACKAGE_ID}", googleConsentMode: { default: { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" } } }`);
    expect(await run(page, `${inline}\n${settings}`)).toContain('G3:warning');
  });

  test('G4 Consent Mode shape errors', async ({ page }) => {
    const gcm = (d, extra = '') => wrap(`{ clientId: "${MACKAGE_ID}", googleConsentMode: { default: ${d}${extra} } }`);
    const all = 'analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied"';
    expect(await run(page, gcm(`[{ ${all.replace('"denied"', '"yes"')} }]`))).toContain('G4:value:error');
    const typo = await sg(page, (SG, t) => SG.audit(t).findings.find((f) => f.id === 'G4' && f.kind === 'type').data, gcm(`[{ ${all}, ads_storage: "denied" }]`));
    expect(typo).toMatchObject({ type: 'ads_storage', suggestion: 'ad_storage' });
    expect(await run(page, gcm(`[{ ${all} }, { ${all}, region: "US" }]`))).toContain('G4:regionType:error');
    const regions = await sg(
      page,
      (SG, t) => SG.audit(t).findings.filter((f) => f.kind === 'region').map((f) => [f.data.code, f.data.issue, f.data.fixed]),
      gcm(`[{ ${all} }, { ${all}, region: ["us-ca", "US-PR", "UK", "CA-XX", "ZZ"] }]`),
    );
    expect(regions).toEqual([
      ['us-ca', 'lowercase', 'US-CA'],
      ['US-PR', 'territory', 'PR'],
      ['UK', 'alias', 'GB'],
      ['CA-XX', 'unknownSubdivision', null],
      ['ZZ', 'unknownCountry', null],
    ]);
    expect(await run(page, gcm(`[{ ${all}, region: ["US"] }]`))).toContain('G4:noFallback:warning');
    expect(await run(page, gcm(`[{ ${all} }]`, ', url_passthrough: false'))).toContain('G4:passthrough:info');
    expect(await run(page, gcm('{ analytics_storage: "denied" }'))).toContain('G4:partial:info');
    expect(await run(page, gcm(`[{ ${all}, wait_for_update: "soon" }]`))).toContain('G4:wait:warning');
  });

  test('X1 cross-domain lists', async ({ page }) => {
    const script = (list) => `<script>window._axcb=window._axcb||[];window._axcb.push(function(axeptio){axeptio.on("cookies:complete",function(){var sharedConsentDomains=${JSON.stringify(list)};});});</script>`;
    const base = wrap(`{ clientId: "${MACKAGE_ID}" }`);
    expect(await run(page, `${base}\n${script(['maboutique.com', 'https://www.monblog.com'])}`, { siteUrl: 'https://maboutique.com' })).toContain('X1:format:error');
    expect(await run(page, `${base}\n${script(['maboutique.com', 'monblog.com'])}`, { siteUrl: 'https://www.autre.com' })).toContain('X1:missing:error');
    expect(await run(page, `${base}\n${script(['maboutique.com', 'monblog.com'])}`)).toContain('X1:unknown:info');
    expect(await run(page, `${base}\n${script(['maboutique.com', 'monblog.com'])}`, { siteUrl: 'https://www.monblog.com' })).toEqual([]);
    expect(await run(page, `${base}\n${script(['a.com', 'b.com'])}\n${script(['a.com', 'c.com'])}`, { siteUrl: 'https://a.com' })).toContain('X1:differ:error');
  });

  test('P1 domain restriction, P2 location-based display off', async ({ page }) => {
    const base = wrap(`{ clientId: "${MACKAGE_ID}" }`);
    expect(await run(page, base, { project: restricted, siteUrl: 'https://www.mackage.com' })).not.toContain('P1:error');
    expect(await run(page, base, { project: restricted, siteUrl: 'https://www.mackage.ca' })).toContain('P1:error');
    expect(await run(page, base, { project: geoOff })).toContain('P2:warning');
    expect(await run(page, wrap(`{ clientId: "${MACKAGE_ID}", cookiesVersion: "EU FR" }`), { project: geoOff })).not.toContain('P2:warning');
  });

  test('N1 notes: no loader, data-id tag read like the SDK does', async ({ page }) => {
    expect(await run(page, '<p>Hello</p>')).toContain('N1:noLoader:info');
    const tag = `<script data-id="${MACKAGE_ID}" data-cookies-version="Old" src="https://static.axept.io/sdk.js"></script>`;
    const r = await run(page, tag, { project });
    expect(r).toContain('N1:dataId:info');
    expect(r).toContain('A1:error');
  });

  test('findings are sorted errors first and carry their copy', async ({ page }) => {
    const r = await sg(page, (SG, t) => SG.audit(t, { ui: 'fr' }).findings, `<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>${wrap('{ clientId: "x", foo: 1 }')}`);
    const order = { error: 0, warning: 1, info: 2 };
    for (let i = 1; i < r.length; i++) expect(order[r[i - 1].severity]).toBeLessThanOrEqual(order[r[i].severity]);
    for (const f of r) expect(f.title && f.why && f.fix).toBeTruthy();
    expect(r[0].title).toMatch(/[àâçéèêëîïôûùüÿœ]|Axeptio|clientId/);
  });
});
