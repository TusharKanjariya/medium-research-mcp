// test/lemmy.test.js — Lemmy source server (SRC-03).
//
// Three concerns, all offline (fixtures + stubs; no live network):
//   1. Field-mapping units — mapLemmyPost / mapLemmyDetail convert captured
//      programming.dev API v3 payloads into exact contract items/details (Lemmy
//      calls the title `name`; permalink is the federation ap_id; posts have no
//      tags).
//   2. Auth-wire unit — the conditional Bearer header (D-06): a stubbed jwt
//      yields `Authorization: Bearer <token>`; a null jwt yields `{}` (anonymous),
//      driven through the exported header-builder with no network.
//   3. Registration + manifest smoke — the three tools register with an
//      outputSchema, and the manifest documents the LEMMY_INSTANCE-for-auth note.
//
// Fixtures are REAL programming.dev payloads captured once
// (test/fixtures/lemmy-*.json): /api/v3/post/list?type_=All&sort=Hot -> lemmy-list,
// /api/v3/post?id=.. + /api/v3/comment/list?post_id=.. -> lemmy-detail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapLemmyPost,
  mapLemmyDetail,
  bearerHeaders,
  lemmyAuthHeaders,
  normalizeInstance,
  authInstanceMatches,
  resolveLemmyHeaders,
  server,
} from "../servers/lemmy/server.js";
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

const list = fixture("lemmy-list"); // { posts: [PostView] } from /post/list
const detail = fixture("lemmy-detail"); // { post_view, comments: [CommentView] }
const pv = list.posts[0];

// --- mapLemmyPost --------------------------------------------------------

test("mapLemmyPost maps a PostView onto the exact contract fields", () => {
  const m = mapLemmyPost(pv);
  assert.equal(m.id, String(pv.post.id));
  assert.equal(m.type, "post");
  assert.equal(m.title, pv.post.name); // Lemmy calls the title `name`
  assert.equal(m.author, pv.creator.name);
  assert.equal(m.score, pv.counts.score); // counts.score -> score
  assert.equal(m.num_comments, pv.counts.comments); // counts.comments -> num_comments
  assert.equal(m.created_utc, pv.post.published); // ISO passthrough (no conversion)
  assert.equal(m.permalink, pv.post.ap_id); // ap_id is the canonical permalink
  assert.deepEqual(m.tags, []); // Lemmy posts have no tags
});

test("mapLemmyPost id is a string and null score/comments when counts omit them", () => {
  const m = mapLemmyPost({ post: { id: 42, name: "t" }, creator: { name: "u" } });
  assert.equal(m.id, "42");
  assert.equal(typeof m.id, "string");
  assert.equal(m.score, null);
  assert.equal(m.num_comments, null);
  assert.equal(m.author, "u");
});

test("mapLemmyPost body text is HTML-stripped via the shared contract path", () => {
  const raw = {
    post: { id: 1, name: "markup", body: "Line one.<p>Two &amp; <a href=\"x\">link</a>" },
    creator: { name: "u" },
    counts: { score: 1, comments: 0 },
  };
  const env = buildListEnvelope({
    source: "lemmy",
    query: null,
    results: [mapLemmyPost(raw)],
  });
  const text = env.results[0].text;
  assert.ok(!/</.test(text), "no HTML tags remain");
  assert.ok(text.includes("Two & link"), "entities decoded, tags removed");
});

// --- mapLemmyDetail ------------------------------------------------------

test("mapLemmyDetail maps the post_view and flattens comments to [{id,author,text}]", () => {
  const { item, comments } = mapLemmyDetail(detail.post_view, detail.comments);
  assert.equal(item.id, String(detail.post_view.post.id));
  assert.equal(item.type, "post");
  assert.equal(comments.length, detail.comments.length);
  for (const c of comments) {
    assert.deepEqual(Object.keys(c).sort(), ["author", "id", "text"]);
    assert.equal(typeof c.id, "string");
  }
  const first = comments[0];
  assert.equal(first.id, String(detail.comments[0].comment.id));
  assert.equal(first.author, detail.comments[0].creator.name);
  assert.equal(first.text, detail.comments[0].comment.content);
});

test("mapLemmyDetail comments are HTML-stripped through buildDetailEnvelope", () => {
  const synthetic = {
    post_view: { post: { id: 9, name: "t" }, creator: { name: "u" }, counts: {} },
    comments: [
      {
        comment: { id: 91, content: "Aw &amp; <a href=\"x\">man</a>" },
        creator: { name: "alice" },
      },
    ],
  };
  const env = buildDetailEnvelope({
    source: "lemmy",
    ...mapLemmyDetail(synthetic.post_view, synthetic.comments),
  });
  const c = env.item.comments[0];
  assert.ok(!/<a /.test(c.text), "anchor tag stripped");
  assert.ok(c.text.includes("Aw & man"), "entities decoded, tags removed");
});

// --- conditional Bearer auth wire (D-06) --------------------------------

test("bearerHeaders builds the Authorization fragment only when a jwt is present", () => {
  assert.deepEqual(bearerHeaders("tok123"), { Authorization: "Bearer tok123" });
  assert.deepEqual(bearerHeaders(null), {});
  assert.deepEqual(bearerHeaders(undefined), {});
});

