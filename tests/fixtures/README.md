# Test fixtures

Trimmed copies of real published project files, read from `client.axept.io` on 2026-10-30. The tests never call Axeptio: they serve these files through Playwright route interception.

| File | Project | Read from |
| --- | --- | --- |
| `mackage.json` | Mackage all countries (`691245e5b48e4a03c7b9c5c5`), 6 brands banners, location-based display on, Consent Mode v2 step on every banner | `https://client.axept.io/projectconfigurations/brands/691245e5b48e4a03c7b9c5c5.json` |
| `tcf-dev.json` | Dev (`69bf231ed26c858445ab2d62`), one TCF banner for Quebec (`country: CA`, `subdivision: QC`) | `https://client.axept.io/tcf/69bf231ed26c858445ab2d62.json` |

What was trimmed: long texts, images, styles and step content the generator never reads. The keys the generator does read are kept as published:

- brands: `projectId`, `projectName`, `publishedAt`, `isDomainRestrictionEnabled`, `verifiedDomains`, `client.cookiesSettings` (location-based display and fallback), and for each banner in `cookies`: `identifier`, `name`, `language`, `country`, `subdivision`, `regulation`, `googleConsentMode`, `settings` and `steps` (name, layout, vendor names).
- TCF: the same project keys, and for each banner in `consents`: `identifier`, `name`, `language`, `country`, `subdivision` and `google_consent_mode`.

If Axeptio changes the shape of these files, refresh them the same way (open the URL in a browser, keep the same keys) and rerun `npm test`.
