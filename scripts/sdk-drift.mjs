#!/usr/bin/env node
// SDK drift check (SPEC section 9, "Catalogue drift").
//
// Downloads Axeptio's two web SDKs and re-extracts the parts the generator mirrors:
//   - sdk.js (brands): the settings class field list, in order, with each default. It is the
//     minified `class Hr` today; it is found by content because the minifier renames it.
//   - tcf/sdk.js: the keys destructured from window.axeptioSettings.
//   - both: the settings read straight from window.axeptioSettings, and a few anchors (method,
//     event and string names the generated code relies on).
// Then compares them with sdk-snapshot.json and writes a Markdown report.
//
//   node scripts/sdk-drift.mjs --write sdk-snapshot.json                 refresh the snapshot
//   node scripts/sdk-drift.mjs --compare sdk-snapshot.json --out drift   CI: drift/report.md, changed=true|false
//   add --brands <file> --tcf <file> to read local copies instead of downloading.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// --- pure extraction (no Node API: the same code also runs in a browser console) ---------------

export const BRANDS_SDK_URL = 'https://static.axept.io/sdk.js';
export const TCF_SDK_URL = 'https://static.axept.io/tcf/sdk.js';

/** Names and strings the generated code depends on. Presence only: counts change for no reason. */
export const ANCHORS = {
  brands: [
    'getComoV2DefaultSettings(){',
    'pushCoMoV2DefaultSettings',
    'liftSeededDefaultWhenConsentModeOff',
    'applyImplicitGrantedConsent',
    'applyGoogleConsentModeFlagsFromSettings(){',
    'updateGoogleConsentModeOnStart',
    'checkGtagConfigPriorToCoMoV2',
    'loadCrossDomains(e){',
    'initAxeptioCallbackGlobal',
    'trigger("ready")',
    'cookies:complete',
    'hideAxeptioButton',
    'openAxeptioCookies',
    'getToken',
    'useDocumentLang',
    'browser_locale',
    'custom_function',
  ],
  tcf: [
    'openAxeptioCookies',
    '_axcb',
    'cookies:complete',
    'getToken',
    'hideAxeptioButton',
    'userCrossCookiesDomain',
  ],
};

function skipString(src, i) {
  const quote = src[i];
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && c === '$' && src[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < src.length && depth) {
        const d = src[i];
        if (d === '"' || d === "'" || d === '`') {
          i = skipString(src, i);
          continue;
        }
        if (d === '{') depth++;
        else if (d === '}') depth--;
        i++;
      }
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return i;
}

/** One expression from `i` to the next top-level `,` `;` or closing bracket. */
export function readExpression(src, i) {
  const start = i;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth--;
    } else if ((c === ',' || c === ';') && depth === 0) break;
    i++;
  }
  return { text: src.slice(start, i).trim(), end: i };
}

/** Index of the bracket closing the one at `open`, or -1. */
function matchBracket(src, open) {
  const end = readExpression(src, open + 1);
  let i = end.end;
  // readExpression stops at top-level commas too: keep going until the closing bracket.
  while (i < src.length && (src[i] === ',' || src[i] === ';')) i = readExpression(src, i + 1).end;
  return i < src.length ? i : -1;
}

