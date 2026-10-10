/*
 * CiteTally — core logic.
 *
 * This file has NO dependency on Zotero. It is loaded into the plugin with
 * Services.scriptloader.loadSubScript() and into Node for unit tests with
 * require(). Everything that touches the network goes through an injected
 * `http(method, url, {headers, body})` function returning {status, json}.
 */
/* eslint-disable no-var */
var CiteCountsLib = (function () {
  "use strict";

  const SOURCES = {
    openalex: { key: "openalex", label: "OpenAlex" },
    s2: { key: "s2", label: "Semantic Scholar" },
  };

  const OPENALEX_BASE = "https://api.openalex.org";
  const S2_BASE = "https://api.semanticscholar.org/graph/v1";
  const OPENALEX_BATCH = 50; // DOIs per OR-filter request
  const S2_BATCH = 100; // ids per batch POST (API max is 500)

  // ---------------------------------------------------------------------------
  // Extra field
  // ---------------------------------------------------------------------------
  // One line per source, e.g.
  //   Citations (OpenAlex): 123 [2026-10-10]
  //   Citations (Semantic Scholar): 118 [2026-10-10]
  const LINE_RE = /^Citations \((OpenAlex|Semantic Scholar)\): (\d+) \[(\d{4}-\d{2}-\d{2})\]\s*$/;

  function labelToKey(label) {
    for (const s of Object.values(SOURCES)) if (s.label === label) return s.key;
    return null;
  }

  /** @returns {{[key: string]: {count: number, date: string}}} */
  function parseExtra(extra) {
    const out = {};
    if (!extra) return out;
    for (const line of String(extra).split(/\r?\n/)) {
      const m = LINE_RE.exec(line.trim());
      if (m) out[labelToKey(m[1])] = { count: parseInt(m[2], 10), date: m[3] };
    }
    return out;
  }

  /**
   * Returns a new Extra string with this source's line replaced (or added at
   * the top). All other content is preserved untouched.
   */
  function setExtraCount(extra, sourceKey, count, date) {
    const src = SOURCES[sourceKey];
    if (!src) throw new Error("Unknown source " + sourceKey);
    const newLine = `Citations (${src.label}): ${count} [${date}]`;
    const lines = extra ? String(extra).split(/\r?\n/) : [];
    let replaced = false;
    const kept = [];
    for (const line of lines) {
      const m = LINE_RE.exec(line.trim());
      if (m && labelToKey(m[1]) === sourceKey) {
        if (!replaced) kept.push(newLine);
        replaced = true; // drop any duplicates
      } else {
        kept.push(line);
      }
    }
    if (!replaced) {
      // keep our lines grouped at the top, in a stable order
      let insertAt = 0;
      while (insertAt < kept.length && LINE_RE.test(kept[insertAt].trim())) insertAt++;
      kept.splice(insertAt, 0, newLine);
    }
    return kept.join("\n").replace(/\n+$/, "");
  }

  /** Removes all of this plugin's lines from Extra. */
  function clearExtra(extra) {
    if (!extra) return "";
    return String(extra)
      .split(/\r?\n/)
      .filter((l) => !LINE_RE.test(l.trim()))
      .join("\n")
      .replace(/^\n+|\n+$/g, "");
  }

  function todayISO(d) {
    d = d || new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function daysBetween(isoA, isoB) {
    const a = Date.parse(isoA + "T00:00:00Z");
    const b = Date.parse(isoB + "T00:00:00Z");
    return Math.round((b - a) / 86400000);
  }

  // ---------------------------------------------------------------------------
  // Identifiers
  // ---------------------------------------------------------------------------
  const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;

  function cleanDOI(raw) {
    if (!raw) return null;
    let s = String(raw).trim();
    try {
      s = decodeURIComponent(s);
    } catch (e) {
      /* keep as is */
    }
    const m = DOI_RE.exec(s);
    if (!m) return null;
    return m[1].replace(/[.,;:)\]}]+$/, "").toLowerCase();
  }

  const ARXIV_RE = /arxiv\.org\/(?:abs|pdf)\/([a-z\-.]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i;
  const ARXIV_EXTRA_RE = /^arXiv:\s*([a-z\-.]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/im;

  /**
   * @param {{doi?: string, extra?: string, url?: string, title?: string, year?: string|number}} f
   * @returns {{doi: string|null, arxiv: string|null, title: string|null, year: number|null}}
   */
  function getIdentifiers(f) {
    let doi = cleanDOI(f.doi);
    if (!doi && f.extra) {
      const m = /^DOI:\s*(\S+)/im.exec(f.extra);
      if (m) doi = cleanDOI(m[1]);
    }
    if (!doi && f.url && /doi\.org\//i.test(f.url)) doi = cleanDOI(f.url);

    let arxiv = null;
    let m = f.url && ARXIV_RE.exec(f.url);
    if (m) arxiv = m[1];
    if (!arxiv && f.extra && (m = ARXIV_EXTRA_RE.exec(f.extra))) arxiv = m[1];
    // arXiv-minted DOIs: 10.48550/arXiv.2101.00001
    if (!arxiv && doi && (m = /^10\.48550\/arxiv\.(.+)$/i.exec(doi))) arxiv = m[1];

    const yearMatch = f.year ? /(\d{4})/.exec(String(f.year)) : null;
    return {
      doi: doi || null,
      arxiv: arxiv || null,
      title: f.title ? String(f.title).trim() || null : null,
      year: yearMatch ? parseInt(yearMatch[1], 10) : null,
    };
  }

  function normTitle(t) {
    return String(t || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/<[^>]+>/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿]+/g, "");
  }

  function titlesMatch(a, b) {
    const na = normTitle(a);
    const nb = normTitle(b);
    return na.length >= 8 && na === nb;
  }

  function yearOk(wanted, got) {
    if (!wanted || !got) return true;
    return Math.abs(wanted - got) <= 1; // preprint vs. published year
  }

  function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  // ---------------------------------------------------------------------------
  // OpenAlex
  // ---------------------------------------------------------------------------
  function oaParams(opts) {
    let p = "";
    if (opts.openalexKey) p += "&api_key=" + encodeURIComponent(opts.openalexKey);
    if (opts.email) p += "&mailto=" + encodeURIComponent(opts.email);
    return p;
  }

  function buildOpenAlexBatchUrl(dois, opts) {
    // DOIs may contain "|" or "," in rare cases; those break the filter syntax,
    // so callers should route such DOIs through the single-lookup path.
    const filter = "doi:" + dois.map((d) => "https://doi.org/" + d).join("|");
    return (
      `${OPENALEX_BASE}/works?filter=${encodeURIComponent(filter)}` +
      `&select=doi,cited_by_count&per_page=${Math.max(dois.length, 1)}` +
      oaParams(opts || {})
    );
  }

  function buildOpenAlexDoiUrl(doi, opts) {
    return (
      `${OPENALEX_BASE}/works/doi:${encodeURIComponent(doi)}?select=doi,cited_by_count` +
      oaParams(opts || {})
    );
  }

  /** @returns {Map<string, number>} doi(lowercase) -> count */
  function parseOpenAlexBatch(json) {
    const map = new Map();
    for (const w of (json && json.results) || []) {
      const d = cleanDOI(w.doi);
      if (d && typeof w.cited_by_count === "number") map.set(d, w.cited_by_count);
    }
    return map;
  }

  function buildOpenAlexTitleUrl(title, opts) {
    return (
      `${OPENALEX_BASE}/works?search=${encodeURIComponent(title)}` +
      `&select=display_name,publication_year,cited_by_count&per_page=5` +
      oaParams(opts || {})
    );
  }

  function pickOpenAlexTitleMatch(json, title, year) {
    for (const w of (json && json.results) || []) {
      if (titlesMatch(w.display_name, title) && yearOk(year, w.publication_year)) {
        return typeof w.cited_by_count === "number" ? w.cited_by_count : null;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Semantic Scholar
  // ---------------------------------------------------------------------------
  function s2Id(ids) {
    if (ids.doi && !/^10\.48550\//.test(ids.doi)) return "DOI:" + ids.doi;
    if (ids.arxiv) return "ARXIV:" + ids.arxiv;
    if (ids.doi) return "DOI:" + ids.doi;
    return null;
  }

  function s2Headers(opts) {
    const h = { "Content-Type": "application/json" };
    if (opts && opts.s2Key) h["x-api-key"] = opts.s2Key;
    return h;
  }

  const S2_BATCH_URL = `${S2_BASE}/paper/batch?fields=citationCount`;

  /** S2 batch returns an array aligned with the request; null = not found. */
  function parseS2Batch(json, requestedIds) {
    const map = new Map();
    if (!Array.isArray(json)) return map;
    json.forEach((p, i) => {
      if (p && typeof p.citationCount === "number") map.set(requestedIds[i], p.citationCount);
    });
    return map;
  }

  function buildS2TitleUrl(title) {
    return (
      `${S2_BASE}/paper/search/match?query=${encodeURIComponent(title)}` +
      `&fields=title,year,citationCount`
    );
  }

  function pickS2TitleMatch(json, title, year) {
    const p = json && Array.isArray(json.data) ? json.data[0] : null;
    if (p && titlesMatch(p.title, title) && yearOk(year, p.year)) {
      return typeof p.citationCount === "number" ? p.citationCount : null;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Orchestration
  // ---------------------------------------------------------------------------
  /**
   * Calls http with retry on 429/5xx.
   * @returns {Promise<{status:number, json:any}>}
   */
  async function request(ctx, method, url, init, label) {
    const maxTries = 4;
    for (let attempt = 0; ; attempt++) {
      if (ctx.isCancelled && ctx.isCancelled()) throw new Error("cancelled");
      let res;
      try {
        res = await ctx.http(method, url, init || {});
      } catch (e) {
        res = { status: 0, json: null, error: e };
      }
      const retryable = res.status === 429 || res.status === 0 || res.status >= 500;
      if (!retryable || attempt >= maxTries - 1) return res;
      const wait = Math.min(30000, 1500 * Math.pow(2, attempt));
      if (ctx.log) ctx.log(`${label}: HTTP ${res.status}, retrying in ${wait} ms`);
      await ctx.sleep(wait);
    }
  }

  function describeFailure(source, res) {
    if (res.status === 401 || res.status === 403) {
      return source === "openalex"
        ? "OpenAlex rejected the request (missing or invalid API key?)"
        : "Semantic Scholar rejected the API key";
    }
    if (res.status === 429) return SOURCES[source].label + " rate limit / daily budget exhausted";
    return `${SOURCES[source].label} HTTP ${res.status}`;
  }

  async function fetchOpenAlex(ctx, records, results) {
    const opts = ctx.opts;
    const withDoi = records.filter((r) => r.ids.doi);
    const batchable = withDoi.filter((r) => !/[|,]/.test(r.ids.doi));
    const singles = withDoi.filter((r) => /[|,]/.test(r.ids.doi));

    for (const group of chunk(batchable, OPENALEX_BATCH)) {
      const dois = group.map((r) => r.ids.doi);
      const res = await request(ctx, "GET", buildOpenAlexBatchUrl(dois, opts), {}, "OpenAlex");
      if (res.status === 200) {
        const map = parseOpenAlexBatch(res.json);
        for (const r of group) {
          if (map.has(r.ids.doi)) results.get(r.id).openalex = map.get(r.ids.doi);
        }
      } else {
        const msg = describeFailure("openalex", res);
        for (const r of group) results.get(r.id).errors.push(msg);
        if (res.status === 401 || res.status === 403 || res.status === 429) return; // stop early
      }
      ctx.progress(group.length);
    }

    for (const r of singles) {
      const res = await request(ctx, "GET", buildOpenAlexDoiUrl(r.ids.doi, opts), {}, "OpenAlex");
      if (res.status === 200 && res.json && typeof res.json.cited_by_count === "number") {
        results.get(r.id).openalex = res.json.cited_by_count;
      }
      ctx.progress(1);
    }

    // Title fallback for items without DOI or not found by DOI
    if (opts.titleFallback) {
      const todo = records.filter((r) => results.get(r.id).openalex == null && r.ids.title);
      for (const r of todo) {
        const res = await request(ctx, "GET", buildOpenAlexTitleUrl(r.ids.title, opts), {}, "OpenAlex");
        if (res.status === 200) {
          const n = pickOpenAlexTitleMatch(res.json, r.ids.title, r.ids.year);
          if (n != null) results.get(r.id).openalex = n;
        } else if (res.status === 429 || res.status === 401 || res.status === 403) {
          results.get(r.id).errors.push(describeFailure("openalex", res));
          return;
        }
        ctx.progress(1);
      }
    }
  }

  async function fetchS2(ctx, records, results) {
    const opts = ctx.opts;
    // Unauthenticated S2 shares a tiny pool; keep ~1 req/s, faster with a key.
    const gap = opts.s2Key ? 1100 : 3000;
    const withId = records.map((r) => ({ r, sid: s2Id(r.ids) })).filter((x) => x.sid);

    let first = true;
    for (const group of chunk(withId, S2_BATCH)) {
      if (!first) await ctx.sleep(gap);
      first = false;
      const ids = group.map((x) => x.sid);
      const res = await request(
        ctx,
        "POST",
        S2_BATCH_URL,
        { headers: s2Headers(opts), body: JSON.stringify({ ids }) },
        "Semantic Scholar"
      );
      if (res.status === 200) {
        const map = parseS2Batch(res.json, ids);
        for (const x of group) if (map.has(x.sid)) results.get(x.r.id).s2 = map.get(x.sid);
      } else {
        const msg = describeFailure("s2", res);
        for (const x of group) results.get(x.r.id).errors.push(msg);
        if (res.status === 401 || res.status === 403) return;
      }
      ctx.progress(group.length);
    }

    if (opts.titleFallback) {
      const todo = records.filter((r) => results.get(r.id).s2 == null && r.ids.title);
      for (const r of todo) {
        await ctx.sleep(gap);
        const res = await request(
          ctx,
          "GET",
          buildS2TitleUrl(r.ids.title),
          { headers: s2Headers(opts) },
          "Semantic Scholar"
        );
        if (res.status === 200) {
          const n = pickS2TitleMatch(res.json, r.ids.title, r.ids.year);
          if (n != null) results.get(r.id).s2 = n;
        }
        // 404 from /search/match simply means "no match"
        ctx.progress(1);
      }
    }
  }

  /**
   * @param {object} p
   * @param {{id: any, ids: ReturnType<typeof getIdentifiers>}[]} p.records
   * @param {{openalex?: boolean, s2?: boolean}} p.sources
   * @param {{openalexKey?: string, s2Key?: string, email?: string, titleFallback?: boolean}} p.opts
   * @param {(method: string, url: string, init: object) => Promise<{status: number, json: any}>} p.http
   * @param {(ms: number) => Promise<void>} [p.sleep]
   * @param {(done: number, total: number) => void} [p.onProgress]
   * @param {() => boolean} [p.isCancelled]
   * @param {(msg: string) => void} [p.log]
   * @returns {Promise<Map<any, {openalex: number|null, s2: number|null, errors: string[]}>>}
   */
  async function fetchCounts(p) {
    const results = new Map();
    for (const r of p.records) results.set(r.id, { openalex: null, s2: null, errors: [] });

    // Rough progress budget: one unit per record per enabled source (+ fallbacks).
    const enabled = ["openalex", "s2"].filter((k) => p.sources[k]);
    let done = 0;
    const total = p.records.length * enabled.length;
    const ctx = {
      http: p.http,
      sleep: p.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
      opts: p.opts || {},
      log: p.log,
      isCancelled: p.isCancelled,
      progress(n) {
        done = Math.min(total, done + n);
        if (p.onProgress) p.onProgress(done, total);
      },
    };

    // The two sources are independent, so run them in parallel.
    const jobs = [];
    if (p.sources.openalex) jobs.push(fetchOpenAlex(ctx, p.records, results));
    if (p.sources.s2) jobs.push(fetchS2(ctx, p.records, results));
    await Promise.all(jobs);

    // de-duplicate error messages per record
    for (const v of results.values()) v.errors = Array.from(new Set(v.errors));
    return results;
  }

  return {
    SOURCES,
    parseExtra,
    setExtraCount,
    clearExtra,
    todayISO,
    daysBetween,
    cleanDOI,
    getIdentifiers,
    normTitle,
    titlesMatch,
    chunk,
    buildOpenAlexBatchUrl,
    buildOpenAlexDoiUrl,
    parseOpenAlexBatch,
    buildOpenAlexTitleUrl,
    pickOpenAlexTitleMatch,
    s2Id,
    S2_BATCH_URL,
    parseS2Batch,
    buildS2TitleUrl,
    pickS2TitleMatch,
    fetchCounts,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CiteCountsLib;
