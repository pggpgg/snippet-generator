// The page itself: loading projects, the wizard controls, sharing, downloads, themes, layouts.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { HOTJAR_TAG, MACKAGE_ID, TCF_ID, fixture, norm, openApp, serveProjects } from './helpers.js';

const mackage = fixture('mackage.json');
const tcfDev = fixture('tcf-dev.json');

async function loadMackage(page) {
  await serveProjects(page, { [`brands:${MACKAGE_ID}`]: mackage });
  await page.fill('#project-id', MACKAGE_ID);
  await page.click('#step-project button[type=submit]');
  await expect(page.locator('.project-summary h3')).toHaveText('Mackage all countries');
}

const snippet = (page, block = 'axeptio') => page.locator(`[data-block=${block}] pre`);

test.describe('page', () => {
  test('loads clean, in the browser language by default', async ({ page }) => {
    const errors = await openApp(page);
    await expect(page.locator('h1')).toHaveText('Snippet Generator');
    await expect(page.locator('.lead')).toContainText('Answer a few questions');
    expect(errors).toEqual([]);
    expect(page.url()).not.toContain('#');
  });

  test('French browser gets French, and the choice of language and theme is remembered', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'fr-CA' });
    const page = await context.newPage();
    await openApp(page);
    await expect(page.locator('.lead')).toContainText('Répondez à quelques questions');
    await page.click('[data-act=ui-lang][data-arg=en]');
    await expect(page.locator('.lead')).toContainText('Answer a few questions');
    await page.click('[data-act=theme]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.click('[data-act=theme]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const stored = await page.evaluate(() => [localStorage.getItem('snippet-generator:ui'), localStorage.getItem('snippet-generator:theme')]);
    expect(stored).toEqual(['en', 'dark']);
    await page.reload();
    await page.waitForSelector('html[data-ready]', { state: 'attached' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.lead')).toContainText('Answer a few questions');
    await page.click('[data-act=theme]');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
    await context.close();
  });

  test('loading a project fills the summary, remembers it, and pre-fills the answers', async ({ page }) => {
    await openApp(page);
    await loadMackage(page);
    await expect(page.locator('.project-summary tbody tr')).toHaveCount(6);
    await expect(page.locator('.project-summary')).toContainText('Location-based display on');
    await expect(page.locator('input[name=googleOn][value=true]')).toBeChecked();
    await expect(snippet(page)).toContainText('useDocumentLang: true');
    await expect(snippet(page)).not.toContainText('cookiesVersion');
    const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('snippet-generator:recent')));
    expect(recent).toEqual([{ id: MACKAGE_ID, name: 'Mackage all countries' }]);
    await page.click('[data-act=unload]');
    await expect(page.locator('.project-summary')).toHaveCount(0);
    await expect(page.locator('[data-act=recent]')).toHaveText(['Mackage all countries']);
  });

  test('a pasted admin URL is reduced to the project ID', async ({ page }) => {
    await openApp(page);
    await serveProjects(page, { [`brands:${MACKAGE_ID}`]: mackage });
    await page.fill('#project-id', `https://admin.axeptio.eu/projects/${MACKAGE_ID}/cookies`);
    await page.click('#step-project button[type=submit]');
    await expect(page.locator('#project-id')).toHaveValue(MACKAGE_ID);
    await expect(page.locator('.project-summary h3')).toHaveText('Mackage all countries');
  });

  test('unknown or invalid project IDs explain themselves', async ({ page }) => {
    await openApp(page);
    await serveProjects(page, {});
    await page.fill('#project-id', 'aaaaaaaaaaaaaaaaaaaaaaaa');
    await page.click('#step-project button[type=submit]');
    await expect(page.locator('#step-project .field-error')).toContainText('No published project with this ID');
    await page.fill('#project-id', '1234');
    await expect(page.locator('#step-project .field-error').first()).toContainText('24 characters');
    await page.route('https://client.axept.io/**', (route) => route.abort());
    await page.fill('#project-id', MACKAGE_ID);
    await page.click('#step-project button[type=submit]');
    await expect(page.locator('#step-project .field-error')).toContainText('Couldn’t reach Axeptio');
  });

  test('a project with both banner types asks which one the site loads', async ({ page }) => {
    await openApp(page);
    await serveProjects(page, { [`brands:${MACKAGE_ID}`]: mackage, [`tcf:${MACKAGE_ID}`]: { ...tcfDev, projectId: MACKAGE_ID } });
    await page.fill('#project-id', MACKAGE_ID);
    await page.click('#step-project button[type=submit]');
    await expect(page.locator('#step-project .alert-info')).toContainText('standard banner and a TCF');
    await expect(page.locator('input[name=sdk][value=brands]')).toBeChecked();
    await page.check('input[name=sdk][value=tcf]');
    await expect(snippet(page)).toContainText('tcf/sdk.js');
    await expect(page.locator('.project-summary tbody tr')).toHaveCount(1);
  });

  test('Consent Mode editor: presets, typed codes with fixes, extra entries, flags', async ({ page }) => {
    await openApp(page);
    await page.check('input[name=googleOn][value=true]');
    await page.check('input[name=gOwner][value=inline]');
    const input = page.locator('[data-draft=optout]');
    await input.fill('us-ny, US-PR, ZZ');
    await input.press('Enter');
    await expect(page.locator('#step-google .region-chip')).toHaveText(['US-NY', 'PR', 'ZZ']);
    await expect(page.locator('#step-google .field-error')).toContainText('ZZ: unknown country code.');
    await expect(snippet(page, 'gcm')).toContainText("region: ['US-NY', 'PR']");
    await page.click('#step-google .region-chip:has-text("ZZ")');
    await page.click('[data-act=entry-add]');
    await page.locator('[data-draft=extra-0]').fill('CA-QC');
    await page.click('[data-act=region-add][data-arg="google.extra.0|extra-0"]');
    await page.check('input[data-bind="google.redaction"]');
    await page.locator('input[data-bind="google.wait"]').fill('800');
    // Renders are batched: let the assertions retry until the last input lands.
    await expect(snippet(page, 'gcm')).toContainText("wait_for_update: 800, region: ['CA-QC']");
    await expect(snippet(page, 'gcm')).toContainText("gtag('set', 'ads_data_redaction', true);");
    await page.selectOption('select[data-bind="google.fallback.analytics_storage"]', 'granted');
    await expect(snippet(page, 'gcm')).toContainText("{ analytics_storage: 'granted', ad_storage: 'denied'");
  });

  test('script blocking from the project vendors, and a vendor added by name', async ({ page }) => {
    await openApp(page);
    await loadMackage(page);
    await page.click('#step-vendors > summary');
    await expect(page.locator('#step-vendors .vendor')).toHaveCount(12);
    await expect(page.locator('#step-vendors')).toContainText('No consent needed for Google Fonts, CloudFlare, Google Tag Manager and Shopify.com');
    await page.locator('.vendor:has(code:text-is("hotjar")) input[type=checkbox]').check();
    await expect(page.locator('#step-vendors .alert-warning')).toContainText('Paste the tag');
    await page.locator('.vendor:has(code:text-is("hotjar")) textarea').fill(HOTJAR_TAG);
    await expect(snippet(page, 'callbacks')).toContainText('if (choices.hotjar) {');
    await page.locator('[data-draft=vendorName]').fill('my vendor');
    await page.click('[data-act=vendor-add]');
    await expect(page.locator('#step-vendors .field-error')).toContainText('technical name');
    await page.locator('[data-draft=vendorName]').fill('matomo');
    await page.locator('[data-draft=vendorTitle]').fill('Matomo');
    await page.locator('[data-draft=vendorTitle]').press('Enter');
    await expect(snippet(page, 'callbacks')).toContainText('if (choices.matomo) {');
    await expect(snippet(page, 'callbacks')).toContainText('// Paste the Matomo tag here');
    await page.click('[data-act=tab][data-arg=guide]');
    await expect(page.locator('.guide')).toContainText('Remove the original tags of Hotjar and Matomo');
    await expect(page.locator('.guide')).toContainText('axeptio_activate_hotjar');
  });

  test('footer link, hidden button and the Cookies Atlas link', async ({ page }) => {
    await openApp(page);
    await loadMackage(page);
    await page.click('#step-link > summary');
    await page.check('input[data-bind=hideButton]');
    await expect(page.locator('#step-link .alert-info')).toContainText('adds the footer link');
    await expect(snippet(page, 'footer')).toContainText('Gérer mes cookies');
    await page.fill('input[data-bind="linkLabels.fr"]', 'Mes témoins');
    await expect(snippet(page, 'footer')).toContainText('>Mes témoins</a>');
    await expect(snippet(page, 'callbacks')).toContainText('axeptio.on("ready"');
    await expect(page.locator(`a[href="https://pggpgg.github.io/cookies-atlas/?project=${MACKAGE_ID}&logic=html"]`)).toHaveCount(1);
  });

  test('domains: derived cookie domain, the uncertain case, cross-domain list', async ({ page }) => {
    await openApp(page);
    await page.fill('input[data-bind=siteUrl]', 'https://www.boutique.co.zz');
    await page.check('input[name=subdomains][value=true]');
    await expect(page.locator('#step-domains .alert-warning')).toContainText('not sure where the registrable domain starts');
    await page.fill('input[data-bind=siteUrl]', 'https://www.maboutique.com/fr');
    await expect(page.locator('#step-domains .note').first()).toContainText('From the site address: maboutique.com.');
    await expect(snippet(page)).toContainText('userCookiesDomain: "maboutique.com"');
    await page.check('input[name=crossDomain][value=true]');
    await page.fill('textarea[data-bind=crossDomains]', 'https://www.monblog.com\nmonforum.com');
    await expect(page.locator('#step-domains')).toContainText('https://www.monblog.com: no https://, write monblog.com.');
    await expect(page.locator('#step-domains')).toContainText('This site (maboutique.com) is added to the list');
    await expect(snippet(page, 'crossDomain')).toContainText('"maboutique.com",\n      "monblog.com",\n      "monforum.com"');
    await page.click('[data-act=tab][data-arg=guide]');
    await expect(page.locator('[data-act=download-domain]')).toHaveCount(3);
  });

  test('advanced settings and expert mode write only what differs', async ({ page }) => {
    await openApp(page);
    await page.click('#step-advanced > summary');
    await page.fill('input[data-bind=duration]', '365');
    await page.selectOption('select[data-bind=gtmEvents]', 'update_only');
    await page.uncheck('input[data-bind=secure]');
    await page.check('input[data-bind=preconnect]');
    await expect(snippet(page)).toContainText('userCookiesDuration: 365,');
    await expect(snippet(page)).toContainText('triggerGTMEvents: "update_only",');
    await expect(snippet(page)).toContainText('userCookiesSecure: false,');
    await expect(snippet(page, 'preconnect')).toContainText('crossorigin');
    await page.check('#step-advanced input[data-act=expert]');
    await page.fill('input[data-expert=jsonCookieName]', 'my_consent');
    await page.locator('input[data-expert=jsonCookieName]').press('Tab');
    await expect(snippet(page)).toContainText('jsonCookieName: "my_consent",');
    await page.check('input[data-act=pin][data-arg=openCookiesWidgetIfVendorsMismatch]');
    await expect(snippet(page)).toContainText('openCookiesWidgetIfVendorsMismatch: false,');
    await page.click('[data-act=custom-add]');
    await page.fill('input[data-bind="expert.custom.0.key"]', 'myFlag');
    await page.fill('input[data-bind="expert.custom.0.value"]', '{ "a": 1 }');
    await expect(snippet(page)).toContainText('myFlag: { a: 1 },');
    await expect(page.locator('#expert')).toContainText('Not read by the SDK as of build');
  });

  test('the raw settings editor applies known keys back to the wizard', async ({ page }) => {
    await openApp(page);
    await page.click('#step-advanced > summary');
    await page.check('#step-advanced input[data-act=expert]');
    await page.fill('textarea[data-raw]', `window.axeptioSettings = {\n  clientId: "${MACKAGE_ID}",\n  userCookieDomain: "https://www.example.com",\n  cookiesVersion: "EU FR",\n};`);
    await page.click('[data-act=raw-apply]');
    await expect(page.locator('#expert')).toContainText('Applied to the wizard.');
    await expect(page.locator('#project-id')).toHaveValue(MACKAGE_ID);
    await expect(page.locator('input[name=subdomains][value=true]')).toBeChecked();
    await expect(page.locator('input[name=pin][value=config]')).toBeChecked();
    await expect(snippet(page)).toContainText('userCookiesDomain: "example.com",');
    await page.fill('textarea[data-raw]', 'window.axeptioSettings = { clientId: ');
    await page.click('[data-act=raw-apply]');
    await expect(page.locator('#expert')).toContainText('can’t be read');
  });

  test('copy buttons, client link and downloads', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page);
    await loadMackage(page);
    await page.click('[data-act=copy-head]');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('window.axeptioSettings');
    await page.click('[data-act=share]');
    await page.fill('input[data-bind="share.name"]', 'Pierre');
    await page.fill('input[data-bind="share.contact"]', 'pierre@example.com');
    await page.fill('textarea[data-bind="share.note"]', 'Voici le code.');
    await page.click('[data-act=copy-client-link]');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('view=client');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/^http:\/\/localhost:\d+\/#s=[A-Za-z0-9_-]+&view=client&ui=en$/);

    const [txt] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=download-txt]')]);
    expect(txt.suggestedFilename()).toBe('axeptio-snippet-mackage-all-countries.txt');
    const txtBody = readFileSync(await txt.path(), 'utf8');
    expect(txtBody).toContain(`clientId: "${MACKAGE_ID}"`);
    const [html] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=download-html]')]);
    const htmlBody = readFileSync(await html.path(), 'utf8');
    expect(htmlBody).toMatch(/^<!doctype html>/);
    expect(htmlBody).toContain('Prepared for you by Pierre');
    expect(htmlBody).toContain('<span class="tk-p">clientId</span>');
    expect(htmlBody).not.toMatch(/\u2014/);

    const client = await context.newPage();
    await openApp(client, link.slice(link.indexOf('#')));
    await expect(client.locator('.prepared')).toContainText('Prepared for you by Pierre');
    expect(norm(await client.locator('[data-block=axeptio] pre').innerText())).toBe(norm(await snippet(page).innerText()));
  });

  test('phone width: everything stacks, no horizontal scroll', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'fr-CA' });
    const page = await context.newPage();
    await openApp(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const [wizard, output] = await Promise.all([page.locator('.wizard').boundingBox(), page.locator('.output').boundingBox()]);
    expect(output.y).toBeGreaterThan(wizard.y + wizard.height - 1);
    await context.close();
  });

  test('dark theme keeps code readable (tokens switch)', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await openApp(page);
    const colors = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return [css.getPropertyValue('--page').trim(), css.getPropertyValue('--code-string').trim()];
    });
    expect(colors).toEqual(['#121211', '#5fd09a']);
  });

  test('the TCF wizard hides what tcf/sdk.js ignores', async ({ page }) => {
    await openApp(page);
    await serveProjects(page, { [`tcf:${TCF_ID}`]: tcfDev });
    await page.fill('#project-id', TCF_ID);
    await page.click('#step-project button[type=submit]');
    await expect(page.locator('input[name=sdk][value=tcf]')).toBeChecked();
    await expect(page.locator('input[name=htmlLang]')).toHaveCount(0);
    await page.click('#step-link > summary');
    await expect(page.locator('input[data-bind=hideButton]')).toHaveCount(0);
    await expect(page.locator('#step-link')).toContainText('no hideAxeptioButton function');
    await page.click('#step-advanced > summary');
    await expect(page.locator('input[data-bind=duration]')).toHaveCount(0);
    await page.check('input[name=crossDomain][value=true]');
    await page.fill('textarea[data-bind=crossDomains]', 'a.com\nb.com');
    await expect(snippet(page)).toContainText('userCrossCookiesDomain: ["a.com", "b.com"],');
    await expect(page.locator('[data-block=crossDomain]')).toHaveCount(0);
  });
});
