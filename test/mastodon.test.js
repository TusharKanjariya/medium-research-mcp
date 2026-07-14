// test/mastodon.test.js — Mastodon source server (SRC-11, SRC-13).
//
// All offline (fixtures + stubs; no live network). Concerns:
//   1. Field-mapping units — mapMastodonStatus / mapTrendingTag / mapTrendingLink
//      convert captured fosstodon.org / mastodon.social-shaped payloads into exact
//      contract items, including the BOOST case (map from status.reblog) and the
//      string-valued history[].uses summing.
//   2. HTML-strip-through-contract — status.content is stripped by the shared
//      buildListEnvelope path.
//   3. Contract conformance — envelopes parse against the frozen schema; count
//      matches.
//   4. Registration smoke — exactly the four tools register, each with an
//      outputSchema; `limit` is a zod int max 40 that rejects >40 before fetch.
//   5. D-11 lockdown + D-10 trends-empty + SSRF (SEC-01) on the guarded path — a
//      401/422 surfaces a terminal error that mapMastodonError re-maps to the
//      "disallows anonymous reads" message; a trends 200 [] and a 404 both yield
//      count:0 with no throw; a private/loopback/metadata instance is rejected.
//
// Fixtures are synthesized from 07-RESEARCH §"Mastodon Field Maps":
// mastodon-timeline.json = a status array (incl. one boost with a non-null reblog
// and one with tags[]); mastodon-trends-tags.json / mastodon-trends-links.json =
// arrays with STRING history[].uses values.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapMastodonStatus,
  mapTrendingTag,
  mapTrendingLink,
  mapMastodonError,
  normalizeInstance,
  server,
} from "../servers/mastodon/server.js";
import {
  buildListEnvelope,
  ListEnvelopeSchema,
} from "../shared/contract.js";
import { getJson } from "../shared/http_client.js";

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)),
      "utf8",
    ),
  );

const timeline = fixture("mastodon-timeline"); // [status] incl. a boost
const trendsTags = fixture("mastodon-trends-tags"); // [{name,url,history[]}]
const trendsLinks = fixture("mastodon-trends-links"); // [preview card]
const status0 = timeline[0]; // normal status with tags[]
const boost = timeline[1]; // top-level empty; real payload in .reblog

// --- mapMastodonStatus ---------------------------------------------------

test("mapMastodonStatus maps a status onto the exact contract fields", () => {
  const m = mapMastodonStatus(status0);
  assert.equal(m.id, String(status0.id));
  assert.equal(typeof m.id, "string");
  assert.equal(m.type, "status"); // new TYPE value
  assert.equal(m.title, ""); // statuses have no title
  assert.equal(m.author, status0.account.acct); // account.acct
  assert.equal(
    m.score,
    status0.favourites_count + status0.reblogs_count,
    "score = favourites + reblogs",
  );
  assert.equal(m.num_comments, status0.replies_count); // replies_count
  assert.equal(m.created_utc, status0.created_at); // ISO passthrough
  assert.equal(m.url, status0.url);
  assert.equal(m.permalink, status0.url); // url ?? uri
  assert.deepEqual(m.tags, ["mcp", "opensource"]); // stripped to name strings
});

test("mapMastodonStatus maps a BOOST from status.reblog, not the empty wrapper", () => {
  const m = mapMastodonStatus(boost);
  const rb = boost.reblog;
  assert.equal(m.id, String(rb.id)); // reblog's id, not the wrapper's
  assert.equal(m.author, rb.account.acct); // 'bob@mastodon.social', not 'carol'
  assert.equal(m.score, rb.favourites_count + rb.reblogs_count); // 70, not 0
  assert.equal(m.num_comments, rb.replies_count); // 8, not 0
  assert.equal(m.url, rb.url);
  assert.deepEqual(m.tags, ["fediverse"]);
});

test("mapMastodonStatus id is a string; score defaults to 0 and num_comments to null when omitted", () => {
  const m = mapMastodonStatus({ id: 42, account: { acct: "u" } });
  assert.equal(m.id, "42");
  assert.equal(typeof m.id, "string");
  assert.equal(m.score, 0); // (undefined ?? 0) + (undefined ?? 0)
  assert.equal(m.num_comments, null);
  assert.equal(m.author, "u");
  assert.deepEqual(m.tags, []);
});

