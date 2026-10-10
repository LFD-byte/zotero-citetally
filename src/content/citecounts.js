/* global Zotero, CiteCountsLib, ChromeUtils */
/* eslint-disable no-global-assign */

// Zotero integration. Loaded into the bootstrap scope after lib.js.
// Targets Zotero 8–10 (MenuManager, ItemTreeManager, PreferencePanes).
CiteCounts = {
  id: null,
  version: null,
  rootURI: null,
  PREF: "extensions.citecounts.",
  FTL: "citecounts.ftl",

  columnKeys: [],
  menuIDs: [],
  prefPaneID: null,
  notifierID: null,

  running: false,
  cancelRequested: false,
  addQueue: new Set(),
  addTimer: null,

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    // The bootstrap sandbox has no window timers.
    this.timer = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  },

  log(msg) {
    Zotero.debug("[Citation Counts] " + msg);
  },

  async startup() {
    // Strings formatted through Zotero.ftl (undo labels in Zotero 10)
    try {
      if (Zotero.ftl && Zotero.ftl.addResourceIds) Zotero.ftl.addResourceIds([this.FTL]);
    } catch (e) {
      this.log("ftl: " + e);
    }
    await this.registerColumns();
    this.registerMenus();
    this.prefPaneID = await Zotero.PreferencePanes.register({
      pluginID: this.id,
      src: this.rootURI + "content/preferences.xhtml",
      label: "Citation Counts",
      image: this.rootURI + "content/icons/icon.svg",
    });
    this.notifierID = Zotero.Notifier.registerObserver(this, ["item"], "citecounts");
    this.log(`started v${this.version}`);
  },

  shutdown() {
    this.cancelRequested = true;
    if (this.addTimer) this.timer.clearTimeout(this.addTimer);
    if (this.notifierID) Zotero.Notifier.unregisterObserver(this.notifierID);
    for (const id of this.menuIDs) {
      try {
        Zotero.MenuManager.unregisterMenu(id);
      } catch (e) {
        /* already gone */
      }
    }
    for (const key of this.columnKeys) {
      try {
        Zotero.ItemTreeManager.unregisterColumn(key);
      } catch (e) {
        /* already gone */
      }
    }
    try {
      if (Zotero.ftl && Zotero.ftl.removeResourceIds) Zotero.ftl.removeResourceIds([this.FTL]);
    } catch (e) {
      /* ignore */
    }
    for (const win of Zotero.getMainWindows()) this.onMainWindowUnload(win);
  },

  onMainWindowLoad(win) {
    try {
      win.MozXULElement.insertFTLIfNeeded(this.FTL);
    } catch (e) {
      this.log("insertFTLIfNeeded: " + e);
    }
  },

  onMainWindowUnload(win) {
    try {
      const link = win.document.querySelector(`[href="${this.FTL}"]`);
      if (link) link.remove();
    } catch (e) {
      /* ignore */
    }
  },

  // ---------------------------------------------------------------------------
  // Preferences & strings
  // ---------------------------------------------------------------------------
  pref(key) {
    return Zotero.Prefs.get(this.PREF + key, true);
  },

  options() {
    const staleDays = parseInt(String(this.pref("staleDays") || "30"), 10);
    return {
      sources: {
        openalex: !!this.pref("openalex.enabled"),
        s2: !!this.pref("s2.enabled"),
      },
      opts: {
        openalexKey: String(this.pref("openalex.apiKey") || "").trim(),
        s2Key: String(this.pref("s2.apiKey") || "").trim(),
        email: String(this.pref("email") || "").trim(),
        titleFallback: !!this.pref("titleFallback"),
      },
      staleDays: Number.isFinite(staleDays) && staleDays >= 0 ? staleDays : 30,
    };
  },

  // Plain strings for places that don't take Fluent IDs (progress window,
  // column labels). Fluent is used for menus and the preferences pane.
  t(key, args) {
    const zh = /^zh/i.test(Zotero.locale || "");
    const S = {
      colOA: ["Cites (OpenAlex)", "引用 (OpenAlex)"],
      colS2: ["Cites (S2)", "引用 (S2)"],
      headline: ["Citation Counts", "引用数"],
      fetching: ["Fetching citation counts for {n} items…", "正在获取 {n} 个条目的引用数…"],
      progress: ["{done}/{total}", "{done}/{total}"],
      saving: ["Saving…", "正在保存…"],
      done: ["Updated {updated} of {total} items", "已更新 {updated}/{total} 个条目"],
      noId: ["{n} without DOI/arXiv ID or matching title", "{n} 个条目缺少 DOI/arXiv ID 且标题未匹配"],
      upToDate: ["All selected items are up to date", "所选条目的引用数都已是最新"],
      cancelled: ["Cancelled", "已取消"],
      busy: ["An update is already running", "已有更新任务在运行"],
      noSource: ["Enable at least one source in Settings → Citation Counts", "请在 设置 → 引用数 中至少启用一个数据源"],
      noKey: [
        "No OpenAlex API key set — only a small daily budget is available. Add a free key in Settings → Citation Counts.",
        "未设置 OpenAlex API key，每日额度很小。可在 设置 → 引用数 中填入免费 key。",
      ],
      cleared: ["Removed citation counts from {n} items", "已移除 {n} 个条目的引用数"],
      error: ["Error: {msg}", "错误：{msg}"],
    };
    let s = (S[key] || [key, key])[zh ? 1 : 0];
    for (const [k, v] of Object.entries(args || {})) s = s.replace("{" + k + "}", v);
    return s;
  },

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------
  async registerColumns() {
    const L = CiteCountsLib;
    const make = (source, label) => ({
      dataKey: "citecounts-" + source,
      label,
      pluginID: this.id,
      zoteroPersist: ["width", "hidden", "sortDirection"],
      dataProvider: (item) => {
        try {
          if (!item.isRegularItem()) return "";
          const c = L.parseExtra(item.getField("extra"))[source];
          return c ? String(c.count) : "";
        } catch (e) {
          return "";
        }
      },
    });
    for (const col of [make("openalex", this.t("colOA")), make("s2", this.t("colS2"))]) {
      const key = await Zotero.ItemTreeManager.registerColumn(col);
      if (key) this.columnKeys.push(key);
    }
  },

  // ---------------------------------------------------------------------------
  // Menus (Zotero 8+ MenuManager)
  // ---------------------------------------------------------------------------
  registerMenus() {
    const hasRegular = (items) => (items || []).some((i) => i.isRegularItem());
    const itemMenu = Zotero.MenuManager.registerMenu({
      menuID: "citecounts-item",
      pluginID: this.id,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "citecounts-menu-update",
          onShowing: (ev, ctx) => ctx.setVisible(!this.running && hasRegular(ctx.items)),
          onCommand: (ev, ctx) => this.updateItems(ctx.items, { onlyStale: false }),
        },
        {
          menuType: "menuitem",
          l10nID: "citecounts-menu-update-stale",
          onShowing: (ev, ctx) => ctx.setVisible(!this.running && hasRegular(ctx.items)),
          onCommand: (ev, ctx) => this.updateItems(ctx.items, { onlyStale: true }),
        },
        {
          menuType: "menuitem",
          l10nID: "citecounts-menu-clear",
          onShowing: (ev, ctx) => ctx.setVisible(!this.running && hasRegular(ctx.items)),
          onCommand: (ev, ctx) => this.clearItems(ctx.items),
        },
        {
          menuType: "menuitem",
          l10nID: "citecounts-menu-stop",
          onShowing: (ev, ctx) => ctx.setVisible(this.running),
          onCommand: () => {
            this.cancelRequested = true;
          },
        },
      ],
    });
    if (itemMenu) this.menuIDs.push(itemMenu);

    const collMenu = Zotero.MenuManager.registerMenu({
      menuID: "citecounts-collection",
      pluginID: this.id,
      target: "main/library/collection",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "citecounts-menu-collection",
          onShowing: (ev, ctx) => {
            const rows = this.contextRows(ctx);
            ctx.setVisible(
              !this.running &&
                rows.length > 0 &&
                rows.every((r) => r.isCollection() || r.isLibrary(true) || r.isSearch())
            );
          },
          onCommand: async (ev, ctx) => {
            const items = await this.itemsForRows(this.contextRows(ctx));
            await this.updateItems(items, { onlyStale: false });
          },
        },
        {
          menuType: "menuitem",
          l10nID: "citecounts-menu-collection-stale",
          onShowing: (ev, ctx) => {
            const rows = this.contextRows(ctx);
            ctx.setVisible(
              !this.running &&
                rows.length > 0 &&
                rows.every((r) => r.isCollection() || r.isLibrary(true) || r.isSearch())
            );
          },
          onCommand: async (ev, ctx) => {
            const items = await this.itemsForRows(this.contextRows(ctx));
            await this.updateItems(items, { onlyStale: true });
          },
        },
      ],
    });
    if (collMenu) this.menuIDs.push(collMenu);
  },

  /** Selected collection-tree rows; Zotero 10 has a plural API, 8/9 a singular one. */
  contextRows(ctx) {
    try {
      if (Array.isArray(ctx.collectionTreeRows)) return ctx.collectionTreeRows;
    } catch (e) {
      /* not available */
    }
    try {
      const row = ctx.collectionTreeRow;
      if (row) return [row];
    } catch (e) {
      /* throws in Zotero 10 */
    }
    return [];
  },

  async itemsForRows(rows) {
    const seen = new Map();
    const recursive = !!Zotero.Prefs.get("recursiveCollections");
    for (const row of rows) {
      let items = [];
      if (row.isCollection()) {
        const collect = (c) => {
          items.push(...c.getChildItems(false, false));
          if (recursive) for (const sub of c.getChildCollections(false, false)) collect(sub);
        };
        collect(row.ref);
      } else if (row.isLibrary(true)) {
        items = await Zotero.Items.getAll(row.ref.libraryID, true, false);
      } else if (row.isSearch()) {
        const ids = await row.ref.search();
        items = await Zotero.Items.getAsync(ids);
      }
      for (const it of items) if (it && it.isRegularItem()) seen.set(it.id, it);
    }
    return Array.from(seen.values());
  },

  // ---------------------------------------------------------------------------
  // Auto-fetch for newly added items
  // ---------------------------------------------------------------------------
  notify(event, type, ids) {
    if (event !== "add" || type !== "item" || !this.pref("autoOnAdd")) return;
    for (const id of ids) this.addQueue.add(id);
    // Metadata (DOI etc.) often arrives a few seconds after the item is created,
    // e.g. when Zotero retrieves metadata for a dropped PDF. Debounce.
    if (this.addTimer) this.timer.clearTimeout(this.addTimer);
    this.addTimer = this.timer.setTimeout(() => this.flushAddQueue(), 15000);
  },

  async flushAddQueue() {
    this.addTimer = null;
    if (this.running) {
      this.addTimer = this.timer.setTimeout(() => this.flushAddQueue(), 15000);
      return;
    }
    const ids = Array.from(this.addQueue);
    this.addQueue.clear();
    const items = (await Zotero.Items.getAsync(ids)).filter(
      (i) => i && !i.deleted && i.isRegularItem()
    );
    if (!items.length) return;
    // Large imports or syncs: don't silently fire hundreds of requests.
    if (items.length > 50) {
      this.log(`skipping auto-fetch for ${items.length} added items (bulk add)`);
      return;
    }
    await this.updateItems(items, { onlyStale: true, quiet: true });
  },

  // ---------------------------------------------------------------------------
  // Update / clear
  // ---------------------------------------------------------------------------
  fieldIfValid(item, field) {
    try {
      const fid = Zotero.ItemFields.getID(field);
      if (fid && Zotero.ItemFields.isValidForType(fid, item.itemTypeID)) return item.getField(field);
    } catch (e) {
      /* ignore */
    }
    return "";
  },

  recordFor(item) {
    const date = item.getField("date");
    const parsed = date ? Zotero.Date.strToDate(date) : null;
    return {
      id: item.id,
      ids: CiteCountsLib.getIdentifiers({
        doi: this.fieldIfValid(item, "DOI"),
        extra: item.getField("extra"),
        url: item.getField("url"),
        title: item.getField("title"),
        year: parsed && parsed.year ? parsed.year : null,
      }),
    };
  },

  async http(method, url, init) {
    const xhr = await Zotero.HTTP.request(method, url, {
      headers: init.headers || {},
      body: init.body,
      responseType: "json",
      successCodes: false,
      timeout: 30000,
    });
    return { status: xhr.status, json: xhr.response };
  },

  async updateItems(items, { onlyStale = false, quiet = false } = {}) {
    const L = CiteCountsLib;
    items = (items || []).filter((i) => i.isRegularItem() && i.library && i.library.editable);
    if (!items.length) return;
    if (this.running) {
      if (!quiet) this.flash(this.t("busy"));
      return;
    }
    const { sources, opts, staleDays } = this.options();
    const enabled = Object.keys(sources).filter((k) => sources[k]);
    if (!enabled.length) {
      if (!quiet) this.flash(this.t("noSource"));
      return;
    }

    if (onlyStale) {
      const today = L.todayISO();
      items = items.filter((it) => {
        const have = L.parseExtra(it.getField("extra"));
        return enabled.some((k) => !have[k] || L.daysBetween(have[k].date, today) >= staleDays);
      });
      if (!items.length) {
        if (!quiet) this.flash(this.t("upToDate"));
        return;
      }
    }

    this.running = true;
    this.cancelRequested = false;
    let pw = null;
    let line = null;
    if (!quiet) {
      pw = new Zotero.ProgressWindow({ closeOnClick: false });
      pw.changeHeadline(this.t("headline"));
      line = new pw.ItemProgress(null, this.t("fetching", { n: items.length }));
      pw.show();
      if (sources.openalex && !opts.openalexKey) {
        pw.addDescription(this.t("noKey"));
      }
    }

    try {
      const records = items.map((it) => this.recordFor(it));
      const results = await L.fetchCounts({
        records,
        sources,
        opts,
        http: (m, u, i) => this.http(m, u, i),
        sleep: (ms) => Zotero.Promise.delay(ms),
        isCancelled: () => this.cancelRequested,
        log: (m) => this.log(m),
        onProgress: (done, total) => {
          if (line) {
            line.setProgress(total ? Math.round((done / total) * 100) : 100);
            line.setText(
              this.t("fetching", { n: items.length }) + " " + this.t("progress", { done, total })
            );
          }
        },
      });

      if (line) line.setText(this.t("saving"));
      const today = L.todayISO();
      const changed = [];
      let notFound = 0;
      const errors = new Set();
      for (const it of items) {
        const r = results.get(it.id);
        r.errors.forEach((e) => errors.add(e));
        let extra = it.getField("extra");
        const before = extra;
        let any = false;
        for (const k of enabled) {
          if (r[k] != null) {
            extra = L.setExtraCount(extra, k, r[k], today);
            any = true;
          }
        }
        if (!any) notFound++;
        if (extra !== before) {
          it.setField("extra", extra);
          changed.push(it);
        }
      }
      await this.saveAll(changed, "citecounts-undo-update");

      if (line) {
        line.setProgress(100);
        line.setText(this.t("done", { updated: items.length - notFound, total: items.length }));
        if (notFound) pw.addDescription(this.t("noId", { n: notFound }));
        for (const e of Array.from(errors).slice(0, 3)) pw.addDescription(this.t("error", { msg: e }));
        pw.startCloseTimer(errors.size ? 15000 : 6000);
      }
      this.log(`updated ${changed.length}/${items.length}; notFound=${notFound}; errors=${[...errors].join(" | ")}`);
    } catch (e) {
      if (String(e && e.message) === "cancelled") {
        if (line) line.setText(this.t("cancelled"));
      } else {
        Zotero.logError(e);
        if (line) line.setText(this.t("error", { msg: e.message || e }));
      }
      if (pw) pw.startCloseTimer(8000);
    } finally {
      this.running = false;
      this.cancelRequested = false;
    }
  },

  async clearItems(items) {
    const L = CiteCountsLib;
    const changed = [];
    for (const it of (items || []).filter((i) => i.isRegularItem() && i.library.editable)) {
      const before = it.getField("extra");
      const after = L.clearExtra(before);
      if (after !== before) {
        it.setField("extra", after);
        changed.push(it);
      }
    }
    await this.saveAll(changed, "citecounts-undo-clear");
    this.flash(this.t("cleared", { n: changed.length }));
  },

  /**
   * Saves modified items. On Zotero 10 the whole batch becomes one undo step;
   * on 8/9 (no undo history) items are simply saved.
   */
  async saveAll(items, undoAction) {
    if (!items.length) return;
    const saveOpts = { skipDateModifiedUpdate: true };
    for (const group of CiteCountsLib.chunk(items, 200)) {
      if (Zotero.UndoHistory && Zotero.UndoHistory.stageAction) {
        await Zotero.DB.executeTransaction(async () => {
          Zotero.UndoHistory.stageAction(undoAction, { count: group.length });
          for (const it of group) await it.save(saveOpts);
        });
      } else {
        await Zotero.DB.executeTransaction(async () => {
          for (const it of group) await it.save(saveOpts);
        });
      }
    }
  },

  flash(text) {
    const pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.changeHeadline(this.t("headline"));
    pw.addDescription(text);
    pw.show();
    pw.startCloseTimer(5000);
  },
};
