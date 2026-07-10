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
  mapSeUnanswered,
  seThrottle,
  requireSeQuestion,
  fetchQuestionDetail,
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
const noAnswers = fixture("stackexchange-noanswers");
const noAnswersBackoff = fixture("stackexchange-noanswers-backoff");
const noAnswersQuotaZero = fixture("stackexchange-noanswers-quota-zero");

const listItem = list.items[0];
const detailQuestion = detail.items[0];

// Injectable sleep spy (mirrors test/http_client.test.js) — records each wait in ms
// so the backoff-honoring path is observable without real time passing.
function sleepSpy() {
  const waited = [];
  const sleep = async (ms) => {
    waited.push(ms);
  };
  sleep.waited = waited;
  return sleep;
}

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

// --- TREND-02: so_unanswered (view-rank + throttle) ----------------------

test("mapSeUnanswered overrides score with view_count, keeps the rest of the item map (D-08)", () => {
  const item = noAnswers.items[0];
  const m = mapSeUnanswered(item);
  assert.equal(m.score, item.view_count); // score := view_count (the override)
  assert.notEqual(m.score, item.score); // proves it is NOT the vote score
  assert.equal(m.num_comments, item.answer_count); // answer_count (0), untouched
  assert.equal(m.num_comments, 0);
  assert.equal(m.type, "question");
  assert.equal(m.id, String(item.question_id));
  assert.equal(typeof m.id, "string");
  assert.match(m.created_utc, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(
    new Date(m.created_utc).getUTCFullYear() > 2000,
    "created_utc is a real, non-1970 date",
  );
});

test("mapSeUnanswered yields score=null when view_count is missing", () => {
  const m = mapSeUnanswered({ ...noAnswers.items[0], view_count: undefined });
  assert.equal(m.score, null);
});

test("view_count re-rank reorders the fetched window strictly descending (Pitfall 2 — no server view sort)", () => {
  // Replicate the handler's client-side re-rank exactly.
  const ranked = [...noAnswers.items]
    .sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0))
    .map(mapSeUnanswered);
  const scores = ranked.map((r) => r.score);
  // strictly descending by view_count
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1] > scores[i], `score[${i - 1}] > score[${i}]`);
  }
  // top item is the max-view_count question, NOT the fetched-order first item
  const maxView = Math.max(...noAnswers.items.map((i) => i.view_count));
  assert.equal(ranked[0].score, maxView);
  assert.notEqual(
    ranked[0].id,
    String(noAnswers.items[0].question_id),
    "fetched order is not preserved — the re-rank changed the head",
  );
});

test("seThrottle throws the set-STACKEXCHANGE_KEY guidance when quota_remaining is 0 (D-10)", async () => {
  const sleep = sleepSpy();
  await assert.rejects(
    () => seThrottle(noAnswersQuotaZero, { sleep }),
    /STACKEXCHANGE_KEY/,
  );
  assert.deepEqual(sleep.waited, [], "no sleep on the quota-exhaustion path");
});

test("seThrottle honors a present backoff by sleeping backoff*1000 ms via the injected sleep (D-10)", async () => {
  const sleep = sleepSpy();
  const out = await seThrottle(noAnswersBackoff, { sleep });
  assert.equal(out, noAnswersBackoff, "resolves with the raw payload");
  assert.deepEqual(
    sleep.waited,
    [3 * 1000],
    "a single 3000ms wait honors the fixture's backoff:3",
  );
});

test("seThrottle does NOT sleep for a normal response with no backoff", async () => {
  const sleep = sleepSpy();
  await seThrottle(noAnswers, { sleep });
  assert.deepEqual(sleep.waited, [], "no backoff field -> no wait");
});

// WR-01: a pathological/hostile backoff must be clamped so it cannot hang the tool.
test("seThrottle clamps a pathological backoff at the 30s ceiling (WR-01)", async () => {
  const sleep = sleepSpy();
  // backoff:100000s would be a ~27-hour uncancellable hang without the cap.
  await seThrottle({ backoff: 100_000 }, { sleep });
  assert.deepEqual(
    sleep.waited,
    [30_000],
    "the honored wait is capped at MAX_BACKOFF_MS (30_000ms), not backoff*1000",
  );
});

