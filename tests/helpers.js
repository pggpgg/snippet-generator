// Shared helpers for the Playwright suites: the page exposes window.SnippetGenerator, and tests
// call it through page.evaluate. Project files are served from tests/fixtures by route interception,
// so the suite never reaches Axeptio's CDN.
import { readFileSync } from 'node:fs';

export const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
export const MACKAGE_ID = '691245e5b48e4a03c7b9c5c5';
export const TCF_ID = '69bf231ed26c858445ab2d62';

/** Collapses runs of whitespace: the spec compares outputs whitespace-normalized. */
export const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export async function openApp(page, hash = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/${hash}`);
  await page.waitForSelector('html[data-ready]', { state: 'attached' });
  return errors;
}

/** Serves fixture files for the brands and TCF endpoints (anything else: {"isEmpty": true}). */
export async function serveProjects(page, files = {}) {
  await page.route('https://client.axept.io/**', (route) => {
    const url = route.request().url();
    const id = (url.match(/([a-f0-9]{24})\.json/) || [])[1];
    const kind = url.includes('/tcf/') ? 'tcf' : 'brands';
    const body = files[`${kind}:${id}`];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body || { isEmpty: true }) });
  });
}

/** Runs fn(SnippetGenerator, ...args) in the page. fn must be self-contained. */
export async function sg(page, fn, ...args) {
  return page.evaluate(
    async ({ src, args }) => {
      // eslint-disable-next-line no-new-func
      const f = new Function(`return (${src})`)();
      return f(window.SnippetGenerator, ...args);
    },
    { src: fn.toString(), args },
  );
}

/** The loader as the back office gives it (SPEC 2.1). */
export const LOADER_BRANDS = `(function(d, s) {
  var t = d.getElementsByTagName(s)[0], e = d.createElement(s);
  e.async = true; e.src = "//static.axept.io/sdk.js";
  t.parentNode.insertBefore(e, t);
})(document, "script");`;

export const LOADER_TCF = `(function(d, s) {
  var t = d.getElementsByTagName(s)[0], e = d.createElement(s);
  e.async = true; e.src = "//static.axept.io/tcf/sdk.js"; e.type = "module";
  t.parentNode.insertBefore(e, t);
})(document, "script");`;

export const CA_EXCEPT_QC = ['CA-AB', 'CA-BC', 'CA-MB', 'CA-NB', 'CA-NL', 'CA-NS', 'CA-NT', 'CA-NU', 'CA-ON', 'CA-PE', 'CA-SK', 'CA-YT'];

export const HOTJAR_TAG = `<!-- Hotjar Tracking Code -->
<script>
    (function(h,o,t,j,a,r){
        h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
        h._hjSettings={hjid:1234567,hjsv:6};
        a=o.getElementsByTagName('head')[0];
        r=o.createElement('script');r.async=1;
        r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
        a.appendChild(r);
    })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');
</script>`;

/** SPEC section 10, scenario 7: the snippet to audit. */
export const AUDIT_7 = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('config','G-XXXX');</script>
<script>window.axeptioSettings={clientId:"691245e5b48e4a03c7b9c5c5",cookieVersion:"CA-QC FR",googleConsentMode:{default:{analytics_storage:"denied"}}};(function(d,s){var t=d.getElementsByTagName(s)[0],e=d.createElement(s);e.async=true;e.src="//static.axept.io/sdk.js";t.parentNode.insertBefore(e,t);})(document,"script");</script>`;
