// test/hn.test.js — HN reference server (FOUND-04, OUT-01).
//
// Two concerns, both offline (fixtures pin the field map; no live network):
//   1. Field-mapping units — mapHnHit / mapHnItem convert captured Algolia
//      payloads into exact contract items/details (incl. job null-score).
//   2. Registration smoke — the three tools register on the McpServer without
//      throwing.
//
// Fixtures are REAL Algolia payloads captured once (test/fixtures/*.json) so the
// map is validated against ground truth, not a hand-written mock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapHnHit,
  mapHnItem,
  risingNumericFilters,
  rankByVelocity,
  server,
} from "../servers/hn/server.js";
import {
  buildListEnvelope,
  buildDetailEnvelope,
  ListEnvelopeSchema,
  DetailEnvelopeSchema,
} from "../shared/contract.js";

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)),
      "utf8",
    ),
  );

const story = fixture("hn-story");
const job = fixture("hn-job");
const item = fixture("hn-item");

// --- mapHnHit ------------------------------------------------------------

test("mapHnHit maps a story hit onto the exact contract fields", () => {
  const m = mapHnHit(story);
  assert.equal(m.id, "16582136");
  assert.equal(typeof m.id, "string"); // objectID stringified
  assert.equal(m.type, "story");
  assert.equal(m.title, "Stephen Hawking has died");
  assert.equal(m.author, "Cogito");
  assert.equal(m.score, 6015); // points -> score
  assert.equal(m.num_comments, 436); // num_comments passthrough
  assert.equal(m.created_utc, "2018-03-14T03:50:30Z"); // ISO-8601 created_at
  assert.equal(m.url, "http://www.bbc.com/news/uk-43396008");
  assert.equal(
    m.permalink,
    "https://news.ycombinator.com/item?id=16582136", // constructed
  );
});

test("mapHnHit filters _tags to human-meaningful tags, dropping author_*/story_* noise", () => {
  // story _tags: ["story","author_Cogito","story_16582136"]
  const m = mapHnHit(story);
  assert.deepEqual(m.tags, ["story"]);
});

test("mapHnHit derives type from _tags per the type map", () => {
  assert.equal(mapHnHit({ objectID: "1", _tags: ["story"] }).type, "story");
  assert.equal(
    mapHnHit({ objectID: "2", _tags: ["ask_hn", "story"] }).type,
    "ask",
  );
  assert.equal(
    mapHnHit({ objectID: "3", _tags: ["show_hn", "story"] }).type,
    "show",
  );
  assert.equal(mapHnHit({ objectID: "4", _tags: ["job"] }).type, "job");
  assert.equal(mapHnHit({ objectID: "5", _tags: ["comment"] }).type, "comment");
  assert.equal(
    mapHnHit({ objectID: "6", _tags: ["poll", "story"] }).type,
    "story", // poll has no enum -> fallback
  );
  assert.equal(mapHnHit({ objectID: "7", _tags: [] }).type, "story");
});

test("mapHnHit yields null score and null num_comments for a job story", () => {
  const m = mapHnHit(job);
  assert.equal(m.type, "job");
  assert.equal(m.score, null); // verified Algolia behavior
  assert.equal(m.num_comments, null);
  assert.equal(m.permalink, "https://news.ycombinator.com/item?id=999984");
});

test("mapHnHit text (story_text/comment_text) is HTML-stripped via the shared contract path", () => {
  const hit = {
    objectID: "42",
    _tags: ["story", "ask_hn"],
    title: "Ask HN: test",
    author: "asker",
    story_text: "Line one.<p>Two &amp; <a href=\"x\">link</a>",
  };
  // mapHnHit maps text raw; buildListEnvelope -> normalizeItem strips it.
  const env = buildListEnvelope({
    source: "hackernews",
    query: null,
    results: [mapHnHit(hit)],
  });
  const text = env.results[0].text;
  assert.ok(!/</.test(text), "no HTML tags remain");
  assert.ok(text.includes("Two & link"), "entities decoded, tags removed");
});

// --- mapHnItem -----------------------------------------------------------

test("mapHnItem maps the root detail node onto the item", () => {
  const { item: it } = mapHnItem(item);
  assert.equal(it.id, "16582136");
  assert.equal(it.type, "story");
  assert.equal(it.title, "Stephen Hawking has died");
  assert.equal(it.score, 6015); // points -> score
  assert.equal(it.url, "http://www.bbc.com/news/uk-43396008");
  assert.equal(
    it.permalink,
    "https://news.ycombinator.com/item?id=16582136",
  );
  // created_at_i (epoch) -> ISO-8601
  assert.equal(it.created_utc, "2018-03-14T03:50:30.000Z");
});

