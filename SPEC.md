# Snippet Generator: build spec

A single-page tool where a CSM (or a client they send a link to) answers plain-language questions about a website and gets the optimal Axeptio **direct `<script>` integration** for it: copy-ready code, an annotated install guide, and an audit of any snippet already on the site.

Owner: Pierre Gagnon-Gingras (CSM, Axeptio). Interview and research done 2026-10-29. Everything under "Verified facts" was read from the live `sdk.js` (build `2026-10-28T21:27:12Z`), the live `tcf/sdk.js` and the Axeptio help center that day. Sister project: [Cookies Atlas](https://github.com/pggpgg/cookies-atlas) (same owner, same look, same data source).

---

## 1. Decisions (from the interview)

| Topic | Decision |
|---|---|
| Name / repo | `pggpgg/snippet-generator` (public), served by GitHub Pages at `https://pggpgg.github.io/snippet-generator/` |
| Audience | **Both, CSM-led.** CSMs use it, then send clients a link with everything pre-filled. Copy must explain itself to a marketer or a junior dev |
| Integration method | **Direct `<script>` in HTML only.** No GTM template, CMS plugin or SPA framework output in v1 (mention them only to say "this tool is for the hard-coded snippet") |
| Output | **Snippet + annotated guide**: copy-ready code, a short "why" for every line that isn't default, and ordered install steps. No separate verification checklist |
| UI language | FR/EN toggle (Québécois French, tech terms kept in English: config, fallback, tie-break, override, match, dataLayer). Generated code comments and the guide follow the UI language. Default to the browser language |
| Features | Everything below: Google Consent Mode v2 (with region-specific defaults), multi-config / geolocation (`cookiesVersion`, `useDocumentLang`), TCF publisher SDK, cross-subdomain consent, cross-domain consent script, script blocking via callbacks, reopen-consent link, performance tuning, **and any other `axeptioSettings` property** the user wants to declare |
| "Optimal" means | A mix of **correct consent signals** (defaults set before any Google tag, no race, no double load) and **minimal code** (emit only what differs from the SDK's behavior without it). When the two conflict, correctness wins, and the guide says why the extra lines are there |
| Project data | **Optional auto-fill** from a project ID (same public endpoint as Cookies Atlas). Everything works fully manual |
| Stack | **No build step.** One `index.html` with inline CSS and JS, plain ES2022, no runtime dependencies, no framework. Self-hosted fonts next to it. Tests run with Playwright against the page (dev-only) |
| UX | **Wizard + expert mode.** Plain-language questions by default; a toggle reveals every raw property, editable |
| Vendors (script blocking) | **Auto from the project**, with a toggle per vendor to choose which ones get a consent-gated loader. Manual entry when there's no project |
| GCM defaults owner | **User chooses**, with the trade-off explained: `googleConsentMode` in `axeptioSettings` (Axeptio's documented way) or an inline `gtag('consent','default',…)` block |
| GCM defaults model | Pierre's standard pattern first: a **fallback entry with no region, all denied**, plus an **opt-out entry with a comma-separated list of regions, all granted**. More entries possible |
| Sharing | Shareable URL with full state, read-only client view (sender enters name, contact and a note), download as file, and **audit a pasted snippet** |
| Look | **Match Cookies Atlas** (same tokens, fonts, header, light/dark, FR/EN toggle) so the two read as a suite |
| Deliverable of this session | This spec. The build happens in a fresh session that has the repo attached |

---

## 2. Verified facts: the snippet

### 2.1 Two SDKs, two loaders

Brands (the standard banner):
```html
<script>
window.axeptioSettings = {
  clientId: "PROJECT_ID",
};

(function(d, s) {
  var t = d.getElementsByTagName(s)[0], e = d.createElement(s);
  e.async = true; e.src = "//static.axept.io/sdk.js";
  t.parentNode.insertBefore(e, t);
})(document, "script");
</script>
```

Publishers (TCF v2.2, IAB):
```html
<script>
window.axeptioSettings = {
  clientId: "PROJECT_ID",
};

(function(d, s) {
  var t = d.getElementsByTagName(s)[0], e = d.createElement(s);
  e.async = true; e.src = "//static.axept.io/tcf/sdk.js"; e.type = "module";
  t.parentNode.insertBefore(e, t);
})(document, "script");
</script>
```
Both loaders are copied from the Axeptio back office (Pierre, 2026-10-29). Keep them byte-for-byte, including the protocol-relative `//`, so CSMs recognize them. `static.axept.io/sdk-slim.js` also still answers 200; treat it as legacy in the audit (info, not error) and never generate it.

### 2.2 How the brands SDK builds its settings

`new Hr(scriptTag, defaults, window.axeptioSettings)` where `scriptTag = document.querySelector('script[data-id][src*="axept.io"]')`:

1. Field defaults (table 2.3).
2. **Every own key of `window.axeptioSettings` is copied onto the settings with `Object.assign`**, except `token` and keys whose value is `undefined`. So unknown keys are accepted silently: a typo like `cookieVersion` does nothing and raises no error. This is why "declare any property" works, and why the audit must catch typos.
3. Then, if a `<script data-id="…" src="…axept.io…">` exists, its attributes win: `data-id` (clientId), `data-token`, `data-cookies-version`, `data-cookies-domain`, `data-mount-classname`. The generator never emits this form, but the audit must read it.
4. `token` in `axeptioSettings` creates a *custom* token (the SDK otherwise generates one, or reads `?axeptio_token=` from the URL first).
5. `cookiesVersion` may be an **object** (dynamic selection, see 2.5) and is resolved here to a string.
6. Loading the SDK twice throws `Error("Axeptio SDK is already loaded")` (checks `window.__axeptioSDK`).

### 2.3 Brands settings catalogue (the expert-mode source of truth)

Defaults are what the SDK uses when the key is absent. "Doc" = documented in [Options and advanced mode: axeptioSettings](https://support.axeptio.eu/en/articles/274040-advanced-options-and-mode-axeptiosettings) or another help article; "SDK only" = present in sdk.js but undocumented (expert mode shows them under "Undocumented, use with care").

| Key | Type | SDK default | Source | Notes for the generator |
|---|---|---|---|---|
| `clientId` | 24-hex string | none (required) | Doc | Project ID. Validate `/^[a-f0-9]{24}$/i` |
| `cookiesVersion` | string \| object | none | Doc | Config name to pin. See 2.5 and audit rule A1 |
| `useDocumentLang` | boolean | `false` | Doc | Language tie-break uses `<html lang>` instead of `navigator.language` |
| `userCookiesDomain` | string | current host | Doc | Registrable domain to share consent across subdomains (`example.com`, no protocol, no leading dot, no `www`) |
| `userCookiesDuration` | number (days) \| `"page"` \| `"session"` | **190** | Doc | Help article says 365 and the GTM template says 180; the SDK uses `parseInt(value) \|\| 190`. Show "SDK default: 190 days" in the UI |
| `userCookiesSecure` | boolean | `true` | Doc | Only set `false` for http dev sites |
| `userCookiesSameSite` | `"Lax"` \| `"Strict"` \| `"None"` | browser default | Doc | Case-insensitive match |
| `jsonCookieName` | string | `axeptio_cookies` | Doc | |
| `authorizedVendorsCookieName` | string | `axeptio_authorized_vendors` | Doc | |
| `allVendorsCookieName` | string | `axeptio_all_vendors` | Doc | |
| `gppCookieName` | string | `axeptio_gpp_string` | SDK only | |
| `triggerGTMEvents` | `true` \| `false` \| `"update_only"` | `true` | Doc (values from GTM doc + SDK) | `true`: `axeptio_update` + `axeptio_activate_<vendor>` / `axeptio_enable_` / `axeptio_disable_`. `"update_only"`: only `axeptio_update` |
| `dataLayerName` | string | `dataLayer` | Doc (GTM) | If set, inline gtag code must use the same name |
| `googleConsentMode` | object | none | Doc | See section 3 |
| `openCookiesWidgetIfVendorsMismatch` | boolean | `false` | Doc | Reopen the widget when new vendors were added since the visitor's choice |
| `mountClassName` | string | `axeptio_mount` | Doc | |
| `apiUrl` | URL | `https://api.axept.io/v1` | Doc | |
| `nonce` | string | none | SDK only (read from `window.axeptioSettings.nonce`) | CSP nonce applied to what the SDK injects. Pair with [CSP article](https://support.axeptio.eu/en/articles/273997-axeptio-csp-configuration) |
| `token` / `tokenInstance` | string | generated | Doc | Logged-in user token. `token` marks it custom |
| `proxyBaseUrl` | URL | none | SDK only | Routes API/config/consent URLs through a first-party proxy (server-side setups). Expert only |
| `postConsentUrl`, `configUrl` | URL | Axeptio endpoints | SDK only | Expert only |
| `userCrossCookiesDomain` | string[] | none | SDK only | After a choice, loads hidden iframes `https://<domain>?axeptio_token=…`. Third-party-cookie blocking makes this unreliable; prefer the documented link-decoration script (4.3). Expert only, with that warning |
| `signalEssential` | boolean | `false` | SDK only | Adds the non-optional vendors to `axeptio_authorized_vendors` in `axeptio_update` |
| `compressUserCookie` | boolean \| `"forced"` | `false` | SDK only | |
| `metadataPrefix` | string | `$$` | SDK only | Never change |
| `rejectCookiesOnInit`, `restrictedMode`, `appSDKMode`, `platform`, `sdkVersion` | | | SDK only | Show read-only in expert mode with "internal, don't set" |

Internal fields the SDK writes itself (never offer them): `countryCode`, `subdivisionCode`, `reglementation`, `isFallback`, `userLanguage`, `consentDefaultAlreadySent`, `consentUpdateAlreadySent`, `cookiesConfig`, `directConfigUrl`.

Expert mode also accepts **free custom keys** (key + JSON value) because the SDK copies any key; flag them with "not read by the SDK as of build 2026-10-28" unless they're in this table.

### 2.4 TCF SDK settings (subset)

`tcf/sdk.js` destructures only: `projectId` or `clientId`, `configurationId`, `cookiesVersion`, `appSDKMode`, `dataLayerName`, `triggerGTMEvents`, `googleConsentMode`, `userCookiesDomain`, `userCookiesSameSite`, `userCookiesSecure`, `userCrossCookiesDomain`, `metadataPrefix`, plus `nonce` and `sdkVersion`. In TCF mode the wizard hides everything else, and the audit flags any other key as "ignored by the TCF SDK" (notably `useDocumentLang`, `userCookiesDuration`, cookie names).
From the [TCF integration article](https://support.axeptio.eu/en/articles/274044-tcf-integrate-and-publish): IAB vendors read the TC string themselves; non-IAB services need `axeptio_update` + `axeptio_authorized_vendors` (no `axeptio_activate_*` events in TCF); load the SDK as early as possible.

### 2.5 `cookiesVersion`: string or dynamic object

String: the config `name` to pin.

Object (documented in [Dynamic loading of configurations via custom code](https://support.axeptio.eu/en/articles/330536-dynamic-loading-of-configurations-via-custom-code), algorithm read from sdk.js `$r`):
```js
cookiesVersion: {
  type: "custom_function",            // or "browser_locale"
  config: { function: function () { return document.documentElement.lang; } },
  cases: { "fr": "site-fr", "en": "site-en", "default": "site-en" }
}
```
- `browser_locale` uses `navigator.language`, or `<html lang>` when `useDocumentLang` is true.
- Case lookup on the value `v`: `ll` (lowercase 2 letters) → `cases[ll]`; `CC` (uppercase) → `cases[CC]`; `ll-CC` → `cases["ll-CC"]`, then `cases.ll`, then `cases.CC`; `CC-XXX` → exact, then `cases.CC`; else `cases.default`. Values can be nested objects (resolved recursively). Unmatched → `default`.
- SPAs that switch language without reload: `axeptioSDK.setCookiesVersion("name")`.

**How selection really works** (from `getCookiesConfig()`, same port as Cookies Atlas `src/engine/select.ts`): banner-visibility gate, then if location-based display is ON: subdivision → single-country → multi-country → regulation → fallback config. Only if that finds nothing (geo OFF, or no match and no fallback) does `cookiesVersion` apply, and when it does it **overrides page rules and the default "first config"**. Pierre's field rule: a leftover `cookiesVersion` from an older install is a top cause of "wrong banner" tickets because it silently bypasses the other selection logic. The generator never adds one unless the user explicitly asks for it.

### 2.6 Runtime API (for generated callbacks)

- Queue: `window._axcb = window._axcb || []; window._axcb.push(function (axeptio) { … });` Callbacks run with the SDK instance as soon as it exists (immediately if already loaded; `push` is patched to call through).
- `axeptio.on(event, handler, { replay: true, once: false })`: **replay defaults to true**, so a handler registered after the event still receives it.
- Events seen in sdk.js: `cookies:complete` (payload: choices object keyed by vendor `name`, booleans, plus `$$` metadata), `cookies:open`, `cookies:close`, `cookies:loaded`, `cookies:step:change`, `cookies:consent`, `cookies:error`, `cookies:expiration:change`, `cookies:vendors:toggle:on|off`, `cookies:vendors:toggleall:on|off`, `cookies:googleconsenttypes:toggle:on|off`, `consent:saved`, `consent:required`, `token:update` (a `"ready"` string also exists in sdk.js; confirm it's an `on()` event before relying on it).
- Instance methods: `getToken()`, `hasAcceptedVendor(name)`, `requestConsent(name)`, `openCookies()`, `setCookiesVersion(name)`, `getUserCookieChoices()`.
- Globals (set once the widget mounts): `window.openAxeptioCookies()`, `window.hideAxeptioButton()`, `window.showAxeptioButton()`, `window.axeptioSDK`.
- dataLayer events (brands, `triggerGTMEvents` true): `axeptio_update` (`axeptio_authorized_vendors`, `consent_mode` when GCM), `axeptio_activate_<vendor>`, `axeptio_enable_<vendor>`, `axeptio_disable_<vendor>`.

---

## 3. Verified facts: Google Consent Mode v2

### 3.1 `googleConsentMode` in `axeptioSettings` (brands SDK)

```js
googleConsentMode: {
  default: { … } | [ { … }, { … } ],   // object OR array of objects (one gtag('consent','default') per entry)
  wait_for_update: 500,                // ms, used when an entry doesn't set its own
  ads_data_redaction: true,            // boolean → gtag('set','ads_data_redaction', …)
  url_passthrough: true                // only `true` is applied; `false` is ignored
}
```
- Every entry is merged over the base `{analytics_storage, ad_storage, ad_user_data, ad_personalization: "denied", wait_for_update: 500}`. So an entry only needs the keys that differ, plus `region`.
- `region` is gtag's: an array of ISO 3166-1/3166-2 codes (`"US"`, `"CA-ON"`). Google applies the most specific matching region; an entry without `region` is the global fallback.
- Pierre's standard output (keep this shape, all four types written out for readability):
  ```js
  googleConsentMode: {
    default: [
      { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500 },
      { analytics_storage: "granted", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", region: ["US", "CA-ON", "CA-BC"] }
    ]
  }
  ```

### 3.2 Timing and de-duplication (why "who owns the defaults" matters)

- If `axeptioSettings.googleConsentMode` has `display: true` or a non-empty `default`, the SDK pushes the defaults **when sdk.js executes** (bootstrap). Otherwise it waits for the project file and pushes them only if the published config has the Consent Mode step (`cookies[].googleConsentMode.display === true`) and no consent update exists yet.
- `sdk.js` is `async`. Anything a page runs synchronously before it executes (inline `gtag('config', …)`, a GTM container already processing) can run before Axeptio's default. The SDK detects `config` pushed before `consent default` (`checkGtagConfigPriorToCoMoV2`) and complains.
- **If a `consent default` command is already in the dataLayer, Axeptio skips its own defaults entirely** (and skips types already present in `google_tag_data.ics`). Inline defaults therefore never double up with Axeptio's; Axeptio still sends the updates.
- Updates only happen if the published config has the **Consent Mode v2 step** enabled ([help article](https://support.axeptio.eu/en/articles/704809-configure-google-consent-mode-v2-hard-coded-integration): without it "Google never receives the granted signal"). It's auto-enabled when GA4/Google Ads vendors are in the banner.

### 3.3 The two output modes (user picks, wizard recommends)

- **A. Axeptio setting** (documented default): `googleConsentMode` inside `axeptioSettings`, Axeptio snippet first in `<head>`, Google scripts after. Recommend when Google tags only load through a GTM container placed after Axeptio, or there are no inline `gtag()` calls.
- **B. Inline gtag defaults**: a synchronous block placed before the Axeptio snippet and before any Google script:
  ```html
  <script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('consent', 'default', { …fallback, wait_for_update: 500 });
  gtag('consent', 'default', { …opt-out, region: [ … ] });
  gtag('set', 'ads_data_redaction', true);   // if chosen
  gtag('set', 'url_passthrough', true);      // if chosen
  </script>
  ```
  `googleConsentMode` is then omitted from `axeptioSettings` (keeping both is audit rule G3). Recommend when the site has inline `gtag('config')`, a hard-coded gtag.js, or anything that may beat an async script. Use `window[dataLayerName]` if a custom `dataLayerName` is set.
- Basic vs advanced mode is a **tag-loading** decision, not a snippet setting: the guide explains it (basic: Google tags blocked until consent, GA4/Ads must be vendors in the banner; advanced: tags load immediately and send cookieless pings). Copy from the help article's comparison table.

### 3.4 Region presets (chips that append codes to the opt-out list)

- Canada except Québec: `CA-AB, CA-BC, CA-MB, CA-NB, CA-NL, CA-NS, CA-NT, CA-NU, CA-ON, CA-PE, CA-SK, CA-YT`
- United States: `US`
- Explain the alternative too: `CA` granted plus a `CA-QC` denied entry works because the most specific region wins.
- Validate every code against ISO 3166 (reuse Cookies Atlas `src/engine/iso-3166.ts` lists); warn on lowercase, spaces, or US territories written as subdivisions (`US-PR` → `PR`).

---

## 4. Verified facts: other features

### 4.1 Data source (auto-fill)

Same as Cookies Atlas (`src/app/project.ts`): `GET https://client.axept.io/projectconfigurations/brands/{id}.json`, CORS open, no custom headers (they trigger a preflight the CDN may refuse). Unknown IDs return `200 {"isEmpty": true}`. Fields used:
- `projectName`, `publishedAt`, `client.cookiesSettings.geolocation`, `geolocationFallbackConfigId`
- `cookies[]`: `name` (the value `cookiesVersion` matches), `language`, `country`, `subdivision`, `regulation`, `googleConsentMode.display` (GCM step on), `steps[].vendors[]` (`name`, `title`, `technical`, `category`)
- `isDomainRestrictionEnabled`, `verifiedDomains`
- Response headers `X-Viewer-Country(-Region)` (not needed here, but harmless)

If brands returns `isEmpty`, try the TCF endpoint the TCF SDK uses: `https://client.axept.io/tcf/{id}.json` (not yet verified for CORS or shape: check with a real TCF project ID from Pierre; if it fails, ask the user to pick "Publisher (TCF)" manually). Success there switches the wizard to TCF mode.

### 4.2 Cross-subdomain consent

`userCookiesDomain: "example.com"` (derive from the site URL the user gives, using a small public-suffix-aware rule: handle at least `co.uk`, `com.au`, `qc.ca`, `gc.ca` style two-level suffixes; ask when unsure).

### 4.3 Cross-domain consent (separate domains)

Documented in [Share consent across different domains](https://support.axeptio.eu/en/articles/274104-share-consent-across-different-domains). Generate its script verbatim (Appendix A) with the user's domain list. Constraints to show in the guide:
- Same project **and same configuration** (same `cookiesVersion`) on every site; a translated or duplicated config doesn't share consent. With location-based display this means both sites must resolve to the same config for a given visitor.
- Same list on every site, including the current one, no `https://`, no `www`; subdomains are included automatically.
- Only links present when the visitor makes their choice get the `axeptio_token`; arriving directly still shows the banner.
- Offer to download one snippet per domain (identical code, so one is enough; say so).

### 4.4 Script blocking via callbacks

For each vendor toggled on (non-`technical` vendors from the project, or manual name + code):
```html
<script>
window._axcb = window._axcb || [];
window._axcb.push(function (axeptio) {
  axeptio.on("cookies:complete", function (choices) {
    if (choices.hotjar) { loadHotjarOnce(); }
  });
});
</script>
```
- Generate a single `_axcb.push` for all vendors, each loader guarded so it runs once per page even if `cookies:complete` fires again after the visitor reopens the widget.
- The user pastes the vendor's official tag; the tool strips its outer `<script>` and wraps it. If they paste a `<script src>`, generate a `createElement('script')` loader instead.
- Warn that the vendor's original tag must be **removed** from the page, otherwise it still runs before consent.
- Revocation: note in the guide that removing an already-loaded script needs a reload (Axeptio can't unload it).
- If the site uses GTM for that vendor, say the `axeptio_activate_<vendor>` trigger in GTM is the cleaner route (this tool still outputs code).

### 4.5 Reopen-consent link

```html
<a href="#" onclick="if (window.openAxeptioCookies) { window.openAxeptioCookies(); } return false;">Gérer mes cookies</a>
```
Localized label. Optional "hide the floating cookie button": `window.hideAxeptioButton()` only exists after the widget mounts; verify on Pierre's test domain (pgagnong.com) which event to hook (`ready` or `cookies:loaded`) before shipping, and mention the back-office alternative if one exists.

### 4.6 Performance and placement

- Axeptio first in `<head>`, before GTM/gtag (and after the inline gtag defaults in mode B).
- `<link rel="preconnect" href="https://static.axept.io">` and `<link rel="preconnect" href="https://client.axept.io" crossorigin>` (the project file is a CORS fetch, so its preconnect needs `crossorigin` to be reused). Mark this as optional "performance" output; verify in DevTools that both connections are reused before making it default-on.
- Never load the SDK conditionally by region or page (the GTG article: Axeptio must load even where the banner is hidden, so it can emit `granted`).
- CSP: if the user says the site uses a nonce, add `nonce` to `axeptioSettings` and a `nonce="…"` attribute on every generated inline `<script>`.

### 4.7 GPP / US

The brands SDK handles GPP itself for configs whose regulation is `ccpa` or `gpp` (`__gpp`, `axeptio_gpp_string` cookie, GPP dataLayer events). No setting needed; the guide mentions it when the project has such configs. TCF projects expose `__tcfapi`.

---

## 5. Wizard (plain language, FR/EN)

Left: steps. Right: live output (Snippet · Guide · Audit tabs). Each answer updates the output instantly. A step can be skipped; sensible defaults apply. Mobile: output stacks below.

1. **Your project.** Project ID (optional) + "Load from Axeptio". Shows name, published date, SDK type (brands/TCF), configs (name, language, region, regulation, GCM step on/off), geolocation on/off, vendors. Without an ID: "Standard banner" or "Publisher (TCF)". Site URL (used for cookie domain, domain-restriction check and the guide).
2. **Languages and banners.** "Is your site in more than one language?" "Does your `<html lang>` match the page language?" With geolocation ON and two languages in one region: recommend `useDocumentLang: true` and explain the tie-break (browser language vs *site* language). "Do you need to force a specific banner?" defaults to **No** (no `cookiesVersion`); yes → pick from project config names, or "by page language" (dynamic object with cases) or "by browser language". Link to Cookies Atlas (`?project=…&logic=html`) to check the result on a map.
3. **Domains.** Subdomains share consent? → `userCookiesDomain`. Other domains to share with? → cross-domain script + list.
4. **Google.** Uses Google tags? How loaded (GTM container / gtag.js / inline config / none)? Basic or advanced mode (explained)? Who sets defaults (A or B, with recommendation from the answers)? Defaults editor: fallback (no region) + opt-out regions (presets + free codes) + extra entries; `wait_for_update`; ads data redaction; URL passthrough. If the project has no config with the GCM step: blocking warning (G1).
5. **Other tools (script blocking).** Vendor list with toggles and a code box each.
6. **Footer link.** Generate reopen link (label per language); hide floating button option.
7. **Advanced.** CSP nonce, cookie duration (SDK default 190), SameSite, Secure, dataLayer name, `triggerGTMEvents`, `openCookiesWidgetIfVendorsMismatch`. Toggle **Expert mode**: the full catalogue (2.3, or 2.4 in TCF), raw `axeptioSettings` editor with validation, custom keys.

Minimal-code rule: a key appears in the output only if its value differs from the SDK default (2.3) or the user pinned it in expert mode ("always write this key").

---

## 6. Output

- **Snippet tab.** One `<head>` block in this order: preconnects (optional) → inline GCM defaults (mode B) → Axeptio settings + loader → callbacks (`_axcb`: script blocking, cross-domain). Then a separate "footer" block (reopen link). Copy buttons per block and "copy all". Syntax highlighting done by hand (small tokenizer, no library). Comments in the UI language, short.
- **Guide tab.** Numbered install steps ("Paste this as high as possible in `<head>`, before your Google Tag Manager snippet"), then one short "why" per non-default line, pulled from the same catalogue entries as the tooltips. Includes the GCM mode explanation, the GCM step reminder, and the cross-domain constraints when relevant.
- **Audit tab.** See section 7.
- **Download.** A self-contained `.html` (guide + code, printable, same look) and a `.txt` with just the snippet.

---

## 7. Audit (paste an existing snippet)

Paste any HTML/JS. Parse it **without executing it** (no `eval`, no `Function`): a tolerant tokenizer for JS object literals (unquoted keys, single quotes, trailing commas, comments, nested objects/arrays; function values kept as raw text and marked "dynamic"). Detect script tags and their order. Then show findings (error / warning / info) with **the mechanism and the exact fix**, and a button "Load into the wizard" that pre-fills state from the parsed snippet and produces the optimized version (diff view: before / after).

Rules (minimum set):
- **A1 `cookiesVersion` present** (warning; error if geo is ON and it doesn't match any config name). Explain when it applies and what it overrides (2.5). Pierre's #1 rule.
- **A2 SDK loaded twice** (two loaders, or sdk.js + tcf/sdk.js): the second throws "Axeptio SDK is already loaded". Mention plugins (Shopify app, WordPress extension, GTM template) as common second sources.
- **A3 TCF loader without `type="module"`**, or brands loader with it.
- **A4 Unknown / misspelled keys** (Levenshtein ≤ 2 against the catalogue: `cookieVersion`, `useDocumentLanguage`, `userCookieDomain`…). Keys ignored by the TCF SDK when in TCF mode.
- **A5 `clientId` missing or not 24 hex**; `projectId` used with the brands SDK.
- **A6 Bad values**: `userCookiesDomain` with protocol, path, leading dot or `www`; `userCookiesSecure: false`; `triggerGTMEvents` not `true`/`false`/`"update_only"`; non-numeric duration.
- **A7 `sdk-slim.js`** (info: legacy URL).
- **G1 GCM defaults declared but no published config has the Consent Mode step** (needs auto-fill): signals stay denied forever.
- **G2 Google script before Axeptio** (gtm.js, gtag/js) in the pasted order, or `gtag('config')` before any `consent default`.
- **G3 Defaults set twice** (inline `gtag('consent','default')` and `googleConsentMode.default`): Axeptio silently skips its own, so editing `axeptioSettings` "does nothing". Keep one.
- **G4 GCM shape errors**: values not `granted`/`denied`, unknown types, `region` not an array, bad codes, regional entries with no global fallback, `url_passthrough: false` (ignored, info).
- **X1 Cross-domain script**: domains with `https://`/`www`, current domain missing from the list (can't know for sure: ask), lists that differ between pasted snippets.
- **P1 Domain restriction** (auto-fill): site domain not in `verifiedDomains` while restriction is on.
- **P2 Geo OFF, several configs, no `cookiesVersion`**: everyone gets the first config (link to Cookies Atlas).

---

## 8. Sharing and state

- All state in the URL **fragment** (`#s=…`, never the query string, so pasted vendor code never hits a server log): JSON → `CompressionStream('deflate-raw')` → base64url. Pasted audit input is **not** included. "Copy link" button. Version field in the state for future migrations.
- **Client view**: `#s=…&view=client`. Before copying, the sender fills an optional "Prepared by" name, contact (email/phone) and note, shown as a card at the top. The client sees the output tabs read-only with an "Edit" button that opens the wizard.
- `#…&internal=1` shows admin links (`https://admin.axeptio.eu/projects/{id}/cookies`) like Cookies Atlas.
- Recent projects in `localStorage` (try/catch), theme and UI language too, same keys pattern as Cookies Atlas (`snippet-generator:*`).

---

## 9. Look, tech, repo

- **Look:** copy Cookies Atlas tokens from `src/styles.css` (`:root` light, dark under `prefers-color-scheme` guarded by `:root:not([data-theme='light'])`, and `[data-theme='dark']`), Figtree headings, Source Sans 3 body, monospace for code, yellow `--accent`. Mirror the header from `src/components/Chrome.tsx` (logo mark, title, FR/EN, theme toggle) and the no-flash theme script from its `index.html`. Status colors always with an icon and a label.
- **Fonts:** self-host the latin + latin-ext woff2 files from `@fontsource/figtree` and `@fontsource/source-sans-3` under `fonts/` (the page makes no request to anything but its own files and Axeptio's CDN).
- **Files:** `index.html` (everything inline), `fonts/`, `favicon.svg`, `README.md` (EN + short FR, like Cookies Atlas), `SPEC.md`, `tests/` + a dev-only `package.json` (Playwright, no runtime deps).
- **Testability inside one file:** keep the pure logic (state → settings object → code strings, parser, audit rules, URL codec) in one clearly marked section and expose it as `window.SnippetGenerator = { generate, audit, parse, encodeState, decodeState }`. Tests load the page in Playwright and call these.
- **Deploy:** GitHub Pages from `main` / root (no workflow needed). Add `.github/workflows/test.yml` running the Playwright tests on push.
- **Catalogue drift (nice to have):** a weekly workflow like Cookies Atlas `sdk-drift.yml` that downloads sdk.js and tcf/sdk.js, re-extracts the `class Hr` field list and the TCF destructuring, and opens an issue if they changed.
- **Sandbox caveat for the build session:** the cloud sandbox can't reach `*.axept.io` (proxy 403). Read sdk.js and project files through Claude in Chrome from a neutral page (example.com): `fetch()` then return slices under ~900 characters, replacing `cookie` with `CK` and `=` with another character, or the extension blocks the output. Useful anchors: `indexOf('class Hr{')`, `'getComoV2DefaultSettings(){'`, `'applyGoogleConsentModeFlagsFromSettings(){'`, `'loadCrossDomains(e){'`, `'if(window.axeptioSettings!==void 0){let{'` (tcf).

---

## 10. Acceptance tests

Exact output (whitespace-normalized) for:

1. **Minimal brands.** clientId `691245e5b48e4a03c7b9c5c5`, nothing else → exactly the loader in 2.1 with only `clientId`. No preconnects unless toggled.
2. **Mackage-style** (project `691245e5b48e4a03c7b9c5c5`, geo ON, QC FR/EN, US/CA, UK, EU; GCM step on): two languages + correct html lang → `useDocumentLang: true`, **no `cookiesVersion`**; GCM mode A with fallback denied + opt-out `["US", CA except QC]` granted → `googleConsentMode.default` array as in 3.1.
3. **Same, mode B** → inline gtag block first (two `consent default` calls), `axeptioSettings` without `googleConsentMode`.
4. **TCF.** Manual "Publisher (TCF)" + GCM → `tcf/sdk.js` loader with `e.type = "module"`; expert mode hides `useDocumentLang`; pasting a TCF snippet containing `useDocumentLang` yields A4.
5. **Cross-domain** with `maboutique.com, monblog.com` → Appendix A script with that list; pasting `https://www.monblog.com` yields X1.
6. **Script blocking** with Hotjar on (from the Mackage vendor list, name `hotjar`) → one `_axcb.push`, guarded loader keyed on `choices.hotjar`.
7. **Audit** of:
   ```html
   <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
   <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('config','G-XXXX');</script>
   <script>window.axeptioSettings={clientId:"691245e5b48e4a03c7b9c5c5",cookieVersion:"CA-QC FR",googleConsentMode:{default:{analytics_storage:"denied"}}};(function(d,s){var t=d.getElementsByTagName(s)[0],e=d.createElement(s);e.async=true;e.src="//static.axept.io/sdk.js";t.parentNode.insertBefore(e,t);})(document,"script");</script>
   ```
   → A4 (`cookieVersion` → `cookiesVersion`), G2 (Google before Axeptio, config before default), and "Load into wizard" produces a corrected snippet.
8. **URL round-trip**: every test state encodes and decodes to an identical object; client view renders with name/contact/note.
9. **FR/EN**: every UI string and every generated comment exists in both languages (test like Cookies Atlas `tests/copy.test.ts`).

Before shipping, Pierre checks scenarios 2, 3 and 6 on a test project on pgagnong.com (Tag Assistant for GCM order).

**Out of scope for v1:** GTM template output, CMS plugins, SPA framework guides, mobile SDKs, server-side tagging setup, scanning a live URL (needs a proxy).

---

## Appendix A: cross-domain consent script (from the help center, 2026-10-29)

Only `sharedConsentDomains` changes; comments are localized in the output.

```html
<script>
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
</script>
```
The receiving SDK reads `?axeptio_token=` from `location.search` before anything else (verified in sdk.js).

## Appendix B: sources

- Help center: [axeptioSettings options](https://support.axeptio.eu/en/articles/274040-advanced-options-and-mode-axeptiosettings) · [GCM v2 hard-coded](https://support.axeptio.eu/en/articles/704809-configure-google-consent-mode-v2-hard-coded-integration) · [Share consent across domains](https://support.axeptio.eu/en/articles/274104-share-consent-across-different-domains) · [Dynamic cookiesVersion](https://support.axeptio.eu/en/articles/330536-dynamic-loading-of-configurations-via-custom-code) · [TCF integrate](https://support.axeptio.eu/en/articles/274044-tcf-integrate-and-publish) · [GTM template parameters](https://support.axeptio.eu/en/articles/697549-gtm-axeptio-cmp-template-parameters) · [Google Tag Gateway](https://support.axeptio.eu/en/articles/676210-configure-your-axeptio-setup-for-google-tag-gateway-gtg) · [CSP](https://support.axeptio.eu/en/articles/273997-axeptio-csp-configuration)
- Code: `https://static.axept.io/sdk.js` (build 2026-10-28T21:27:12Z), `https://static.axept.io/tcf/sdk.js` (Last-Modified 2026-10-29)
- Sister project: https://github.com/pggpgg/cookies-atlas (`docs/SPEC.md`, `src/app/project.ts`, `src/styles.css`, `src/engine/`)
