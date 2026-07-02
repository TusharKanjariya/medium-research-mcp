// servers/lobsters/server.js — Lobsters source server (SRC-02).
//
// Copied from the HN reference server (servers/hn/server.js): same imports,
// McpServer, registerTool blocks, and direct-run transport guard. The only
// source-specific logic is the field map (mapLobstersStory / mapLobstersDetail)
// and the URL construction. Everything reusable — defaulting, HTML stripping,
// envelope assembly, the dual content/structuredContent return, caching/retry/
// stale — lives in the shared modules and is imported here.
//
// Source: Lobsters .json endpoints (https://lobste.rs), NO auth, no credentials.
//
// Field map verified against a live lobste.rs/hottest.json payload (02-RESEARCH
// SRC-02 §5, fixtures under test/fixtures/lobsters-*.json):
//   short_id->id, "story"->type, title->title, submitter_user->author (PLAIN
//   STRING — Pitfall 6, NOT a nested {username} object), score->score (upvotes),
//   comment_count->num_comments, created_at->created_utc (ISO already, no
//   conversion), url->url, comments_url->permalink, tags->tags,
//   description_plain/description->text.
//
// Lobsters has no reliable full-text search, so lobsters_search does a D-01
// client-side substring filter over the /hottest.json window (25 stories).

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

const LOBSTERS = "https://lobste.rs";
const SOURCE = "lobsters";

// --- Lobsters-only field mapping (the ONLY Lobsters-specific logic) ------

/**
 * Map one raw Lobsters story onto a raw contract item (pre-normalize). The
 * returned object is fed through buildListEnvelope -> normalizeItem, which
 * applies defaulting and HTML-stripping — so this is pure field mapping and
 * constructs no derived text. `author` comes from the PLAIN-STRING
 * `submitter_user` (Pitfall 6 — the live API no longer nests it as an object,
 * so `.username` would be undefined). `created_at` is already ISO-8601.
 */
export function mapLobstersStory(s) {
  return {
    id: s.short_id,
    type: "story",
    title: s.title ?? "",
    author: s.submitter_user ?? null, // plain username STRING (Pitfall 6)
    score: s.score ?? null, // upvotes (§5)
    num_comments: s.comment_count ?? null, // comments (§5)
    created_utc: s.created_at ?? null, // ISO-8601 already
    url: s.url ?? null, // may be "" for text posts
    permalink: s.comments_url ?? s.short_id_url ?? null,
    tags: s.tags ?? [],
    text: s.description_plain ?? s.description ?? null,
  };
}

/**
 * Map one raw Lobsters story detail (/s/{short_id}.json) onto { item, comments }.
 * The detail object carries the story fields at the top level plus a flat
 * `comments` array; each comment is flattened to the contract's {id, author,
 * text}. Text stripping happens downstream in buildDetailEnvelope.
 */
export function mapLobstersDetail(story) {
  const item = mapLobstersStory(story);
  const comments = (story.comments ?? []).map((c) => ({
    id: c.short_id,
    author: c.commenting_user ?? null, // plain username STRING (Pitfall 6)
    text: c.comment_plain ?? c.comment ?? null,
  }));
  return { item, comments };
}

// --- MCP wiring (identical shape to the HN template) ---------------------
//
// registerTool takes RAW Zod shapes for inputSchema/outputSchema (NOT z.object(...)
// — Pitfall 7). Every handler fetches through getJson (never fetch directly —
// CLAUDE.md), maps via the helpers above, assembles the envelope with the shared
// factories, and returns toolResult() so both structuredContent and JSON-text
// content are emitted.

export const server = new McpServer({ name: "lobsters", version: "1.0.0" });

server.registerTool(
  "lobsters_hottest",
  {
    title: "Lobsters hottest stories",
    description:
      "Current Lobsters hottest (native trending) stories, normalized. " +
      "`limit` bounds the number of mapped results.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ limit = 20 }) => {
    const raw = await getJson(`${LOBSTERS}/hottest.json`);
    const env = buildListEnvelope({
      source: SOURCE,
      query: null, // hottest list has no query
      results: (raw ?? []).slice(0, limit).map(mapLobstersStory),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "lobsters_tag",
  {
    title: "Lobsters stories by tag",
    description:
      "Recent Lobsters stories filed under a single tag (e.g. \"rust\", " +
      "\"programming\", \"security\"), normalized. `limit` bounds the results.",
    inputSchema: {
      tag: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ tag, limit = 20 }) => {
    const raw = await getJson(
      `${LOBSTERS}/t/${encodeURIComponent(tag)}.json`,
    );
    const env = buildListEnvelope({
      source: SOURCE,
      query: null, // tag list has no free-text query
      results: (raw ?? []).slice(0, limit).map(mapLobstersStory),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "lobsters_get",
  {
    title: "Lobsters story detail",
    description:
      "Fetch one Lobsters story by its short id with its comments, normalized.",
    inputSchema: {
      id: z.union([z.string(), z.number()]),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ id }) => {
    const story = await getJson(
      `${LOBSTERS}/s/${encodeURIComponent(id)}.json`,
    );
    const { item, comments } = mapLobstersDetail(story);
    const env = buildDetailEnvelope({ source: SOURCE, item, comments });
    return toolResult(env);
  },
);

server.registerTool(
  "lobsters_search",
  {
    title: "Lobsters search (hottest window)",
    description:
      "Client-side substring search over the current Lobsters hottest window " +
      "(the first page of /hottest.json, ~25 stories). Matches the query " +
      "case-insensitively against each story's title, tags, and text. NOTE: " +
      "Lobsters has no full-text search API, so this only finds matches within " +
      "the fetched hottest window, not the whole site.",
    inputSchema: {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, limit = 20 }) => {
    const raw = await getJson(`${LOBSTERS}/hottest.json`);
    const q = query.toLowerCase();
    const hits = (raw ?? []).filter((s) =>
      `${s.title ?? ""} ${(s.tags ?? []).join(" ")} ${
        s.description_plain ?? s.description ?? ""
      }`
        .toLowerCase()
        .includes(q),
    );
    const env = buildListEnvelope({
      source: SOURCE,
      query,
      results: hits.slice(0, limit).map(mapLobstersStory),
    });
    return toolResult(env);
  },
);

// Connect over stdio only when run directly (`node servers/lobsters/server.js`),
// so importing this module for tests does NOT start a live transport.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await server.connect(new StdioServerTransport());
}