test("lemmyAuthHeaders sends Bearer when lemmyJwt resolves a token (creds present)", async () => {
  const headers = await lemmyAuthHeaders({ jwtImpl: async () => "jwt-abc" });
  assert.deepEqual(headers, { Authorization: "Bearer jwt-abc" });
});

test("lemmyAuthHeaders is anonymous (empty headers, no throw) when lemmyJwt is null", async () => {
  const headers = await lemmyAuthHeaders({ jwtImpl: async () => null });
  assert.deepEqual(headers, {});
});

// --- instance normalization (D-13) --------------------------------------

test("normalizeInstance defaults a scheme-less instance to https and strips a trailing slash", () => {
  assert.equal(normalizeInstance("lemmy.world"), "https://lemmy.world");
  assert.equal(normalizeInstance("https://lemmy.world/"), "https://lemmy.world");
  assert.equal(normalizeInstance("https://lemmy.world///"), "https://lemmy.world");
  // an explicit http scheme is preserved (no forced upgrade — SSRF guard vets it)
  assert.equal(normalizeInstance("http://lemmy.world"), "http://lemmy.world");
  // surrounding whitespace is trimmed
  assert.equal(normalizeInstance("  lemmy.world  "), "https://lemmy.world");
});

test("normalizeInstance throws a readable, host-literal-free error on empty input", () => {
  for (const bad of ["", "   ", null, undefined]) {
    assert.throws(() => normalizeInstance(bad), /instance is required/);
  }
  // SEC-02: the error must NOT embed a specific Lemmy forum host literal
  try {
    normalizeInstance("");
  } catch (err) {
    assert.ok(
      !/programming\.dev|lemmy\.world/.test(err.message),
      "empty-input error names no specific forum host",
    );
  }
});

// --- host-gated Bearer decision (D-15, Open Q3) -------------------------
//
// The env JWT is minted for lemmyCreds().instance (= LEMMY_INSTANCE). It must
// NEVER be replayed to a caller-chosen instance. authInstanceMatches() is the
// pure host-compare seam; resolveLemmyHeaders() wraps lemmyAuthHeaders() behind
// it. Both are driven with an injected credsImpl/jwtImpl — no network, no env.

const envCreds = () => ({ instance: "https://programming.dev", user: "u", pass: "p" });
const noCreds = () => undefined;

test("authInstanceMatches is true only when the effective base host equals the env auth host", () => {
  // same host (scheme/trailing-slash differences are normalized away)
  assert.equal(authInstanceMatches("https://programming.dev", { credsImpl: envCreds }), true);
  assert.equal(authInstanceMatches("programming.dev", { credsImpl: envCreds }), true);
  assert.equal(authInstanceMatches("https://programming.dev/", { credsImpl: envCreds }), true);
  // different host -> no match (token must not cross)
  assert.equal(authInstanceMatches("https://lemmy.world", { credsImpl: envCreds }), false);
  // no auth creds configured -> never matches (stays anonymous)
  assert.equal(authInstanceMatches("https://programming.dev", { credsImpl: noCreds }), false);
});

test("resolveLemmyHeaders sends the Bearer when the instance host matches the env auth host", async () => {
  const headers = await resolveLemmyHeaders("https://programming.dev", {
    credsImpl: envCreds,
    jwtImpl: async () => "jwt-abc",
  });
  assert.deepEqual(headers, { Authorization: "Bearer jwt-abc" });
});

test("resolveLemmyHeaders is anonymous ({}) when a tool-param instance host differs from the env host", async () => {
  let jwtCalled = false;
  const headers = await resolveLemmyHeaders("https://lemmy.world", {
    credsImpl: envCreds,
    jwtImpl: async () => {
      jwtCalled = true;
      return "jwt-abc";
    },
  });
  assert.deepEqual(headers, {}, "no Bearer replayed to a caller-chosen host");
  assert.equal(jwtCalled, false, "the env token is never even resolved for a mismatched host");
});

test("resolveLemmyHeaders is anonymous when no LEMMY auth creds are configured", async () => {
  const headers = await resolveLemmyHeaders("https://programming.dev", {
    credsImpl: noCreds,
    jwtImpl: async () => "jwt-abc",
  });
  assert.deepEqual(headers, {});
});

// --- contract conformance (OUT-01) --------------------------------------

test("mapLemmyPost results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "lemmy",
    query: "hot",
    results: list.posts.map(mapLemmyPost),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, list.posts.length);
});

test("mapLemmyDetail builds a detail envelope that parses against the contract schema", () => {
  const env = buildDetailEnvelope({
    source: "lemmy",
    ...mapLemmyDetail(detail.post_view, detail.comments),
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
});

// --- registration smoke --------------------------------------------------

test("lemmy server registers exactly the three expected tools", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, ["lemmy_hot", "lemmy_post", "lemmy_search"]);
});

