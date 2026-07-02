// servers/hashnode/server.js — Hashnode source server (SRC-04).
//
// Copied from the HN reference server (servers/hn/server.js): same imports,
// McpServer, registerTool blocks, and direct-run transport guard. The only
// source-specific logic is the field map (mapHashnodeNode / mapHashnodeDetail),
// the GraphQL query strings, and the fact that Hashnode's public API is
// POST-only GraphQL — so this server fetches through postJson (NEVER getJson,
// NEVER fetch directly — CLAUDE.md / Pitfall 1). Everything reusable —
// defaulting, HTML stripping, envelope assembly, the dual content/
// structuredContent return, caching/retry/stale — lives in the shared modules.
//
// Source: Hashnode public GraphQL API. NOTE (execute-time correction): the
// documented host `https://gql.hashnode.com` root now serves a Vercel web app;
// the live GraphQL endpoint is the `/public` path (Cloudflare-fronted). No auth
// for public reads.
//
// Field map (02-RESEARCH SRC-04 §5, verified against the cited GraphQL schema):
//   id->id, "article"->type, title->title, author.name(||username)->author,
//   reactionCount->score (reactions), responseCount->num_comments (responses),
//   publishedAt->created_utc (ISO already, no conversion), url->url/permalink,
//   tags[].slug->tags, brief (feed) / content.markdown (detail)->text.
//
// SEARCH: Hashnode has NO global full-text search (native search is
// publication-scoped), so hashnode_search does a D-01 client-side substring
// filter over the FEATURED feed window. Trending-by-tag likewise client-side-
// filters on tags[].slug because FeedFilter.tags expects ObjectIds, not slugs
// (Pitfall 5).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { postJson } from "../../shared/http_client.js";
import {
  buildListEnvelope,
  buildDetailEnvelope,
  listEnvelopeShape,
  detailEnvelopeShape,
  toolResult,
} from "../../shared/contract.js";

const HASHNODE = "https://gql.hashnode.com/public";
const SOURCE = "hashnode";

// The FEATURED feed window fetched for the D-01 client-side search and the
// tag filter (Hashnode has no global search; FeedFilter.tags needs ObjectIds).
const SEARCH_WINDOW = 50;

// --- GraphQL query strings (fixed module constants — user input NEVER enters
// the query body; it flows exclusively through `variables`, Security V5) ------

