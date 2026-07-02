// test/devto.test.js — Dev.to (Forem) source server (SRC-05).
//
// Two concerns, both offline (fixtures pin the field map; no live network):
//   1. Field-mapping units — mapDevtoArticle / mapDevtoDetail convert captured
//      Forem payloads into exact contract items/details (public_reactions_count
//      ->score, comments_count->num_comments, tag_list->tags, list description vs
//      detail body_markdown).
//   2. Registration smoke — the four tools register on the McpServer, each with
//      an outputSchema.
//
// Fixtures are REAL Forem payloads captured once (test/fixtures/devto-*.json):
//   - devto-list.json    : /articles?top=7&per_page=5  (tag_list is an ARRAY)
//   - devto-detail.json  : /articles/{id}              (tag_list is a STRING)
//   - devto-comments.json: /comments?a_id={id}         (top-level, id_code)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapDevtoArticle,
  mapDevtoDetail,
  server,
} from "../servers/devto/server.js";
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

const list = fixture("devto-list"); // array of /articles list objects
const detail = fixture("devto-detail"); // one /articles/{id} object
const comments = fixture("devto-comments"); // /comments?a_id= top-level array
const article = list[0];

// --- mapDevtoArticle -----------------------------------------------------

test("mapDevtoArticle maps a list article onto the exact contract fields", () => {
  const m = mapDevtoArticle(article);
  assert.equal(m.id, String(article.id));
  assert.equal(typeof m.id, "string"); // id stringified
  assert.equal(m.type, "article");
  assert.equal(m.title, article.title);
  assert.equal(m.author, article.user.username);
  assert.equal(m.score, article.public_reactions_count); // reactions -> score
  assert.equal(m.num_comments, article.comments_count); // comments -> num_comments
  assert.equal(m.created_utc, article.published_at); // ISO passthrough (no conversion)
  assert.equal(m.url, article.url);
  assert.equal(m.permalink, article.url);
  assert.deepEqual(m.tags, article.tag_list); // list tag_list is already an array
  assert.equal(m.text, article.description); // list text = description
});

test("mapDevtoArticle normalizes a comma-separated tag_list STRING (detail quirk) to an array", () => {
  // The detail endpoint returns tag_list as "aie, gemma, ai" — must become an array.
  assert.equal(typeof detail.tag_list, "string");
  const m = mapDevtoArticle(detail);
  assert.ok(Array.isArray(m.tags), "tags is an array");
  assert.deepEqual(m.tags, ["aie", "gemma", "ai"]);
});

test("mapDevtoArticle yields null score/num_comments when the source omits them", () => {
  const m = mapDevtoArticle({ id: 1, title: "t", user: { username: "u" } });
  assert.equal(m.score, null);
  assert.equal(m.num_comments, null);
  assert.deepEqual(m.tags, []);
});

test("mapDevtoArticle author falls back to name when username is absent", () => {
  const m = mapDevtoArticle({ id: 2, title: "t", user: { name: "Full Name" } });
  assert.equal(m.author, "Full Name");
});

// --- mapDevtoDetail ------------------------------------------------------

test("mapDevtoDetail item text uses body_markdown (not description)", () => {
  const { item } = mapDevtoDetail(detail, comments);
  assert.equal(item.id, String(detail.id));
  assert.equal(item.type, "article");
  assert.equal(item.score, detail.public_reactions_count);
  assert.equal(item.num_comments, detail.comments_count);
  assert.equal(item.text, detail.body_markdown); // detail text = full body
});

test("mapDevtoDetail flattens top-level comments to [{id,author,text}] (id_code, username)", () => {
  const { comments: flat } = mapDevtoDetail(detail, comments);
  assert.equal(flat.length, comments.length);
  for (const c of flat) {
    assert.deepEqual(Object.keys(c).sort(), ["author", "id", "text"]);
  }
  assert.equal(flat[0].id, comments[0].id_code); // id_code -> id
  assert.equal(flat[0].author, comments[0].user.username);
});

test("mapDevtoDetail drops nested children (only the top level becomes comments)", () => {
  const synthetic = {
    id_code: "top1",
    user: { username: "alice" },
    body_html: "<p>Parent comment</p>",
    children: [
      { id_code: "kid1", user: { username: "bob" }, body_html: "<p>reply</p>", children: [] },
    ],
  };
  const { comments: flat } = mapDevtoDetail({ id: 9, title: "t" }, [synthetic]);
  assert.equal(flat.length, 1, "only the top-level comment is mapped");
  assert.equal(flat[0].id, "top1");
  assert.ok(!flat.some((c) => c.id === "kid1"), "nested child id must not appear");
});

test("mapDevtoDetail comment body_html is HTML-stripped through buildDetailEnvelope", () => {
  const synthetic = {
    id_code: "c1",
    user: { username: "carol" },
    body_html: "Nice &amp; clear <a href=\"x\">write-up</a>",
    children: [],
  };
  const env = buildDetailEnvelope({
    source: "devto",
    ...mapDevtoDetail({ id: 9, title: "t", body_markdown: "body" }, [synthetic]),
  });
  const c = env.item.comments[0];
  assert.ok(!/<a /.test(c.text), "anchor tag stripped");
  assert.ok(c.text.includes("Nice & clear write-up"), "entities decoded, tags removed");
});

// --- devto_search client-side window filter (D-01) -----------------------

test("devto_search-style filter returns only substring matches within the window", () => {
  const q = "ai"; // present across the AI-themed top window
  const hits = list.filter((a) =>
    `${a.title ?? ""} ${(a.tag_list ?? []).join(" ")} ${a.description ?? ""}`
      .toLowerCase()
      .includes(q),
  );
  assert.ok(hits.length >= 1, "at least one match in the window");
  const env = buildListEnvelope({
    source: "devto",
    query: q,
    results: hits.map(mapDevtoArticle),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  // a nonsense query matches nothing and still yields a valid (empty) envelope
  const none = list.filter((a) =>
    `${a.title}`.toLowerCase().includes("zzz-no-such-token-zzz"),
  );
  const empty = buildListEnvelope({
    source: "devto",
    query: "zzz-no-such-token-zzz",
    results: none.map(mapDevtoArticle),
  });
  assert.equal(empty.count, 0);
});

// --- contract conformance (OUT-01) --------------------------------------

test("mapDevtoArticle results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "devto",
    query: "top",
    results: list.map(mapDevtoArticle),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, list.length);
});

test("mapDevtoDetail builds a detail envelope that parses against the contract schema", () => {
  const env = buildDetailEnvelope({
    source: "devto",
    ...mapDevtoDetail(detail, comments),
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
});

// --- registration smoke --------------------------------------------------

test("devto server registers exactly devto_get, devto_search, devto_tag, devto_top", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, ["devto_get", "devto_search", "devto_tag", "devto_top"]);
});

test("each devto tool declares an outputSchema (contract validation on return)", () => {
  for (const name of ["devto_get", "devto_search", "devto_tag", "devto_top"]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});
