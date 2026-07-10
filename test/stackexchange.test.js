// test/stackexchange.test.js — Stack Exchange source server (SRC-01, OUT-01).
//
// Two concerns, both offline (fixtures pin the field map; no live network):
//   1. Field-mapping units — mapSeQuestion / mapSeDetail convert captured SE 2.3
//      payloads into exact contract items/details (votes->score, answers->
//      num_comments, epoch-seconds->ISO, answers->comments[]).
//   2. Registration smoke — the three D-02 tools register on the McpServer, each
//      with an outputSchema, without throwing.
//
// Fixtures are REAL SE 2.3 payloads captured once with filter=withbody
// (test/fixtures/stackexchange-*.json) so the map is validated against ground
// truth AND `text` body-presence is provable (Assumption A1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapSeQuestion,
  mapSeDetail,
  requireSeQuestion,
  seUrl,
  server,
} from "../servers/stackexchange/server.js";
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

const list = fixture("stackexchange-list");
const detail = fixture("stackexchange-detail");
const answers = fixture("stackexchange-answers");

const listItem = list.items[0];
const detailQuestion = detail.items[0];

// --- mapSeQuestion -------------------------------------------------------

test("mapSeQuestion maps a raw SE question onto the exact contract fields", () => {
  const m = mapSeQuestion(listItem);
  assert.equal(m.id, String(listItem.question_id));
  assert.equal(typeof m.id, "string"); // question_id stringified
  assert.equal(m.type, "question"); // literal
  assert.equal(m.title, listItem.title);
  assert.equal(m.author, listItem.owner?.display_name ?? null);
  assert.equal(m.score, listItem.score); // score -> score (votes)
  assert.equal(m.num_comments, listItem.answer_count); // answer_count -> num_comments
  assert.equal(m.url, listItem.link);
  assert.equal(m.permalink, listItem.link); // permalink == url
  assert.deepEqual(m.tags, listItem.tags);
});

test("mapSeQuestion converts creation_date (epoch SECONDS) to a non-1970 ISO string (Pitfall 3)", () => {
  const m = mapSeQuestion(listItem);
  // round-trips the epoch: parsing back yields the same second, and the year is
  // the real capture year — NOT 1970 (which is what treating seconds as ms gives).
  assert.equal(typeof m.created_utc, "string");
  assert.match(m.created_utc, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    new Date(m.created_utc).getTime(),
    listItem.creation_date * 1000,
  );
  assert.ok(
    new Date(m.created_utc).getUTCFullYear() > 2000,
    "year is real, not 1970",
  );
});

test("mapSeQuestion yields author=null for a question with a missing owner", () => {
  const m = mapSeQuestion({ ...listItem, owner: undefined });
  assert.equal(m.author, null);
});

test("mapSeQuestion yields text=null for a question with no body (before normalize)", () => {
  const m = mapSeQuestion({ ...listItem, body: undefined, body_markdown: undefined });
  assert.equal(m.text, null);
});

// --- text body-presence + HTML strip (Assumption A1, filter=withbody) ----

test("a body-present item yields non-null text after buildListEnvelope -> normalizeItem (A1)", () => {
  const bodyItem = list.items.find((i) => i.body || i.body_markdown);
  assert.ok(bodyItem, "fixture captured a body via filter=withbody");
  const env = buildListEnvelope({
    source: "stackexchange",
    query: null,
    results: [mapSeQuestion(bodyItem)],
  });
  const text = env.results[0].text;
  assert.ok(text != null && text.length > 0, "text populated (filter=withbody)");
});

test("SE HTML body is stripped through the shared contract path (tags removed, entities decoded)", () => {
  const q = {
    question_id: 42,
    title: "Test",
    owner: { display_name: "asker" },
    score: 1,
    answer_count: 0,
    creation_date: 1700000000,
    link: "https://stackoverflow.com/q/42",
    tags: ["testing"],
    body: "Line one.<p>Two &amp; <a href=\"x\">link</a>",
  };
  const env = buildListEnvelope({
    source: "stackexchange",
    query: null,
    results: [mapSeQuestion(q)],
  });
  const text = env.results[0].text;
  assert.ok(!/</.test(text), "no HTML tags remain");
  assert.ok(text.includes("Two & link"), "entities decoded, tags removed");
});

// --- mapSeDetail ---------------------------------------------------------

test("mapSeDetail maps the question onto the item and answers onto comments[]", () => {
  const { item, comments } = mapSeDetail(detailQuestion, answers.items);
  assert.equal(item.id, String(detailQuestion.question_id));
  assert.equal(item.type, "question");
  assert.equal(comments.length, answers.items.length);
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const a = answers.items[i];
    assert.deepEqual(Object.keys(c).sort(), ["author", "id", "text"]);
    assert.equal(c.id, String(a.answer_id));
    assert.equal(typeof c.id, "string");
    assert.equal(c.author, a.owner?.display_name ?? null);
  }
});

