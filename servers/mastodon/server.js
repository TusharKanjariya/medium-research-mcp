// servers/mastodon/server.js — Mastodon source server (SRC-11, SRC-13).
//
// Keyless. Copied from the HN reference server (servers/hn/server.js) for its
// STRUCTURE — imports, McpServer, registerTool raw-shape wiring, map* helpers,
// the buildListEnvelope/toolResult chain, and the direct-run transport guard —
// but the FETCH CALL SITE is copied from servers/lemmy/server.js: every request
// rides `getJson(url, { untrustedHost: true })` so the caller-supplied instance
// host is vetted by the shared assertSafeUrl SSRF guard (D-14, SEC-01). Copying
// the bare HN `getJson(url)` here would reintroduce the SSRF hole (Pitfall 5).
//
// Source: any public Mastodon instance (https://<instance>/api/v1/...). No auth —
// the instance is an untrusted per-call TOOL PARAMETER (D-13), never a hardcoded
// host: there is NO instance-host literal anywhere in this file (the base is
// always `${normalizeInstance(instance)}`). That is the SEC-02 property the
// Phase 7 parameterization audit (plan 07-04) enforces.
//
// Four single-responsibility tools (D-06): mastodon_public, mastodon_hashtag,
// mastodon_trending_tags, mastodon_trending_links. Timeline statuses map to
// type "status", trending tags to type "topic" (title `#name`), trending links
// to type "article" (D-09; TYPE "status"/"topic" appended in 07-01, "article"
// pre-existing). `limit` is clamped at 40 in zod (D-08) — RESEARCH confirms
// Mastodon silently server-clamps at 40, so rejecting >40 keeps the envelope
// count honest.
//
// Field map verified against live fosstodon.org (timelines) + mastodon.social
// (trends) payloads on 2026-07-14 (07-RESEARCH §"Mastodon Field Maps"):
//   status: id->String(id), type->"status", author->account.acct,
//   score->favourites_count+reblogs_count, num_comments->replies_count,
//   created_utc->created_at, url->url, permalink->url ?? uri, tags->tags[].name,
//   text->content. A BOOSTED status carries its real payload in `reblog` (the
//   wrapper has empty content / zero counts) — map from status.reblog when present
//   so boosts surface the original post, not a blank item (RESEARCH Pitfall 4).
//   trending tag: type "topic", title `#name`, score sum(history[].uses via Number).
//   trending link (preview card): type "article", url/title, text->description.
//
// D-11 per-instance failure UX: a locked-down instance answers HTTP 401 or 422
// ({"error":"This method requires an authenticated user"} — AUTHORIZED_FETCH /
// disable-public-preview). Both are terminal 4xx in getJson (no retry, no stale).
// getJson exposes NO err.status, so we match the error MESSAGE string (Pitfall 3)
// and re-throw a clear tool-level error naming the instance — never a crash (SC4).
// Lockdown is per-ENDPOINT (mastodon.social's public timeline is 422 while its
// hashtag + trends are anon-OK), so the mapping is applied per tool call.
//
// D-10 trends-disabled → empty: a disabled/locked trends endpoint returns either
// a 200 empty array (yields count:0 naturally) or a 404 (a terminal 4xx). Catch
// only /HTTP 404/ and return an empty envelope (count:0); never throw for a
// trends-disabled instance (SRC-13, SC3). Other errors propagate.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { getJson } from "../../shared/http_client.js";
import {
  buildListEnvelope,
  listEnvelopeShape,
  toolResult,
} from "../../shared/contract.js";

const SOURCE = "mastodon";

// --- Instance parameterization (D-13, SEC-02) -----------------------------
//
// The instance is an untrusted per-call tool parameter. normalizeInstance()
// defaults a missing scheme to https:// and strips trailing slashes so
// `${base}/api/v1/...` interpolates cleanly. It does NOT guess a bare name into
// a host (D-13) and NAMES NO SPECIFIC INSTANCE HOST in its error (SEC-02); the
// SSRF decision lives entirely in getJson({ untrustedHost: true }), not here.

/**
 * Normalize a Mastodon instance base URL: trim, default a missing scheme to
 * https, strip trailing slashes. Throws a readable, host-literal-free (SEC-02)
 * error on empty input.
 * @param {string} instance
 * @returns {string} base URL incl. scheme, no trailing slash
 */
