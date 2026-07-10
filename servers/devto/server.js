// servers/devto/server.js — Dev.to (Forem) source server (SRC-05).
//
// Copied from the HN reference server (servers/hn/server.js): same imports,
// McpServer, registerTool blocks, and direct-run transport guard. The only
// source-specific logic is the field map (mapDevtoArticle / mapDevtoDetail) and
// the URL construction. Everything reusable — defaulting, HTML stripping,
// envelope assembly, the dual content/structuredContent return, caching/retry/
// stale — lives in the shared modules and is imported here.
//
// Source: Forem REST API (https://dev.to/api), NO auth. Every call sends the
// Forem versioned Accept header via getJson's `headers` option.
//
// Field map verified against live /articles payloads (02-RESEARCH SRC-05 §5,
// fixtures under test/fixtures/devto-*.json):
//   id->id (stringify), "article"->type, title->title,
//   user.username(||name)->author, public_reactions_count->score (reactions),
//   comments_count->num_comments (comments), published_at->created_utc (ISO
//   already, no conversion), url->url/permalink, tag_list->tags,
//   description (LIST) / body_markdown (DETAIL)->text.
//
// LIST vs DETAIL quirks (verified live):
//   - /articles list objects OMIT the body, so list `text` = `description`;
//     only /articles/{id} returns `body_markdown` (detail `text`).
//   - `tag_list` is an ARRAY on the list endpoint but a comma-separated STRING
//     on the detail endpoint — toTags() normalizes both to a string array so
//     the contract (tags: string[]) always holds.
//
// SEARCH: Dev.to has no public article search API, so devto_search does a D-01
// client-side substring filter over the top-of-week window.

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

const DEVTO = "https://dev.to/api";
const SOURCE = "devto";

// Forem versioned Accept header sent on every call (getJson headers option).
const FOREM_HEADERS = { Accept: "application/vnd.forem.api-v1+json" };

// D-07 trending default: most popular over the past 7 days.
const TOP_DAYS = 7;
// D-01 client-side search window over the top feed.
const SEARCH_WINDOW = 50;

// --- Dev.to-only field mapping (the ONLY Dev.to-specific logic) ----------

