"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/content/lib.js");

test("parseExtra reads both sources and ignores other lines", () => {
  const extra = [
    "Citations (OpenAlex): 123 [2026-10-01]",
    "Citations (Semantic Scholar): 99 [2026-10-02]",
    "tex.foo: bar",
    "Some note",
  ].join("\n");
  assert.deepEqual(L.parseExtra(extra), {
    openalex: { count: 123, date: "2026-10-01" },
    s2: { count: 99, date: "2026-10-02" },
  });
  assert.deepEqual(L.parseExtra(""), {});
  assert.deepEqual(L.parseExtra(null), {});
});

test("setExtraCount adds at top, replaces in place, keeps user content", () => {
  let e = "Original note\nPMID: 1234";
  e = L.setExtraCount(e, "openalex", 5, "2026-01-01");
  assert.equal(e, "Citations (OpenAlex): 5 [2026-01-01]\nOriginal note\nPMID: 1234");
  e = L.setExtraCount(e, "s2", 7, "2026-01-01");
  assert.equal(
    e,
    "Citations (OpenAlex): 5 [2026-01-01]\nCitations (Semantic Scholar): 7 [2026-01-01]\nOriginal note\nPMID: 1234"
  );
  e = L.setExtraCount(e, "openalex", 6, "2026-02-01");
  assert.match(e, /^Citations \(OpenAlex\): 6 \[2026-02-01\]\n/);
  assert.equal(e.split("\n").length, 4);
  assert.equal(L.setExtraCount("", "s2", 0, "2026-01-01"), "Citations (Semantic Scholar): 0 [2026-01-01]");
});

test("setExtraCount removes duplicate lines for the same source", () => {
  const e = "Citations (OpenAlex): 1 [2026-01-01]\nx\nCitations (OpenAlex): 2 [2026-01-02]";
  assert.equal(L.setExtraCount(e, "openalex", 3, "2026-03-03"), "Citations (OpenAlex): 3 [2026-03-03]\nx");
});

test("clearExtra removes only plugin lines", () => {
  const e = "Citations (OpenAlex): 1 [2026-01-01]\nkeep me\nCitations (Semantic Scholar): 2 [2026-01-01]";
  assert.equal(L.clearExtra(e), "keep me");
});

test("cleanDOI handles URLs, prefixes, trailing punctuation, case", () => {
  assert.equal(L.cleanDOI("https://doi.org/10.1000/ABC.123."), "10.1000/abc.123");
  assert.equal(L.cleanDOI("doi:10.1000/xyz"), "10.1000/xyz");
  assert.equal(L.cleanDOI("https://doi.org/10.1000%2Fenc"), "10.1000/enc");
  assert.equal(L.cleanDOI("not a doi"), null);
  assert.equal(L.cleanDOI(""), null);
});

test("getIdentifiers finds DOI and arXiv from fields, Extra and URL", () => {
  assert.equal(L.getIdentifiers({ doi: "10.1001/a" }).doi, "10.1001/a");
  assert.equal(L.getIdentifiers({ extra: "foo\nDOI: 10.1002/b" }).doi, "10.1002/b");
  assert.equal(L.getIdentifiers({ url: "https://doi.org/10.1003/c" }).doi, "10.1003/c");
  assert.equal(L.getIdentifiers({ url: "https://arxiv.org/abs/2101.00001v2" }).arxiv, "2101.00001");
  assert.equal(L.getIdentifiers({ extra: "arXiv: 1706.03762" }).arxiv, "1706.03762");
  assert.equal(L.getIdentifiers({ doi: "10.48550/arXiv.2203.02155" }).arxiv, "2203.02155");
  const ids = L.getIdentifiers({ title: " T ", year: "2021-05-03" });
  assert.equal(ids.title, "T");
  assert.equal(ids.year, 2021);
});

test("titlesMatch normalizes case, punctuation, diacritics, markup", () => {
  assert.ok(L.titlesMatch("Attention Is All You Need", "attention is all you need."));
  assert.ok(L.titlesMatch("Über <i>Graph</i> Networks", "Uber graph networks"));
  assert.ok(!L.titlesMatch("Attention Is All You Need", "Attention Is Not All You Need"));
  assert.ok(!L.titlesMatch("Short", "short")); // too short to trust
});

test("s2Id prefers real DOI, then arXiv", () => {
  assert.equal(L.s2Id({ doi: "10.1001/a", arxiv: "2101.00001" }), "DOI:10.1001/a");
  assert.equal(L.s2Id({ doi: "10.48550/arxiv.2101.00001", arxiv: "2101.00001" }), "ARXIV:2101.00001");
  assert.equal(L.s2Id({ doi: null, arxiv: null }), null);
});

test("OpenAlex batch URL and parsing", () => {
  const url = L.buildOpenAlexBatchUrl(["10.1001/a", "10.1002/b"], { openalexKey: "K", email: "a@b.c" });
  assert.match(url, /^https:\/\/api\.openalex\.org\/works\?filter=/);
  assert.ok(decodeURIComponent(url).includes("doi:https://doi.org/10.1001/a|https://doi.org/10.1002/b"));
  assert.match(url, /api_key=K/);
  assert.match(url, /mailto=a%40b\.c/);
  const map = L.parseOpenAlexBatch({
    results: [
      { doi: "https://doi.org/10.1001/A", cited_by_count: 10 },
      { doi: null, cited_by_count: 3 },
    ],
  });
  assert.equal(map.get("10.1001/a"), 10);
  assert.equal(map.size, 1);
});

