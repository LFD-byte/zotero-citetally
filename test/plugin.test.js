"use strict";
// Boots src/bootstrap.js in a VM against a mock of the Zotero 8–10 plugin APIs.
// This catches wiring mistakes (wrong API names, scope issues, save logic);
// it does not replace a manual check in a real Zotero.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const plain = (x) => JSON.parse(JSON.stringify(x));
const SRC = path.join(__dirname, "..", "src") + "/";
const ROOT_URI = "file://" + SRC;

class FakeItem {
  constructor(id, fields, { regular = true, itemType = "journalArticle" } = {}) {
    this.id = id;
    this.fields = { extra: "", url: "", title: "", date: "", ...fields };
    this._regular = regular;
    this.itemType = itemType;
    this.itemTypeID = itemType === "journalArticle" ? 1 : 2;
    this.library = { editable: true };
    this.saved = 0;
    this.lastSaveOpts = null;
  }
  isRegularItem() { return this._regular; }
  getField(f) { return this.fields[f] ?? ""; }
  setField(f, v) { this.fields[f] = v; }
  async save(opts) { this.saved++; this.lastSaveOpts = opts; }
}

function makeEnv({ zotero10 = true, prefs = {}, http } = {}) {
  const calls = { menus: [], columns: [], unregMenus: [], unregColumns: [], ftl: [], staged: [], http: [], pw: [] };
  const prefStore = {
    "extensions.citecounts.openalex.enabled": true,
    "extensions.citecounts.openalex.apiKey": "OAKEY",
    "extensions.citecounts.s2.enabled": true,
    "extensions.citecounts.s2.apiKey": "",
    "extensions.citecounts.email": "",
    "extensions.citecounts.titleFallback": true,
    "extensions.citecounts.autoOnAdd": false,
    "extensions.citecounts.staleDays": "30",
    recursiveCollections: false,
    ...prefs,
  };
  const win = {
    MozXULElement: { insertFTLIfNeeded: (f) => calls.ftl.push(f) },
    document: { querySelector: () => null },
  };
  class ProgressWindow {
    constructor() {
      const self = this;
      this.lines = [];
      this.descriptions = [];
      calls.pw.push(this);
      this.ItemProgress = function (icon, text) {
        this.text = text;
        this.progress = 0;
        this.setText = (t) => { this.text = t; };
        this.setProgress = (p) => { this.progress = p; };
        self.lines.push(this);
      };
    }
    changeHeadline(h) { this.headline = h; }
    show() {}
    addDescription(d) { this.descriptions.push(d); }
    startCloseTimer() {}
  }
  const items = new Map();
  const Zotero = {
    initializationPromise: Promise.resolve(),
    locale: "en-US",
    debug: () => {},
    logError: (e) => { throw e; },
    getMainWindows: () => [win],
    Prefs: { get: (k) => prefStore[k] },
    PreferencePanes: { register: async (o) => { calls.pane = o; return "pane-id"; } },
    Notifier: { registerObserver: (obs) => { calls.observer = obs; return "obs-id"; }, unregisterObserver: (id) => { calls.unregObserver = id; } },
    MenuManager: {
      registerMenu: (o) => { calls.menus.push(o); return o.menuID; },
      unregisterMenu: (id) => calls.unregMenus.push(id),
    },
    ItemTreeManager: {
      registerColumn: async (c) => { calls.columns.push(c); return c.dataKey; },
      unregisterColumn: (k) => calls.unregColumns.push(k),
    },
    ftl: { addResourceIds: (ids) => calls.ftl.push(...ids), removeResourceIds: () => {} },
    HTTP: {
      request: async (method, url, opts) => {
        calls.http.push({ method, url, opts });
        assert.equal(opts.successCodes, false);
        assert.equal(opts.responseType, "json");
        const r = await http(method, url, opts);
        return { status: r.status, response: r.json };
      },
    },
    Promise: { delay: async () => {} },
    ProgressWindow,
    DB: { executeTransaction: async (fn) => fn() },
    ItemFields: {
      getID: (f) => (f === "DOI" ? 26 : null),
      isValidForType: (fid, typeID) => typeID === 1,
    },
    Date: { strToDate: (s) => { const m = /(\d{4})/.exec(s); return m ? { year: m[1] } : {}; } },
    Items: {
      getAsync: async (ids) => ids.map((i) => items.get(i)),
      getAll: async () => Array.from(items.values()),
    },
  };
  if (zotero10) Zotero.UndoHistory = { stageAction: (a, args) => calls.staged.push([a, args]) };

  const timers = require("node:timers");
  const ctx = {
    Zotero,
    ChromeUtils: { importESModule: () => ({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }) },
    Services: {
      scriptloader: {
        loadSubScript: (uri) => {
          const file = uri.replace("file://", "");
          vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
        },
        loadSubScriptWithOptions(uri, opts) {
          calls.loadOpts = calls.loadOpts || [];
          calls.loadOpts.push(JSON.parse(JSON.stringify(opts)));
          this.loadSubScript(uri);
        },
      },
    },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC + "bootstrap.js", "utf8"), ctx, { filename: "bootstrap.js" });
  return { ctx, calls, items, win, Zotero, addItem: (it) => items.set(it.id, it) };
}

