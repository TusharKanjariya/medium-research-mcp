// test/producthunt.test.js — Product Hunt source server (SRC-08, OUT-01).
//
// Concerns, all offline (fixtures pin the field map; no live network):
//   1. Field-mapping units — mapPhPost / mapPhDetail convert captured Product Hunt v2
//      GraphQL payloads into exact contract items/details (votesCount->score,
//      commentsCount->num_comments, type:"launch", topic slugs->tags, comments[]).
//   2. Envelope conformance — list/detail envelopes parse against the contract schemas.
//   3. GraphQL 200-with-errors guard (Pitfall 4, T-03-07) — requirePhOk throws a clear
//      error on an `errors` array instead of yielding a silent empty list.
//   4. Required-credential proof (criterion 4, D-10) — productHuntHeaders() throws a
//      clear "set PRODUCTHUNT_TOKEN" error when the token is unset.
//   5. Registration smoke — the two tools register, each with an outputSchema.
//   6. Security invariants — no direct fetch(, no process.env in the server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapPhPost,
  mapPhDetail,
  requirePhOk,
  requirePhPost,
  server,
} from "../servers/producthunt/server.js";
import {
  buildListEnvelope,
  buildDetailEnvelope,
  ListEnvelopeSchema,
  DetailEnvelopeSchema,
} from "../shared/contract.js";
import { productHuntHeaders } from "../shared/credentials.js";

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)),
      "utf8",
    ),
  );

const posts = fixture("producthunt-posts"); // { data: { posts: { edges } } }
const postDetail = fixture("producthunt-post-detail"); // { data: { post: {...} } }

const edges = posts.data.posts.edges;
const firstNode = edges[0].node; // SuperTool: topics present, user.name present
const bareNode = edges[1].node; // MinimalApp: empty topics, user.name null
const detailPost = postDetail.data.post;

// --- mapPhPost -----------------------------------------------------------

test("mapPhPost maps a raw Product Hunt post node onto the exact contract fields", () => {
  const m = mapPhPost(firstNode);
  assert.equal(m.id, String(firstNode.id));
  assert.equal(typeof m.id, "string");
  assert.equal(m.type, "launch"); // NEW enum value (03-01 Task 1 prerequisite)
  assert.equal(m.title, firstNode.name);
  assert.equal(m.author, firstNode.user.name); // display name preferred
  assert.equal(m.created_utc, firstNode.createdAt); // already ISO-8601
  assert.equal(m.url, firstNode.website); // external product link
  assert.equal(m.permalink, firstNode.url); // Product Hunt post page
});

test("mapPhPost reads score from votesCount and num_comments from commentsCount (D-05/D-07)", () => {
  const m = mapPhPost(firstNode);
  assert.equal(m.score, firstNode.votesCount);
  assert.equal(m.score, 842);
  assert.equal(m.num_comments, firstNode.commentsCount);
  assert.equal(m.num_comments, 57);
});

test("mapPhPost maps topic slugs to tags (and empty topics to [])", () => {
  assert.deepEqual(mapPhPost(firstNode).tags, ["developer-tools", "productivity"]);
  assert.deepEqual(mapPhPost(bareNode).tags, []);
});

test("mapPhPost author falls back to username when the display name is null", () => {
  assert.equal(mapPhPost(bareNode).author, bareNode.user.username);
});

test("mapPhPost preserves a legitimate 0 votesCount/commentsCount (not null)", () => {
  const m = mapPhPost({ ...firstNode, votesCount: 0, commentsCount: 0 });
  assert.equal(m.score, 0);
  assert.equal(m.num_comments, 0);
});

// --- HTML stripping through the shared contract path (OUT-03) ------------

test("post tagline HTML is stripped through buildListEnvelope -> normalizeItem", () => {
  const env = buildListEnvelope({
    source: "producthunt",
    query: null,
    results: [mapPhPost(firstNode)], // tagline carries a <b> tag
  });
  const text = env.results[0].text;
  assert.ok(text != null);
  assert.ok(!/</.test(text), "no HTML tags remain in text");
  assert.ok(text.includes("fastest"), "text content preserved");
});

// --- contract conformance (OUT-01) --------------------------------------

test("mapPhPost results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "producthunt",
    query: "developer-tools",
    results: edges.map((e) => mapPhPost(e.node)),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, edges.length);
  for (const r of env.results) assert.equal(r.type, "launch");
});

// --- mapPhDetail (producthunt_get) --------------------------------------

