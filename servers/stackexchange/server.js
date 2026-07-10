// servers/stackexchange/server.js — Stack Exchange source server (SRC-01).
//
// Copied from the HN reference server (servers/hn/server.js): same imports,
// McpServer, three registerTool blocks, and direct-run transport guard. The only
// source-specific logic is the field map (mapSeQuestion / mapSeDetail) and the URL
// construction. Everything reusable — defaulting, HTML stripping, envelope
// assembly, the dual content/structuredContent return, caching/retry/stale — lives
// in the shared modules and is imported here.
//
// Source: Stack Exchange API 2.3 (https://api.stackexchange.com/2.3), network-wide
// via the `site` param (default "stackoverflow", D-03), optional STACKEXCHANGE_KEY
// for higher quota (D-04/CRED-04 — degrades to keyless when unset).
//
// Field map verified against live responses (02-RESEARCH SRC-01 §5, fixtures under
// test/fixtures/stackexchange-*.json):
//   question_id->id, "question"->type, title->title, owner.display_name->author,
//   score->score (votes), answer_count->num_comments, creation_date->created_utc,
//   link->url/permalink, tags->tags, body(_markdown)->text.
//
// filter=withbody is sent on EVERY question/answer/detail call so `text` is never
// silently null (D-04, Pitfall 2). NOTE: the built-in `withbody` filter populates
// `body` (rendered HTML), not `body_markdown` (verified live — RESEARCH Assumption
// A1 corrected); we read `body_markdown ?? body` and the shared normalizeItem strips
// the HTML downstream, so `text` lands as clean plain text either way.
//
// creation_date is epoch SECONDS -> `new Date(s * 1000).toISOString()` (Pitfall 3);
// treating it as ms would yield year-1970 dates.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { getJson } from "../../shared/http_client.js";
import {
  buildListEnvelope,
  buildDetailEnvelope,
  listEnvelopeShape,
  detailEnvelopeShape,
  toolResult,
} from "../../shared/contract.js";
import { stackExchangeParams } from "../../shared/credentials.js";

const SE = "https://api.stackexchange.com/2.3";
const SOURCE = "stackexchange";

// --- SE-only field mapping (the ONLY SE-specific logic) ------------------