test("seThrottle leaves a small in-range backoff unclamped (WR-01 does not shorten legit waits)", async () => {
  const sleep = sleepSpy();
  await seThrottle({ backoff: 5 }, { sleep });
  assert.deepEqual(sleep.waited, [5000], "a normal 5s backoff is honored exactly");
});

// WR-02: the GENUINE sequential double-fetch (so_get_question / fetchQuestionDetail)
// must honor a first-response backoff BETWEEN the two fetches — the self-inflicted
// throttle/ban scenario seThrottle exists to prevent. `get`/`sleep` are injected so
// the wiring is provable offline.
test("fetchQuestionDetail honors a first-response backoff BETWEEN the question and answers fetches (WR-02)", async () => {
  const sleep = sleepSpy();
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      // question response carries a backoff SE wants honored before the next call
      return { items: [detailQuestion], backoff: 2 };
    }
    return { items: answers.items }; // answers response
  };
  const { item, comments } = await fetchQuestionDetail(
    { id: detailQuestion.question_id, site: "stackoverflow" },
    { get, sleep },
  );
  assert.equal(calls.length, 2, "both the question and answers fetches ran");
  assert.match(calls[0], /\/questions\//, "first fetch is the question");
  assert.match(calls[1], /\/answers/, "second fetch is the answers");
  assert.deepEqual(
    sleep.waited,
    [2000],
    "the backoff from the FIRST response is slept before the SECOND (answers) fetch",
  );
  assert.equal(item.id, String(detailQuestion.question_id));
  assert.equal(comments.length, answers.items.length);
});

test("fetchQuestionDetail does not sleep when the first response carries no backoff (WR-02)", async () => {
  const sleep = sleepSpy();
  const get = async (url) =>
    /\/answers/.test(url) ? { items: answers.items } : { items: [detailQuestion] };
  await fetchQuestionDetail(
    { id: detailQuestion.question_id, site: "stackoverflow" },
    { get, sleep },
  );
  assert.deepEqual(sleep.waited, [], "no backoff on the question response -> no wait");
});

test("fetchQuestionDetail surfaces the not-found guard when the question is absent (WR-02 keeps CR-01)", async () => {
  const sleep = sleepSpy();
  const get = async () => ({ items: [] }); // SE 200 empty for a bad id
  await assert.rejects(
    () => fetchQuestionDetail({ id: "999999999", site: "stackoverflow" }, { get, sleep }),
    /not found/,
  );
  assert.deepEqual(sleep.waited, [], "no throttle wait once the question is missing");
});

test("a list envelope built from mapSeUnanswered parses against the frozen contract (OQ-1 — no extra fields)", () => {
  const env = buildListEnvelope({
    source: "stackexchange",
    query: "asyncio",
    results: noAnswers.items.map(mapSeUnanswered),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, noAnswers.items.length);
  // the throttle signals never leak into the envelope
  assert.ok(!("backoff" in env), "no backoff key on the envelope");
  assert.ok(!("quota_remaining" in env), "no quota_remaining key on the envelope");
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
  for (const name of [
    "so_hot_questions",
    "so_search",
    "so_get_question",
    "so_unanswered",
  ]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});

test("so_unanswered is registered with an outputSchema and a REQUIRED tag input (D-09)", () => {
  const tool = server._registeredTools["so_unanswered"];
  assert.ok(tool, "so_unanswered is registered");
  assert.ok(tool.outputSchema, "so_unanswered declares an outputSchema");
  const schema = tool.inputSchema;
  // tag is required — omitting it must fail schema parse
  assert.throws(() => schema.parse({ site: "stackoverflow" }), "tag is required");
  assert.doesNotThrow(() => schema.parse({ tag: "python" }), "tag alone is valid");
});
