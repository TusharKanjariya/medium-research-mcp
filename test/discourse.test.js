// test/discourse.test.js — Discourse source server (SRC-10).
//
// All offline (fixtures + stubs; no live network). Five concerns:
//   1. Field-mapping units — mapDiscourseTopic / mapDiscourseDetail convert
//      captured meta.discourse.org-shaped payloads into exact contract items,
//      including author resolution from the users[] map AND the
//      last_poster_username fallback, and Discourse's internal post.score is
//      never surfaced.
//   2. HTML-strip-through-contract — excerpt/cooked are stripped by the shared
//      buildListEnvelope / buildDetailEnvelope path.
//   3. Contract conformance — envelopes parse against the frozen schema; count
//      matches.
//   4. Registration smoke — exactly the three tools register, each with an
//      outputSchema.
//   5. D-11 + SSRF (SEC-01) on the guarded path — an HTTP 403 and an HTML-200
//      (content-type text/html) both surface a terminal error (no JSON.parse
//      crash), mapDiscourseError re-maps them to the login message naming the
//      instance, and a private/loopback/metadata instance is rejected.
//
// Fixtures are synthesized from 07-RESEARCH §"Discourse Field Maps":
// discourse-latest.json = { users[], topic_list:{ topics[] } }; discourse-topic.json
// = a /t/<id>.json shape; discourse-login-html.json = the HTML-200 gate fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapDiscourseTopic,
  mapDiscourseDetail,
  mapDiscourseError,
  normalizeInstance,
  server,
} from "../servers/discourse/server.js";
import {
  buildListEnvelope,
  buildDetailEnvelope,
  ListEnvelopeSchema,
  DetailEnvelopeSchema,
} from "../shared/contract.js";
import { getJson } from "../shared/http_client.js";

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)),
      "utf8",
    ),
  );

const latest = fixture("discourse-latest"); // { users, topic_list:{ topics } }
const topicDetail = fixture("discourse-topic"); // /t/<id>.json shape
const loginHtml = fixture("discourse-login-html"); // HTML-200 gate fixture

const BASE = "https://forum.example.test";
const usersById = new Map((latest.users ?? []).map((u) => [u.id, u.username]));
const topic0 = latest.topic_list.topics[0];
const topic1 = latest.topic_list.topics[1];

// --- mapDiscourseTopic ---------------------------------------------------

test("mapDiscourseTopic maps a topic onto the exact contract fields", () => {
  const m = mapDiscourseTopic(topic0, usersById, BASE);
  assert.equal(m.id, String(topic0.id));
  assert.equal(typeof m.id, "string");
  assert.equal(m.type, "topic"); // new TYPE value
  assert.equal(m.title, topic0.title);
  assert.equal(m.score, topic0.like_count); // like_count -> score
  assert.equal(m.num_comments, topic0.reply_count); // reply_count -> num_comments
  assert.equal(m.created_utc, topic0.created_at); // ISO passthrough
  assert.equal(m.permalink, `${BASE}/t/${topic0.slug}/${topic0.id}`);
  assert.equal(m.url, null); // list carries no canonical URL
  assert.deepEqual(m.tags, topic0.tags);
});

test("mapDiscourseTopic resolves the OP author from the users[] map", () => {
  // topic0 posters[0] is user_id 100 ('Original Poster') -> users[] -> 'alice'
  const m = mapDiscourseTopic(topic0, usersById, BASE);
  assert.equal(m.author, "alice");
});

test("mapDiscourseTopic falls back to last_poster_username when the OP is not in users[]", () => {
  // topic1 posters[0] is user_id 999 (absent from users[]) -> fallback 'charlie'
  const m = mapDiscourseTopic(topic1, usersById, BASE);
  assert.equal(m.author, topic1.last_poster_username);
  assert.equal(m.author, "charlie");
});

test("mapDiscourseTopic author is null when neither users[] nor last_poster_username resolve", () => {
  const bare = { id: 7, title: "t", slug: "t", posters: [{ user_id: 42 }] };
  const m = mapDiscourseTopic(bare, usersById, BASE);
  assert.equal(m.author, null);
});