test("each lemmy tool declares an outputSchema (contract validation on return)", () => {
  for (const name of ["lemmy_hot", "lemmy_post", "lemmy_search"]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});

test("each lemmy tool description documents the LEMMY_INSTANCE-for-auth note", () => {
  for (const name of ["lemmy_hot", "lemmy_post", "lemmy_search"]) {
    const desc = server._registeredTools[name].description;
    assert.match(
      desc,
      /LEMMY_INSTANCE/,
      `${name} description mentions LEMMY_INSTANCE`,
    );
  }
});

// --- SEC-01 guarded path (untrustedHost) --------------------------------
//
// The three lemmy getJson calls now pass untrustedHost:true so the instance-
// parameterized host rides the shared assertSafeUrl SSRF guard. The registered
// tool wrapper builds its getJson opts internally, so there is no seam to inject
// fetchImpl/lookup through the handler (Pitfall 5, 05-RESEARCH); we therefore
// drive the guard behavior at the getJson layer with a lemmy instance URL,
// exactly as the handler does. The map/registration tests above are unaffected —
// they never drive getJson.

// A JSON response shim exposing headers.get() for the content-type gate.
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

test("SEC-01: a lemmy instance getJson (untrustedHost) builds a valid list envelope on the guarded path", async () => {
  const fetchImpl = async () => jsonRes(200, list); // lemmy list-shaped payload
  const raw = await getJson("https://programming.dev/api/v3/post/list?type_=All", {
    fetchImpl,
    sleep: async () => {},
    lookup: publicLookup,
    untrustedHost: true,
    cacheKey: "lemmy:guarded-public",
  });
  const env = buildListEnvelope({
    source: "lemmy",
    query: null,
    results: (raw?.posts ?? []).map(mapLemmyPost),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, list.posts.length);
});

// A user-supplied (tool-param) instance now selects the outbound host, so it
// rides the SAME guarded path. normalizeInstance shapes the string; getJson's
// untrustedHost guard vets the resolved IP. A public instance succeeds; a
// private-range or cloud-metadata instance is rejected — the SSRF acceptance
// property for the newly parameterized instance param (D-15, Pitfall 5).

test("SEC-01: a public tool-param instance builds a valid envelope on the guarded path", async () => {
  const fetchImpl = async () => jsonRes(200, list);
  const base = normalizeInstance("lemmy.world"); // scheme-defaulted user instance
  const raw = await getJson(`${base}/api/v3/post/list?type_=All`, {
    fetchImpl,
    sleep: async () => {},
    lookup: publicLookup,
    untrustedHost: true,
    cacheKey: "lemmy:guarded-param-public",
  });
  const env = buildListEnvelope({
    source: "lemmy",
    query: null,
    results: (raw?.posts ?? []).map(mapLemmyPost),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, list.posts.length);
});

test("SEC-01: a lemmy instance resolving to a private IP is blocked on the guarded path", async () => {
  const fetchImpl = async () => jsonRes(200, list); // must never be read
  await assert.rejects(
    () =>
      getJson("https://internal.lemmy.test/api/v3/post/list?type_=All", {
        fetchImpl,
        sleep: async () => {},
        lookup: privateLookup,
        untrustedHost: true,
        cacheKey: "lemmy:guarded-private",
      }),
    /blocked address/,
  );
});

test("SEC-01: a tool-param instance resolving to loopback (127.0.0.1) is rejected", async () => {
  const fetchImpl = async () => jsonRes(200, list); // must never be read
  const base = normalizeInstance("localhost.lemmy.test");
  await assert.rejects(
    () =>
      getJson(`${base}/api/v3/post/list?type_=All`, {
        fetchImpl,
        sleep: async () => {},
        lookup: loopbackLookup,
        untrustedHost: true,
        cacheKey: "lemmy:guarded-loopback",
      }),
    /blocked address/,
  );
});

test("SEC-01: a tool-param instance resolving to cloud metadata (169.254.169.254) is rejected", async () => {
  const fetchImpl = async () => jsonRes(200, list); // must never be read
  const base = normalizeInstance("metadata.lemmy.test");
  await assert.rejects(
    () =>
      getJson(`${base}/api/v3/post/list?type_=All`, {
        fetchImpl,
        sleep: async () => {},
        lookup: metadataLookup,
        untrustedHost: true,
        cacheKey: "lemmy:guarded-metadata",
      }),
    /blocked address/,
  );
});

// --- manifest documents the auth precondition ---------------------------

test("manifest user_config fields carry the LEMMY_INSTANCE-required-for-auth note", () => {
  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../servers/lemmy/manifest.json", import.meta.url)),
      "utf8",
    ),
  );
  const uc = manifest.user_config ?? {};
  // Every credential-ish field description must reference LEMMY_INSTANCE so the
  // operator learns authenticated reads need it set explicitly.
  for (const key of ["lemmy_instance", "lemmy_username", "lemmy_password"]) {
    assert.ok(uc[key], `manifest declares ${key}`);
    assert.match(
      uc[key].description,
      /LEMMY_INSTANCE/i,
      `${key} description documents the LEMMY_INSTANCE auth note`,
    );
  }
  // The password field must be keychain-sensitive.
  assert.equal(uc.lemmy_password.sensitive, true);
});
