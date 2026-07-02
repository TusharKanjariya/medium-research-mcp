// test/hashnode.test.js — Hashnode source server (SRC-04).
//
// Two concerns, both offline (fixtures pin the field map; no live network):
//   1. Field-mapping units — mapHashnodeNode / mapHashnodeDetail convert captured
//      GraphQL payloads into exact contract items/details (reactionCount->score,
//      responseCount->num_comments, tags[].slug->tags).
//   2. Registration smoke — the three tools register on the McpServer, each with
//      an outputSchema.
//
// Fixtures mirror the Hashnode public GraphQL response shape (02-RESEARCH SRC-04,
// cited schema). NOTE: the live Hashnode origin returned a Cloudflare 522 during
// execution, so these fixtures were built from the RESEARCH-cited feed/post
// schema rather than a fresh live capture — the field NAMES (reactionCount /
// responseCount / tags[].slug) are what the maps assert against.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapHashnodeNode,
  mapHashnodeDetail,
  requireHashnodePost,
  server,
} from "../servers/hashnode/server.js";
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

const feed = fixture("hashnode-list"); // feed(FEATURED) GraphQL response
const post = fixture("hashnode-detail"); // post(id) GraphQL response
const nodes = feed.data.feed.edges.map((e) => e.node);
const node = nodes[0];

// --- mapHashnodeNode -----------------------------------------------------

test("mapHashnodeNode maps a feed node onto the exact contract fields", () => {
  const m = mapHashnodeNode(node);
  assert.equal(m.id, node.id);
  assert.equal(m.type, "article");
  assert.equal(m.title, node.title);
  assert.equal(m.author, node.author.name);
  assert.equal(m.score, node.reactionCount); // reactionCount -> score
  assert.equal(m.num_comments, node.responseCount); // responseCount -> num_comments
  assert.equal(m.created_utc, node.publishedAt); // ISO passthrough (no conversion)
  assert.equal(m.url, node.url);
  assert.equal(m.permalink, node.url); // url is the canonical permalink
  assert.deepEqual(m.tags, ["nodejs", "backend"]); // tags[].slug
  assert.equal(m.text, node.brief); // feed text = brief
});

test("mapHashnodeNode author falls back to username when name is null", () => {
  const gqlGuru = nodes[1]; // author.name === null, username "gqlguru"
  assert.equal(gqlGuru.author.name, null);
  assert.equal(mapHashnodeNode(gqlGuru).author, "gqlguru");
});

test("mapHashnodeNode preserves a legitimate zero reactionCount/responseCount", () => {
  const zeroed = nodes[1]; // reactionCount 0, responseCount 0
  const m = mapHashnodeNode(zeroed);
  assert.equal(m.score, 0); // 0 must NOT normalize to null
  assert.equal(m.num_comments, 0);
});

test("mapHashnodeNode tags is a plain array of slug strings", () => {
  const m = mapHashnodeNode(nodes[2]); // Rust article, two tags
  assert.deepEqual(m.tags, ["rust", "webdev"]);
});

// --- mapHashnodeDetail ---------------------------------------------------

test("mapHashnodeDetail item uses content.markdown (not brief) for text", () => {
  const { item } = mapHashnodeDetail(post.data.post);
  assert.equal(item.id, post.data.post.id);
  assert.equal(item.type, "article");
  assert.equal(item.score, post.data.post.reactionCount);
  assert.equal(item.num_comments, post.data.post.responseCount);
  // detail text is the full markdown body, not the short brief
  assert.ok(item.text.includes("Why resilience matters"));
});

test("mapHashnodeNode/detail body is HTML-stripped through the shared contract path", () => {
  const env = buildDetailEnvelope({
    source: "hashnode",
    ...mapHashnodeDetail(post.data.post),
  });
  const text = env.item.text;
  assert.ok(!/<b>/.test(text), "inline HTML tags stripped");
  assert.ok(text.includes("retries & backoff"), "entities decoded");
});

