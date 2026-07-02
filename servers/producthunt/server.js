// servers/producthunt/server.js — Product Hunt source server (SRC-08).
//
// The ONE GraphQL server in the suite. Modeled on the SE/HN/GitHub REST template
// (same imports, McpServer, registerTool blocks, direct-run guard) but the transport
// is a POST GraphQL query over the shared postJson() path (Pattern 2) instead of
// getJson(). Product Hunt surfaces launch/momentum signal for blog topics — today's
// or this-week's launches ranked by votes. It carries a SINGLE entity type on the
// uniform contract (type:"launch"): votesCount->score, commentsCount->num_comments
// (D-05/D-07). Everything reusable — defaulting, HTML stripping, envelope assembly,
// the dual content/structuredContent return, caching/retry/stale — lives in the
// shared modules and is imported here.
//
// Source: Product Hunt API v2 GraphQL (https://api.producthunt.com/v2/api/graphql).
// A REQUIRED PRODUCTHUNT_TOKEN (developer token, bearer, read-only) is resolved
// through productHuntHeaders(), which THROWS "Missing credential: set
// PRODUCTHUNT_TOKEN" when unset (D-10, CRED-04) — the server still registers/starts,
// but the error surfaces on the call, proving the required-credential path
// (criterion 4). The token rides ONLY in the Authorization header (T-03-05): it
// never enters the URL, the cache key (postJson's body-aware key is secret-free), or
// any log/error. postJson adds Content-Type: application/json.
//
// GRAPHQL 200-WITH-ERRORS GUARD (Pitfall 4, T-03-07): GraphQL returns HTTP 200 even
// when the query errors (`{ errors:[...], data:null }`), so postJson does NOT throw.
// After every postJson we FIRST call requirePhOk(raw) — which throws a clear error
// when raw.errors is non-empty — THEN defensively read raw.data?.posts?.edges ?? [].
// This prevents a silent empty list (count:0) masquerading as "no launches".
//
// The outbound host PH_GRAPHQL is a FIXED module constant — never taken from tool
// input (SSRF invariant, T-03-06). Tool params (period/topic/id) only fill GraphQL
// VARIABLES sent to the fixed host (validated upstream), never the host itself.
// `topic` is an optional slug passthrough (D-07) validated server-side by Product
// Hunt; absent -> the overall leaderboard. All PH timestamps are ISO-8601 (no epoch
// conversion).

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
import { productHuntHeaders } from "../../shared/credentials.js";

// Outbound host is a FIXED module constant — NEVER taken from tool input (SSRF
// invariant, T-03-06). Tool params only fill GraphQL variables sent to this host.
const PH_GRAPHQL = "https://api.producthunt.com/v2/api/graphql";
const SOURCE = "producthunt";

// --- Product Hunt-only field mapping (the ONLY source-specific logic) -----

// The hunter/maker: prefer the display name, fall back to the username, else null.
function phAuthor(user) {
  return user?.name ?? user?.username ?? null;
}

/**
 * Map one raw Product Hunt post node (from a posts.edges[].node or a post) onto a
 * raw contract item (pre-normalize). Fed through buildListEnvelope /
 * buildDetailEnvelope -> normalizeItem, which applies defaulting and HTML-stripping
 * — so this is pure field mapping.
 *
 * votesCount->score (§5 votes, D-05); commentsCount->num_comments (§5 comments,
 * D-07); type "launch"; name->title; user name/username->author; topic slugs->tags;
 * createdAt (already ISO-8601)->created_utc; website->url (external product link);
 * url->permalink (the Product Hunt post page); tagline->text. `??` preserves a
 * legitimate 0 votes/comments.
 */
export function mapPhPost(node) {
  return {
    id: String(node.id),
    type: "launch",
    title: node.name ?? "",
    author: phAuthor(node.user),
    score: node.votesCount ?? null, // §5 votes (D-05)
    num_comments: node.commentsCount ?? null, // §5 comments (D-07)
    created_utc: node.createdAt ?? null, // already ISO-8601
    url: node.website || null, // external product link (blank -> null)
    permalink: node.url ?? null, // Product Hunt post page
    tags: (node.topics?.edges ?? [])
      .map((e) => e?.node?.slug)
      .filter(Boolean),
    text: node.tagline ?? null,
  };
}

/**
 * Map a raw Product Hunt post + its top-level comments onto { item, comments } for
 * the detail tool. Only top-level comments become comments[] (HN precedent); text
 * stripping happens downstream in buildDetailEnvelope.
 */
export function mapPhDetail(post) {
  return {
    item: mapPhPost(post),
    comments: (post.comments?.edges ?? [])
      .filter((e) => e?.node)
      .map((e) => ({
        id: String(e.node.id),
        author: phAuthor(e.node.user),
        text: e.node.body ?? null,
      })),
  };
}