/** A default value as the snapshot stores it: literals as JSON, minified references as a tag. */
export function normalizeDefault(text) {
  const t = String(text || '').trim();
  if (!t || t === 'void 0' || t === 'undefined') return undefined;
  if (t === '!0' || t === 'true') return true;
  if (t === '!1' || t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(t)) return Number(t);
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) return JSON.parse(t);
  if (/^'(?:[^'\\]|\\.)*'$/.test(t)) return t.slice(1, -1).replace(/\\(.)/g, '$1');
  if (/^`[^`$\\]*`$/.test(t)) return t.slice(1, -1);
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(t)) return '(constant)';
  return '(expression)';
}

function field(name, valueText) {
  const value = normalizeDefault(valueText);
  return value === undefined ? { name } : { name, default: value };
}

const DEFINE = /(?:\(0,\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(this,\s*"([\w$]+)",/y;

/** Babel's defineProperty run: (0,O.a)(this,"clientId",void 0),(0,O.a)(this,"tokenInstance",void 0),... */
function readDefineRun(src, pos) {
  const fields = [];
  let i = pos;
  for (;;) {
    DEFINE.lastIndex = i;
    const m = DEFINE.exec(src);
    if (!m) break;
    const value = readExpression(src, DEFINE.lastIndex);
    if (src[value.end] !== ')') break;
    fields.push(field(m[1], value.text));
    i = value.end + 1;
    while (/\s/.test(src[i] || '')) i++;
    if (src[i] !== ',' && src[i] !== ';') break;
    i++;
    while (/\s/.test(src[i] || '')) i++;
  }
  return fields;
}

/** Native class fields: class X{clientId;tokenInstance;dataLayerName="dataLayer";...constructor(){...}} */
function readClassFields(src, bodyStart) {
  const fields = [];
  const ID = /\s*([A-Za-z_$][\w$]*)\s*/y;
  let i = bodyStart;
  for (;;) {
    ID.lastIndex = i;
    const m = ID.exec(src);
    if (!m || m[1] === 'constructor' || m[1] === 'static') break;
    const j = ID.lastIndex;
    if (src[j] === '=' && src[j + 1] !== '>') {
      const value = readExpression(src, j + 1);
      fields.push(field(m[1], value.text));
      i = value.end;
    } else if (src[j] === ';' || src[j] === '}') {
      fields.push(field(m[1], ''));
      i = j;
    } else break;
    if (src[i] !== ';') break;
    i++;
  }
  return fields;
}

const looksLikeSettings = (fields) => {
  const names = new Set(fields.map((f) => f.name));
  return names.has('clientId') && names.has('cookiesVersion') && names.has('userCookiesDomain') && fields.length >= 10;
};

/** The brands settings class: every field in declaration order, with its default. */
export function extractBrandsSettings(src) {
  const candidates = [];
  const anchor = /\(this,\s*"clientId",/g;
  const anyDefine = new RegExp(DEFINE.source, 'g');
  let m;
  while ((m = anchor.exec(src))) {
    // Back up to the start of the helper call, "(0,O.a)" or "_defineProperty".
    let start = m.index;
    if (src[start - 1] === ')') {
      let depth = 0;
      for (let k = start - 1; k >= 0; k--) {
        if (src[k] === ')') depth++;
        else if (src[k] === '(' && --depth === 0) {
          start = k;
          break;
        }
      }
    } else {
      while (start > 0 && /[\w$.]/.test(src[start - 1])) start--;
    }
    candidates.push(readDefineRun(src, start));
    // Fields declared before clientId: start from the first definition in the same constructor.
    const ctor = src.lastIndexOf('constructor(', start);
    if (ctor >= 0 && start - ctor < 4000) {
      anyDefine.lastIndex = ctor;
      const first = anyDefine.exec(src);
      if (first && first.index < start) candidates.push(readDefineRun(src, first.index));
    }
  }
  const classRe = /class\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[\w$.]+)?\s*\{/g;
  while ((m = classRe.exec(src))) candidates.push(readClassFields(src, classRe.lastIndex));
  const found = candidates.filter(looksLikeSettings).sort((a, b) => b.length - a.length)[0];
  if (!found) throw new Error('sdk.js: settings class not found (no run of fields with clientId, cookiesVersion and userCookiesDomain)');
  return found;
}

/** tcf/sdk.js: let{projectId:e,clientId:t,...}=window.axeptioSettings */
export function extractTcfSettings(src) {
  let best = null;
  const re = /(?:let|const|var)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = re.lastIndex - 1;
    const close = matchBracket(src, open);
    if (close < 0 || src[close] !== '}') continue;
    if (!/^\s*=\s*window\.axeptioSettings\b/.test(src.slice(close + 1, close + 40))) continue;
    const inner = src.slice(open + 1, close);
    const fields = [];
    let i = 0;
    while (i < inner.length) {
      const part = readExpression(inner, i);
      const text = part.text;
      const key = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))/.exec(text);
      if (key && !text.startsWith('...')) {
        const eq = /^[^=]*?=(?![=>])([\s\S]*)$/.exec(text);
        fields.push(field(key[1] || key[2] || key[3], eq ? eq[1] : ''));
      }
      i = part.end + 1;
    }
    if (!best || fields.length > best.length) best = fields;
  }
  if (!best || !best.some((f) => f.name === 'clientId')) throw new Error('tcf/sdk.js: no destructuring of window.axeptioSettings with clientId');
  return best;
}

/** Settings read one by one: window.axeptioSettings.x, or (e=window.axeptioSettings)...e.x */
export function extractDirectReads(src) {
  const out = new Set();
  for (const m of src.matchAll(/axeptioSettings\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of src.matchAll(/\(([A-Za-z_$][\w$]*)\s*=\s*window\.axeptioSettings\)/g)) {
    const alias = m[1].replace(/\$/g, '\\$');
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const read = new RegExp(`(?<![\\w$.])${alias}\\.([A-Za-z_$][\\w$]*)`).exec(tail);
    if (read) out.add(read[1]);
  }
  return [...out].sort();
}

/** sdk.js stamps its build; tcf/sdk.js reports a release version. */
export function extractBuild(src, kind) {
  const m = kind === 'tcf' ? /releaseVersion:\s*"([^"]+)"/.exec(src) : /axeptioBuildTimestamp\s*=\s*"([^"]+)"/.exec(src);
  return m ? m[1] : null;
}

export function anchorsIn(src, list) {
  return Object.fromEntries(list.map((a) => [a, src.includes(a)]));
}

export function snapshotOf(brandsSrc, tcfSrc) {
  return {
    brands: {
      url: BRANDS_SDK_URL,
      build: extractBuild(brandsSrc, 'brands'),
      settings: extractBrandsSettings(brandsSrc),
      directReads: extractDirectReads(brandsSrc),
      anchors: anchorsIn(brandsSrc, ANCHORS.brands),
    },
    tcf: {
      url: TCF_SDK_URL,
      release: extractBuild(tcfSrc, 'tcf'),
      settings: extractTcfSettings(tcfSrc),
      directReads: extractDirectReads(tcfSrc),
      anchors: anchorsIn(tcfSrc, ANCHORS.tcf),
    },
  };
}

const show = (v) => (v === undefined ? 'none' : JSON.stringify(v));

/** Every difference that matters to the generator. Builds and releases alone are not drift. */
export function compareSnapshots(before, after) {
  const changes = [];
  for (const sdk of ['brands', 'tcf']) {
    const b = before[sdk] || {};
    const a = after[sdk] || {};
    const bFields = new Map((b.settings || []).map((f) => [f.name, f]));
    const aFields = new Map((a.settings || []).map((f) => [f.name, f]));
    for (const [name, f] of aFields) if (!bFields.has(name)) changes.push({ sdk, kind: 'setting-added', name, after: f.default });
    for (const [name, f] of bFields) if (!aFields.has(name)) changes.push({ sdk, kind: 'setting-removed', name, before: f.default });
    for (const [name, f] of aFields) {
      const old = bFields.get(name);
      if (old && show(old.default) !== show(f.default)) changes.push({ sdk, kind: 'default-changed', name, before: old.default, after: f.default });
    }
    const common = (list, other) => (list || []).map((f) => f.name).filter((n) => other.has(n));
    if (common(b.settings, aFields).join() !== common(a.settings, bFields).join()) changes.push({ sdk, kind: 'order-changed' });
    const bReads = new Set(b.directReads || []);
    const aReads = new Set(a.directReads || []);
    for (const r of aReads) if (!bReads.has(r)) changes.push({ sdk, kind: 'read-added', name: r });
    for (const r of bReads) if (!aReads.has(r)) changes.push({ sdk, kind: 'read-removed', name: r });
    for (const [anchor, present] of Object.entries(a.anchors || {})) {
      const was = (b.anchors || {})[anchor];
      if (was !== undefined && was !== present) changes.push({ sdk, kind: present ? 'anchor-appeared' : 'anchor-gone', name: anchor });
    }
  }
  return { changed: changes.length > 0, changes };
}

const FILE = { brands: 'sdk.js', tcf: 'tcf/sdk.js' };
const HINT = {
  'setting-added': (c) =>
    c.sdk === 'tcf'
      ? `New key read by ${FILE.tcf}: \`${c.name}\`. Set \`tcf: true\` on it in CATALOGUE (index.html), or add it there if it is new.`
      : `New setting in ${FILE.brands}: \`${c.name}\` (default: ${show(c.after)}). Add it to CATALOGUE in index.html (src: 'sdk'), or to SDK_INTERNAL_FIELDS if the SDK sets it itself.`,
  'setting-removed': (c) =>
    c.sdk === 'tcf'
      ? `${FILE.tcf} no longer reads \`${c.name}\`. Drop its \`tcf\` flag in CATALOGUE so the wizard hides it and the audit (A4) flags it in TCF mode.`
      : `${FILE.brands} no longer has \`${c.name}\`. Remove it from CATALOGUE or SDK_INTERNAL_FIELDS: the audit (A4) will then flag it as unknown.`,
  'default-changed': (c) => `Default of \`${c.name}\` in ${FILE[c.sdk]}: ${show(c.before)} became ${show(c.after)}. Update \`def\` in CATALOGUE: the minimal-code rule leaves out keys equal to their default.`,
  'order-changed': (c) => `The field order changed in ${FILE[c.sdk]}. Nothing to do unless a field moved before or after Object.assign.`,
  'read-added': (c) => `${FILE[c.sdk]} now reads \`window.axeptioSettings.${c.name}\` directly. Check whether the generator should write it.`,
  'read-removed': (c) => `${FILE[c.sdk]} no longer reads \`window.axeptioSettings.${c.name}\` directly. Check the generated code that writes it.`,
  'anchor-appeared': (c) =>
    c.sdk === 'tcf' && c.name === 'getToken'
      ? `\`getToken\` now exists in ${FILE.tcf}: the cross-domain script (SPEC Appendix A) may work with the TCF banner. Test it, then lift the TCF restriction in the generator.`
      : `\`${c.name}\` now appears in ${FILE[c.sdk]}. Check the matching fact in SPEC.md.`,
  'anchor-gone': (c) => `\`${c.name}\` is gone from ${FILE[c.sdk]}. The behaviour the generator relies on may have changed: check the matching fact in SPEC.md.`,
};