function defaultHttp(method, url, opts) {
  if (url.includes("api.openalex.org/works?filter=")) {
    return { status: 200, json: { results: [{ doi: "https://doi.org/10.1000/a", cited_by_count: 42 }] } };
  }
  if (url.includes("paper/batch")) {
    const ids = JSON.parse(opts.body).ids;
    return { status: 200, json: ids.map((i) => (i === "DOI:10.1000/a" ? { citationCount: 40 } : null)) };
  }
  if (url.includes("openalex") && url.includes("search=")) return { status: 200, json: { results: [] } };
  if (url.includes("search/match")) return { status: 404, json: null };
  return { status: 404, json: null };
}

async function boot(env) {
  await env.ctx.startup({ id: "citation-counts@test", version: "1.0.0", rootURI: ROOT_URI });
}

function menuItem(env, menuID, l10nID) {
  const m = env.calls.menus.find((x) => x.menuID === menuID);
  return m.menus.find((x) => x.l10nID === l10nID);
}

test("startup registers columns, menus, pane, observer and FTL", async () => {
  const env = makeEnv({ http: defaultHttp });
  await boot(env);
  assert.deepEqual(env.calls.columns.map((c) => c.dataKey), ["citecounts-openalex", "citecounts-s2"]);
  assert.ok(env.calls.columns.every((c) => c.pluginID === "citation-counts@test"));
  assert.deepEqual(env.calls.menus.map((m) => m.target), ["main/library/item", "main/library/collection"]);
  assert.equal(env.calls.pane.src, ROOT_URI + "content/preferences.xhtml");
  assert.deepEqual(env.calls.loadOpts, [{ allowUnsafeURL: true }, { allowUnsafeURL: true }]);
  assert.ok(env.calls.ftl.includes("citecounts.ftl"));
  assert.equal(typeof env.calls.observer.notify, "function");
  // every l10nID used by menus exists in both locales
  const ids = env.calls.menus.flatMap((m) => m.menus.map((x) => x.l10nID));
  for (const loc of ["en-US", "zh-CN"]) {
    const ftl = fs.readFileSync(path.join(SRC, "locale", loc, "citecounts.ftl"), "utf8");
    for (const id of [...ids, "citecounts-undo-update", "citecounts-undo-clear"]) {
      assert.match(ftl, new RegExp("^" + id + " =", "m"), `${loc} missing ${id}`);
    }
  }
});

test("update from item menu writes Extra, column shows counts, one undo step", async () => {
  const env = makeEnv({ http: defaultHttp });
  await boot(env);
  const a = new FakeItem(1, { DOI: "10.1000/A", extra: "my note", title: "Paper A", date: "2020" });
  const b = new FakeItem(2, { title: "Unknown Paper Title Here", date: "2021" });
  const note = new FakeItem(3, {}, { regular: false });

  const it = menuItem(env, "citecounts-item", "citecounts-menu-update");
  let visible;
  it.onShowing(null, { items: [a, b, note], setVisible: (v) => (visible = v) });
  assert.equal(visible, true);
  await it.onCommand(null, { items: [a, b, note] });

  assert.match(a.fields.extra, /^Citations \(OpenAlex\): 42 \[\d{4}-\d\d-\d\d\]\nCitations \(Semantic Scholar\): 40 \[\d{4}-\d\d-\d\d\]\nmy note$/);
  assert.equal(a.saved, 1);
  assert.deepEqual(plain(a.lastSaveOpts), { skipDateModifiedUpdate: true });
  assert.equal(b.saved, 0); // nothing found -> untouched
  assert.equal(note.saved, 0);
  assert.deepEqual(plain(env.calls.staged), [["citecounts-undo-update", { count: 1 }]]);

  const [colOA, colS2] = env.calls.columns;
  assert.equal(colOA.dataProvider(a), "42");
  assert.equal(colS2.dataProvider(a), "40");
  assert.equal(colOA.dataProvider(b), "");
  assert.equal(colOA.dataProvider(note), "");

  const pw = env.calls.pw.at(-1);
  assert.match(pw.lines[0].text, /Updated 1 of 2 items/);
  assert.ok(pw.descriptions.some((d) => /1 without DOI/.test(d)));
  // the OpenAlex key went into the query string; S2 had none
  assert.ok(env.calls.http.some((c) => c.url.includes("api_key=OAKEY")));
  assert.ok(env.calls.http.filter((c) => c.url.includes("paper/batch")).every((c) => !c.opts.headers["x-api-key"]));
});

