#!/usr/bin/env node
// examples/pain-point-sweep.mjs — DOC-01: the cross-source pain-point sweep.
//
// This file IS the recipe (D-14): give it ONE tag and it queries four developer
// sources — Stack Exchange, Discourse, Mastodon, Dev.to — normalizes each through
// the frozen output contract, and merges them into ONE ranked list via the shared
// `mergeRank`. Because every source emits the SAME item shape (shared/contract.js),
// the merge needs ZERO per-source logic: it is a flat concat sorted by the contract
// `score` field, nulls last. That is the whole thesis of this suite, made runnable.
//
// Run it:
//   node examples/pain-point-sweep.mjs rust
//   npm run example:sweep -- rust
// (tag defaults to "rust" when omitted).
//
// It reuses ONLY existing exported helpers + shared modules — no new fetch, merge,
// or normalize logic lives here. Each source fetch is wrapped in its own try/catch:
// a source that errors, rate-limits, or is locked down contributes an EMPTY envelope
// and logs one `[source] skipped: …` line to stderr — one bad source NEVER aborts the
// sweep and NEVER breaks the contract (D-14 graceful degradation).
//
// The two instance URLs below are EXAMPLE VALUES, not server defaults (SEC-02): the
// Discourse/Mastodon servers take the instance as an untrusted per-call parameter, so
// this example picks sensible public instances and lets you override them via argv or
// env. Swap them freely.

import { getJson } from "../shared/http_client.js";
import { buildListEnvelope } from "../shared/contract.js";
import { mergeRank } from "../shared/rank.js";

// Stack Exchange + Dev.to helpers (fixed-host sources).
import { seUrl, mapSeUnanswered } from "../servers/stackexchange/server.js";
import { devtoTopUrl, mapDevtoArticle } from "../servers/devto/server.js";
// Discourse + Mastodon BOTH export `normalizeInstance` — alias to disambiguate.
import {
  normalizeInstance as normDiscourse,
  mapDiscourseTopic,
} from "../servers/discourse/server.js";
import {
  normalizeInstance as normMastodon,
  mapTimelineStatuses,
} from "../servers/mastodon/server.js";

// --- inputs (all overridable — nothing here is a hardcoded-as-only-option) -----
const tag = process.argv[2] || "rust";
// Example public instances. Override with argv[3]/argv[4] or env to point elsewhere.
const DISCOURSE_INSTANCE =
  process.argv[3] || process.env.DISCOURSE_INSTANCE || "https://meta.discourse.org";
const MASTODON_INSTANCE =
  process.argv[4] || process.env.MASTODON_INSTANCE || "https://mastodon.social";
const TOP_N = 15;
const FOREM_HEADERS = { Accept: "application/vnd.forem.api-v1+json" };

// Wrap a source so any failure degrades to an empty envelope + a stderr note,
// never a thrown crash. `query` is carried through for the contract envelope.
async function safeSource(source, query, fetchEnvelope) {
  try {
    return await fetchEnvelope();
  } catch (err) {
    console.error(`[${source}] skipped: ${err?.message ?? err}`);
    return buildListEnvelope({ source, query, results: [] });
  }
}

// Stack Exchange — high-signal unanswered questions for the tag (score = views).
function stackExchange() {
  return safeSource("stackexchange", tag, async () => {
    const { url, cacheKey } = seUrl("/questions/unanswered", {
      tagged: tag,
      sort: "votes",
      order: "desc",
      site: "stackoverflow",
    });
    const raw = await getJson(url, { cacheKey });
    return buildListEnvelope({
      source: "stackexchange",
      query: tag,
      results: (raw.items ?? []).map(mapSeUnanswered),
    });
  });
}

// Dev.to — top articles of the past week filed under the tag.
function devto() {
  return safeSource("devto", tag, async () => {
    const raw = await getJson(devtoTopUrl({ tag, days: 7, limit: 40 }), {
      headers: FOREM_HEADERS,
    });
    return buildListEnvelope({
      source: "devto",
      query: tag,
      results: (raw ?? []).map(mapDevtoArticle),
    });
  });
}

// Discourse — search a public forum for the tag (instance is an example value).
function discourse() {
  return safeSource("discourse", tag, async () => {
    const base = normDiscourse(DISCOURSE_INSTANCE);
    // untrustedHost: the instance host rides the shared SSRF guard (SEC-01).
    const raw = await getJson(
      `${base}/search.json?q=${encodeURIComponent(tag)}`,
      { untrustedHost: true },
    );
    const usersById = new Map((raw.users ?? []).map((u) => [u.id, u.username]));
    const topics = raw.topics ?? raw.topic_list?.topics ?? [];
    return buildListEnvelope({
      source: "discourse",
      query: tag,
      results: topics.map((t) => mapDiscourseTopic(t, usersById, base)),
    });
  });
}

// Mastodon — the hashtag timeline of a public instance (instance is an example value).
function mastodon() {
  return safeSource("mastodon", tag, async () => {
    const base = normMastodon(MASTODON_INSTANCE);
    const arr = await getJson(
      `${base}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`,
      { untrustedHost: true },
    );
    return buildListEnvelope({
      source: "mastodon",
      query: tag,
      results: mapTimelineStatuses(arr, base),
    });
  });
}

// Run all four in parallel; each already degrades on its own.
const envelopes = await Promise.all([
  stackExchange(),
  discourse(),
  mastodon(),
  devto(),
]);

// Tag each normalized item with its envelope's source for display only — the
// contract item shape carries no `source` field (that lives on the envelope), so
// annotate here before merging. mergeRank reads only `score`, so this extra field
// is inert to the ranking and never touches the contract the tools emit.
for (const e of envelopes) {
  for (const item of e.results) item._source = e.source;
}

// The whole point: one branch-free merge across every source (score desc, nulls last).
const ranked = mergeRank(envelopes);

const perSource = envelopes.map((e) => `${e.source}=${e.count}`).join(" ");
console.log(`\nPain-point sweep for tag "${tag}"  (${perSource})\n`);
if (ranked.length === 0) {
  console.log("No results (every source returned empty or was unreachable).");
} else {
  for (const item of ranked.slice(0, TOP_N)) {
    const score = item.score == null ? "—" : String(item.score);
    console.log(
      `${score.padStart(6)} · ${(item._source ?? "?").padEnd(13)} · ${item.title} · ${item.permalink ?? item.url ?? ""}`,
    );
  }
  console.log(`\n${ranked.length} total items merged; showing top ${Math.min(TOP_N, ranked.length)}.`);
}