test("mapHashnodeDetail flattens top-level comments to [{id,author,text}]", () => {
  const { comments } = mapHashnodeDetail(post.data.post);
  const edges = post.data.post.comments.edges;
  assert.equal(comments.length, edges.length);
  for (const c of comments) {
    assert.deepEqual(Object.keys(c).sort(), ["author", "id", "text"]);
  }
  assert.equal(comments[0].id, edges[0].node.id);
  assert.equal(comments[0].author, edges[0].node.author.name);
  assert.equal(comments[1].author, "curiousdev"); // name null -> username
});

test("mapHashnodeDetail comment HTML is stripped through buildDetailEnvelope", () => {
  const env = buildDetailEnvelope({
    source: "hashnode",
    ...mapHashnodeDetail(post.data.post),
  });
  const first = env.item.comments[0];
  assert.ok(!/<a /.test(first.text), "anchor tag stripped");
  assert.ok(first.text.includes("the same pattern & it saved us"), "entity decoded");
});

// --- WR-03: not-found returns a clear error, not a bogus placeholder ------

test("requireHashnodePost throws a clear not-found error when the article is absent (WR-03)", () => {
  // GraphQL returns data.post === null for a missing id; `?? {}` used to produce
  // a junk `id: "undefined"` detail item. Now it not-founds cleanly instead.
  assert.throws(() => requireHashnodePost(null, "abc123"), /article abc123 not found/);
  assert.throws(() => requireHashnodePost(undefined, "x"), /not found/);
});

test("requireHashnodePost returns the post unchanged when present (WR-03 happy path)", () => {
  const p = { id: "real", title: "t" };
  assert.equal(requireHashnodePost(p, "real"), p);
});

// --- hashnode_search client-side window filter (D-01) --------------------

test("hashnode_search-style filter returns only substring matches within the window", () => {
  const q = "rust"; // matches the Rust article (title + tag slug)
  const hits = nodes.filter((n) =>
    `${n.title ?? ""} ${(n.tags ?? []).map((t) => t.slug).join(" ")} ${
      n.brief ?? ""
    }`
      .toLowerCase()
      .includes(q),
  );
  assert.ok(hits.length >= 1, "at least one match in the window");
  const env = buildListEnvelope({
    source: "hashnode",
    query: q,
    results: hits.map(mapHashnodeNode),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  // a nonsense query matches nothing and still yields a valid (empty) envelope
  const none = nodes.filter((n) =>
    `${n.title}`.toLowerCase().includes("zzz-no-such-token-zzz"),
  );
  const empty = buildListEnvelope({
    source: "hashnode",
    query: "zzz-no-such-token-zzz",
    results: none.map(mapHashnodeNode),
  });
  assert.equal(empty.count, 0);
});

test("trending-by-tag filter matches on tags[].slug (Pitfall 5 — no ObjectId needed)", () => {
  const tag = "graphql";
  const filtered = nodes.filter((n) =>
    (n.tags ?? []).some((t) => t.slug === tag),
  );
  assert.equal(filtered.length, 1);
  assert.equal(mapHashnodeNode(filtered[0]).title, nodes[1].title);
});

// --- contract conformance (OUT-01) --------------------------------------

test("mapHashnodeNode results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "hashnode",
    query: "trending",
    results: nodes.map(mapHashnodeNode),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, nodes.length);
});

test("mapHashnodeDetail builds a detail envelope that parses against the contract schema", () => {
  const env = buildDetailEnvelope({
    source: "hashnode",
    ...mapHashnodeDetail(post.data.post),
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
});

// --- registration smoke --------------------------------------------------

test("hashnode server registers exactly hashnode_get, hashnode_search, hashnode_trending", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, [
    "hashnode_get",
    "hashnode_search",
    "hashnode_trending",
  ]);
});

test("each hashnode tool declares an outputSchema (contract validation on return)", () => {
  for (const name of ["hashnode_get", "hashnode_search", "hashnode_trending"]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});