test("'update outdated' skips fresh items", async () => {
  const env = makeEnv({ http: defaultHttp });
  await boot(env);
  const today = env.ctx.CiteCountsLib.todayISO();
  const fresh = new FakeItem(1, {
    DOI: "10.1000/a",
    extra: `Citations (OpenAlex): 1 [${today}]\nCitations (Semantic Scholar): 1 [${today}]`,
  });
  await menuItem(env, "citecounts-item", "citecounts-menu-update-stale").onCommand(null, { items: [fresh] });
  assert.equal(env.calls.http.length, 0);
  assert.match(env.calls.pw.at(-1).descriptions[0], /up to date/);
});

test("clear removes only plugin lines", async () => {
  const env = makeEnv({ http: defaultHttp });
  await boot(env);
  const a = new FakeItem(1, { extra: "Citations (OpenAlex): 5 [2026-01-01]\nkeep" });
  await menuItem(env, "citecounts-item", "citecounts-menu-clear").onCommand(null, { items: [a] });
  assert.equal(a.fields.extra, "keep");
  assert.deepEqual(plain(env.calls.staged), [["citecounts-undo-clear", { count: 1 }]]);
});

test("collection menu works with Zotero 10 plural rows (singular getter throws)", async () => {
  const env = makeEnv({ http: defaultHttp });
  await boot(env);
  const a = new FakeItem(1, { DOI: "10.1000/a" });
  const coll = { getChildItems: () => [a], getChildCollections: () => [] };
  const row = { isCollection: () => true, isLibrary: () => false, isSearch: () => false, ref: coll };
  const ctx = {
    collectionTreeRows: [row],
    get collectionTreeRow() { throw new Error("use collectionTreeRows"); },
    setVisible(v) { this.visible = v; },
  };
  const mi = menuItem(env, "citecounts-collection", "citecounts-menu-collection");
  mi.onShowing(null, ctx);
  assert.equal(ctx.visible, true);
  await mi.onCommand(null, ctx);
  assert.match(a.fields.extra, /Citations \(OpenAlex\): 42/);
});

test("collection menu works with Zotero 8/9 singular row and no undo API", async () => {
  const env = makeEnv({ http: defaultHttp, zotero10: false });
  await boot(env);
  const a = new FakeItem(1, { DOI: "10.1000/a" });
  const row = { isCollection: () => true, isLibrary: () => false, isSearch: () => false, ref: { getChildItems: () => [a], getChildCollections: () => [] } };
  const ctx = { collectionTreeRow: row, setVisible() {} };
  await menuItem(env, "citecounts-collection", "citecounts-menu-collection").onCommand(null, ctx);
  assert.equal(a.saved, 1);
});

test("auto-fetch on add is off by default and debounced when on", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = makeEnv({ http: defaultHttp, prefs: { "extensions.citecounts.autoOnAdd": true } });
  await boot(env);
  const a = new FakeItem(7, { DOI: "10.1000/a" });
  env.addItem(a);
  env.calls.observer.notify("add", "item", [7]);
  assert.equal(env.calls.http.length, 0);
  t.mock.timers.tick(15000);
  // let the async flush finish
  for (let i = 0; i < 20 && !a.saved; i++) await new Promise((r) => setImmediate(r));
  assert.equal(a.saved, 1);
  assert.equal(env.calls.pw.length, 0, "auto-fetch is quiet");
});

test("auth failure is shown, nothing saved", async () => {
  const env = makeEnv({ http: () => ({ status: 401, json: null }), prefs: { "extensions.citecounts.s2.enabled": false } });
  await boot(env);
  const a = new FakeItem(1, { DOI: "10.1000/a" });
  await menuItem(env, "citecounts-item", "citecounts-menu-update").onCommand(null, { items: [a] });
  assert.equal(a.saved, 0);
  assert.ok(env.calls.pw.at(-1).descriptions.some((d) => /API key/.test(d)));
});

test("shutdown unregisters everything", async () => {
  const env = makeEnv({ http: defaultHttp });
  await boot(env);
  env.ctx.shutdown();
  assert.deepEqual(env.calls.unregMenus, ["citecounts-item", "citecounts-collection"]);
  assert.deepEqual(env.calls.unregColumns, ["citecounts-openalex", "citecounts-s2"]);
  assert.equal(env.calls.unregObserver, "obs-id");
  assert.equal(env.ctx.CiteCounts, undefined);
});