test("mapMastodonStatus content is HTML-stripped via the shared contract path", () => {
  const env = buildListEnvelope({
    source: "mastodon",
    query: null,
    results: [mapMastodonStatus(status0)],
  });
  const text = env.results[0].text;
  assert.ok(!/</.test(text), "no HTML tags remain");
  assert.ok(text.includes("MCP server"), "anchor text preserved, tag removed");
  assert.ok(text.includes("loving it"));
});

// --- mapTrendingTag ------------------------------------------------------

test("mapTrendingTag maps a trending hashtag to a topic with a #-title and summed usage", () => {
  const m = mapTrendingTag(trendsTags[0]);
  assert.equal(m.type, "topic");
  assert.equal(m.title, "#mcp"); // D-09: title = the #name
  assert.equal(m.author, null);
  assert.equal(m.score, 200 + 150 + 60, "score = sum(history[].uses via Number)");
  assert.equal(m.num_comments, null);
  assert.equal(m.created_utc, null);
  assert.equal(m.url, trendsTags[0].url);
  assert.deepEqual(m.tags, ["mcp"]);
  assert.equal(m.text, null);
});

// --- mapTrendingLink -----------------------------------------------------

test("mapTrendingLink maps a preview card to an article with summed usage", () => {
  const m = mapTrendingLink(trendsLinks[0]);
  assert.equal(m.type, "article");
  assert.equal(m.title, trendsLinks[0].title);
  assert.equal(m.author, "TechExample"); // author_name preferred
  assert.equal(m.score, 30 + 20, "score = sum(history[].uses via Number)");
  assert.equal(m.created_utc, trendsLinks[0].published_at);
  assert.equal(m.url, trendsLinks[0].url);
  assert.equal(m.text, trendsLinks[0].description);
});

test("mapTrendingLink falls back to provider_name when author_name is blank", () => {
  const m = mapTrendingLink(trendsLinks[1]);
  assert.equal(m.author, "Example Blog"); // author_name "" -> provider_name
  assert.equal(m.created_utc, null); // published_at null
  assert.equal(m.score, 7);
});

// --- contract conformance (OUT-01) ---------------------------------------

test("mapMastodonStatus results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "mastodon",
    query: null,
    results: timeline.map(mapMastodonStatus),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, timeline.length);
});

test("mapTrendingTag / mapTrendingLink results build envelopes that parse against the contract schema", () => {
  const tagsEnv = buildListEnvelope({
    source: "mastodon",
    query: null,
    results: trendsTags.map(mapTrendingTag),
  });
  const linksEnv = buildListEnvelope({
    source: "mastodon",
    query: null,
    results: trendsLinks.map(mapTrendingLink),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(tagsEnv));
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(linksEnv));
  assert.equal(tagsEnv.count, trendsTags.length);
  assert.equal(linksEnv.count, trendsLinks.length);
});

// --- instance normalization (D-13) ---------------------------------------

test("normalizeInstance defaults a scheme-less instance to https and strips a trailing slash", () => {
  assert.equal(normalizeInstance("fosstodon.org"), "https://fosstodon.org");
  assert.equal(normalizeInstance("https://fosstodon.org/"), "https://fosstodon.org");
  assert.equal(normalizeInstance("https://fosstodon.org///"), "https://fosstodon.org");
  assert.equal(normalizeInstance("http://fosstodon.org"), "http://fosstodon.org");
  assert.equal(normalizeInstance("  fosstodon.org  "), "https://fosstodon.org");
});

test("normalizeInstance throws a readable, host-literal-free error on empty input (SEC-02)", () => {
  for (const bad of ["", "   ", null, undefined]) {
    assert.throws(() => normalizeInstance(bad), /instance is required/);
  }
  try {
    normalizeInstance("");
  } catch (err) {
    assert.ok(
      !/mastodon\.social|fosstodon\.org|mstdn/.test(err.message),
      "empty-input error names no specific instance host",
    );
  }
});

// --- SEC-02: no instance-host literal anywhere in the server source -------

