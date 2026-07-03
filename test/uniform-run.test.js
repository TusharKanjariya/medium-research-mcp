// test/uniform-run.test.js — OUT-02: the project's thesis, proven.
//
// The whole point of the normalized output contract is that a single research
// run can pull from MANY sources and the consumer (the medium-blog-pro skill)
// ranks and filters the merged list with ZERO per-source branches. This test
// turns that claim into an executable assertion.
//
// It loads recorded fixtures from 5+ DIFFERENT shipped sources — deliberately
// mixing sources whose `score` means points/votes/reactions/stars (HN, Stack
// Exchange, Lobsters, Dev.to, GitHub) against RSS whose score is null — maps
// each through its server's EXISTING exported map* helper into the shared list
// envelope, feeds ALL of them through ONE `mergeRank([...])` call, and asserts:
//   (a) every merged item parses against ItemSchema (the full contract shape
//       holds uniformly across all sources);
//   (b) ordering is score-descending with null-score items (the RSS ones) last;
//   (c) a source-agnostic filter reads only contract fields and never throws on
//       a null score;
//   (d) a STRUCTURAL guard: mergeRank takes only the envelopes argument and its
//       body contains no source-keyed conditional — the branch-free property is
//       the whole point of OUT-02.
//
// Offline by design (D-10): it exercises the MERGE over recorded fixtures, never
// the network. The runnable live demo lives in examples/uniform-run.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { mapHnHit } from "../servers/hn/server.js";
import { mapSeQuestion } from "../servers/stackexchange/server.js";
import { mapLobstersStory } from "../servers/lobsters/server.js";
import { mapDevtoArticle } from "../servers/devto/server.js";
import { mapGhRepo } from "../servers/github/server.js";
import { parseFeed, normalizeFeed } from "../servers/rss/server.js";

import { buildListEnvelope, ItemSchema } from "../shared/contract.js";
import { mergeRank, filterByMinScore } from "../shared/rank.js";

// --- fixture loaders (offline; no network) -------------------------------
const jsonFixture = (name) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)),
      "utf8",
    ),
  );
const textFixture = (name) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );

// Build one list envelope per source, using each server's REAL exported map*
// helper — the same mapping the live tool handlers run. Five numeric-score
// sources plus RSS (score always null) give the null-mixing the rank must
// handle source-agnostically.
function sourceEnvelopes() {
  return [
    buildListEnvelope({
      source: "hn",
      query: "top",
      results: [mapHnHit(jsonFixture("hn-story"))],
    }),
    buildListEnvelope({
      source: "stackexchange",
      query: "top",
      results: jsonFixture("stackexchange-list").items.map(mapSeQuestion),
    }),
    buildListEnvelope({
      source: "lobsters",
      query: "hottest",
      results: jsonFixture("lobsters-list").map(mapLobstersStory),
    }),
    buildListEnvelope({
      source: "devto",
      query: "top",
      results: jsonFixture("devto-list").map(mapDevtoArticle),
    }),
    buildListEnvelope({
      source: "github",
      query: "stars",
      results: jsonFixture("github-repos").items.map(mapGhRepo),
    }),
    buildListEnvelope({
      source: "rss",
      query: "https://example.com/feed.atom",
      results: normalizeFeed(parseFeed(textFixture("rss-atom.xml")), "feed"),
    }),
  ];
}

// --- the merge is the whole test ----------------------------------------

test("mergeRank merges 5+ distinct sources into one uniform list (OUT-02)", () => {
  const envelopes = sourceEnvelopes();

  // Sanity: this proof genuinely spans 5+ different sources.
  const inputSources = new Set(envelopes.map((e) => e.source));
  assert.ok(
    inputSources.size >= 5,
    `expected 5+ distinct sources, got ${inputSources.size}`,
  );

  const merged = mergeRank(envelopes);

  // The merged list is the flat concat of every envelope's results.
  const totalIn = envelopes.reduce((n, e) => n + e.results.length, 0);
  assert.equal(merged.length, totalIn, "no item dropped or duplicated");

  // At least five distinct `source`-tagged item origins survive the merge.
  // (Items don't carry `source`; we prove breadth via the input envelopes and
  // that each envelope's items all appear in the merge below.)
  for (const e of envelopes) {
    for (const it of e.results) {
      assert.ok(merged.includes(it), `${e.source} item present in merge`);
    }
  }
});

test("(a) every merged item validates against the full contract ItemSchema", () => {
  const merged = mergeRank(sourceEnvelopes());
  assert.ok(merged.length > 0);
  for (const item of merged) {
    assert.doesNotThrow(
      () => ItemSchema.parse(item),
      `item ${item.id} must satisfy the contract shape`,
    );
  }
});

test("(b) ranking is score-descending with null scores sorted last, source-agnostic", () => {
  const merged = mergeRank(sourceEnvelopes());

  const scored = merged.filter((i) => i.score != null);
  const nulls = merged.filter((i) => i.score == null);

  // All numeric-score items come before any null-score item.
  const firstNullIdx = merged.findIndex((i) => i.score == null);
  if (firstNullIdx !== -1) {
    assert.ok(
      merged.slice(firstNullIdx).every((i) => i.score == null),
      "once a null score appears, every following item is also null",
    );
  }

  // Numeric scores are non-increasing.
  for (let i = 1; i < scored.length; i++) {
    assert.ok(
      scored[i - 1].score >= scored[i].score,
      `scores non-increasing at ${i}: ${scored[i - 1].score} >= ${scored[i].score}`,
    );
  }

  // The RSS (null-score) items really are present at the tail — the mix matters.
  assert.ok(nulls.length > 0, "the merge includes null-score (RSS) items");
});

test("(c) a source-agnostic filter reads only contract fields and never throws on null", () => {
  const merged = mergeRank(sourceEnvelopes());

  assert.doesNotThrow(() => filterByMinScore(merged, 100));
  const top = filterByMinScore(merged, 100);

  // Only items at/above the threshold survive; null scores are dropped, never
  // throw. This is the same branch-free filtering the consumer performs.
  assert.ok(top.length > 0, "some items clear the min-score threshold");
  assert.ok(
    top.every((i) => typeof i.score === "number" && i.score >= 100),
    "every filtered item has a numeric score >= threshold",
  );
  assert.ok(
    !top.some((i) => i.score == null),
    "no null-score item survives a min-score filter",
  );
});

// --- (d) the structural guard: zero per-source branches ------------------

test("(d) mergeRank has no source parameter and no source-keyed branch", () => {
  // It accepts ONLY the envelopes argument — no `source` selector.
  assert.equal(mergeRank.length, 1, "mergeRank takes exactly one argument");

  // Its source text contains no conditional keyed on a `source` identifier —
  // the branch-free property that IS OUT-02. (Comments in the body count too,
  // so this also forbids a `source`-named local acting as a switch.)
  const src = mergeRank.toString();
  assert.ok(
    !/\bif\s*\([^)]*\bsource\b/.test(src),
    "mergeRank body must contain no `if (... source ...)` branch",
  );
  assert.ok(
    !/\bswitch\s*\([^)]*\bsource\b/.test(src),
    "mergeRank body must contain no `switch (source)`",
  );
  assert.ok(
    !/===\s*["'`]/.test(src),
    "mergeRank body must not compare against any string literal (no per-source ===)",
  );

  // filterByMinScore is likewise source-agnostic.
  const fsrc = filterByMinScore.toString();
  assert.ok(
    !/\bif\s*\([^)]*\bsource\b/.test(fsrc),
    "filterByMinScore must contain no source-keyed branch",
  );
});
