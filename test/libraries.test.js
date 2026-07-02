// test/libraries.test.js — Libraries.io source server (SRC-07, OUT-01).
//
// Concerns, all offline (fixtures pin the field map; no live network):
//   1. Field-mapping units — mapLibProject converts captured Libraries.io /search +
//      /{platform}/{name} payloads into exact contract items (dependents_count->
//      score, num_comments null, type:"package", id = platform/name, keywords->tags).
//   2. Envelope conformance — list/detail envelopes parse against the contract schemas.
//   3. Secret-free cache key (WR-01, Pitfall 3, T-03-04) — the api_key rides in the
//      request URL but NEVER in the cache key.
//   4. Required-credential proof (criterion 4, D-10) — libUrl throws a clear
//      "set LIBRARIESIO_KEY" error when the key is unset (BEFORE any request).
//   5. Registration smoke — the two tools register, each with an outputSchema.
//   6. Security invariants — no direct fetch(, no process.env in the server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapLibProject,
  requireLibProject,
  libUrl,
  server,
} from "../servers/librariesio/server.js";
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

const search = fixture("libraries-search"); // array of projects
const project = fixture("libraries-project"); // single project

const searchItem = search[0]; // react (full metadata, keywords present)
const bareItem = search[1]; // lodash (empty keywords)

// --- mapLibProject -------------------------------------------------------

test("mapLibProject maps a raw Libraries.io project onto the exact contract fields", () => {
  const m = mapLibProject(searchItem);
  assert.equal(m.id, `${searchItem.platform}/${searchItem.name}`); // composite id
  assert.equal(typeof m.id, "string");
  assert.equal(m.type, "package"); // NEW enum value (03-01 Task 1 prerequisite)
  assert.equal(m.title, searchItem.name);
  assert.equal(m.author, null); // packages have no single author
  assert.equal(m.num_comments, null); // n/a for packages
  assert.equal(m.created_utc, searchItem.latest_release_published_at); // already ISO-8601
  assert.equal(m.permalink, searchItem.package_manager_url); // canonical registry page
});

test("mapLibProject reads score from dependents_count (D-04 most-depended signal)", () => {
  const m = mapLibProject(searchItem);
  assert.equal(m.score, searchItem.dependents_count);
  assert.equal(m.score, 123456);
});

test("mapLibProject maps keywords to tags (and an empty keywords list to [])", () => {
  assert.deepEqual(mapLibProject(searchItem).tags, ["react", "ui", "frontend"]);
  assert.deepEqual(mapLibProject(bareItem).tags, []);
});

test("mapLibProject url prefers package_manager_url, then repository_url, then homepage", () => {
  assert.equal(mapLibProject(searchItem).url, searchItem.package_manager_url);
  const noRegistry = { ...searchItem, package_manager_url: undefined };
  assert.equal(mapLibProject(noRegistry).url, searchItem.repository_url);
  const repoOnly = {
    ...searchItem,
    package_manager_url: undefined,
    repository_url: undefined,
  };
  assert.equal(mapLibProject(repoOnly).url, searchItem.homepage);
});

test("mapLibProject preserves a legitimate 0 dependents_count as score 0 (not null)", () => {
  const m = mapLibProject({ ...searchItem, dependents_count: 0 });
  assert.equal(m.score, 0);
});

// --- HTML stripping through the shared contract path (OUT-03) ------------

test("package description HTML is stripped through buildDetailEnvelope -> normalizeItem", () => {
  const env = buildDetailEnvelope({
    source: "librariesio",
    item: mapLibProject(project), // express description carries a <b> tag
    comments: [],
  });
  const text = env.item.text;
  assert.ok(text != null);
  assert.ok(!/</.test(text), "no HTML tags remain in text");
  assert.ok(text.includes("Node.js"), "text content preserved");
});

// --- contract conformance (OUT-01) --------------------------------------

test("mapLibProject results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "librariesio",
    query: "react",
    results: search.map(mapLibProject),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, search.length);
  for (const r of env.results) assert.equal(r.type, "package");
});

test("librariesio_get maps a project onto a DetailEnvelopeSchema-valid envelope with comments []", () => {
  const env = buildDetailEnvelope({
    source: "librariesio",
    item: mapLibProject(project),
    comments: [],
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
  assert.deepEqual(env.item.comments, []);
  assert.equal(env.item.id, `${project.platform}/${project.name}`);
});

// --- CR-01: not-found guard ----------------------------------------------

test("requireLibProject throws a clear not-found error for an absent project", () => {
  assert.throws(
    () => requireLibProject(undefined, "npm", "does-not-exist-xyz"),
    /package npm\/does-not-exist-xyz not found/,
  );
  assert.throws(() => requireLibProject(null, "pypi", "x"), /not found/);
});

test("requireLibProject returns the project unchanged when present (happy path)", () => {
  const p = { name: "x", platform: "NPM" };
  assert.equal(requireLibProject(p, "npm", "x"), p);
});

// --- WR-01 / T-03-04: api_key never enters the cache key ------------------

test("libUrl sends the api_key in the request URL but NEVER in the cache key (WR-01, Pitfall 3)", () => {
  const prev = process.env.LIBRARIESIO_KEY;
  process.env.LIBRARIESIO_KEY = "SECRET_LIB_KEY_XYZ";
  try {
    const { url, cacheKey } = libUrl("/search", { platforms: "npm", q: "react" });
    assert.ok(url.includes("SECRET_LIB_KEY_XYZ"), "authed URL carries the api_key");
    assert.ok(
      !cacheKey.includes("SECRET_LIB_KEY_XYZ"),
      "cache key must be secret-free (http_client contract: NEVER a secret)",
    );
    assert.ok(
      !cacheKey.includes("api_key"),
      "no api_key param in the cache key at all",
    );
    // the non-secret params still round-trip into the cache key
    assert.ok(cacheKey.includes("platforms=npm"), "public params preserved in cache key");
  } finally {
    if (prev === undefined) delete process.env.LIBRARIESIO_KEY;
    else process.env.LIBRARIESIO_KEY = prev;
  }
});

// --- criterion 4 proof: missing LIBRARIESIO_KEY throws a clear error ------

test("libUrl throws a clear 'set LIBRARIESIO_KEY' error when the key is unset (criterion 4, D-10)", () => {
  const prev = process.env.LIBRARIESIO_KEY;
  delete process.env.LIBRARIESIO_KEY;
  try {
    assert.throws(
      () => libUrl("/search", { platforms: "npm", q: "react" }),
      /LIBRARIESIO_KEY/,
      "a missing required key fails loudly BEFORE any request",
    );
  } finally {
    if (prev !== undefined) process.env.LIBRARIESIO_KEY = prev;
  }
});

// --- registration smoke (FOUND-05) --------------------------------------

test("librariesio server registers exactly librariesio_get, librariesio_search", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, ["librariesio_get", "librariesio_search"]);
});

test("each librariesio tool declares an outputSchema (contract validation on return)", () => {
  for (const name of ["librariesio_search", "librariesio_get"]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});

// --- security invariants: no direct fetch, no process.env in the server --

test("servers/librariesio/server.js never calls fetch directly and never reads process.env", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../servers/librariesio/server.js", import.meta.url)),
    "utf8",
  );
  assert.ok(!/\bfetch\s*\(/.test(src), "no direct fetch( — all HTTP via getJson()");
  assert.ok(
    !/process\.env/.test(src),
    "no process.env — creds only via librariesIoParams()",
  );
});
