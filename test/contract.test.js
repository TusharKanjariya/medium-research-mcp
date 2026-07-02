// Tests for shared/contract.js — the output contract (FOUND-03/05, OUT-01/03).
// The contract is the linchpin: uniform output must be structurally impossible
// to drift. node:test only (D-06).
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  TYPE,
  itemShape,
  ItemSchema,
  listEnvelopeShape,
  ListEnvelopeSchema,
  detailEnvelopeShape,
  DetailEnvelopeSchema,
  stripHtml,
  normalizeItem,
  buildListEnvelope,
  buildDetailEnvelope,
  toolResult,
} from "../shared/contract.js";

// --- normalizeItem defaults ---------------------------------------------
test("normalizeItem fills every contract field, defaulting absent fields to null", () => {
  const item = normalizeItem({ id: 40123, type: "story" });
  assert.equal(item.id, "40123", "id is coerced to a string");
  assert.equal(typeof item.id, "string");
  assert.equal(item.author, null);
  assert.equal(item.score, null);
  assert.equal(item.num_comments, null);
  assert.equal(item.created_utc, null);
  assert.equal(item.url, null);
  assert.equal(item.permalink, null);
  assert.equal(item.text, null);
  assert.deepEqual(item.tags, [], "tags defaults to an empty array");
  // every contract key is present
  for (const key of Object.keys(itemShape)) {
    assert.ok(key in item, `normalized item must contain key: ${key}`);
  }
});

test("normalizeItem never renames or drops score/num_comments — keys always present even when null", () => {
  const item = normalizeItem({ id: 1, type: "story" });
  assert.ok("score" in item);
  assert.ok("num_comments" in item);
  assert.equal(item.score, null);
  assert.equal(item.num_comments, null);
});

test("normalizeItem preserves a zero score/num_comments (does not coerce 0 to null)", () => {
  const item = normalizeItem({ id: 1, type: "story", score: 0, num_comments: 0 });
  assert.equal(item.score, 0);
  assert.equal(item.num_comments, 0);
});

test("normalizeItem strips HTML from text", () => {
  const item = normalizeItem({ id: 1, type: "story", text: "<p>Hello &amp; <b>bye</b></p>" });
  assert.equal(item.text, "Hello & bye");
});

test("normalizeItem output parses cleanly against ItemSchema", () => {
  const item = normalizeItem({ id: 1, type: "story", score: 42, num_comments: null });
  assert.doesNotThrow(() => ItemSchema.parse(item));
});

// --- TYPE enum: Phase 3 additive extension (Pitfall 1 BLOCKER) -----------
// GitHub issues -> "issue", Libraries.io packages -> "package", Product Hunt
// launches -> "launch". toolResult() validates structuredContent against
// z.enum(TYPE) on every return, so these values MUST be in the enum or every
// Phase 3 source call fails SDK output validation. The extension is additive:
// the nine prior values keep parsing (no removal/reorder that breaks callers).

test("TYPE includes the Phase 3 additive values issue, package, launch", () => {
  for (const t of ["issue", "package", "launch"]) {
    assert.ok(TYPE.includes(t), `TYPE must include "${t}"`);
  }
});

test("TYPE keeps every pre-existing value (additive change, no removals/reorder)", () => {
  const priorNine = [
    "story",
    "ask",
    "show",
    "question",
    "article",
    "repo",
    "comment",
    "post",
    "job",
  ];
  for (const t of priorNine) {
    assert.ok(TYPE.includes(t), `TYPE must still include prior value "${t}"`);
  }
  // the original nine remain the leading prefix, in order (appended, not reordered)
  assert.deepEqual(TYPE.slice(0, priorNine.length), priorNine);
});

test("ItemSchema parses items typed issue, package, and launch", () => {
  for (const t of ["issue", "package", "launch"]) {
    const item = normalizeItem({ id: 1, type: t, title: "x" });
    assert.doesNotThrow(
      () => ItemSchema.parse(item),
      `an item typed "${t}" must parse`,
    );
    assert.equal(item.type, t);
  }
});

