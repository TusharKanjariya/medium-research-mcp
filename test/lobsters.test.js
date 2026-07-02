// test/lobsters.test.js — Lobsters source server (SRC-02).
//
// Two concerns, both offline (fixtures pin the field map; no live network):
//   1. Field-mapping units — mapLobstersStory / mapLobstersDetail convert captured
//      lobste.rs payloads into exact contract items/details (incl. the plain-string
//      submitter_user, Pitfall 6).
//   2. Registration smoke — the four tools register on the McpServer, each with an
//      outputSchema.
//
// Fixtures are REAL lobste.rs payloads captured once (test/fixtures/lobsters-*.json)
// so the map is validated against ground truth, not a hand-written mock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapLobstersStory,
  mapLobstersDetail,
  server,
} from "../servers/lobsters/server.js";
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

const list = fixture("lobsters-list"); // array of stories from /hottest.json
const detail = fixture("lobsters-detail"); // one /s/{short_id}.json story
const story = list[0];

// --- mapLobstersStory ----------------------------------------------------

test("mapLobstersStory maps a story onto the exact contract fields", () => {
  const m = mapLobstersStory(story);
  assert.equal(m.id, story.short_id);
  assert.equal(m.type, "story");
  assert.equal(m.title, story.title);
  assert.equal(m.score, story.score); // upvotes -> score
  assert.equal(m.num_comments, story.comment_count); // comment_count -> num_comments
  assert.equal(m.created_utc, story.created_at); // ISO passthrough (no conversion)
  assert.equal(m.url, story.url);
  assert.equal(m.permalink, story.comments_url);
  assert.deepEqual(m.tags, story.tags);
});

test("mapLobstersStory author comes from the plain-string submitter_user (Pitfall 6)", () => {
  // The live API returns submitter_user as a plain username STRING, not a
  // nested {username} object — so author must equal the string directly.
  assert.equal(typeof story.submitter_user, "string");
  const m = mapLobstersStory(story);
  assert.equal(m.author, story.submitter_user);
});

test("mapLobstersStory yields null score/num_comments when the source omits them", () => {
  const m = mapLobstersStory({ short_id: "x1", title: "t", submitter_user: "u" });
  assert.equal(m.score, null);
  assert.equal(m.num_comments, null);
});

test("mapLobstersStory text (description) is HTML-stripped via the shared contract path", () => {
  const raw = {
    short_id: "md1",
    title: "markup",
    submitter_user: "u",
    description: "Line one.<p>Two &amp; <a href=\"x\">link</a>",
    // no description_plain -> falls back to the HTML description
  };
  const env = buildListEnvelope({
    source: "lobsters",
    query: null,
    results: [mapLobstersStory(raw)],
  });
  const text = env.results[0].text;
  assert.ok(!/</.test(text), "no HTML tags remain");
  assert.ok(text.includes("Two & link"), "entities decoded, tags removed");
});

// --- mapLobstersDetail ---------------------------------------------------

test("mapLobstersDetail maps the story and flattens comments to [{id,author,text}]", () => {
  const { item, comments } = mapLobstersDetail(detail);
  assert.equal(item.id, detail.short_id);
  assert.equal(item.type, "story");
  assert.equal(comments.length, detail.comments.length);
  for (const c of comments) {
    assert.deepEqual(Object.keys(c).sort(), ["author", "id", "text"]);
    assert.equal(typeof c.id, "string");
  }
  const first = comments[0];
  assert.equal(first.id, detail.comments[0].short_id);
  assert.equal(first.author, detail.comments[0].commenting_user);
});

test("mapLobstersDetail comments are HTML-stripped through buildDetailEnvelope", () => {
  const synthetic = {
    short_id: "s9",
    title: "t",
    submitter_user: "u",
    comments: [
      {
        short_id: "c9",
        commenting_user: "alice",
        comment: "Aw &amp; <a href=\"x\">man</a>", // HTML only, no comment_plain
      },
    ],
  };
  const env = buildDetailEnvelope({
    source: "lobsters",
    ...mapLobstersDetail(synthetic),
  });
  const c = env.item.comments[0];
  assert.ok(!/<a /.test(c.text), "anchor tag stripped");
  assert.ok(c.text.includes("Aw & man"), "entities decoded, tags removed");
});

// --- lobsters_search client-side window filter (D-01) --------------------

test("lobsters_search-style filter returns only substring matches within the window", () => {
  const q = "supreme"; // present in the first story's title
  const hits = list.filter((s) =>
    `${s.title ?? ""} ${(s.tags ?? []).join(" ")} ${
      s.description_plain ?? s.description ?? ""
    }`
      .toLowerCase()
      .includes(q),
  );
  assert.ok(hits.length >= 1, "at least one match in the window");
  for (const h of hits) {
    const hay = `${h.title} ${(h.tags ?? []).join(" ")} ${
      h.description_plain ?? h.description ?? ""
    }`.toLowerCase();
    assert.ok(hay.includes(q));
  }
  // a nonsense query matches nothing and still yields a valid (empty) envelope
  const none = list.filter((s) =>
    `${s.title}`.toLowerCase().includes("zzz-no-such-token-zzz"),
  );
  const env = buildListEnvelope({
    source: "lobsters",
    query: "zzz-no-such-token-zzz",
    results: none.map(mapLobstersStory),
  });
  assert.equal(env.count, 0);
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
});

// --- contract conformance (OUT-01) --------------------------------------

test("mapLobstersStory results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "lobsters",
    query: "hottest",
    results: list.map(mapLobstersStory),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, list.length);
});

test("mapLobstersDetail builds a detail envelope that parses against the contract schema", () => {
  const env = buildDetailEnvelope({
    source: "lobsters",
    ...mapLobstersDetail(detail),
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
});

// --- registration smoke --------------------------------------------------

test("lobsters server registers exactly the four expected tools", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, [
    "lobsters_get",
    "lobsters_hottest",
    "lobsters_search",
    "lobsters_tag",
  ]);
});

test("each lobsters tool declares an outputSchema (contract validation on return)", () => {
  for (const name of [
    "lobsters_get",
    "lobsters_hottest",
    "lobsters_search",
    "lobsters_tag",
  ]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});