export function normalizeInstance(instance) {
  const raw = String(instance ?? "").trim();
  if (!raw) throw new Error("instance is required (a public Mastodon instance base URL)");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

// --- Mastodon-only field mapping (the ONLY Mastodon-specific logic) --------
//
// Sum a Mastodon trends `history[]` `uses` column: values are STRINGS
// (e.g. "1234"), so parse each with Number. A NaN (missing/garbage) contributes
// 0 rather than poisoning the total to NaN.

/** Sum history[].uses (string values) with Number, treating NaN as 0. */
function sumHistoryUses(history) {
  return (history ?? []).reduce((acc, h) => {
    const n = Number(h?.uses);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
}

/**
 * Map one raw Mastodon status onto a raw contract item (pre-normalize). The
 * returned object is fed through buildListEnvelope -> normalizeItem, which
 * applies String(id)/?? null defaulting and strips `content` HTML downstream.
 *
 * BOOST HANDLING (Pitfall 4): when `status.reblog` is non-null the top-level
 * wrapper carries empty content / zero counts and the real payload lives in
 * `status.reblog` — map from the reblog so a boost surfaces the original post's
 * content, counts, account and url instead of a blank low-signal item.
 * @param {object} status
 */
export function mapMastodonStatus(status) {
  const s = status?.reblog ?? status ?? {};
  return {
    id: String(s.id),
    type: "status", // new TYPE value (07-01)
    title: "", // Mastodon statuses have no title; contract title is non-null string
    author: s.account?.acct ?? null,
    score: (s.favourites_count ?? 0) + (s.reblogs_count ?? 0), // total engagement
    num_comments: s.replies_count ?? null,
    created_utc: s.created_at ?? null, // ISO-8601 already
    url: s.url ?? null,
    permalink: s.url ?? s.uri ?? null,
    tags: (s.tags ?? []).map((t) => t.name), // strip to name strings (no leading #)
    text: s.content ?? null, // HTML -> stripped by normalizeItem
  };
}

/**
 * Map one /api/v1/trends/tags entry onto a raw contract item. A trending tag has
 * no author/created time; `score` is the summed recent-days usage (history[].uses,
 * string values parsed with Number). title is the `#name` per D-09.
 * @param {object} tag
 */
export function mapTrendingTag(tag) {
  const t = tag ?? {};
  return {
    id: t.name != null ? String(t.name) : String(t.id),
    type: "topic", // reuse Discourse-added type (D-09)
    title: `#${t.name}`,
    author: null,
    score: sumHistoryUses(t.history),
    num_comments: null,
    created_utc: null, // tags have no creation time
    url: t.url ?? null,
    permalink: t.url ?? null,
    tags: t.name != null ? [t.name] : [],
    text: null,
  };
}

/**
 * Map one /api/v1/trends/links preview card onto a raw contract item. A trending
 * link is an "article" (D-09); `author` prefers author_name then provider_name;
 * `score` is the summed recent-days usage; `text` is the card description.
 * @param {object} card
 */
export function mapTrendingLink(card) {
  const c = card ?? {};
  return {
    id: c.url != null ? String(c.url) : String(c.title),
    type: "article", // D-09 (pre-existing TYPE value)
    title: c.title ?? "",
    author: c.author_name || c.provider_name || null,
    score: sumHistoryUses(c.history),
    num_comments: null,
    created_utc: c.published_at ?? null, // ISO-8601 when present
    url: c.url ?? null,
    permalink: c.url ?? null,
    tags: [],
    text: c.description ?? null,
  };
}

// --- D-11 per-instance failure UX -----------------------------------------
//
// getJson throws a plain Error with NO `.status` (Pitfall 3): the message is
// `getJson: HTTP <status> from <url>` for a 4xx. A locked-down instance answers
// 401 (older AUTHORIZED_FETCH / disable-public-preview) or 422 ("requires an
// authenticated user"). Map both to a clear tool-level error naming the instance;
// propagate everything else. Exported so the D-11 mapping is unit-testable offline
// (the handler wraps its own getJson opts, so there is no injection seam at the
// tool boundary).
function lockdownError(base) {
  return new Error(
    `Instance ${base} disallows anonymous reads — try another instance (this tool is keyless).`,
  );
}

export function mapMastodonError(err, base) {
  if (/HTTP (401|422)/.test(err?.message ?? "")) {
    return lockdownError(base);
  }
  return err;
}

// --- WR-02: timeline responses must be a JSON array -----------------------
//
// A public/hashtag timeline endpoint returns a JSON array. `getJson` returns
// whatever JSON the upstream sent, so a 200 carrying an OBJECT instead (e.g.
// `{"error":"..."}` returned with a 200, or a proxy/interstitial JSON object)
// would make `.map` throw a raw `TypeError: arr.map is not a function` — which
// `mapMastodonError` does NOT recognize (its message matches neither HTTP 401 nor
// 422), so it would re-throw verbatim as a confusing crash. An unexpected
// non-array body from a public timeline is effectively an anonymous-access/lockdown
// signal, so map it to the SAME clear tool-level error as the D-11 401/422 path
// rather than a raw TypeError (a tool call never hard-errors — resilience rule).
// The trends tools keep their own D-10 empty-path handling (leave those as-is).
export function mapTimelineStatuses(arr, base) {
  if (!Array.isArray(arr)) throw lockdownError(base);
  return arr.map(mapMastodonStatus);
}

// --- D-10 trends-disabled → empty -----------------------------------------
//
// A trends endpoint returns a JSON array. When trends are disabled, Mastodon
// returns EITHER a 200 empty array (yields count:0 naturally) OR a 404 (terminal
// 4xx in getJson). Catch only /HTTP 404/ and return [] (so the envelope is
// count:0, no throw); other errors propagate. NEVER throw for a trends-disabled
// instance (SRC-13, SC3).
async function fetchTrends(base, path) {
  try {
    return (await getJson(`${base}${path}`, { untrustedHost: true })) ?? [];
  } catch (err) {
    if (/HTTP 404/.test(err?.message ?? "")) return []; // trends disabled → empty
    throw err; // genuine transient/other error propagates unchanged
  }
}

// --- MCP wiring (HN structure; Lemmy guarded fetch) -----------------------
//
// registerTool takes RAW Zod shapes (NOT z.object(...) — Pitfall 7). Every
// handler resolves the base from the untrusted `instance` param via
// normalizeInstance, fetches through getJson({ untrustedHost: true }) (never
// fetch directly — CLAUDE.md), maps via the helpers above, assembles the envelope
// with the shared factories, and returns toolResult() so both structuredContent
// and JSON-text content are emitted. `limit` is a zod int max 40 (D-08) — a call
// with limit>40 is rejected by the schema BEFORE any fetch.

export const server = new McpServer({ name: "mastodon", version: "1.0.0" });

const LIMIT_NOTE =
  "`limit` bounds results (max 40 — Mastodon silently clamps larger values " +
  "server-side, so >40 is rejected up front to keep the count honest). ";
const INSTANCE_NOTE =
  "The target instance is a per-call `instance` base URL (scheme defaults to " +
  "https), so this tool is keyless — no credentials. ";

server.registerTool(
  "mastodon_public",
  {
    title: "Mastodon public timeline",
    description:
      "The public (local + federated) timeline of any Mastodon instance, " +
      "normalized. " +
      INSTANCE_NOTE +
      LIMIT_NOTE +
      "Note some instances lock the public timeline behind authentication " +
      "(returns a clear tool-level error).",
    inputSchema: {
      instance: z.string(),
      limit: z.number().int().min(1).max(40).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ instance, limit = 20 }) => {
    const base = normalizeInstance(instance);
    try {
      const arr = await getJson(
        `${base}/api/v1/timelines/public?limit=${limit}`,
        { untrustedHost: true },
      );
      const env = buildListEnvelope({
        source: SOURCE,
        query: null,
        results: mapTimelineStatuses(arr, base), // WR-02: guard a non-array body
      });
      return toolResult(env);
    } catch (err) {
      throw mapMastodonError(err, base);
    }
  },
);

server.registerTool(
  "mastodon_hashtag",
  {
    title: "Mastodon hashtag timeline",
    description:
      "The timeline of public statuses tagged with a `tag` on any Mastodon " +
      "instance, normalized. " +
      INSTANCE_NOTE +
      LIMIT_NOTE +
      "Federation sparsity: results reflect only what the chosen instance " +
      "federates — larger, more-connected instances see more of a tag than " +
      "small ones (D-12). Pass the tag without a leading '#'.",
    inputSchema: {
      instance: z.string(),
      tag: z.string(),
      limit: z.number().int().min(1).max(40).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ instance, tag, limit = 20 }) => {
    const base = normalizeInstance(instance);
    try {
      const arr = await getJson(
        `${base}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`,
        { untrustedHost: true },
      );
      const env = buildListEnvelope({
        source: SOURCE,
        query: tag,
        results: mapTimelineStatuses(arr, base), // WR-02: guard a non-array body
      });
      return toolResult(env);
    } catch (err) {
      throw mapMastodonError(err, base);
    }
  },
);

server.registerTool(
  "mastodon_trending_tags",
  {
    title: "Mastodon trending hashtags",
    description:
      "Currently trending hashtags on any Mastodon instance, normalized " +
      "(type 'topic', title '#name', score = summed recent-days usage). " +
      INSTANCE_NOTE +
      "An instance with trends disabled returns an empty result set (never an " +
      "error).",
    inputSchema: {
      instance: z.string(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ instance }) => {
    const base = normalizeInstance(instance);
    const arr = await fetchTrends(base, "/api/v1/trends/tags");
    const env = buildListEnvelope({
      source: SOURCE,
      query: null,
      results: (arr ?? []).map(mapTrendingTag),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "mastodon_trending_links",
  {
    title: "Mastodon trending links",
    description:
      "Currently trending links (news/article preview cards) on any Mastodon " +
      "instance, normalized (type 'article'). " +
      INSTANCE_NOTE +
      "An instance with trends disabled returns an empty result set (never an " +
      "error).",
    inputSchema: {
      instance: z.string(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ instance }) => {
    const base = normalizeInstance(instance);
    const arr = await fetchTrends(base, "/api/v1/trends/links");
    const env = buildListEnvelope({
      source: SOURCE,
      query: null,
      results: (arr ?? []).map(mapTrendingLink),
    });
    return toolResult(env);
  },
);

// Connect over stdio only when run directly (`node servers/mastodon/server.js`),
// so importing this module for tests does NOT start a live transport.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await server.connect(new StdioServerTransport());
}
