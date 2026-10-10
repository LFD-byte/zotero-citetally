# Maintaining

Written so that anyone — including an AI assistant with no memory of earlier
sessions — can pick this up from the repository alone.

## Layout

| Path | Role |
| --- | --- |
| `src/manifest.json` | Template. `__PLACEHOLDERS__` are filled by `scripts/build.mjs` from `package.json`. |
| `src/bootstrap.js` | Zotero lifecycle hooks; loads the two content scripts. |
| `src/content/lib.js` | **All logic that doesn't touch Zotero**: Extra parsing, identifiers, title matching, OpenAlex/S2 requests, retries. Unit-tested in Node. |
| `src/content/citecounts.js` | Zotero glue: columns, menus, prefs pane, notifier, saving. |
| `src/content/preferences.xhtml` | Settings pane (prefs are bound by the `preference` attribute). |
| `src/locale/{en-US,zh-CN}/citecounts.ftl` | Fluent strings for menus, prefs and undo labels. Short runtime strings live in `CiteCounts.t()`. |
| `src/prefs.js` | Default prefs (`extensions.citecounts.*`). |
| `test/lib.test.js` | Unit tests for `lib.js`. |
| `test/plugin.test.js` | Boots the real plugin in a VM against a mock Zotero 8–10 API. |

Zotero APIs used: `Zotero.MenuManager` (8+), `Zotero.ItemTreeManager.registerColumn`,
`Zotero.PreferencePanes.register`, `Zotero.Notifier`, `Zotero.HTTP.request`,
`Zotero.ProgressWindow`, `Zotero.UndoHistory.stageAction` (10+, optional).

Scripts are loaded with `loadSubScriptWithOptions(url, { allowUnsafeURL: true })`:
from Firefox 153.3 ESR, plain `loadSubScript` refuses `jar:` URIs (Mozilla bug
1974213; Zotero commit ba2d6ece). Keep it that way.

Column sorting is numeric only while Zotero's `naturalSorting` pref is on
(the default); that comparison lives in Zotero, not here.

**Never change the add-on ID** (`citetally@lfd-byte.github.io`, `config.addonID` in
`package.json`). Changing it breaks auto-update for every installed copy.

## When a new Zotero major version ships

1. Read `https://www.zotero.org/support/dev/zotero_<N>_for_developers`.
2. Grep this repo for every API that page says changed or was removed. The list
   above is the complete set of Zotero APIs in use.
3. If something changed: fix `citecounts.js`, mirror the change in the mock in
   `test/plugin.test.js` (keep the old behaviour tested too while older
   versions are still supported), run `npm test`.
4. Set `config.zoteroMaxVersion` in `package.json` to `<N>.0.*`.
5. Release (below). Ask the maintainer to install the new `.xpi` in the new
   Zotero and click through: update an item, update a collection, sort a
   column, open settings.

To drop an old Zotero version, raise `config.zoteroMinVersion` (e.g. `8.999`
to require 9) and remove the compatibility branch and its test.

## When a data source changes

OpenAlex and Semantic Scholar code is entirely in `lib.js` (`buildOpenAlex*`,
`parseOpenAlexBatch`, `S2_BATCH_URL`, `parseS2Batch`, `fetchOpenAlex`,
`fetchS2`). Update the fixtures in `test/lib.test.js` from a real response
first, then fix the parser.

Known constraints (as of 2026-10):
- OpenAlex requires `api_key` for real use; ~$1/day free usage per key. The
  batch request filters up to 50 DOIs with `doi:a|b|c`.
- Semantic Scholar batch endpoint takes up to 500 ids; unauthenticated traffic
  shares one pool, so the plugin waits 3 s between S2 requests without a key
  and 1.1 s with one.

## Releasing

```bash
# bump "version" in package.json and add a "## x.y.z" section to CHANGELOG.md
npm test && npm run build
git commit -am "Release x.y.z"
git tag vx.y.z && git push && git push --tags
```

The `Release` workflow checks the tag matches `package.json`, runs tests and
lint, builds, and publishes a GitHub release with the `.xpi` and
`update.json`. Installed copies poll
`https://github.com/<repo>/releases/latest/download/update.json` and update
themselves.