export function driftReport(before, after, result) {
  const lines = ['## Snippet Generator: Axeptio SDK drift check', ''];
  const was = (x, y) => (x === y ? `\`${y}\` (unchanged)` : `\`${x}\` then \`${y}\``);
  lines.push(`- ${FILE.brands} build: ${was(before.brands?.build, after.brands?.build)}`);
  lines.push(`- ${FILE.tcf} release: ${was(before.tcf?.release, after.tcf?.release)}`, '');
  if (!result.changed) {
    lines.push('No difference with sdk-snapshot.json: the settings catalogue still matches both SDKs.');
    return `${lines.join('\n')}\n`;
  }
  lines.push('### What changed', '');
  for (const c of result.changes) lines.push(`- ${HINT[c.kind](c)}`);
  lines.push(
    '',
    '### Then',
    '',
    '1. Update index.html (CATALOGUE, SDK_INTERNAL_FIELDS, SDK_BUILD) and SPEC.md if a behaviour changed.',
    '2. Refresh the snapshot: `npm run sdk:snapshot`, and commit it with the fix.',
    '3. Run `npm test`: tests/sdk-drift.spec.js checks the snapshot against the catalogue.',
  );
  return `${lines.join('\n')}\n`;
}

// --- CLI ----------------------------------------------------------------------------------------