// tag_list is an ARRAY on list objects but a comma-separated STRING on detail
// objects (verified live) — normalize both to a plain string array so the
// contract's `tags: string[]` always holds.
function toTags(a) {
  if (Array.isArray(a.tag_list)) return a.tag_list;
  if (typeof a.tag_list === "string") {
    return a.tag_list
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  if (Array.isArray(a.tags)) return a.tags;
  return [];
}

/**
 * Map one Dev.to article onto a raw contract item (pre-normalize). Fed through
 * buildListEnvelope -> normalizeItem, which applies defaulting + HTML-stripping,
 * so this is pure field mapping. `author` falls back username -> name -> null.
 * `text` uses the list `description`; the detail path overrides with
 * `body_markdown`. `published_at` is already ISO-8601 (no conversion).
 */
export function mapDevtoArticle(a) {
  return {
    id: String(a.id),
    type: "article",
    title: a.title ?? "",
    author: a.user?.username ?? a.user?.name ?? null,
    score: a.public_reactions_count ?? null, // reactions (§5)
    num_comments: a.comments_count ?? null, // comments (§5)
    created_utc: a.published_at ?? null, // ISO-8601 already
    url: a.url ?? null,
    permalink: a.url ?? null, // Dev.to url is the canonical permalink
    tags: toTags(a),
    text: a.description ?? null, // list text = description
  };
}

/**
 * Guard the not-found case (WR-05, same class as CR-01). Dev.to returns HTTP 404
 * for a missing id today, so getJson throws before mapping — but that safety relies
 * on the upstream choosing 404 over "200 + empty/odd body". A `200 {}` (or a
 * stale-cache hit of a malformed prior body) would otherwise let mapDevtoArticle
 * dereference an id-less object. An explicit shape check makes the not-found
 * deterministic and consistent with the SE/Lobsters guards.
 */
export function requireDevtoArticle(article, id) {
  if (!article || article.id == null) {
    throw new Error(`devto: article ${id} not found`);
  }
  return article;
}

/**
 * Map a single /articles/{id} article plus its /comments?a_id= tree onto
 * { item, comments }. The item reuses mapDevtoArticle but overrides `text` with
 * the full `body_markdown` (the detail body, not the list description). Only
 * TOP-LEVEL comments are flattened to the contract's {id, author, text}; the
 * nested `children` reply tree is intentionally dropped. Text stripping happens
 * downstream in buildDetailEnvelope.
 */
export function mapDevtoDetail(article, comments) {
  const item = {
    ...mapDevtoArticle(article),
    text: article.body_markdown ?? article.description ?? null,
  };
  const flat = (comments ?? []).map((c) => ({
    id: c.id_code,
    author: c.user?.username ?? c.user?.name ?? null,
    text: c.body_html ?? null, // HTML stripped downstream
  }));
  return { item, comments: flat };
}

/**
 * Build the Dev.to /articles request URL for the devto_top tool (both modes).
 * Pure and exported so the forbidden-combo guard is unit-testable offline
 * WITHOUT the network (D-15, Pitfall 4): `registerTool` takes a RAW Zod shape,
 * so cross-field constraints (reject `mode: "rising"` + `days`) cannot live in
 * the schema and MUST be enforced here, BEFORE any fetch.
 *
 * - `mode: "top"`  -> `?top=<days ?? TOP_DAYS>&per_page=<limit>` (top-of-window;
 *   `days` is an INTEGER number of days: 7 = top of week, 30 = top of month).
 * - `mode: "rising"` -> `?state=rising&per_page=<limit>` (Forem rising feed;
 *   `days` is meaningless here and is REJECTED).
 * - `tag` (either mode) appends `&tag=<encodeURIComponent(tag)>`.
 */
export function devtoTopUrl({ mode = "top", days, tag, limit } = {}) {
  if (mode === "rising" && days != null) {
    throw new Error(
      'devto_top: `days` is not valid with `mode: "rising"` — `days` selects a ' +
        "top-of-window (mode: \"top\") only. Drop `days` or use `mode: \"top\"`.",
    );
  }
  const params =
    mode === "rising"
      ? `state=rising&per_page=${limit}`
      : `top=${days ?? TOP_DAYS}&per_page=${limit}`;
  const tagPart = tag ? `&tag=${encodeURIComponent(tag)}` : "";
  return `${DEVTO}/articles?${params}${tagPart}`;
}

// --- MCP wiring (identical shape to the HN template) ---------------------
//
// registerTool takes RAW Zod shapes for inputSchema/outputSchema (NOT
// z.object(...) — Pitfall 7). Every handler fetches through getJson (never
// fetch directly — CLAUDE.md), maps via the helpers above, assembles the
// envelope with the shared factories, and returns toolResult().

export const server = new McpServer({ name: "devto", version: "1.0.0" });

server.registerTool(
  "devto_top",
  {
    title: "Dev.to top / rising articles",
    description:
      "Dev.to trending articles in one of two explicit modes. `mode: \"top\"` " +
      "(default) returns the most popular articles over the past `days` — where " +
      "`days` is an INTEGER NUMBER OF DAYS (7 = top of week, 30 = top of month; " +
      "default 7), NOT a word like \"week\". `mode: \"rising\"` returns Dev.to's " +
      "rising feed (`days` does NOT apply in rising mode and is rejected). An " +
      "optional `tag` (e.g. \"javascript\", \"rust\") filters EITHER mode; " +
      "`limit` bounds the results.",
    inputSchema: {
      mode: z.enum(["top", "rising"]).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      days: z.number().int().min(1).max(365).optional(),
      tag: z.string().optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ mode = "top", limit = 20, days, tag }) => {
    // Build the URL first: devtoTopUrl throws deterministically on the D-15
    // forbidden combo (mode: "rising" + days) BEFORE any network call.
    const url = devtoTopUrl({ mode, days, tag, limit });
    const raw = await getJson(url, { headers: FOREM_HEADERS });
    const env = buildListEnvelope({
      source: SOURCE,
      query: tag ?? null, // free-text query is the tag filter, if any
      results: (raw ?? []).map(mapDevtoArticle),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "devto_tag",
  {
    title: "Dev.to articles by tag",
    description:
      "Top Dev.to articles filed under a single tag (e.g. \"javascript\", " +
      "\"rust\", \"webdev\"), over the past 7 days, normalized. `limit` bounds " +
      "the results.",
    inputSchema: {
      tag: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ tag, limit = 20 }) => {
    const raw = await getJson(
      `${DEVTO}/articles?tag=${encodeURIComponent(tag)}&top=${TOP_DAYS}&per_page=${limit}`,
      { headers: FOREM_HEADERS },
    );
    const env = buildListEnvelope({
      source: SOURCE,
      query: null, // tag list has no free-text query
      results: (raw ?? []).map(mapDevtoArticle),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "devto_search",
  {
    title: "Dev.to search (top-of-week window)",
    description:
      "Client-side substring search over the current Dev.to top-of-week " +
      `window (the first ~${SEARCH_WINDOW} most popular articles of the past ` +
      "7 days). Matches the query case-insensitively against each article's " +
      "title, tags, and description. NOTE: Dev.to has no public article search " +
      "API, so this only finds matches within the fetched top window, not the " +
      "whole site.",
    inputSchema: {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, limit = 20 }) => {
    const raw = await getJson(
      `${DEVTO}/articles?top=${TOP_DAYS}&per_page=${SEARCH_WINDOW}`,
      { headers: FOREM_HEADERS },
    );
    const q = query.toLowerCase();
    const hits = (raw ?? []).filter((a) =>
      `${a.title ?? ""} ${toTags(a).join(" ")} ${a.description ?? ""}`
        .toLowerCase()
        .includes(q),
    );
    const env = buildListEnvelope({
      source: SOURCE,
      query,
      results: hits.slice(0, limit).map(mapDevtoArticle),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "devto_get",
  {
    title: "Dev.to article detail",
    description:
      "Fetch one Dev.to article by its id with its full body and top-level " +
      "comments, normalized.",
    inputSchema: {
      id: z.union([z.string(), z.number()]),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ id }) => {
    const raw = await getJson(
      `${DEVTO}/articles/${encodeURIComponent(id)}`,
      { headers: FOREM_HEADERS },
    );
    const article = requireDevtoArticle(raw, id);
    const comments = await getJson(
      `${DEVTO}/comments?a_id=${encodeURIComponent(id)}`,
      { headers: FOREM_HEADERS },
    );
    const { item, comments: flat } = mapDevtoDetail(article, comments);
    const env = buildDetailEnvelope({ source: SOURCE, item, comments: flat });
    return toolResult(env);
  },
);

// Connect over stdio only when run directly (`node servers/devto/server.js`),
// so importing this module for tests does NOT start a live transport.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await server.connect(new StdioServerTransport());
}
