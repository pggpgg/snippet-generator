// Acceptance test 9: every UI string and every generated comment exists in both languages,
// reads cleanly, and never uses an em dash (house style: periods, commas, colons, parentheses).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { AUDIT_7, CA_EXCEPT_QC, HOTJAR_TAG, MACKAGE_ID, fixture, openApp, sg } from './helpers.js';

const mackage = fixture('mackage.json');
const DASHES = /[—―]|\s–\s/; // em dash, horizontal bar, spaced en dash
const BROKEN = /undefined|NaN|\[object|\bnull\b(?!,)|\s{2,}/;

test.describe('copy (FR / EN)', () => {
  test('9. both languages have exactly the same keys, and every string is filled', async ({ page }) => {
    await openApp(page);
    const report = await sg(page, (SG) => {
      const problems = [];
      const walk = (en, fr, path) => {
        const te = Array.isArray(en) ? 'array' : typeof en;
        const tf = Array.isArray(fr) ? 'array' : typeof fr;
        if (te !== tf) return problems.push(`${path}: ${te} vs ${tf}`);
        if (te === 'object') {
          const ke = Object.keys(en).sort();
          const kf = Object.keys(fr).sort();
          for (const k of ke) if (!kf.includes(k)) problems.push(`${path}.${k}: missing in FR`);
          for (const k of kf) if (!ke.includes(k)) problems.push(`${path}.${k}: missing in EN`);
          for (const k of ke) if (kf.includes(k)) walk(en[k], fr[k], `${path}.${k}`);
        } else if (te === 'array') {
          if (en.length !== fr.length) problems.push(`${path}: ${en.length} vs ${fr.length} items`);
          en.forEach((v, i) => walk(v, fr[i], `${path}[${i}]`));
        } else if (te === 'string') {
          if (!en.trim() && !['granted', 'denied'].includes(en)) problems.push(`${path}: empty EN`);
          if (!fr.trim()) problems.push(`${path}: empty FR`);
        }
      };
      walk(SG.messages.en, SG.messages.fr, 'messages');
      return problems;
    });
    expect(report).toEqual([]);
  });

  test('9. no em dash and no broken text in any string or function result', async ({ page }) => {
    await openApp(page);
    const texts = await sg(page, (SG) => {
      const out = [];
      const skip = new Set(['q', 'list', 'findings']);
      const walk = (node, path) => {
        if (typeof node === 'string') out.push([path, node]);
        else if (typeof node === 'function') {
          if (skip.has(path.split('.')[1])) return;
          const args = Array.from({ length: Math.max(node.length, 1) }, (_, i) => (i === 0 ? 'example.com' : 'shop.example.com'));
          const r = node(...args);
          if (typeof r === 'string') out.push([path, r]);
        } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
        else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
      };
      for (const ui of ['en', 'fr']) walk(SG.messages[ui], ui);
      return out;
    });
    expect(texts.length).toBeGreaterThan(400);
    for (const [path, text] of texts) {
      expect(text, path).not.toMatch(DASHES);
      expect(text, path).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  test('9. findings read cleanly in both languages', async ({ page }) => {
    await openApp(page);
    const samples = [
      AUDIT_7,
      '<script>window.axeptioSettings = { clientId: "abc", projectId: "x", useDocumentLanguage: true, userCookieDomain: "https://www.example.com/", countryCode: "CA", foo: 1, userCookiesSecure: false, triggerGTMEvents: "yes", userCookiesDuration: "forever", userCookiesSameSite: "Sometimes", googleConsentMode: { default: [{ ad_storage: "yes", ads_storage: "denied", region: "US" }, { analytics_storage: "denied", region: ["us-ca", "US-PR", "UK"] }], url_passthrough: false } };</script><script src="https://static.axept.io/sdk-slim.js" type="module"></script><script src="https://static.axept.io/tcf/sdk.js"></script>',
      '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-X"></script><script>gtag("consent","default",{analytics_storage:"denied"});window.axeptioSettings={clientId:"691245e5b48e4a03c7b9c5c5",cookiesVersion:"Nope",googleConsentMode:{default:{analytics_storage:"denied"}}};var sharedConsentDomains=["https://www.a.com","b.com"];</script><script>var sharedConsentDomains=["c.com"];</script><script src="//static.axept.io/sdk.js"></script>',
      '<script data-id="691245e5b48e4a03c7b9c5c5" data-cookies-version="EU FR" src="https://static.axept.io/sdk.js"></script>',
      '<p>nothing here</p>',
    ];
    const project = await sg(page, (SG, file, id) => SG.projectFromFiles(id, file, null).project, mackage, MACKAGE_ID);
    const geoOff = { ...project, geo: false, restriction: true, domains: ['autre.com'], configs: project.configs.map((c, i) => ({ ...c, gcm: i > 2 })) };
    const findings = await sg(
      page,
      (SG, samples, project, geoOff) => {
        const out = [];
        for (const ui of ['en', 'fr'])
          for (const text of samples)
            for (const ctx of [{}, { project, siteUrl: 'https://shop.example.com' }, { project: geoOff, siteUrl: 'https://www.example.com' }])
              out.push(...SG.audit(text, { ...ctx, ui }).findings.map((f) => ({ ui, id: f.id, kind: f.kind, title: f.title, why: f.why, fix: f.fix })));
        return out;
      },
      samples,
      project,
      geoOff,
    );
    const ids = new Set(findings.map((f) => f.id));
    for (const id of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'G1', 'G2', 'G3', 'G4', 'X1', 'P1', 'P2', 'N1']) expect(ids, id).toContain(id);
    for (const f of findings) {
      for (const text of [f.title, f.why, f.fix]) {
        const where = `${f.ui} ${f.id}:${f.kind}: ${text}`;
        expect(text, where).toBeTruthy();
        expect(text, where).not.toMatch(BROKEN);
        expect(text, where).not.toMatch(DASHES);
        expect(text, where).not.toMatch(/^\s|\s$/);
        // French puts a space before : and ; but never before , or . (and English never does).
        expect(text, where).not.toMatch(f.ui === 'fr' ? /\s[,.](?!\.)/ : /\s[,.:;](?![\w"'\[])/);
      }
    }
  });

  test('9. every generated comment exists in both languages', async ({ page }) => {
    await openApp(page);
    const pairs = await sg(
      page,
      (SG, file, id, regions, hotjar) => {
        const loaded = SG.applyProject(SG.makeState({}), SG.projectFromFiles(id, file, null).project);
        const granted = { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' };
        const full = SG.makeState({
          ...loaded,
          siteUrl: 'https://www.example.com',
          pin: 'config',
          pinConfig: 'EU FR',
          subdomains: true,
          crossDomain: true,
          crossDomains: ['example.com', 'example.org'],
          link: true,
          hideButton: true,
          csp: true,
          nonce: 'abc',
          preconnect: true,
          secure: false,
          google: { ...loaded.google, on: true, owner: 'inline', optout: { region: regions, values: granted } },
          vendors: loaded.vendors.map((v) => (v.name === 'hotjar' ? { ...v, on: true, code: hotjar } : v.name === 'tiktok' ? { ...v, on: true } : v)),
        });
        const settingsMode = SG.makeState({ ...full, csp: false, google: { ...full.google, owner: 'settings' } });
        const tcf = SG.makeState({ ...full, sdk: 'tcf' });
        const dynamic = SG.makeState({ ...full, pin: 'page', pinCases: [{ lang: 'fr', config: 'EU FR' }], pinDefault: 'EU EN' });
        return [full, settingsMode, tcf, dynamic].map((s) => ({ en: SG.generate(s, { ui: 'en' }), fr: SG.generate(s, { ui: 'fr' }) }));
      },
      mackage,
      MACKAGE_ID,
      ['US', ...CA_EXCEPT_QC],
      HOTJAR_TAG,
    );
    const comments = (code) => [...code.matchAll(/\/\/ ([^\n]*)|<!-- ([^\n]*?) -->/g)].map((m) => (m[1] || m[2]).trim());
    const stripComments = (code) => code.replace(/\s*\/\/ [^\n]*/g, '').replace(/<!-- [^\n]*? -->/g, '').replace(/>[^<\n]*<\/a>/g, '></a>').replace(/\s+/g, ' ');
    let total = 0;
    for (const { en, fr } of pairs) {
      const all = (g) => `${g.head}\n${g.footer}`;
      expect(stripComments(all(en))).toBe(stripComments(all(fr)));
      const ce = comments(all(en));
      const cf = comments(all(fr));
      expect(ce.length).toBe(cf.length);
      ce.forEach((c, i) => {
        if (/^(Hotjar|TikTok|[a-z_]+)$/i.test(c) || /^kept global|^gardé global/.test(c)) return;
        expect(cf[i], `${c} has no French version`).not.toBe(c);
        total++;
      });
      for (const text of [all(en), all(fr), ...en.guide.steps, ...fr.guide.steps]) expect(text).not.toMatch(DASHES);
    }
    expect(total).toBeGreaterThan(20);
  });

  test('9. the rendered page has no em dash or broken text in either language', async ({ page }) => {
    await openApp(page);
    const hash = await sg(
      page,
      async (SG, file, id) => {
        const loaded = SG.applyProject(SG.makeState({}), SG.projectFromFiles(id, file, null).project);
        const s = SG.makeState({ ...loaded, siteUrl: 'https://www.example.com', subdomains: true, crossDomain: true, crossDomains: ['example.com', 'example.org'], link: true, hideButton: true, pin: 'page', vendors: loaded.vendors.map((v) => ({ ...v, on: v.name === 'hotjar' })), google: { ...loaded.google, on: true } });
        return `#s=${await SG.encodeState(s)}`;
      },
      mackage,
      MACKAGE_ID,
    );
    for (const lang of ['en', 'fr']) {
      await page.goto(`/${hash}&ui=${lang}`);
      await page.waitForSelector('html[data-ready]', { state: 'attached' });
      await page.evaluate(() => document.querySelectorAll('details.step').forEach((d) => (d.open = true)));
      await page.check('#step-advanced input[data-act=expert]');
      for (const tab of ['snippet', 'guide', 'audit']) {
        await page.click(`[data-act=tab][data-arg=${tab}]`);
        if (tab === 'audit') await page.fill('[data-audit]', AUDIT_7);
        const text = await page.evaluate(() => document.body.innerText);
        expect(text).not.toMatch(DASHES);
        expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
      }
      await expect(page.locator('html')).toHaveAttribute('lang', lang === 'fr' ? 'fr-CA' : 'en');
    }
  });

  test('the page source itself never uses an em dash, eval or new Function', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).not.toMatch(/—/);
    const logic = html.slice(html.indexOf("'use strict';"), html.lastIndexOf('</script>'));
    expect(logic).not.toMatch(/\beval\s*\(/);
    expect(logic).not.toMatch(/new Function\s*\(/);
    expect(logic).not.toMatch(/<\/script/i);
  });
});