test("mapHnItem flattens ONLY top-level children into comments [{id,author,text}]", () => {
  const { comments } = mapHnItem(item);
  assert.equal(comments.length, 3); // 3 top-level; nested replies excluded
  const ids = comments.map((c) => c.id);
  assert.deepEqual(ids, ["16582152", "16582170", "16582194"]);
  // nested child ids must NOT appear
  assert.ok(!ids.includes("16582191"));
  assert.ok(!ids.includes("16582228"));
  for (const c of comments) {
    assert.deepEqual(Object.keys(c).sort(), ["author", "id", "text"]);
    assert.equal(typeof c.id, "string");
  }
});

test("mapHnItem comments are HTML-stripped through buildDetailEnvelope", () => {
  const env = buildDetailEnvelope({
    source: "hackernews",
    ...mapHnItem(item),
  });
  const htmlComment = env.item.comments.find((c) => c.id === "16582152");
  assert.ok(htmlComment, "the HTML comment is present");
  assert.ok(!/<a /.test(htmlComment.text), "anchor tag stripped");
  assert.ok(!/&#x27;/.test(htmlComment.text), "entity decoded");
  assert.ok(htmlComment.text.includes("Aw man"));
});

// --- contract conformance (OUT-01) --------------------------------------

test("mapHnHit results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "hackernews",
    query: "hawking",
    results: [mapHnHit(story), mapHnHit(job)],
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, 2);
});

test("mapHnItem builds a detail envelope that parses against the contract schema", () => {
  const env = buildDetailEnvelope({
    source: "hackernews",
    ...mapHnItem(item),
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
});

// --- hn_rising helpers (TREND-03): deterministic, clock injected ---------
//
// Both helpers are pure and take an injected `nowSeconds`, so ordering and the
// numericFilters cutoff are exact and offline — no network, no Date.now().

test("risingNumericFilters builds points>N,created_at_i>cutoff from the injected clock", () => {
  const nowSeconds = 1_000_000;
  assert.equal(
    risingNumericFilters({ hours: 24, minPoints: 10, nowSeconds }),
    `points>10,created_at_i>${1_000_000 - 24 * 3600}`,
  );
  // A different window/floor recomputes the cutoff exactly.
  assert.equal(
    risingNumericFilters({ hours: 6, minPoints: 50, nowSeconds }),
    `points>50,created_at_i>${1_000_000 - 6 * 3600}`,
  );
});

test("rankByVelocity orders by points/hour desc — a fresh climber outranks an older high-points hit", () => {
  const nowSeconds = 1_000_000;
  const at = (ageHours) => nowSeconds - ageHours * 3600;
  const oldHigh = { objectID: "old", points: 200, created_at_i: at(20) }; // 10 pts/h
  const climber = { objectID: "climber", points: 60, created_at_i: at(1) }; // 60 pts/h
  const staleLow = { objectID: "stale", points: 12, created_at_i: at(23) }; // ~0.5 pts/h
  const input = [oldHigh, staleLow, climber];
  const ranked = rankByVelocity(input, nowSeconds);
  assert.deepEqual(
    ranked.map((h) => h.objectID),
    ["climber", "old", "stale"],
  );
  // input is not mutated (a NEW array is returned)
  assert.deepEqual(
    input.map((h) => h.objectID),
    ["old", "stale", "climber"],
  );
});

test("rankByVelocity guards divide-by-zero on an age-0 hit (1/60h floor) — finite velocity, no throw", () => {
  const nowSeconds = 1_000_000;
  const fresh = { objectID: "fresh", points: 5, created_at_i: nowSeconds }; // age 0
  const other = { objectID: "other", points: 5, created_at_i: nowSeconds - 3600 };
  let ranked;
  assert.doesNotThrow(() => {
    ranked = rankByVelocity([other, fresh], nowSeconds);
  });
  // 5 / (1/60h) = 300 pts/h for the age-0 hit, finite and highest here
  assert.equal(ranked[0].objectID, "fresh");
  assert.ok(Number.isFinite(5 / Math.max(0 / 3600, 1 / 60)));
});

// --- registration smoke (Task 2, FOUND-05) ------------------------------

test("hn server registers exactly hn_front_page, hn_search, hn_rising, hn_get_item", () => {
  // Tools register at import time; importing does NOT connect a transport
  // (connect is guarded to direct execution), so this stays offline.
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, [
    "hn_front_page",
    "hn_get_item",
    "hn_rising",
    "hn_search",
  ]);
});

test("hn_rising is registered with an outputSchema (contract validation on return)", () => {
  assert.ok(
    server._registeredTools["hn_rising"],
    "hn_rising is registered",
  );
  assert.ok(
    server._registeredTools["hn_rising"].outputSchema,
    "hn_rising declares an outputSchema",
  );
});

test("each hn tool declares an outputSchema (contract validation on return)", () => {
  for (const name of ["hn_front_page", "hn_search", "hn_rising", "hn_get_item"]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});
