// SPEC section 10: the acceptance tests, as exact (whitespace-normalized) outputs.
import { expect, test } from '@playwright/test';
import { AUDIT_7, CA_EXCEPT_QC, HOTJAR_TAG, LOADER_BRANDS, LOADER_TCF, MACKAGE_ID, TCF_ID, fixture, norm, openApp, serveProjects, sg } from './helpers.js';

const mackage = fixture('mackage.json');
const tcfDev = fixture('tcf-dev.json');
const GRANTED = { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' };

/** Scenario 2's answers on top of the loaded Mackage project, built in the page. */
function mackageOut(page, owner) {
  return sg(
    page,
    (SG, file, id, owner, granted, regions) => {
      const { project } = SG.projectFromFiles(id, file, { isEmpty: true });
      const loaded = SG.applyProject(SG.makeState({}), project);
      const state = SG.makeState({ ...loaded, htmlLang: 'yes', google: { ...loaded.google, on: true, owner, optout: { region: regions, values: granted } } });
      return SG.generate(state);
    },
    mackage,
    MACKAGE_ID,
    owner,
    GRANTED,
    ['US', ...CA_EXCEPT_QC],
  );
}

const EXPECTED_2 = `<script>
window.axeptioSettings = {
  clientId: "691245e5b48e4a03c7b9c5c5",
  // Banner language: the page's <html lang>, not the browser's
  useDocumentLang: true,
  // Google Consent Mode v2: default signals, sent before Google tags read consent
  googleConsentMode: {
    default: [
      { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500 },
      { analytics_storage: "granted", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", region: ["US", "CA-AB", "CA-BC", "CA-MB", "CA-NB", "CA-NL", "CA-NS", "CA-NT", "CA-NU", "CA-ON", "CA-PE", "CA-SK", "CA-YT"] }
    ]
  },
};

${LOADER_BRANDS}
</script>`;

const EXPECTED_3 = `<script>
// Google Consent Mode v2: default signals, set before Axeptio and any Google tag
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });
gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', region: ['US', 'CA-AB', 'CA-BC', 'CA-MB', 'CA-NB', 'CA-NL', 'CA-NS', 'CA-NT', 'CA-NU', 'CA-ON', 'CA-PE', 'CA-SK', 'CA-YT'] });
</script>

<script>
window.axeptioSettings = {
  clientId: "691245e5b48e4a03c7b9c5c5",
  // Banner language: the page's <html lang>, not the browser's
  useDocumentLang: true,
};

${LOADER_BRANDS}
</script>`;

// Appendix A, with only sharedConsentDomains changed.
const APPENDIX_A = `<script>
// Sharing Axeptio consent between your sites.
// Add this code on each of the sites listed below.
window._axcb = window._axcb || [];
window._axcb.push(function (axeptio) {
  // Waits for the visitor to make their choice in the banner
  axeptio.on("cookies:complete", function () {
    // TO MODIFY: the domains of all your sites, including this one,
    // without https:// or www. The list is the same on each site.
    // Their subdomains (www, fr, blog…) are included automatically.
    var sharedConsentDomains = [
      "maboutique.com",
      "monblog.com"
    ];

    // Returns the domain from the list to which an address belongs, or null
    function findSharedDomain(hostname) {
      return sharedConsentDomains.find(function (domain) {
        return hostname === domain || hostname.endsWith("." + domain);
      }) || null;
    }

    // Page outside the list: no links are modified
    var currentDomain = findSharedDomain(window.location.hostname);
    if (!currentDomain) {
      return;
    }

    document.querySelectorAll("a[href]").forEach(function (link) {
      var url;
      try {
        url = new URL(link.href);
      } catch (e) {
        return; // Unreadable address: this link is ignored
      }
      // Only links to web pages are processed (not mailto:, tel:…)
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return;
      }
      // Adds the visitor's token to links to another site in the list
      var targetDomain = findSharedDomain(url.hostname);
      if (targetDomain && targetDomain !== currentDomain) {
        url.searchParams.set("axeptio_token", axeptio.getToken());
        link.href = url.href;
      }
    });
  });
});
</script>`;

const EXPECTED_6 = `<script>
// Tools that wait for consent: each one loads once, after the visitor accepts it
window._axcb = window._axcb || [];
window._axcb.push(function (axeptio) {
  var loaded = {};
  function loadOnce(name, load) {
    if (!loaded[name]) {
      loaded[name] = true;
      load();
    }
  }
  axeptio.on("cookies:complete", function (choices) {
    if (choices.hotjar) {
      loadOnce("hotjar", function () {
        // Hotjar
        (function(h,o,t,j,a,r){
            h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
            h._hjSettings={hjid:1234567,hjsv:6};
            a=o.getElementsByTagName('head')[0];
            r=o.createElement('script');r.async=1;
            r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
            a.appendChild(r);
        })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');
      });
    }
  });
});
</script>`;

const EXPECTED_7_AFTER = `<script>
// Google Consent Mode v2: default signals, set before Axeptio and any Google tag
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });
</script>

<script>
window.axeptioSettings = {
  clientId: "691245e5b48e4a03c7b9c5c5",
};

${LOADER_BRANDS}
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('config','G-XXXX');</script>`;

test.describe('acceptance (SPEC 10)', () => {
  test.beforeEach(async ({ page }) => {
    const errors = await openApp(page);
    test.info().annotations.push({ type: 'errors', description: errors.join('\n') });
  });

  test('1. minimal brands: exactly the back-office loader with only clientId', async ({ page }) => {
    const out = await sg(page, (SG, id) => SG.generate(SG.makeState({ projectId: id })), MACKAGE_ID);
    expect(norm(out.head)).toBe(norm(`<script>\nwindow.axeptioSettings = {\n  clientId: "${MACKAGE_ID}",\n};\n\n${LOADER_BRANDS}\n</script>`));
    expect(out.head).toBe(`<script>\nwindow.axeptioSettings = {\n  clientId: "${MACKAGE_ID}",\n};\n\n${LOADER_BRANDS}\n</script>`);
    expect(out.footer).toBe('');
    expect(out.blocks.map((b) => b.id)).toEqual(['axeptio']);
    expect(out.head).not.toContain('preconnect');
    const withPreconnect = await sg(page, (SG, id) => SG.generate(SG.makeState({ projectId: id, preconnect: true })).head, MACKAGE_ID);
    expect(withPreconnect).toContain('<link rel="preconnect" href="https://static.axept.io">');
    expect(withPreconnect).toContain('<link rel="preconnect" href="https://client.axept.io" crossorigin>');
  });

  test('2. Mackage-style, mode A: useDocumentLang, no cookiesVersion, defaults in googleConsentMode', async ({ page }) => {
    const out = await mackageOut(page, 'settings');
    expect(norm(out.head)).toBe(norm(EXPECTED_2));
    expect(out.head).not.toContain('cookiesVersion');
    expect(out.settings.useDocumentLang).toBe(true);
    expect(out.checks).toEqual([]);
  });

  test('3. Mackage-style, mode B: inline gtag block first, axeptioSettings without googleConsentMode', async ({ page }) => {
    const out = await mackageOut(page, 'inline');
    expect(norm(out.head)).toBe(norm(EXPECTED_3));
    expect(out.head.indexOf("gtag('consent', 'default'")).toBeLessThan(out.head.indexOf('window.axeptioSettings'));
    expect(out.head.match(/gtag\('consent', 'default'/g)).toHaveLength(2);
    expect(out.settings.googleConsentMode).toBeUndefined();
  });

  test('2 and 3 through the wizard give the same code', async ({ page }) => {
    await serveProjects(page, { [`brands:${MACKAGE_ID}`]: mackage });
    await page.fill('#project-id', MACKAGE_ID);
    await page.click('#step-project button[type=submit]');
    await expect(page.locator('.project-summary h3')).toHaveText('Mackage all countries');
    await page.click('[data-act=preset][data-arg=us]');
    await page.click('[data-act=preset][data-arg=caExceptQc]');
    await page.check('input[name=gOwner][value=settings]');
    await expect.poll(async () => norm(await page.locator('[data-block=axeptio] pre').innerText())).toBe(norm(EXPECTED_2));
    await page.check('input[name=gOwner][value=inline]');
    await expect.poll(async () => norm((await page.locator('.panel-body pre').allInnerTexts()).join('\n\n'))).toBe(norm(EXPECTED_3));
  });

  test('4. TCF: tcf/sdk.js loader with type module, expert mode without useDocumentLang, A4 on a pasted useDocumentLang', async ({ page }) => {
    const out = await sg(page, (SG, id) => SG.generate(SG.makeState({ sdk: 'tcf', projectId: id, google: { on: true }, langs: ['fr', 'en'] })), TCF_ID);
    expect(norm(out.head)).toBe(
      norm(`<script>
window.axeptioSettings = {
  clientId: "${TCF_ID}",
  // Google Consent Mode v2: default signals, sent before Google tags read consent
  googleConsentMode: {
    default: [
      { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500 }
    ]
  },
};

${LOADER_TCF}
</script>`),
    );
    expect(out.head).toContain('e.type = "module"');
    const tcfKeys = await sg(page, (SG) => SG.catalogueFor('tcf').map((c) => c.key));
    expect(tcfKeys).not.toContain('useDocumentLang');
    expect(tcfKeys).toEqual(expect.arrayContaining(['clientId', 'projectId', 'configurationId', 'cookiesVersion', 'googleConsentMode', 'userCrossCookiesDomain']));
    const paste = `<script>window.axeptioSettings = { clientId: "${TCF_ID}", useDocumentLang: true };\n${LOADER_TCF}</script>`;
    const findings = await sg(page, (SG, text) => SG.audit(text).findings, paste);
    expect(findings.map((f) => `${f.id}:${f.kind}`)).toContain('A4:tcf');

    // In the UI: TCF hides the useDocumentLang row of the expert table and the question itself.
    await page.check('input[name=sdk][value=tcf]');
    await page.click('#step-advanced > summary');
    await page.check('#step-advanced input[data-act=expert]');
    const keys = await page.locator('.expert-table td:first-child code').allInnerTexts();
    expect(keys).toContain('googleConsentMode');
    expect(keys).not.toContain('useDocumentLang');
    await expect(page.locator('input[name=langLogic]')).toHaveCount(0);
  });

  test('4b. a TCF project file switches the wizard to TCF', async ({ page }) => {
    await serveProjects(page, { [`tcf:${TCF_ID}`]: tcfDev });
    await page.fill('#project-id', TCF_ID);
    await page.click('#step-project button[type=submit]');
    await expect(page.locator('.project-summary h3')).toHaveText('Dev');
    await expect(page.locator('input[name=sdk][value=tcf]')).toBeChecked();
    await expect(page.locator('[data-block=axeptio] pre')).toContainText('tcf/sdk.js');
  });

  test('5. cross-domain: Appendix A with the list, and X1 on https://www', async ({ page }) => {
    const out = await sg(page, (SG, id) => SG.generate(SG.makeState({ projectId: id, crossDomain: true, crossDomains: ['maboutique.com', 'monblog.com'] })), MACKAGE_ID);
    const block = out.blocks.find((b) => b.id === 'crossDomain');
    expect(norm(block.code)).toBe(norm(APPENDIX_A));
    const pasted = out.head.replace('"monblog.com"', '"https://www.monblog.com"');
    const findings = await sg(page, (SG, text) => SG.audit(text, { siteUrl: 'https://www.maboutique.com' }).findings, pasted);
    const x1 = findings.filter((f) => f.id === 'X1');
    expect(x1.map((f) => f.kind)).toEqual(['format']);
    expect(x1[0].fix).toBe('Write monblog.com.');
    expect(x1[0].severity).toBe('error');
  });

  test('6. script blocking: one _axcb.push, guarded loader keyed on choices.hotjar', async ({ page }) => {
    const out = await sg(
      page,
      (SG, file, id, tag) => {
        const s = SG.applyProject(SG.makeState({}), SG.projectFromFiles(id, file, null).project);
        s.google.on = false;
        s.vendors = s.vendors.map((v) => (v.name === 'hotjar' ? { ...v, on: true, code: tag } : v));
        return SG.generate(s);
      },
      mackage,
      MACKAGE_ID,
      HOTJAR_TAG,
    );
    const block = out.blocks.find((b) => b.id === 'callbacks');
    expect(norm(block.code)).toBe(norm(EXPECTED_6));
    expect(out.head.match(/_axcb\.push/g)).toHaveLength(1);
    expect(block.code).toContain('if (choices.hotjar)');
    expect(block.code).toContain('loadOnce("hotjar"');
  });

  test('7. audit: A4 and G2, and "Load into the wizard" corrects the snippet', async ({ page }) => {
    const findings = await sg(page, (SG, text) => SG.audit(text).findings, AUDIT_7);
    const ids = findings.map((f) => `${f.id}:${f.kind}`);
    expect(ids).toContain('A4:typo');
    expect(findings.find((f) => f.id === 'A4').data).toMatchObject({ key: 'cookieVersion', suggestion: 'cookiesVersion' });
    expect(ids).toContain('G2:googleFirst');
    expect(ids).toContain('G2:configFirst');
    const after = await sg(page, (SG, text) => SG.fromSnippet(text, SG.makeState({})).after('en'), AUDIT_7);
    expect(norm(after)).toBe(norm(EXPECTED_7_AFTER));
    const again = await sg(page, (SG, text) => SG.audit(text).findings, after);
    expect(again.filter((f) => f.severity !== 'info')).toEqual([]);

    // The same through the Audit tab.
    await page.click('[data-act=tab][data-arg=audit]');
    await page.fill('[data-audit]', AUDIT_7);
    await expect(page.locator('.finding')).toHaveCount(findings.length);
    await expect(page.locator('.finding h3').first()).toContainText('gtag.js loads before Axeptio');
    await page.click('[data-act=audit-load]');
    await expect(page.locator('.diff')).toBeVisible();
    await expect(page.locator('.diff .add').first()).toBeVisible();
    await page.click('[data-act=tab][data-arg=snippet]');
    await expect(page.locator('[data-block=gcm] pre')).toContainText("gtag('consent', 'default'");
    await expect(page.locator('[data-block=axeptio] pre')).not.toContainText('cookieVersion');
  });
});