// created_utc: SE `creation_date` is epoch SECONDS (Pitfall 3). Convert to ISO-8601;
// null-safe so a missing timestamp normalizes to null rather than the epoch.
function toIso(seconds) {
  if (seconds == null) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Map one raw SE question onto a raw contract item (pre-normalize). The returned
 * object is fed through buildListEnvelope -> normalizeItem, which applies
 * defaulting and HTML-stripping — so this is pure field mapping and constructs no
 * derived text. `body_markdown ?? body` covers both a custom markdown filter and
 * the built-in `withbody` (HTML `body`); stripHtml downstream cleans either.
 */
export function mapSeQuestion(q) {
  return {
    id: String(q.question_id),
    type: "question",
    title: q.title ?? "",
    author: q.owner?.display_name ?? null, // null for a deleted owner
    score: q.score ?? null, // votes (§5)
    num_comments: q.answer_count ?? null, // answers (§5)
    created_utc: toIso(q.creation_date),
    url: q.link ?? null,
    permalink: q.link ?? null,
    tags: q.tags ?? [],
    text: q.body_markdown ?? q.body ?? null, // needs filter=withbody
  };
}

/**
 * Guard the not-found case (CR-01). Stack Exchange returns HTTP 200 with an empty
 * `items` array for a question id that does not exist (it does NOT 404), so the
 * mapper would otherwise dereference `undefined` and throw an uncaught TypeError
 * on ordinary stale/typo'd input — violating the "a tool call never hard-errors"
 * resilience contract. We surface a clear, actionable not-found error instead of
 * the WR-03 bogus-placeholder pattern (`?? {}` yields a junk `id: "undefined"`
 * item that misrepresents absence as a real, empty question).
 */
export function requireSeQuestion(question, id, site) {
  if (question == null) {
    throw new Error(
      `stackexchange: question ${id} not found on site ${site}`,
    );
  }
  return question;
}

/**
 * Map one raw SE no-answers question onto a raw contract item (TREND-02, D-08).
 * Identical to mapSeQuestion EXCEPT `score` is overridden with `view_count` — for
 * unmet-need mining, views (not votes) are the engagement signal. Everything else
 * (num_comments = answer_count, which is 0 for the no-answers set — contract-legal)
 * is inherited unchanged. The frozen item schema gains no new field.
 */
export function mapSeUnanswered(q) {
  return { ...mapSeQuestion(q), score: q.view_count ?? null };
}

// Behavioral throttle honoring for SE (D-10, OQ-1). Default sleeper; injectable in
// tests so the backoff wait is observable without real time passing.
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// WR-01: hard ceiling on the honored backoff. `backoff` is an arbitrary,
// server-controlled response field that gates WALL-CLOCK time; a pathological or
// stale-served value would otherwise hang the MCP tool call for that many seconds
// with no cancellation (the sleep runs AFTER getJson returns, outside any
// AbortController/timeoutMs). SE's real backoffs are small, so clamping to 30s
// keeps every legitimate wait intact while capping a hostile/garbage value.
const MAX_BACKOFF_MS = 30_000;

/**
 * Honor SE's throttle signals BEHAVIORALLY without touching the frozen envelope
 * (OQ-1 resolved — no backoff/quota_remaining field is ever added to the contract).
 *
 * - `quota_remaining === 0` → throw a clear, actionable error telling the user their
 *   Stack Exchange quota is exhausted and to set STACKEXCHANGE_KEY for a higher quota
 *   (mirrors requireSeQuestion's actionable style; routes exhaustion through the
 *   error path per D-10).
 * - a positive `backoff` field → `await sleep(backoff * 1000)` to honor the API's
 *   mandated wait BEFORE any follow-up SE request (D-10). SE only emits `backoff`
 *   when it wants the next call delayed; sleeping here prevents a self-inflicted ban.
 *
 * The common single-page fetch never issues a follow-up, so a present backoff simply
 * costs one honored wait; callers that never re-fetch still satisfy the API contract.
 */
export async function seThrottle(raw, { sleep = realSleep } = {}) {
  if (raw?.quota_remaining === 0) {
    throw new Error(
      "stackexchange: API quota exhausted (quota_remaining=0) — set STACKEXCHANGE_KEY for a higher quota",
    );
  }
  if (typeof raw?.backoff === "number" && raw.backoff > 0) {
    // Clamp to MAX_BACKOFF_MS (WR-01) so a huge/hostile backoff cannot hang the
    // tool call — the honored wait never exceeds the ceiling.
    await sleep(Math.min(raw.backoff * 1000, MAX_BACKOFF_MS));
  }
  return raw;
}

/**
 * Map a raw SE question + its answers onto { item, comments }. Only the top-level
 * answers become comments (SE answers carry no nested reply tree here); text
 * stripping happens downstream in buildDetailEnvelope.
 */
export function mapSeDetail(question, answers = []) {
  const item = mapSeQuestion(question);
  const comments = (answers ?? []).map((a) => ({
    id: String(a.answer_id),
    author: a.owner?.display_name ?? null,
    text: a.body_markdown ?? a.body ?? null,
  }));
  return { item, comments };
}

// Build a SE request URL + a secret-free cache key (WR-01). The authed URL folds
// in the optional key fragment (emits `key` ONLY when set — never `key=` when
// absent, CRED-04); the cache key deliberately OMITS the key so a credential can
// never become part of the cache key (http_client's cacheKey contract: "NEVER a
// secret"). getJson's error text is separately redacted (redactUrl), so the key
// also never leaks into a thrown error. Callers: `const { url, cacheKey } =
// seUrl(...); await getJson(url, { cacheKey })`.
export function seUrl(path, params) {
  const publicQs = new URLSearchParams({ ...params, filter: "withbody" });
  const authedQs = new URLSearchParams({
    ...params,
    filter: "withbody",
    ...stackExchangeParams(),
  });
  return {
    url: `${SE}${path}?${authedQs.toString()}`,
    cacheKey: `${SE}${path}?${publicQs.toString()}`,
  };
}

// --- MCP wiring (identical shape to the HN template) ---------------------
//
// registerTool takes RAW Zod shapes for inputSchema/outputSchema (NOT z.object(...)
// — Pitfall 7). Every handler fetches through getJson (never fetch directly —
// CLAUDE.md), maps via the helpers above, assembles the envelope with the shared
// factories, and returns toolResult() so both structuredContent and JSON-text
// content are emitted.

export const server = new McpServer({ name: "stackexchange", version: "1.0.0" });

const SORT = z.enum(["hot", "votes", "week", "month", "activity"]);

// /search/advanced supports a DIFFERENT sort set than /questions (WR-02): the
// `hot`/`week`/`month` values valid for hot questions are NOT valid search sorts,
// so search advertises only the sorts the endpoint actually honors. This keeps the
// tool surface honest — a declared `sort` is passed through, never silently dropped.
const SEARCH_SORT = z.enum(["relevance", "votes", "activity", "creation"]);

server.registerTool(
  "so_hot_questions",
  {
    title: "Stack Exchange hot questions",
    description:
      "Trending/hot questions from a Stack Exchange network site, normalized. " +
      "`site` defaults to \"stackoverflow\"; pass any SE network site string " +
      "(e.g. \"serverfault\", \"superuser\", \"askubuntu\") to target it. " +
      "`sort` defaults to \"hot\" (overridable: votes/week/month/activity).",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional(),
      site: z.string().optional(),
      sort: SORT.optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ limit = 20, site = "stackoverflow", sort = "hot" }) => {
    const { url, cacheKey } = seUrl("/questions", {
      site,
      sort,
      order: "desc",
      pagesize: String(limit),
    });
    const raw = await getJson(url, { cacheKey });
    const env = buildListEnvelope({
      source: SOURCE,
      query: null, // hot list has no query
      results: (raw.items ?? []).map(mapSeQuestion),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "so_search",
  {
    title: "Stack Exchange search",
    description:
      "Search a Stack Exchange network site (native SE /search/advanced). " +
      "`site` defaults to \"stackoverflow\"; pass any SE network site string to " +
      "target it. `sort` defaults to \"relevance\" (overridable: " +
      "votes/activity/creation).",
    inputSchema: {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
      site: z.string().optional(),
      sort: SEARCH_SORT.optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, limit = 20, site = "stackoverflow", sort = "relevance" }) => {
    const { url, cacheKey } = seUrl("/search/advanced", {
      site,
      q: query,
      sort,
      order: "desc",
      pagesize: String(limit),
    });
    const raw = await getJson(url, { cacheKey });
    const env = buildListEnvelope({
      source: SOURCE,
      query,
      results: (raw.items ?? []).map(mapSeQuestion),
    });
    return toolResult(env);
  },
);

/**
 * Fetch one SE question and its answers, mapped to { item, comments } (D-02).
 *
 * This is a GENUINE sequential double-fetch (question, THEN answers), so it is the
 * one path that can trip SE's self-inflicted throttle/ban if the first response
 * carries a `backoff`. WR-02: honor `seThrottle(raw)` BETWEEN the two fetches —
 * after the question response, before the answers request — which is exactly the
 * contract seThrottle was written for ("honor the wait BEFORE any follow-up SE
 * request"). `get`/`sleep` are injectable so the throttle-between-fetches wiring is
 * observable offline (no network, no real wait); production uses getJson/realSleep.
 */
export async function fetchQuestionDetail(
  { id, site = "stackoverflow" },
  { get = getJson, sleep = realSleep } = {},
) {
  const encId = encodeURIComponent(id);
  const q = seUrl(`/questions/${encId}`, { site });
  const raw = await get(q.url, { cacheKey: q.cacheKey });
  // SE answers HTTP 200 { items: [] } for a missing id — guard before mapping.
  const question = requireSeQuestion(raw?.items?.[0], id, site);
  // WR-02: honor SE's backoff / surface quota-zero BEFORE the follow-up answers
  // fetch — the real sequential path the throttle exists to protect.
  await seThrottle(raw, { sleep });
  const a = seUrl(`/questions/${encId}/answers`, {
    site,
    sort: "votes",
    order: "desc",
  });
  const answers = await get(a.url, { cacheKey: a.cacheKey });
  return mapSeDetail(question, answers?.items ?? []);
}

server.registerTool(
  "so_get_question",
  {
    title: "Stack Exchange question detail",
    description:
      "Fetch one Stack Exchange question with its answers (mapped to comments[]), " +
      "normalized. `site` defaults to \"stackoverflow\"; pass any SE network site " +
      "string to target it.",
    inputSchema: {
      id: z.union([z.string(), z.number()]),
      site: z.string().optional(),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ id, site = "stackoverflow" }) => {
    const { item, comments } = await fetchQuestionDetail({ id, site });
    const env = buildDetailEnvelope({ source: SOURCE, item, comments });
    return toolResult(env);
  },
);

server.registerTool(
  "so_unanswered",
  {
    title: "Stack Exchange high-view unanswered questions",
    description:
      "Mine high-view questions with ZERO answers (the /questions/no-answers " +
      "set) for a required `tag`, ranked by view_count descending — the purest " +
      "unmet-need signal for a blog topic (TREND-02). `site` defaults to " +
      "\"stackoverflow\"; pass any SE network site string to target it. `score` " +
      "in each result is the question's view_count (not votes) for this tool.",
    inputSchema: {
      tag: z.string(), // REQUIRED (D-09) — no-answers is only meaningful per tag
      site: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ tag, site = "stackoverflow", limit = 20 }) => {
    // Single-page window (OQ-2): SE has NO server-side view sort (`sort=views` is
    // rejected — Pitfall 2), so fetch a modest window with a VALID sort and re-rank
    // by views client-side. pagesize = min(limit*2, 100) gives the re-rank headroom
    // while staying single-fetch, so the common case never needs a backoff sleep.
    const { url, cacheKey } = seUrl("/questions/no-answers", {
      site,
      tagged: tag,
      sort: "activity",
      order: "desc",
      pagesize: String(Math.min(limit * 2, 100)),
    });
    const raw = await getJson(url, { cacheKey });
    // Honor backoff / surface quota-zero via the error+behavioral path (OQ-1/D-10)
    // before any use of the response — no throttle field leaks into the envelope.
    await seThrottle(raw);
    const results = [...(raw.items ?? [])]
      .sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0))
      .slice(0, limit)
      .map(mapSeUnanswered);
    const env = buildListEnvelope({ source: SOURCE, query: tag, results });
    return toolResult(env);
  },
);

// Connect over stdio only when run directly (`node servers/stackexchange/server.js`),
// so importing this module for tests does NOT start a live transport.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await server.connect(new StdioServerTransport());
}