const FEED_QUERY = `query Feed($first: Int!, $filter: FeedFilter) {
  feed(first: $first, filter: $filter) {
    edges { node {
      id title brief slug url publishedAt readTimeInMinutes
      reactionCount responseCount
      author { name username }
      tags { name slug id }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const POST_QUERY = `query Post($id: ID!) {
  post(id: $id) {
    id title brief slug url publishedAt
    reactionCount responseCount replyCount
    content { markdown text }
    author { name username }
    tags { name slug id }
    comments(first: 20) {
      edges { node { id content { markdown text } author { name username } } }
    }
  }
}`;

// --- Hashnode-only field mapping (the ONLY Hashnode-specific logic) -------

/**
 * Map one feed/Post `node` onto a raw contract item (pre-normalize). Fed through
 * buildListEnvelope -> normalizeItem, which applies defaulting + HTML-stripping,
 * so this is pure field mapping. `author` falls back name -> username -> null.
 * `text` uses the feed `brief` (the detail path overrides with content.markdown).
 * `publishedAt` is already ISO-8601 (no conversion).
 */
export function mapHashnodeNode(node) {
  return {
    id: node.id,
    type: "article",
    title: node.title ?? "",
    author: node.author?.name ?? node.author?.username ?? null,
    score: node.reactionCount ?? null, // reactions (§5)
    num_comments: node.responseCount ?? null, // responses (§5)
    created_utc: node.publishedAt ?? null, // ISO-8601 already
    url: node.url ?? null,
    permalink: node.url ?? null, // Hashnode url is the canonical permalink
    tags: (node.tags ?? []).map((t) => t.slug),
    text: node.brief ?? null,
  };
}

/**
 * Guard the not-found case (WR-03). When the article does not exist (or GraphQL
 * returns `data: null` with errors), `post` is null/undefined. Mapping an empty
 * object via `?? {}` would yield a junk `id: "undefined"` item that passes schema
 * validation and misrepresents absence as a real, empty article — so we surface a
 * clear not-found error instead (same convention as SE's requireSeQuestion, CR-01).
 */
export function requireHashnodePost(post, id) {
  if (post == null) {
    throw new Error(`hashnode: article ${id} not found`);
  }
  return post;
}

/**
 * Map a single `post(id)` node onto { item, comments }. The item reuses
 * mapHashnodeNode but overrides `text` with the full `content.markdown`
 * (the detail body, not the feed brief). Only TOP-LEVEL comments (the first
 * `comments.edges`) are flattened to the contract's {id, author, text}; text
 * stripping happens downstream in buildDetailEnvelope.
 */
export function mapHashnodeDetail(post) {
  const item = {
    ...mapHashnodeNode(post),
    text: post.content?.markdown ?? post.brief ?? null,
  };
  const comments = (post.comments?.edges ?? []).map((e) => ({
    id: e.node.id,
    author: e.node.author?.name ?? e.node.author?.username ?? null,
    text: e.node.content?.markdown ?? null,
  }));
  return { item, comments };
}

// Fetch the FEATURED feed window (shared by trending, tag filter, and search).
async function fetchFeatured(first) {
  const raw = await postJson(HASHNODE, {
    body: { query: FEED_QUERY, variables: { first, filter: { type: "FEATURED" } } },
  });
  return (raw?.data?.feed?.edges ?? []).map((e) => e.node);
}

// --- MCP wiring (identical shape to the HN template) ---------------------
//
// registerTool takes RAW Zod shapes for inputSchema/outputSchema (NOT
// z.object(...) — Pitfall 7). Every handler fetches through postJson (never
// fetch directly — CLAUDE.md), maps via the helpers above, assembles the
// envelope with the shared factories, and returns toolResult().

export const server = new McpServer({ name: "hashnode", version: "1.0.0" });

server.registerTool(
  "hashnode_trending",
  {
    title: "Hashnode trending articles",
    description:
      "Current Hashnode network-wide trending (FEATURED feed) articles, " +
      "normalized. `limit` bounds the results. Pass an optional `tag` slug " +
      "(e.g. \"javascript\", \"rust\") to client-side-filter the featured feed " +
      "by tag — Hashnode's FeedFilter.tags expects internal ObjectIds, not " +
      "slugs, so tag filtering is applied over the fetched feed window " +
      `(~${SEARCH_WINDOW} articles), not the whole network.`,
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional(),
      tag: z.string().optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ limit = 20, tag }) => {
    // When filtering by tag, pull the wider window so the client-side filter has
    // material to match; otherwise fetch just what the caller asked for.
    const nodes = await fetchFeatured(tag ? SEARCH_WINDOW : limit);
    const filtered = tag
      ? nodes.filter((n) =>
          (n.tags ?? []).some((t) => t.slug === tag.toLowerCase()),
        )
      : nodes;
    const env = buildListEnvelope({
      source: SOURCE,
      query: null, // trending has no free-text query
      results: filtered.slice(0, limit).map(mapHashnodeNode),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "hashnode_search",
  {
    title: "Hashnode search (featured feed window)",
    description:
      "Client-side substring search over the current Hashnode FEATURED feed " +
      `window (the first ~${SEARCH_WINDOW} trending articles). Matches the ` +
      "query case-insensitively against each article's title, tag slugs, and " +
      "brief. NOTE: Hashnode has NO global full-text search API (its native " +
      "search is publication-scoped), so this only finds matches within the " +
      "fetched featured window, not the whole network.",
    inputSchema: {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, limit = 20 }) => {
    const nodes = await fetchFeatured(SEARCH_WINDOW);
    const q = query.toLowerCase();
    const hits = nodes.filter((n) =>
      `${n.title ?? ""} ${(n.tags ?? []).map((t) => t.slug).join(" ")} ${
        n.brief ?? ""
      }`
        .toLowerCase()
        .includes(q),
    );
    const env = buildListEnvelope({
      source: SOURCE,
      query,
      results: hits.slice(0, limit).map(mapHashnodeNode),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "hashnode_get",
  {
    title: "Hashnode article detail",
    description:
      "Fetch one Hashnode article by its id with its top-level responses, " +
      "normalized.",
    inputSchema: {
      id: z.union([z.string(), z.number()]),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ id }) => {
    // User input `id` flows through GraphQL `variables`, never the query body.
    const raw = await postJson(HASHNODE, {
      body: { query: POST_QUERY, variables: { id: String(id) } },
    });
    const post = requireHashnodePost(raw?.data?.post, id);
    const { item, comments } = mapHashnodeDetail(post);
    const env = buildDetailEnvelope({ source: SOURCE, item, comments });
    return toolResult(env);
  },
);

// Connect over stdio only when run directly (`node servers/hashnode/server.js`),
// so importing this module for tests does NOT start a live transport.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await server.connect(new StdioServerTransport());
}
