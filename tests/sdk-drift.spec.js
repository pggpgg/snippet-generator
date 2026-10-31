// SPEC 9, catalogue drift: the extractor in scripts/sdk-drift.mjs, and the snapshot it wrote from
// the live SDKs checked against the page's settings catalogue. When Axeptio ships a new sdk.js and
// the snapshot is refreshed, these tests fail until index.html follows.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  ANCHORS,
  compareSnapshots,
  driftReport,
  extractBrandsSettings,
  extractBuild,
  extractDirectReads,
  extractTcfSettings,
  normalizeDefault,
  snapshotOf,
} from '../scripts/sdk-drift.mjs';
import { openApp, sg } from './helpers.js';

const snapshot = JSON.parse(readFileSync(new URL('../sdk-snapshot.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

// Settings the brands SDK reads outside its settings class.
const READ_OUTSIDE_THE_CLASS = {
  token: 'read from the settings object, then dropped before Object.assign',
  nonce: 'read at boot, for the tags the SDK injects',
};

/** Minified code in the shape sdk.js has today: Babel's defineProperty helper, one call per field. */
function minifiedBrands(fields, build = snapshot.brands.build) {
  const value = (f) => {
    if (!('default' in f)) return 'void 0';
    if (f.default === true) return '!0';
    if (f.default === false) return '!1';
    if (f.default === '(constant)') return 'bo.c';
    if (f.default === '(expression)') return 'f("a,b",(1,2))';
    return JSON.stringify(f.default);
  };
  const defs = fields.map((f) => `(0,O.a)(this,"${f.name}",${value(f)})`).join(',');
  return `var Zt=1;class Wq{constructor(){(0,O.a)(this,"other",1)}}class Hr{constructor(e,n,o){var r,i,a=this;${defs},this.settings=Object.assign({},e)}}window.axeptioBuildTimestamp="${build}";`;
}

function minifiedTcf(fields, release = snapshot.tcf.release) {
  const keys = fields.map((f, i) => `${f.name}:v${i}`).join(',');
  return `Lu({entry:"sdk",releaseVersion:"${release}",hash:window.location.hash,setting:(e=window.axeptioSettings)===null||e===void 0?void 0:e.sdkVersion,nonce:(t=window.axeptioSettings)===null||t===void 0?void 0:t.nonce});let{a:x}=other;if(window.axeptioSettings!==void 0){let{${keys}}=window.axeptioSettings;Vx(v0||v1).then()}`;
}

test.describe('SDK drift check (scripts/sdk-drift.mjs)', () => {
  test('reads the settings class as sdk.js ships it today', () => {
    const fields = snapshot.brands.settings;
    expect(extractBrandsSettings(minifiedBrands(fields))).toEqual(fields);
    expect(extractBuild(minifiedBrands(fields), 'brands')).toBe(snapshot.brands.build);
  });

  test('reads native class fields too, in case the build drops the helper', () => {
    const code = 'class Zz{clientId;tokenInstance;cookiesVersion;dataLayerName="dataLayer";triggerGTMEvents=!0;userCookiesDuration=190;userCookiesDomain;apiUrl=`https://api.axept.io/v1`;a;b;constructor(e){Object.assign(this,e)}}';
    expect(extractBrandsSettings(code)).toEqual([
      { name: 'clientId' },
      { name: 'tokenInstance' },
      { name: 'cookiesVersion' },
      { name: 'dataLayerName', default: 'dataLayer' },
      { name: 'triggerGTMEvents', default: true },
      { name: 'userCookiesDuration', default: 190 },
      { name: 'userCookiesDomain' },
      { name: 'apiUrl', default: 'https://api.axept.io/v1' },
      { name: 'a' },
      { name: 'b' },
    ]);
  });

  test('reads the TCF destructuring and the settings read one by one', () => {
    const code = minifiedTcf(snapshot.tcf.settings);
    expect(extractTcfSettings(code)).toEqual(snapshot.tcf.settings);
    expect(extractBuild(code, 'tcf')).toBe(snapshot.tcf.release);
    expect(extractDirectReads(code)).toEqual(['nonce', 'sdkVersion']);
    expect(extractDirectReads('null!==(r=window.axeptioSettings)&&void 0!==r&&r.proxyBaseUrl&&delete window.axeptioSettings.proxyBaseUrl')).toEqual(['proxyBaseUrl']);
  });

  test('fails loudly when the shape is not there', () => {
    expect(() => extractBrandsSettings('class A{constructor(){this.clientId=1}}')).toThrow(/settings class not found/);
    expect(() => extractTcfSettings('let{a:b}=window.other')).toThrow(/no destructuring/);
  });

  test('normalizes defaults to what matters', () => {
    expect([normalizeDefault('void 0'), normalizeDefault('!0'), normalizeDefault('!1'), normalizeDefault('190'), normalizeDefault('"x"'), normalizeDefault("'y'"), normalizeDefault('bo.c'), normalizeDefault('f()')]).toEqual([undefined, true, false, 190, 'x', 'y', '(constant)', '(expression)']);
  });

  test('a full snapshot round-trips through the extractor', () => {
    const built = snapshotOf(minifiedBrands(snapshot.brands.settings), minifiedTcf(snapshot.tcf.settings));
    expect(built.brands.settings).toEqual(snapshot.brands.settings);
    expect(built.tcf.settings).toEqual(snapshot.tcf.settings);
    expect(Object.keys(built.brands.anchors)).toEqual(ANCHORS.brands);
    expect(Object.keys(built.tcf.anchors)).toEqual(ANCHORS.tcf);
  });

  test('compares snapshots: nothing to report when nothing moved', () => {
    expect(compareSnapshots(snapshot, clone(snapshot))).toEqual({ changed: false, changes: [] });
    const newBuild = clone(snapshot);
    newBuild.brands.build = '2027-01-01T00:00:00.000Z';
    newBuild.tcf.release = '9.9.9';
    expect(compareSnapshots(snapshot, newBuild).changed).toBe(false);
    const newAnchor = clone(snapshot);
    newAnchor.brands.anchors.somethingNew = true;
    expect(compareSnapshots(snapshot, newAnchor).changed).toBe(false);
  });

  test('compares snapshots: every kind of drift is reported with what to do', () => {
    const after = clone(snapshot);
    after.brands.settings.push({ name: 'shinyNewSetting', default: true });
    after.brands.settings = after.brands.settings.filter((f) => f.name !== 'signalEssential');
    after.brands.settings.find((f) => f.name === 'userCookiesDuration').default = 395;
    after.tcf.settings = after.tcf.settings.filter((f) => f.name !== 'metadataPrefix');
    after.tcf.settings.push({ name: 'useDocumentLang' });
    after.tcf.anchors.getToken = true;
    after.brands.anchors.hideAxeptioButton = false;
    after.brands.directReads.push('nonce');
    const result = compareSnapshots(snapshot, after);
    expect(result.changed).toBe(true);
    expect(result.changes.map((c) => `${c.sdk}:${c.kind}:${c.name || ''}`).sort()).toEqual(
      [
        'brands:setting-added:shinyNewSetting',
        'brands:setting-removed:signalEssential',
        'brands:default-changed:userCookiesDuration',
        'brands:read-added:nonce',
        'brands:anchor-gone:hideAxeptioButton',
        'tcf:setting-added:useDocumentLang',
        'tcf:setting-removed:metadataPrefix',
        'tcf:anchor-appeared:getToken',
      ].sort(),
    );
    const md = driftReport(snapshot, after, result);
    for (const word of ['shinyNewSetting', 'signalEssential', '190 became 395', 'metadataPrefix', 'Appendix A', 'npm run sdk:snapshot']) expect(md).toContain(word);
    expect(md).not.toMatch(/—/);
    expect(driftReport(snapshot, snapshot, compareSnapshots(snapshot, snapshot))).toContain('No difference');
  });
});

test.describe('the snapshot matches the page (SPEC 2.3, 2.4)', () => {
  test('every sdk.js setting is in the catalogue or the internal list, and back', async ({ page }) => {
    await openApp(page);
    const { catalogue, internal, build } = await sg(page, (SG) => ({ catalogue: SG.catalogue, internal: SG.sdkInternalFields, build: SG.sdkBuild }));
    const classFields = snapshot.brands.settings.map((f) => f.name);
    const brandsKeys = catalogue.filter((c) => !c.tcfOnly).map((c) => c.key);
    expect([...classFields, ...Object.keys(READ_OUTSIDE_THE_CLASS)].sort()).toEqual([...brandsKeys, ...internal].sort());
    // The page says which build it was checked against.
    expect(snapshot.brands.build.slice(0, 19)).toBe(build.slice(0, 19));
  });

  test('literal defaults in sdk.js are the catalogue defaults', async ({ page }) => {
    await openApp(page);
    const catalogue = await sg(page, (SG) => SG.catalogue);
    const byKey = new Map(catalogue.map((c) => [c.key, c]));
    for (const f of snapshot.brands.settings) {
      const c = byKey.get(f.name);
      if (!c) continue;
      if (!('default' in f)) {
        // No default in the class: the catalogue may only state the falsy value it amounts to.
        expect([undefined, false], f.name).toContain(c.def);
      } else if (f.default === '(constant)' || f.default === '(expression)') {
        expect(c.def, `${f.name} has a default in sdk.js`).not.toBeUndefined();
      } else {
        expect(c.def, f.name).toEqual(f.default);
      }
    }
  });

  test('tcf/sdk.js reads exactly the keys flagged tcf in the catalogue', async ({ page }) => {
    await openApp(page);
    const tcfKeys = await sg(page, (SG) => SG.catalogue.filter((c) => c.tcf || c.tcfOnly).map((c) => c.key));
    const read = new Set([...snapshot.tcf.settings.map((f) => f.name), ...snapshot.tcf.directReads]);
    expect([...read].sort()).toEqual([...tcfKeys].sort());
  });

  test('the TCF facts the generator relies on still hold in the snapshot', () => {
    // No getToken in tcf/sdk.js: the cross-domain script of Appendix A cannot run with the TCF banner.
    expect(snapshot.tcf.anchors.getToken).toBe(false);
    // No hideAxeptioButton in tcf/sdk.js: the wizard hides that option in TCF mode.
    expect(snapshot.tcf.anchors.hideAxeptioButton).toBe(false);
    for (const [anchor, present] of Object.entries(snapshot.brands.anchors)) expect(present, anchor).toBe(true);
  });
});
