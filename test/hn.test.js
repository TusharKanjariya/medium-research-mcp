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

import { mapHnHit, mapHnItem, server } from "../servers/hn/server.js";
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

// --- registration smoke (Task 2, FOUND-05) ------------------------------

test("hn server registers exactly hn_front_page, hn_search, hn_get_item", () => {
  // Tools register at import time; importing does NOT connect a transport
  // (connect is guarded to direct execution), so this stays offline.
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, ["hn_front_page", "hn_get_item", "hn_search"]);
});

test("each hn tool declares an outputSchema (contract validation on return)", () => {
  for (const name of ["hn_front_page", "hn_search", "hn_get_item"]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});
