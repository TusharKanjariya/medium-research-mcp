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
// via the `site` param (default "stockoverflow", D-03), optional STACKEXCHANGE_KEY
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
      "Search a Stack Exchange network site by relevance (native SE search). " +
      "`site` defaults to \"stackoverflow\"; pass any SE network site string to " +
      "target it.",
    inputSchema: {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
      site: z.string().optional(),
      sort: SORT.optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, limit = 20, site = "stackoverflow" }) => {
    const { url, cacheKey } = seUrl("/search/advanced", {
      site,
      q: query,
      sort: "relevance",
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
    const encId = encodeURIComponent(id);
    const q = seUrl(`/questions/${encId}`, { site });
    const raw = await getJson(q.url, { cacheKey: q.cacheKey });
    const a = seUrl(`/questions/${encId}/answers`, {
      site,
      sort: "votes",
      order: "desc",
    });
    const answers = await getJson(a.url, { cacheKey: a.cacheKey });
    const { item, comments } = mapSeDetail(raw.items?.[0], answers.items ?? []);
    const env = buildDetailEnvelope({ source: SOURCE, item, comments });
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