test("a buildListEnvelope round-trip accepts issue/package/launch items", () => {
  const env = buildListEnvelope({
    source: "github",
    query: "flaky tests",
    results: [
      { id: 1, type: "issue", title: "i" },
      { id: 2, type: "package", title: "p" },
      { id: 3, type: "launch", title: "l" },
    ],
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, 3);
});

test("a bogus type is still rejected by ItemSchema (enum stays closed)", () => {
  const bogus = normalizeItem({ id: 1, type: "not_a_real_type", title: "x" });
  assert.throws(() => ItemSchema.parse(bogus), /invalid|enum/i);
});

// --- stripHtml -----------------------------------------------------------
test("stripHtml removes tags and decodes named + numeric entities", () => {
  assert.equal(stripHtml('a &lt;b&gt; &quot;c&quot; &#65; &#x42;'), 'a <b> "c" A B');
  assert.equal(stripHtml("<p>Hello &amp; <b>world</b></p>"), "Hello & world");
});

test("stripHtml returns null for empty, blank, or tag-only input", () => {
  assert.equal(stripHtml(""), null);
  assert.equal(stripHtml("   "), null);
  assert.equal(stripHtml("<p></p>"), null);
  assert.equal(stripHtml(null), null);
  assert.equal(stripHtml(undefined), null);
});

// --- buildListEnvelope ---------------------------------------------------
test("buildListEnvelope produces {source,query,count,results} with count===results.length and query defaulting to null", () => {
  const env = buildListEnvelope({
    source: "hackernews",
    results: [
      { id: 1, type: "story", title: "a" },
      { id: 2, type: "ask", title: "b" },
    ],
  });
  assert.equal(env.source, "hackernews");
  assert.equal(env.query, null);
  assert.equal(env.count, 2);
  assert.equal(env.count, env.results.length);
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
});

test("buildListEnvelope passes query through when provided", () => {
  const env = buildListEnvelope({ source: "hackernews", query: "vector db", results: [] });
  assert.equal(env.query, "vector db");
  assert.equal(env.count, 0);
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
});

// --- buildDetailEnvelope -------------------------------------------------
test("buildDetailEnvelope produces {source,item:{...item,comments}} with HTML-stripped comment text", () => {
  const env = buildDetailEnvelope({
    source: "hackernews",
    item: { id: 40123, type: "story", title: "root", text: "<p>body &amp; more</p>" },
    comments: [
      { id: 99, author: "alice", text: "<p>nice &amp; tidy</p>" },
      { id: 100, author: null, text: null },
    ],
  });
  assert.equal(env.source, "hackernews");
  assert.equal(env.item.id, "40123");
  assert.equal(env.item.text, "body & more");
  assert.equal(env.item.comments.length, 2);
  assert.deepEqual(env.item.comments[0], { id: "99", author: "alice", text: "nice & tidy" });
  assert.deepEqual(env.item.comments[1], { id: "100", author: null, text: null });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
});

// --- raw shapes vs ZodObject --------------------------------------------
test("itemShape/listEnvelopeShape/detailEnvelopeShape are raw shape objects, not ZodObject instances", () => {
  for (const shape of [itemShape, listEnvelopeShape, detailEnvelopeShape]) {
    assert.equal(typeof shape, "object");
    assert.equal(typeof shape.parse, "undefined", "a raw shape must not have .parse()");
    assert.equal(shape instanceof z.ZodType, false, "a raw shape is not a Zod schema");
  }
  // each field value IS a Zod schema
  assert.ok(itemShape.id instanceof z.ZodType);
  // the compiled schemas ARE ZodObjects
  assert.ok(ItemSchema instanceof z.ZodType);
  assert.equal(typeof ItemSchema.parse, "function");
});

// --- toolResult single seam ---------------------------------------------
test("toolResult returns both a JSON-text content block and structuredContent", () => {
  const env = buildListEnvelope({ source: "hackernews", results: [] });
  const result = toolResult(env);
  assert.deepEqual(result.structuredContent, env);
  assert.equal(Array.isArray(result.content), true);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), env);
});