test("SEC-02: servers/mastodon/server.js contains no instance-host literal (base is the tool param)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../servers/mastodon/server.js", import.meta.url)),
    "utf8",
  );
  const hosts = [...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
  assert.deepEqual(hosts, [], `no http(s) host literal may appear: ${JSON.stringify(hosts)}`);
});

// --- registration smoke --------------------------------------------------

test("mastodon server registers exactly the four expected tools", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, [
    "mastodon_hashtag",
    "mastodon_public",
    "mastodon_trending_links",
    "mastodon_trending_tags",
  ]);
});

test("each mastodon tool declares an outputSchema (contract validation on return)", () => {
  for (const name of [
    "mastodon_public",
    "mastodon_hashtag",
    "mastodon_trending_tags",
    "mastodon_trending_links",
  ]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});

// --- limit clamp (D-08) --------------------------------------------------

test("D-08: the timeline `limit` is a zod int max 40 — a limit of 100 is rejected before fetch", () => {
  for (const name of ["mastodon_public", "mastodon_hashtag"]) {
    const shape = server._registeredTools[name].inputSchema.shape;
    assert.ok(shape.limit, `${name} declares limit`);
    const res = shape.limit.safeParse(100);
    assert.equal(res.success, false, `${name} rejects limit=100`);
    // a readable message references the ceiling
    const msg = res.error.issues.map((i) => i.message).join(" ");
    assert.match(msg, /40|less than or equal/i, "readable max-40 rejection");
    // a valid limit and an omitted limit both pass (optional, <=40)
    assert.equal(shape.limit.safeParse(40).success, true);
    assert.equal(shape.limit.safeParse(undefined).success, true);
  }
});

test("mastodon_hashtag description documents federation sparsity (D-12)", () => {
  const desc = server._registeredTools["mastodon_hashtag"].description;
  assert.match(desc, /federat/i, "mentions federation sparsity");
});

// --- D-11 mapping (mapMastodonError) -------------------------------------

const BASE = "https://locked.example.test";

test("mapMastodonError maps an HTTP 422 to the D-11 lockdown message naming the instance", () => {
  const err = new Error("getJson: HTTP 422 from https://locked.example.test/api/v1/timelines/public");
  const mapped = mapMastodonError(err, BASE);
  assert.match(mapped.message, /disallows anonymous reads/);
  assert.match(mapped.message, /locked\.example\.test/, "names the instance");
});

test("mapMastodonError maps an HTTP 401 to the D-11 lockdown message", () => {
  const err = new Error("getJson: HTTP 401 from https://locked.example.test/api/v1/timelines/public");
  const mapped = mapMastodonError(err, BASE);
  assert.match(mapped.message, /disallows anonymous reads/);
});

test("mapMastodonError passes an unrelated error through unchanged", () => {
  const err = new Error("getJson: HTTP 500 from https://x.example.test/api/v1/timelines/public");
  assert.equal(mapMastodonError(err, BASE), err);
});

// --- guarded path (untrustedHost): D-11 terminal + D-10 empty + SSRF ------
//
// The registered handler builds its own getJson opts, so there is no seam to
// inject fetchImpl/lookup through the tool. We therefore drive getJson directly
// with a Mastodon instance URL exactly as the handler does, proving the guarded
// path surfaces a TERMINAL error (that mapMastodonError re-maps), that a trends
// 404 / 200-[] both collapse to count:0, and that a non-public instance IP is
// blocked.

const jsonRes = (status, data, ct = "application/json") => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? ct : null) },
  async json() {
    return data;
  },
});
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const privateLookup = async () => [{ address: "10.0.0.5", family: 4 }];
const loopbackLookup = async () => [{ address: "127.0.0.1", family: 4 }];
const metadataLookup = async () => [{ address: "169.254.169.254", family: 4 }];

