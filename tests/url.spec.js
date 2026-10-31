// SPEC 8 / acceptance test 8: the whole state travels in the URL fragment and comes back identical.
import { expect, test } from '@playwright/test';
import { AUDIT_7, CA_EXCEPT_QC, HOTJAR_TAG, MACKAGE_ID, TCF_ID, fixture, openApp, sg } from './helpers.js';

const mackage = fixture('mackage.json');

/** Every state the suites use, built in the page. */
async function testStates(page) {
  return sg(
    page,
    (SG, file, id, tcfId, regions, hotjar, audit7) => {
      const project = SG.projectFromFiles(id, file, null).project;
      const loaded = SG.applyProject(SG.makeState({}), project);
      const granted = { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' };
      const mack = (owner) => SG.makeState({ ...loaded, google: { ...loaded.google, on: true, owner, optout: { region: regions, values: granted } } });
      const blocking = SG.makeState({ ...loaded, vendors: loaded.vendors.map((v) => (v.name === 'hotjar' ? { ...v, on: true, code: hotjar } : v)) });
      return [
        SG.makeState({ projectId: id }),
        mack('settings'),
        mack('inline'),
        SG.makeState({ sdk: 'tcf', projectId: tcfId, google: { on: true } }),
        SG.makeState({ projectId: id, crossDomain: true, crossDomains: ['maboutique.com', 'monblog.com'] }),
        blocking,
        SG.fromSnippet(audit7, SG.makeState({})).state,
        SG.makeState({
          projectId: id,
          siteUrl: 'https://www.exemple.qc.ca/boutique',
          langs: ['fr', 'en', 'es'],
          pin: 'page',
          pinCases: [{ lang: 'fr', config: 'CA-QC FR' }, { lang: 'en', config: 'CA-QC EN' }],
          pinDefault: 'CA-QC EN',
          subdomains: true,
          link: true,
          hideButton: true,
          linkLabels: { fr: 'Gérer mes témoins 🍪', en: 'Cookie settings' },
          csp: true,
          nonce: '{{ csp_nonce }}',
          preconnect: true,
          duration: '365',
          sameSite: 'Lax',
          secure: false,
          dataLayerName: 'myLayer',
          gtmEvents: 'update_only',
          vendorsMismatch: true,
          vendors: [{ name: 'my.tool', title: 'Mon outil « spécial »', on: true, code: '<script src="https://x.example/t.js"></script><script>t("init")</script>' }],
          expert: { set: { jsonCookieName: 'consent_json', signalEssential: true }, pin: ['userCookiesSecure'], custom: [{ key: 'myFlag', value: '{"a":[1,2]}' }] },
          share: { name: 'Pierre Gagnon-Gingras', contact: 'pierre@example.com', note: 'Bonjour!\nVoici le code, avec des accents : é à ç.' },
        }),
      ];
    },
    mackage,
    MACKAGE_ID,
    TCF_ID,
    ['US', ...CA_EXCEPT_QC],
    HOTJAR_TAG,
    AUDIT_7,
  );
}

test.describe('URL state (SPEC 8)', () => {
  test('8. every test state encodes and decodes to an identical object', async ({ page }) => {
    await openApp(page);
    const states = await testStates(page);
    expect(states.length).toBeGreaterThan(6);
    for (const state of states) {
      const back = await sg(page, async (SG, s) => SG.decodeState(await SG.encodeState(s)), state);
      expect(back).toEqual(state);
      const normalized = await sg(page, (SG, s) => SG.normalizeState(s), state);
      expect(normalized).toEqual(state);
    }
  });

  test('the fragment is base64url and pasted audit code is never in it', async ({ page }) => {
    await openApp(page);
    await page.fill('#project-id', MACKAGE_ID);
    await page.click('[data-act=tab][data-arg=audit]');
    await page.fill('[data-audit]', AUDIT_7);
    await expect.poll(() => page.url()).toContain('#s=');
    const hash = new URL(page.url()).hash;
    expect(hash).toMatch(/^#s=[A-Za-z0-9_-]+$/);
    const state = await sg(page, (SG, h) => SG.decodeState(new URLSearchParams(h.slice(1)).get('s')), hash);
    expect(JSON.stringify(state)).not.toContain('G-XXXX');
    expect(state.projectId).toBe(MACKAGE_ID);
  });

  test('a link restores the wizard and the same code', async ({ page, context }) => {
    await openApp(page);
    const states = await testStates(page);
    const state = states[7];
    const hash = await sg(page, async (SG, s) => `#s=${await SG.encodeState(s)}`, state);
    const expected = await sg(page, (SG, s) => SG.generate(s, { ui: 'en' }).head, state);
    const other = await context.newPage();
    await openApp(other, hash);
    await expect(other.locator('#project-id')).toHaveValue(MACKAGE_ID);
    const shown = await other.evaluate(() => [...document.querySelectorAll('.panel-body [data-block] pre')].filter((p) => !p.closest('[data-block=footer]')).map((p) => p.innerText).join('\n\n'));
    expect(shown.replace(/\s+/g, ' ').trim()).toBe(expected.replace(/\s+/g, ' ').trim());
  });

  test('8. client view renders the prepared-by card with name, contact and note', async ({ page }) => {
    await openApp(page);
    const states = await testStates(page);
    const hash = await sg(page, async (SG, s) => `#s=${await SG.encodeState(s)}&view=client&ui=fr`, states[7]);
    await page.goto(`/${hash}`);
    await page.waitForSelector('html[data-ready]', { state: 'attached' });
    const card = page.locator('.prepared');
    await expect(card).toContainText('Préparé pour vous par Pierre Gagnon-Gingras');
    await expect(card).toContainText('pierre@example.com');
    await expect(card).toContainText('Voici le code, avec des accents : é à ç.');
    await expect(page.locator('.wizard')).toHaveCount(0);
    await expect(page.locator('[role=tab]')).toHaveText(['Snippet', 'Guide']);
    await expect(page.locator('[data-act=copy-link]')).toHaveCount(0);
    await expect(page.locator('[data-block=axeptio] pre')).toContainText(MACKAGE_ID);
    await page.click('[data-act=edit]');
    await expect(page.locator('.wizard')).toBeVisible();
    await expect.poll(() => page.url()).not.toContain('view=client');
  });

  test('a damaged link falls back to a blank form with a notice', async ({ page }) => {
    await openApp(page, '#s=not-a-real-state');
    await expect(page.locator('.alert-warning').first()).toContainText(/damaged|abîmé/);
    await expect(page.locator('[data-block=axeptio] pre')).toContainText('PROJECT_ID');
  });

  test('internal=1 shows the admin link, plain links never carry it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const states = await (async () => {
      await openApp(page);
      return testStates(page);
    })();
    const hash = await sg(page, async (SG, s) => `#s=${await SG.encodeState(s)}&internal=1`, states[1]);
    await page.goto(`/${hash}`);
    await page.waitForSelector('html[data-ready]', { state: 'attached' });
    await expect(page.locator(`a[href="https://admin.axeptio.eu/projects/${MACKAGE_ID}/cookies"]`)).toHaveCount(1);
    await page.click('[data-act=copy-link]');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('#s=');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).not.toContain('internal');
  });
});