test("title pickers require title and year agreement", () => {
  const oa = {
    results: [
      { display_name: "Something Else Entirely", publication_year: 2020, cited_by_count: 1 },
      { display_name: "Deep Residual Learning for Image Recognition", publication_year: 2016, cited_by_count: 9 },
    ],
  };
  assert.equal(L.pickOpenAlexTitleMatch(oa, "Deep residual learning for image recognition", 2016), 9);
  assert.equal(L.pickOpenAlexTitleMatch(oa, "Deep residual learning for image recognition", 2010), null);
  const s2 = { data: [{ title: "Deep Residual Learning for Image Recognition", year: 2015, citationCount: 8 }] };
  assert.equal(L.pickS2TitleMatch(s2, "Deep Residual Learning for Image Recognition", 2016), 8);
  assert.equal(L.pickS2TitleMatch(s2, "Different paper title here", 2016), null);
});

// ----------------------------------------------------------------------------
// fetchCounts with a mocked network
// ----------------------------------------------------------------------------
function rec(id, f) {
  return { id, ids: L.getIdentifiers(f) };
}

function mockHttp(handler) {
  const calls = [];
  const http = async (method, url, init) => {
    calls.push({ method, url, init });
    return handler(method, url, init);
  };
  return { http, calls };
}

const noSleep = async () => {};

test("fetchCounts: batches DOIs, merges both sources, uses title fallback", async () => {
  const records = [
    rec(1, { doi: "10.1001/a" }),
    rec(2, { doi: "10.1002/b" }),
    rec(3, { title: "A Paper Without Any DOI At All", year: 2020 }),
    rec(4, { url: "https://arxiv.org/abs/2101.00001" }),
  ];
  const { http, calls } = mockHttp((method, url, init) => {
    if (url.includes("openalex") && url.includes("filter=")) {
      return {
        status: 200,
        json: { results: [{ doi: "https://doi.org/10.1001/a", cited_by_count: 11 }, { doi: "https://doi.org/10.1002/b", cited_by_count: 22 }] },
      };
    }
    if (url.includes("openalex") && url.includes("search=")) {
      return { status: 200, json: { results: [{ display_name: "A paper without any DOI at all", publication_year: 2020, cited_by_count: 33 }] } };
    }
    if (url.includes("paper/batch")) {
      const ids = JSON.parse(init.body).ids;
      return { status: 200, json: ids.map((i) => (i === "DOI:10.1001/a" ? { citationCount: 12 } : i === "ARXIV:2101.00001" ? { citationCount: 44 } : null)) };
    }
    if (url.includes("search/match")) {
      return url.includes("Without") ? { status: 200, json: { data: [{ title: "A Paper Without Any DOI At All", year: 2021, citationCount: 34 }] } } : { status: 404, json: null };
    }
    return { status: 404, json: null };
  });

  const out = await L.fetchCounts({
    records,
    sources: { openalex: true, s2: true },
    opts: { titleFallback: true, openalexKey: "K" },
    http,
    sleep: noSleep,
  });
  assert.deepEqual(out.get(1), { openalex: 11, s2: 12, errors: [] });
  assert.equal(out.get(2).openalex, 22);
  assert.equal(out.get(2).s2, null);
  assert.deepEqual(out.get(3), { openalex: 33, s2: 34, errors: [] });
  assert.equal(out.get(4).s2, 44);
  // exactly one OpenAlex batch request for the two DOIs
  assert.equal(calls.filter((c) => c.url.includes("filter=")).length, 1);
  // exactly one S2 batch request
  assert.equal(calls.filter((c) => c.url.includes("paper/batch")).length, 1);
});

test("fetchCounts: retries 429 then succeeds", async () => {
  let n = 0;
  const { http } = mockHttp(() => {
    n++;
    return n < 3 ? { status: 429, json: null } : { status: 200, json: { results: [{ doi: "https://doi.org/10.1001/a", cited_by_count: 5 }] } };
  });
  const out = await L.fetchCounts({
    records: [rec(1, { doi: "10.1001/a" })],
    sources: { openalex: true },
    opts: {},
    http,
    sleep: noSleep,
  });
  assert.equal(out.get(1).openalex, 5);
  assert.equal(n, 3);
});

test("fetchCounts: reports auth failure without crashing", async () => {
  const { http } = mockHttp(() => ({ status: 401, json: null }));
  const out = await L.fetchCounts({
    records: [rec(1, { doi: "10.1001/a" }), rec(2, { doi: "10.1001/b" })],
    sources: { openalex: true },
    opts: {},
    http,
    sleep: noSleep,
  });
  assert.equal(out.get(1).openalex, null);
  assert.match(out.get(1).errors[0], /API key/);
});

test("fetchCounts: splits large DOI sets into batches of 50", async () => {
  const records = Array.from({ length: 120 }, (_, i) => rec(i, { doi: `10.1009/${i}` }));
  const { http, calls } = mockHttp(() => ({ status: 200, json: { results: [] } }));
  const progress = [];
  await L.fetchCounts({
    records,
    sources: { openalex: true },
    opts: {},
    http,
    sleep: noSleep,
    onProgress: (d, t) => progress.push([d, t]),
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(progress.at(-1), [120, 120]);
});

test("fetchCounts: cancellation stops further requests", async () => {
  let cancelled = false;
  const { http, calls } = mockHttp(() => {
    cancelled = true;
    return { status: 200, json: { results: [] } };
  });
  const records = Array.from({ length: 120 }, (_, i) => rec(i, { doi: `10.1009/${i}` }));
  await assert.rejects(
    L.fetchCounts({ records, sources: { openalex: true }, opts: {}, http, sleep: noSleep, isCancelled: () => cancelled }),
    /cancelled/
  );
  assert.equal(calls.length, 1);
});