test("mapSeDetail comments are HTML-stripped through buildDetailEnvelope", () => {
  const env = buildDetailEnvelope({
    source: "stackexchange",
    ...mapSeDetail(detailQuestion, answers.items),
  });
  for (const c of env.item.comments) {
    if (c.text != null) assert.ok(!/<[a-z]/i.test(c.text), "answer HTML stripped");
  }
});

// --- contract conformance (OUT-01) --------------------------------------

test("mapSeQuestion results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "stackexchange",
    query: "python",
    results: list.items.map(mapSeQuestion),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, list.items.length);
});

test("mapSeDetail builds a detail envelope that parses against the contract schema", () => {
  const env = buildDetailEnvelope({
    source: "stackexchange",
    ...mapSeDetail(detailQuestion, answers.items),
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
});

// --- CR-01: not-found guard (SE returns 200 { items: [] } for a bad id) ---

test("requireSeQuestion throws a clear not-found error for an absent question (CR-01)", () => {
  // SE returns HTTP 200 with an empty items array -> raw.items?.[0] is undefined.
  assert.throws(
    () => requireSeQuestion(undefined, "999999999", "stackoverflow"),
    /question 999999999 not found on site stackoverflow/,
  );
  // and never lets a null masquerade as a real question
  assert.throws(() => requireSeQuestion(null, "1", "serverfault"), /not found/);
});

test("requireSeQuestion returns the question unchanged when present (CR-01 happy path)", () => {
  const q = { question_id: 42, title: "t" };
  assert.equal(requireSeQuestion(q, "42", "stackoverflow"), q);
});

test("so_get_question no longer TypeErrors on an empty items array — it not-founds cleanly (CR-01)", () => {
  // Regression for the original crash class: mapSeDetail(raw.items?.[0], ...) on
  // an empty response used to dereference undefined. The guard now intercepts it.
  const emptyResponse = { items: [] };
  assert.throws(
    () => requireSeQuestion(emptyResponse.items?.[0], "42", "stackoverflow"),
    /not found/,
  );
});

// --- WR-01: API key never enters the cache key ---------------------------

test("seUrl sends the API key in the request URL but NEVER in the cache key (WR-01)", () => {
  const prev = process.env.STACKEXCHANGE_KEY;
  process.env.STACKEXCHANGE_KEY = "SECRET_SE_KEY_XYZ";
  try {
    const { url, cacheKey } = seUrl("/questions/42", { site: "stackoverflow" });
    assert.ok(url.includes("SECRET_SE_KEY_XYZ"), "authed URL carries the key");
    assert.ok(
      !cacheKey.includes("SECRET_SE_KEY_XYZ"),
      "cache key must be secret-free (http_client contract: NEVER a secret)",
    );
    assert.ok(!cacheKey.includes("key="), "no key param in the cache key at all");
  } finally {
    if (prev === undefined) delete process.env.STACKEXCHANGE_KEY;
    else process.env.STACKEXCHANGE_KEY = prev;
  }
});

test("seUrl emits no key param at all when STACKEXCHANGE_KEY is unset (keyless degrade, CRED-04)", () => {
  const prev = process.env.STACKEXCHANGE_KEY;
  delete process.env.STACKEXCHANGE_KEY;
  try {
    const { url } = seUrl("/questions/42", { site: "stackoverflow" });
    assert.ok(!url.includes("key="), "keyless mode sends no key= param");
  } finally {
    if (prev !== undefined) process.env.STACKEXCHANGE_KEY = prev;
  }
});

// --- WR-02: so_search honors its advertised `sort` -----------------------

test("so_search passes the chosen sort through to the SE URL (no longer hardcoded relevance, WR-02)", () => {
  const { url } = seUrl("/search/advanced", {
    site: "stackoverflow",
    q: "rust",
    sort: "votes",
    order: "desc",
    pagesize: "20",
  });
  assert.ok(url.includes("sort=votes"), "the requested sort reaches the request URL");
});

test("so_search advertises only /search/advanced-valid sorts and rejects hot-question-only sorts (WR-02)", () => {
  const schema = server._registeredTools["so_search"].inputSchema;
  for (const s of ["relevance", "votes", "activity", "creation"]) {
    assert.doesNotThrow(
      () => schema.parse({ query: "x", sort: s }),
      `search sort "${s}" is accepted`,
    );
  }
  // "hot"/"week"/"month" are valid for so_hot_questions but NOT for search — the
  // surface no longer advertises a sort it would silently drop.
  assert.throws(() => schema.parse({ query: "x", sort: "hot" }), "search rejects hot");
  assert.throws(() => schema.parse({ query: "x", sort: "week" }), "search rejects week");
});

// --- registration smoke (FOUND-05) --------------------------------------

test("stackexchange server registers so_get_question, so_hot_questions, so_search, so_unanswered", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, [
    "so_get_question",
    "so_hot_questions",
    "so_search",
    "so_unanswered",
  ]);
});

test("each stackexchange tool declares an outputSchema (contract validation on return)", () => {
  for (const name of ["so_hot_questions", "so_search", "so_get_question"]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});