test("mapDiscourseTopic yields null score/num_comments and [] tags when omitted", () => {
  const bare = { id: 8, title: "t", slug: "t" };
  const m = mapDiscourseTopic(bare, usersById, BASE);
  assert.equal(m.score, null);
  assert.equal(m.num_comments, null);
  assert.deepEqual(m.tags, []);
});

test("mapDiscourseTopic excerpt text is HTML-stripped via the shared contract path", () => {
  const env = buildListEnvelope({
    source: "discourse",
    query: null,
    results: [mapDiscourseTopic(topic0, usersById, BASE)],
  });
  const text = env.results[0].text;
  assert.ok(!/</.test(text), "no HTML tags remain");
  assert.ok(text.includes("need help"), "anchor text preserved, tag removed");
});

// --- mapDiscourseDetail --------------------------------------------------

test("mapDiscourseDetail maps the topic item from top-level fields, author from details.created_by", () => {
  const { item } = mapDiscourseDetail(topicDetail, BASE);
  assert.equal(item.id, String(topicDetail.id));
  assert.equal(item.type, "topic");
  assert.equal(item.author, topicDetail.details.created_by.username); // 'alice'
  assert.equal(item.score, topicDetail.like_count);
  assert.equal(item.num_comments, topicDetail.reply_count);
  assert.equal(item.permalink, `${BASE}/t/${topicDetail.slug}/${topicDetail.id}`);
});

test("mapDiscourseDetail comments exclude the OP (index 0) and flatten to {id,author,text}", () => {
  const { comments } = mapDiscourseDetail(topicDetail, BASE);
  const posts = topicDetail.post_stream.posts;
  assert.equal(comments.length, posts.length - 1); // OP excluded
  for (const c of comments) {
    assert.deepEqual(Object.keys(c).sort(), ["author", "id", "text"]);
    assert.equal(typeof c.id, "string");
  }
  assert.equal(comments[0].id, String(posts[1].id));
  assert.equal(comments[0].author, posts[1].username);
});

test("mapDiscourseDetail never surfaces Discourse's internal post.score", () => {
  const { item, comments } = mapDiscourseDetail(topicDetail, BASE);
  // OP post.score is 45547.4; the item score must be the topic like_count instead
  assert.equal(item.score, topicDetail.like_count);
  assert.notEqual(item.score, topicDetail.post_stream.posts[0].score);
  // comments carry no score field at all
  for (const c of comments) assert.equal(c.score, undefined);
});

test("mapDiscourseDetail OP/comment HTML is stripped through buildDetailEnvelope", () => {
  const env = buildDetailEnvelope({
    source: "discourse",
    ...mapDiscourseDetail(topicDetail, BASE),
  });
  assert.ok(!/<a /.test(env.item.text), "OP anchor tag stripped");
  assert.ok(env.item.text.includes("details"), "OP anchor text preserved");
  for (const c of env.item.comments) {
    assert.ok(!/</.test(c.text ?? ""), "comment HTML stripped");
  }
});

// --- contract conformance (OUT-01) ---------------------------------------

test("mapDiscourseTopic results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "discourse",
    query: null,
    results: latest.topic_list.topics.map((t) => mapDiscourseTopic(t, usersById, BASE)),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, latest.topic_list.topics.length);
});

test("mapDiscourseDetail builds a detail envelope that parses against the contract schema", () => {
  const env = buildDetailEnvelope({
    source: "discourse",
    ...mapDiscourseDetail(topicDetail, BASE),
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
});

// --- instance normalization (D-13) ---------------------------------------

test("normalizeInstance defaults a scheme-less instance to https and strips a trailing slash", () => {
  assert.equal(normalizeInstance("forum.example.test"), "https://forum.example.test");
  assert.equal(normalizeInstance("https://forum.example.test/"), "https://forum.example.test");
  assert.equal(normalizeInstance("https://forum.example.test///"), "https://forum.example.test");
  assert.equal(normalizeInstance("http://forum.example.test"), "http://forum.example.test");
  assert.equal(normalizeInstance("  forum.example.test  "), "https://forum.example.test");
});

test("normalizeInstance throws a readable, host-literal-free error on empty input (SEC-02)", () => {
  for (const bad of ["", "   ", null, undefined]) {
    assert.throws(() => normalizeInstance(bad), /instance is required/);
  }
  try {
    normalizeInstance("");
  } catch (err) {
    assert.ok(
      !/discourse\.org|meta\.discourse/.test(err.message),
      "empty-input error names no specific forum host",
    );
  }
});

// --- SEC-02: no forum-host literal anywhere in the server source ----------

test("SEC-02: servers/discourse/server.js contains no forum-host literal (base is the tool param)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../servers/discourse/server.js", import.meta.url)),
    "utf8",
  );
  const hosts = [...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
  assert.deepEqual(hosts, [], `no http(s) host literal may appear: ${JSON.stringify(hosts)}`);
});