/**
 * GraphQL 200-with-errors guard (Pitfall 4, T-03-07). A GraphQL endpoint returns
 * HTTP 200 with `{ errors:[...], data:null }` on a bad query/field/argument, so
 * postJson does not throw. Surface a CLEAR error (joining the GraphQL messages)
 * rather than letting the caller silently read an undefined `data` and yield an
 * empty list. Called immediately after every postJson, before reading raw.data.
 */
export function requirePhOk(raw) {
  if (raw?.errors?.length) {
    const msg = raw.errors
      .map((e) => e?.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(`producthunt: GraphQL error: ${msg || "unknown error"}`);
  }
  return raw;
}

/**
 * Guard the not-found case (CR-01 precedent). Product Hunt returns
 * `{ data:{ post:null } }` for an unknown id (HTTP 200, no GraphQL error), so a
 * clear, actionable not-found error is surfaced rather than dereferencing null.
 */
export function requirePhPost(post, id) {
  if (post == null) {
    throw new Error(`producthunt: launch ${id} not found`);
  }
  return post;
}

// The minimal post field set (PH bills by query COMPLEXITY — keep it tight). Shared
// by the list and detail queries so the map has exactly the fields it reads.
const POST_FIELDS = `id name tagline votesCount commentsCount url website createdAt
  topics { edges { node { slug } } }
  user { name username }`;

// Start-of-period ISO for the postedAfter argument (D-05): today = start of today
// UTC; week = now minus 7 days. All PH timestamps are ISO-8601 DateTime.
function periodStartIso(period) {
  if (period === "week") {
    return new Date(Date.now() - 7 * 864e5).toISOString();
  }
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

// --- MCP wiring (identical shape to the SE/HN/GitHub template) -----------
//
// registerTool takes RAW Zod shapes for inputSchema/outputSchema (NOT z.object(...)
// — Pitfall 7). Every handler POSTs a { query, variables } body through postJson
// (never fetch directly — CLAUDE.md), checks requirePhOk, maps via the helpers
// above, assembles the envelope with the shared factories, and returns toolResult()
// so both structuredContent and JSON-text content are emitted.

export const server = new McpServer({ name: "producthunt", version: "1.0.0" });

const PERIOD = z.enum(["today", "week"]);

server.registerTool(
  "producthunt_launches",
  {
    title: "Product Hunt launches (today / this week)",
    description:
      "Today's or this-week's Product Hunt launches ranked by votes. `period` = " +
      "today (default) or week sets the window (D-05). Optional `topic` is a slug " +
      "passthrough (e.g. \"developer-tools\", \"artificial-intelligence\") " +
      "validated server-side; absent returns the overall leaderboard. votes -> " +
      "score, comments -> num_comments.",
    inputSchema: {
      period: PERIOD.optional(),
      topic: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ period = "today", topic, limit = 20 }) => {
    // order:VOTES + postedAfter window (A1/OQ4 — CITED PostsOrder member VOTES and
    // the postedAfter DateTime arg; confirm against the live PH GraphQL explorer,
    // see SUMMARY). The mapper is unaffected if the live arg names differ.
    const query = `query($after: DateTime, $topic: String, $n: Int!) {
      posts(order: VOTES, postedAfter: $after, topic: $topic, first: $n) {
        edges { node { ${POST_FIELDS} } }
      }
    }`;
    const body = {
      query,
      variables: { after: periodStartIso(period), topic: topic ?? null, n: limit },
    };
    const raw = await postJson(PH_GRAPHQL, { body, headers: productHuntHeaders() });
    requirePhOk(raw); // Pitfall 4: surface GraphQL errors, don't yield an empty list
    const edges = raw.data?.posts?.edges ?? [];
    const env = buildListEnvelope({
      source: SOURCE,
      query: topic ?? null,
      results: edges.filter((e) => e?.node).map((e) => mapPhPost(e.node)),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "producthunt_get",
  {
    title: "Product Hunt launch detail",
    description:
      "Fetch one Product Hunt launch by id as a detail envelope, with its top-level " +
      "comments mapped to comments[]. votes -> score, comments -> num_comments.",
    inputSchema: {
      id: z.union([z.string(), z.number()]),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ id }) => {
    const query = `query($id: ID!) {
      post(id: $id) {
        ${POST_FIELDS}
        comments(first: 20) {
          edges { node { id body user { name username } } }
        }
      }
    }`;
    const body = { query, variables: { id: String(id) } };
    const raw = await postJson(PH_GRAPHQL, { body, headers: productHuntHeaders() });
    requirePhOk(raw); // Pitfall 4
    const post = requirePhPost(raw.data?.post, id);
    const { item, comments } = mapPhDetail(post);
    const env = buildDetailEnvelope({ source: SOURCE, item, comments });
    return toolResult(env);
  },
);

// Connect over stdio only when run directly (`node servers/producthunt/server.js`),
// so importing this module for tests does NOT start a live transport.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await server.connect(new StdioServerTransport());
}