class DownloadError extends Error {}

async function download(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw new DownloadError(`${url}: ${error.cause?.code || error.cause?.message || error.message}`);
  }
  if (!res.ok) throw new DownloadError(`${url}: HTTP ${res.status}`);
  return res.text();
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(write|compare|out|brands|tcf)$/.exec(argv[i]);
    if (!m || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    args[m[1]] = argv[++i];
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const output = (name, text) => {
    if (!args.out) return;
    mkdirSync(args.out, { recursive: true });
    writeFileSync(join(args.out, name), text);
  };
  let now;
  try {
    const [brandsSrc, tcfSrc] = await Promise.all([
      args.brands ? readFileSync(args.brands, 'utf8') : download(BRANDS_SDK_URL),
      args.tcf ? readFileSync(args.tcf, 'utf8') : download(TCF_SDK_URL),
    ]);
    now = snapshotOf(brandsSrc, tcfSrc);
  } catch (error) {
    const next =
      error instanceof DownloadError
        ? "Axeptio's CDN did not answer. Nothing to fix if the next run works."
        : 'The files downloaded, but their minified shape changed: update the extraction in scripts/sdk-drift.mjs.';
    output('report.md', `## Snippet Generator: Axeptio SDK drift check\n\nThe check could not read the SDKs: ${error.message}\n\n${next}\n`);
    throw error;
  }
  const json = `${JSON.stringify(now, null, 2)}\n`;
  if (args.write) {
    writeFileSync(args.write, json);
    console.log(`Wrote ${args.write}: ${now.brands.settings.length} sdk.js settings (build ${now.brands.build}), ${now.tcf.settings.length} tcf/sdk.js keys (release ${now.tcf.release}).`);
    return;
  }
  if (args.compare) {
    const before = JSON.parse(readFileSync(args.compare, 'utf8'));
    const result = compareSnapshots(before, now);
    const md = driftReport(before, now, result);
    output('report.md', md);
    output('snapshot.json', json);
    console.log(md);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed}\n`);
    return;
  }
  process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
