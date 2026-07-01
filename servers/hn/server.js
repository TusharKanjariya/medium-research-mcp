// servers/hn/server.js — Hacker News reference server (FOUND-04, OUT-01).
//
// This is the TEMPLATE every later source server copies. It proves the shared
// contract end-to-end: adding a source reduces to writing the field map
// (mapHnHit / mapHnItem) + URL construction. Everything reusable — defaulting,
// HTML stripping, envelope assembly, the dual content/structuredContent return,
// caching/retry/stale — lives in the shared modules and is imported here.
//
// Source: Algolia HN Search API (https://hn.algolia.com/api/v1), no auth.
// Field map verified against live responses (see 01-RESEARCH.md):
//   objectID->id, points->score, num_comments->num_comments, author->author,
//   created_at->created_utc, url->url, _tags->type, story_text/comment_text->text.
// Job stories carry null points/num_comments -> null score/num_comments.

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

const ALGOLIA = "https://hn.algolia.com/api/v1";
const SOURCE = "hackernews";

// --- HN-only field mapping (the ONLY HN-specific logic) ------------------

// _tags values worth surfacing to the reader; internal author_*/story_* noise
// is dropped (01-RESEARCH Open Question 3, planner discretion).
const MEANINGFUL_TAGS = new Set(["story", "front_page", "ask_hn", "show_hn"]);

// Derive the contract `type` enum (ARCHITECTURE §4) from a search hit's _tags.
// ask_hn->ask, show_hn->show, job->job, comment->comment, poll/pollopt/else->story.
function hnHitType(tags = []) {
  const t = new Set(tags);
  if (t.has("ask_hn")) return "ask";
  if (t.has("show_hn")) return "show";
  if (t.has("job")) return "job";
  if (t.has("comment")) return "comment";
  return "story"; // poll/pollopt and anything else fall back to story
}

// Derive the contract `type` from a /items/:id detail node's own `type` field
// (the detail endpoint has no _tags). Ask/Show detail nodes report type "story".
function hnDetailType(type) {
  if (type === "comment") return "comment";
  if (type === "job") return "job";
  return "story"; // story / poll / pollopt / unknown -> story
}

// created_utc: search hits carry an ISO-8601 `created_at`; detail nodes carry an
// epoch `created_at_i`. Prefer the ISO string, else derive from the epoch.
function toIso(source) {
  if (source.created_at != null) return source.created_at;
  if (source.created_at_i != null) {
    return new Date(source.created_at_i * 1000).toISOString();
  }
  return null;
}

const permalink = (id) => `https://news.ycombinator.com/item?id=${id}`;

/**
 * Map one Algolia /search hit onto a raw contract item (pre-normalize). The
 * returned object is fed through buildListEnvelope -> normalizeItem, which
 * applies defaulting and HTML-stripping — so this function is pure field
 * mapping and constructs no derived text.
 */
export function mapHnHit(hit) {
  return {
    id: String(hit.objectID),
    type: hnHitType(hit._tags),
    title: hit.title ?? "",
    author: hit.author ?? null,
    score: hit.points ?? null, // null for job stories (verified)
    num_comments: hit.num_comments ?? null, // null for job stories (verified)
    created_utc: toIso(hit),
    url: hit.url ?? null,
    permalink: permalink(hit.objectID),
    tags: (hit._tags ?? []).filter((t) => MEANINGFUL_TAGS.has(t)),
    text: hit.story_text ?? hit.comment_text ?? null,
  };
}

/**
 * Map one Algolia /items/:id detail node onto { item, comments }. Only the
 * TOP-LEVEL children become comments (the nested reply tree is intentionally
 * flattened away); text stripping happens downstream in buildDetailEnvelope.
 */
export function mapHnItem(detail) {
  const item = {
    id: String(detail.id),
    type: hnDetailType(detail.type),
    title: detail.title ?? "",
    author: detail.author ?? null,
    score: detail.points ?? null,
    num_comments: detail.num_comments ?? null,
    created_utc: toIso(detail),
    url: detail.url ?? null,
    permalink: permalink(detail.id),
    tags: [],
    text: detail.text ?? null,
  };
  const comments = (detail.children ?? []).map((c) => ({
    id: String(c.id),
    author: c.author ?? null,
    text: c.text ?? null,
  }));
  return { item, comments };
}

// --- MCP wiring (identical across servers except URL construction) -------
//
// registerTool at SDK 1.29.0 takes RAW Zod shapes for inputSchema/outputSchema
// (NOT z.object(...) — RESEARCH Pitfall 1). Every handler fetches through
// getJson (never fetch directly — CLAUDE.md), maps via the helpers above,
// assembles the envelope with the shared factories, and returns toolResult()
// so both structuredContent and JSON-text content are emitted (FOUND-05).

export const server = new McpServer({ name: "hn", version: "1.0.0" });

server.registerTool(
  "hn_front_page",
  {
    title: "Hacker News front page",
    description: "Current Hacker News front-page stories, normalized.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ limit = 20 }) => {
    const raw = await getJson(
      `${ALGOLIA}/search?tags=front_page&hitsPerPage=${limit}`,
    );
    const env = buildListEnvelope({
      source: SOURCE,
      query: null, // front page has no query
      results: (raw.hits ?? []).map(mapHnHit),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "hn_search",
  {
    title: "Hacker News search",
    description: "Search Hacker News stories by relevance.",
    inputSchema: {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, limit = 20 }) => {
    const raw = await getJson(
      `${ALGOLIA}/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`,
    );
    const env = buildListEnvelope({
      source: SOURCE,
      query,
      results: (raw.hits ?? []).map(mapHnHit),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "hn_get_item",
  {
    title: "Hacker News item detail",
    description:
      "Fetch one Hacker News item with its top-level comments, normalized.",
    inputSchema: {
      id: z.union([z.string(), z.number()]),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ id }) => {
    const detail = await getJson(`${ALGOLIA}/items/${encodeURIComponent(id)}`);
    const { item, comments } = mapHnItem(detail);
    const env = buildDetailEnvelope({ source: SOURCE, item, comments });
    return toolResult(env);
  },
);

// Connect over stdio only when run directly (`node servers/hn/server.js`), so
// importing this module for tests does NOT start a live transport.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await server.connect(new StdioServerTransport());
}