// --- registration smoke --------------------------------------------------

test("discourse server registers exactly the three expected tools", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, ["discourse_latest", "discourse_top", "discourse_topic"]);
});

test("each discourse tool declares an outputSchema (contract validation on return)", () => {
  for (const name of ["discourse_latest", "discourse_top", "discourse_topic"]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});

// --- WR-01: category "slug/id" token validation at the schema boundary ----
//
// `category` is interpolated straight into the request path, so its shape is
// validated by zod BEFORE the handler builds the URL. A malformed token
// (carrying `?`, `#`, `../`, or a stray `/`) is rejected up front; the
// legitimate "slug/id" form still passes (the single `/` must survive).

test("WR-01: a malformed category token is rejected before the URL is built", () => {
  for (const name of ["discourse_latest", "discourse_top"]) {
    const shape = server._registeredTools[name].inputSchema.shape;
    assert.ok(shape.category, `${name} declares category`);
    for (const bad of [
      "foo/bar?x=1", // query-string injection folds the /l/...json suffix away
      "../../admin", // path traversal
      "support", // slug-only (no numeric id)
      "support/", // trailing slash, no id
      "support/6/extra", // stray extra segment
      "support/6#frag", // fragment truncation
    ]) {
      const res = shape.category.safeParse(bad);
      assert.equal(res.success, false, `${name} rejects category=${JSON.stringify(bad)}`);
      const msg = res.error.issues.map((i) => i.message).join(" ");
      assert.match(msg, /slug\/id/, "readable slug/id rejection message");
    }
  }
});

test("WR-01: a valid slug/id category is accepted (and an omitted one — optional)", () => {
  for (const name of ["discourse_latest", "discourse_top"]) {
    const shape = server._registeredTools[name].inputSchema.shape;
    assert.equal(shape.category.safeParse("support/6").success, true);
    assert.equal(shape.category.safeParse("dev-help/123").success, true);
    assert.equal(shape.category.safeParse(undefined).success, true, "optional");
  }
});

test("discourse_top declares the six-value period enum (D-04)", () => {
  const shape = server._registeredTools["discourse_top"].inputSchema.shape;
  assert.ok(shape.period, "period is declared");
  // z.enum options are exposed on the schema; assert the exact D-04 set
  const opts = shape.period.options ?? shape.period._def?.values ?? [];
  assert.deepEqual(
    [...opts].sort(),
    ["all", "daily", "monthly", "quarterly", "weekly", "yearly"],
  );
});

// --- D-11 mapping (mapDiscourseError) ------------------------------------

test("mapDiscourseError maps an HTTP 403 to the D-11 login message naming the instance", () => {
  const err = new Error("getJson: HTTP 403 from https://forum.example.test/latest.json");
  const mapped = mapDiscourseError(err, BASE);
  assert.match(mapped.message, /requires login or is not publicly accessible/);
  assert.match(mapped.message, /forum\.example\.test/, "names the instance");
});

test("mapDiscourseError maps the content-type-gate login message to the D-11 message", () => {
  const err = new Error(
    "getJson: non-JSON response (login required?) from https://forum.example.test/latest.json",
  );
  const mapped = mapDiscourseError(err, BASE);
  assert.match(mapped.message, /requires login or is not publicly accessible/);
});

test("mapDiscourseError passes an unrelated error through unchanged", () => {
  const err = new Error("getJson: HTTP 500 from https://forum.example.test/latest.json");
  assert.equal(mapDiscourseError(err, BASE), err);
});

// --- guarded path (untrustedHost): D-11 terminal errors + SSRF (SEC-01) ---
//
// The registered handler builds its own getJson opts, so there is no seam to
// inject fetchImpl/lookup through the tool. We therefore drive getJson directly
// with a Discourse instance URL exactly as the handler does, proving the guarded
// path surfaces a TERMINAL error (never a JSON.parse crash) that mapDiscourseError
// then re-maps, and that a non-public instance IP is blocked.

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

test("SEC-01: a public Discourse instance getJson (untrustedHost) builds a valid list envelope", async () => {
  const fetchImpl = async () => jsonRes(200, latest);
  const base = normalizeInstance("forum.example.test");
  const raw = await getJson(`${base}/latest.json`, {
    fetchImpl,
    sleep: async () => {},
    lookup: publicLookup,
    untrustedHost: true,
    cacheKey: "discourse:guarded-public",
  });
  const usersMap = new Map((raw.users ?? []).map((u) => [u.id, u.username]));
  const env = buildListEnvelope({
    source: "discourse",
    query: null,
    results: (raw.topic_list?.topics ?? []).map((t) => mapDiscourseTopic(t, usersMap, base)),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, latest.topic_list.topics.length);
});

test("D-11: a guarded-path HTTP 403 surfaces a terminal error that maps to the login message", async () => {
  const fetchImpl = async () => jsonRes(403, { errors: ["not permitted"] });
  const base = normalizeInstance("locked.example.test");
  await assert.rejects(
    async () => {
      try {
        await getJson(`${base}/latest.json`, {
          fetchImpl,
          sleep: async () => {},
          lookup: publicLookup,
          untrustedHost: true,
          cacheKey: "discourse:guarded-403",
        });
      } catch (err) {
        // the handler's catch: re-map to the D-11 message (no JSON.parse crash)
        throw mapDiscourseError(err, base);
      }
    },
    /requires login or is not publicly accessible/,
  );
});

test("D-11: a guarded-path HTML-200 login page surfaces a terminal error (content-type gate), not a JSON crash", async () => {
  // The gate fires on the text/html content-type BEFORE json() is called, so the
  // HTML body (loginHtml) is never parsed — no JSON.parse crash.
  const fetchImpl = async () => jsonRes(200, loginHtml, "text/html");
  const base = normalizeInstance("html.example.test");
  await assert.rejects(
    async () => {
      try {
        await getJson(`${base}/latest.json`, {
          fetchImpl,
          sleep: async () => {},
          lookup: publicLookup,
          untrustedHost: true,
          cacheKey: "discourse:guarded-html200",
        });
      } catch (err) {
        assert.match(err.message, /non-JSON response \(login required/);
        throw mapDiscourseError(err, base);
      }
    },
    /requires login or is not publicly accessible/,
  );
});

test("SEC-01: a Discourse instance resolving to a private IP is blocked on the guarded path", async () => {
  const fetchImpl = async () => jsonRes(200, latest); // must never be read
  await assert.rejects(
    () =>
      getJson("https://internal.discourse.test/latest.json", {
        fetchImpl,
        sleep: async () => {},
        lookup: privateLookup,
        untrustedHost: true,
        cacheKey: "discourse:guarded-private",
      }),
    /blocked address/,
  );
});

test("SEC-01: a Discourse instance resolving to loopback (127.0.0.1) is rejected", async () => {
  const fetchImpl = async () => jsonRes(200, latest);
  const base = normalizeInstance("localhost.discourse.test");
  await assert.rejects(
    () =>
      getJson(`${base}/latest.json`, {
        fetchImpl,
        sleep: async () => {},
        lookup: loopbackLookup,
        untrustedHost: true,
        cacheKey: "discourse:guarded-loopback",
      }),
    /blocked address/,
  );
});

test("SEC-01: a Discourse instance resolving to cloud metadata (169.254.169.254) is rejected", async () => {
  const fetchImpl = async () => jsonRes(200, latest);
  const base = normalizeInstance("metadata.discourse.test");
  await assert.rejects(
    () =>
      getJson(`${base}/latest.json`, {
        fetchImpl,
        sleep: async () => {},
        lookup: metadataLookup,
        untrustedHost: true,
        cacheKey: "discourse:guarded-metadata",
      }),
    /blocked address/,
  );
});