test("mapPhDetail maps the post onto the item and top-level comments onto comments[]", () => {
  const { item, comments } = mapPhDetail(detailPost);
  assert.equal(item.id, String(detailPost.id));
  assert.equal(item.type, "launch");
  assert.equal(item.score, detailPost.votesCount);
  const srcComments = detailPost.comments.edges;
  assert.equal(comments.length, srcComments.length);
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const src = srcComments[i].node;
    assert.deepEqual(Object.keys(c).sort(), ["author", "id", "text"]);
    assert.equal(c.id, String(src.id));
    assert.equal(typeof c.id, "string");
    assert.equal(c.author, src.user.name ?? src.user.username);
  }
});

// --- WR-01: null-safe edge/node handling (resilience, never hard-error) ---

test("mapPhDetail filters out null/absent comment edges instead of throwing (WR-01)", () => {
  const withHoles = {
    ...detailPost,
    comments: {
      edges: [
        null, // a null edge
        { node: null }, // an edge with a null node
        detailPost.comments.edges[0], // a real edge
      ],
    },
  };
  let out;
  assert.doesNotThrow(() => {
    out = mapPhDetail(withHoles);
  }, "a null edge/node must never throw an uncaught TypeError");
  assert.equal(out.comments.length, 1, "only the one real comment survives");
  assert.equal(out.comments[0].id, String(detailPost.comments.edges[0].node.id));
});

test("producthunt_get detail builds a DetailEnvelopeSchema-valid envelope with comments[] populated and stripped", () => {
  const env = buildDetailEnvelope({
    source: "producthunt",
    ...mapPhDetail(detailPost),
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
  assert.equal(env.item.comments.length, detailPost.comments.edges.length);
  for (const c of env.item.comments) {
    if (c.text != null) assert.ok(!/<[a-z]/i.test(c.text), "comment HTML stripped");
  }
});

// --- Pitfall 4 / T-03-07: GraphQL 200-with-errors guard ------------------

test("requirePhOk throws a clear error when the GraphQL response carries an errors array (Pitfall 4)", () => {
  const errored = {
    data: null,
    errors: [{ message: "Field 'posts' is missing required arguments" }],
  };
  assert.throws(() => requirePhOk(errored), /GraphQL error/);
  assert.throws(() => requirePhOk(errored), /missing required arguments/);
});

test("requirePhOk returns the response unchanged on a clean payload (no errors)", () => {
  assert.equal(requirePhOk(posts), posts);
  assert.equal(requirePhOk({ data: { posts: { edges: [] } } }).data.posts.edges.length, 0);
});

// --- CR-01: not-found guard ----------------------------------------------

test("requirePhPost throws a clear not-found error for a null post (unknown id)", () => {
  assert.throws(() => requirePhPost(null, "999999"), /launch 999999 not found/);
  assert.throws(() => requirePhPost(undefined, "x"), /not found/);
});

test("requirePhPost returns the post unchanged when present (happy path)", () => {
  const p = { id: "1", name: "x" };
  assert.equal(requirePhPost(p, "1"), p);
});

// --- criterion 4 proof: missing PRODUCTHUNT_TOKEN throws a clear error ----

test("productHuntHeaders throws a clear 'set PRODUCTHUNT_TOKEN' error when the token is unset (criterion 4, D-10)", () => {
  const prev = process.env.PRODUCTHUNT_TOKEN;
  delete process.env.PRODUCTHUNT_TOKEN;
  try {
    assert.throws(
      () => productHuntHeaders(),
      /PRODUCTHUNT_TOKEN/,
      "a missing required token fails loudly BEFORE any request",
    );
  } finally {
    if (prev !== undefined) process.env.PRODUCTHUNT_TOKEN = prev;
  }
});

test("productHuntHeaders returns a Bearer Authorization header when the token is set", () => {
  const prev = process.env.PRODUCTHUNT_TOKEN;
  process.env.PRODUCTHUNT_TOKEN = "ph-token-abc";
  try {
    assert.deepEqual(productHuntHeaders(), { Authorization: "Bearer ph-token-abc" });
  } finally {
    if (prev === undefined) delete process.env.PRODUCTHUNT_TOKEN;
    else process.env.PRODUCTHUNT_TOKEN = prev;
  }
});

// --- registration smoke (FOUND-05) --------------------------------------

test("producthunt server registers exactly producthunt_get, producthunt_launches", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, ["producthunt_get", "producthunt_launches"]);
});

test("each producthunt tool declares an outputSchema (contract validation on return)", () => {
  for (const name of ["producthunt_launches", "producthunt_get"]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});

// --- security invariants: no direct fetch, no process.env in the server --

test("servers/producthunt/server.js never calls fetch directly and never reads process.env", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../servers/producthunt/server.js", import.meta.url)),
    "utf8",
  );
  assert.ok(!/\bfetch\s*\(/.test(src), "no direct fetch( — all HTTP via postJson()");
  assert.ok(
    !/process\.env/.test(src),
    "no process.env — creds only via productHuntHeaders()",
  );
});