test("SEC-01: a public Mastodon instance getJson (untrustedHost) builds a valid list envelope", async () => {
  const fetchImpl = async () => jsonRes(200, timeline);
  const base = normalizeInstance("fosstodon.example.test");
  const arr = await getJson(`${base}/api/v1/timelines/public?limit=20`, {
    fetchImpl,
    sleep: async () => {},
    lookup: publicLookup,
    untrustedHost: true,
    cacheKey: "mastodon:guarded-public",
  });
  const env = buildListEnvelope({
    source: "mastodon",
    query: null,
    results: (arr ?? []).map(mapMastodonStatus),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, timeline.length);
});

test("D-11: a guarded-path HTTP 422 surfaces a terminal error that maps to the lockdown message", async () => {
  const fetchImpl = async () =>
    jsonRes(422, { error: "This method requires an authenticated user" });
  const base = normalizeInstance("locked.example.test");
  await assert.rejects(
    async () => {
      try {
        await getJson(`${base}/api/v1/timelines/public?limit=20`, {
          fetchImpl,
          sleep: async () => {},
          lookup: publicLookup,
          untrustedHost: true,
          cacheKey: "mastodon:guarded-422",
        });
      } catch (err) {
        // the handler's catch: re-map to the D-11 message (no crash)
        assert.match(err.message, /HTTP 422/);
        throw mapMastodonError(err, base);
      }
    },
    /disallows anonymous reads/,
  );
});

test("D-10: a trends 200 empty array yields count:0 (no special handling)", async () => {
  const fetchImpl = async () => jsonRes(200, []);
  const base = normalizeInstance("notrends.example.test");
  const arr = await getJson(`${base}/api/v1/trends/tags`, {
    fetchImpl,
    sleep: async () => {},
    lookup: publicLookup,
    untrustedHost: true,
    cacheKey: "mastodon:guarded-trends-empty",
  });
  const env = buildListEnvelope({
    source: "mastodon",
    query: null,
    results: (arr ?? []).map(mapTrendingTag),
  });
  assert.equal(env.count, 0);
});

test("D-10: a trends 404 collapses to an empty envelope (count:0), never a throw", async () => {
  const fetchImpl = async () => jsonRes(404, { error: "Not found" });
  const base = normalizeInstance("trends-disabled.example.test");
  // Replicates the server's fetchTrends catch: /HTTP 404/ -> [] (no throw).
  let arr = [];
  try {
    arr = await getJson(`${base}/api/v1/trends/links`, {
      fetchImpl,
      sleep: async () => {},
      lookup: publicLookup,
      untrustedHost: true,
      cacheKey: "mastodon:guarded-trends-404",
    });
  } catch (err) {
    if (!/HTTP 404/.test(err.message)) throw err;
    arr = [];
  }
  const env = buildListEnvelope({
    source: "mastodon",
    query: null,
    results: (arr ?? []).map(mapTrendingLink),
  });
  assert.equal(env.count, 0);
});

test("SEC-01: a Mastodon instance resolving to a private IP is blocked on the guarded path", async () => {
  const fetchImpl = async () => jsonRes(200, timeline); // must never be read
  await assert.rejects(
    () =>
      getJson("https://internal.mastodon.test/api/v1/timelines/public?limit=20", {
        fetchImpl,
        sleep: async () => {},
        lookup: privateLookup,
        untrustedHost: true,
        cacheKey: "mastodon:guarded-private",
      }),
    /blocked address/,
  );
});

test("SEC-01: a Mastodon instance resolving to loopback (127.0.0.1) is rejected", async () => {
  const fetchImpl = async () => jsonRes(200, timeline);
  const base = normalizeInstance("localhost.mastodon.test");
  await assert.rejects(
    () =>
      getJson(`${base}/api/v1/timelines/public?limit=20`, {
        fetchImpl,
        sleep: async () => {},
        lookup: loopbackLookup,
        untrustedHost: true,
        cacheKey: "mastodon:guarded-loopback",
      }),
    /blocked address/,
  );
});

test("SEC-01: a Mastodon instance resolving to cloud metadata (169.254.169.254) is rejected", async () => {
  const fetchImpl = async () => jsonRes(200, timeline);
  const base = normalizeInstance("metadata.mastodon.test");
  await assert.rejects(
    () =>
      getJson(`${base}/api/v1/trends/tags`, {
        fetchImpl,
        sleep: async () => {},
        lookup: metadataLookup,
        untrustedHost: true,
        cacheKey: "mastodon:guarded-metadata",
      }),
    /blocked address/,
  );
});
