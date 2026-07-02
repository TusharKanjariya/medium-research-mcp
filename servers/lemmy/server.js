// servers/lemmy/server.js — Lemmy source server (SRC-03).
//
// Copied from the HN reference server (servers/hn/server.js): same imports,
// McpServer, registerTool blocks, and direct-run transport guard. The only
// source-specific logic is the field map (mapLemmyPost / mapLemmyDetail), the
// URL construction against the operator-set instance, and the conditional
// Bearer auth wire (D-06). Everything reusable — defaulting, HTML stripping,
// envelope assembly, caching/retry/stale — lives in the shared modules.
//
// Source: Lemmy 0.19+ API v3 (https://<instance>/api/v3/...). Anonymous reads on
// programming.dev by default (D-05, lemmyInstance()); when LEMMY_* creds are set,
// lemmyJwt() supplies a jwt sent as `Authorization: Bearer <jwt>` (D-06).
//
// Field map verified against a live programming.dev payload (02-RESEARCH SRC-03
// §5, fixtures under test/fixtures/lemmy-*.json). A Lemmy list item is a
// PostView { post, creator, counts, ... }:
//   post.id->id (String), "post"->type, post.name->title (Lemmy calls it `name`),
//   creator.name->author, counts.score->score, counts.comments->num_comments,
//   post.published->created_utc (ISO already), post.url->url, post.ap_id->permalink,
//   []->tags (Lemmy posts have no tags), post.body->text.
//
// AUTH PRECONDITION (D-06): lemmyJwt() -> lemmyCreds() (credentials.js) only
// returns creds when LEMMY_INSTANCE **AND** LEMMY_USERNAME **AND** LEMMY_PASSWORD
// are ALL set. Setting only username/password (expecting authenticated reads on
// the default programming.dev) yields anonymous reads with NO error — you MUST
// set LEMMY_INSTANCE explicitly (even to the default https://programming.dev)
// for authenticated reads. Absent creds => lemmyJwt() returns null => anonymous.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { getJson } from "../../shared/http_client.js";
import { lemmyInstance } from "../../shared/credentials.js";
import { lemmyJwt } from "../../shared/auth.js";
import {
  buildListEnvelope,
  buildDetailEnvelope,
  listEnvelopeShape,
  detailEnvelopeShape,
  toolResult,
} from "../../shared/contract.js";

const SOURCE = "lemmy";

// Sort options accepted by Lemmy's post/list + search endpoints (subset that
// makes sense for blog-topic research). `Hot` is the native trending default (D-07).
const SORT = ["Hot", "Active", "New", "TopDay", "TopWeek", "MostComments"];

// --- Lemmy-only field mapping (the ONLY Lemmy-specific logic) -------------

/**
 * Map one raw Lemmy PostView onto a raw contract item (pre-normalize). The
 * returned object is fed through buildListEnvelope -> normalizeItem, which
 * applies defaulting and HTML-stripping. Lemmy calls the title `name`;
 * `published` is already ISO-8601; posts carry no tags so `tags` is always [].
 */
export function mapLemmyPost(pv) {
  const post = pv?.post ?? {};
  const counts = pv?.counts ?? {};
  return {
    id: String(post.id),
    type: "post",
    title: post.name ?? "",
    author: pv?.creator?.name ?? null,
    score: counts.score ?? null, // net score (§5)
    num_comments: counts.comments ?? null, // comments (§5)
    created_utc: post.published ?? null, // ISO-8601 already
    url: post.url ?? null, // may be absent for text posts
    permalink: post.ap_id ?? null, // federation URL is the canonical permalink
    tags: [], // Lemmy posts have no tags
    text: post.body ?? null,
  };
}

/**
 * Map a Lemmy post detail (post_view PostView + a flat CommentView[]) onto
 * { item, comments }. Each CommentView is flattened to the contract's
 * {id, author, text}; text stripping happens downstream in buildDetailEnvelope.
 */
export function mapLemmyDetail(postView, comments) {
  const item = mapLemmyPost(postView);
  const mapped = (comments ?? []).map((cv) => ({
    id: String(cv?.comment?.id),
    author: cv?.creator?.name ?? null,
    text: cv?.comment?.content ?? null,
  }));
  return { item, comments: mapped };
}

// --- Conditional Bearer auth wire (D-06) ----------------------------------
//
// bearerHeaders() is a pure header-builder so the auth decision is unit-testable
// offline; lemmyAuthHeaders() is the async seam every read calls — it resolves
// lemmyJwt() (a Bearer token when LEMMY_* creds are present, else null) and turns
// it into the getJson `headers` fragment. `null` => {} => anonymous, no error.

/** Pure: jwt -> the Authorization header fragment (or {} when there is no jwt). */
export function bearerHeaders(jwt) {
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

/**
 * Resolve the read headers for a Lemmy request. `jwtImpl` is injectable so tests
 * exercise the Bearer-when-token / empty-when-null decision without the network.
 * @param {{ jwtImpl?: () => Promise<string|null> }} [opts]
 */
export async function lemmyAuthHeaders({ jwtImpl = lemmyJwt } = {}) {
  const jwt = await jwtImpl();
  return bearerHeaders(jwt);
}

// --- MCP wiring (identical shape to the HN template) ----------------------
//
// registerTool takes RAW Zod shapes (NOT z.object(...) — Pitfall 7). Every
// handler fetches through getJson (never fetch directly — CLAUDE.md), passing the
// conditional Bearer header via getJson's `headers` option, maps via the helpers
// above, assembles the envelope with the shared factories, and returns
// toolResult() so both structuredContent and JSON-text content are emitted.
//
// The base URL comes ONLY from lemmyInstance() (operator-set env, SSRF mitigation
// T-02-02-SSRF); user input only ever populates query params via URLSearchParams
// or encodeURIComponent'd path segments (T-02-02-URL, Pitfall 8).

export const server = new McpServer({ name: "lemmy", version: "1.0.0" });

const AUTH_NOTE =
  "Authenticated reads require LEMMY_INSTANCE to be set explicitly (even to the " +
  "default https://programming.dev) ALONGSIDE LEMMY_USERNAME/LEMMY_PASSWORD; with " +
  "username/password set but LEMMY_INSTANCE unset, reads stay anonymous by design " +
  "(no error).";

server.registerTool(
  "lemmy_hot",
  {
    title: "Lemmy hot posts (federated)",
    description:
      "Current hot posts across the federated Lemmy network (listing type All, " +
      "sort Hot by default — the native trending notion) from the configured " +
      "instance (default programming.dev), normalized. `limit` bounds results; " +
      "`sort` overrides the ordering. " +
      AUTH_NOTE,
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional(),
      sort: z.enum(SORT).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ limit = 20, sort = "Hot" }) => {
    const base = lemmyInstance();
    const qs = new URLSearchParams({
      type_: "All",
      sort,
      limit: String(limit),
    });
    const headers = await lemmyAuthHeaders();
    const raw = await getJson(`${base}/api/v3/post/list?${qs}`, { headers });
    const env = buildListEnvelope({
      source: SOURCE,
      query: null, // hot list has no free-text query
      results: (raw?.posts ?? []).map(mapLemmyPost),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "lemmy_search",
  {
    title: "Lemmy post search (federated)",
    description:
      "Full-text search over federated Lemmy posts (native /search, type Posts, " +
      "listing All) from the configured instance (default programming.dev), " +
      "normalized. `sort` overrides the ordering. " +
      AUTH_NOTE,
    inputSchema: {
      query: z.string(),
      sort: z.enum(SORT).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, sort = "TopWeek" }) => {
    const base = lemmyInstance();
    const qs = new URLSearchParams({
      q: query,
      type_: "Posts",
      listing_type: "All",
      sort,
    });
    const headers = await lemmyAuthHeaders();
    const raw = await getJson(`${base}/api/v3/search?${qs}`, { headers });
    const env = buildListEnvelope({
      source: SOURCE,
      query,
      results: (raw?.posts ?? []).map(mapLemmyPost),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "lemmy_post",
  {
    title: "Lemmy post detail",
    description:
      "Fetch one Lemmy post by its numeric id with its top-level comments, " +
      "normalized, from the configured instance (default programming.dev). " +
      AUTH_NOTE,
    inputSchema: {
      id: z.union([z.string(), z.number()]),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ id }) => {
    const base = lemmyInstance();
    const pid = encodeURIComponent(id);
    const headers = await lemmyAuthHeaders();
    const [postRes, commentRes] = await Promise.all([
      getJson(`${base}/api/v3/post?id=${pid}`, { headers }),
      getJson(
        `${base}/api/v3/comment/list?post_id=${pid}&max_depth=1&sort=Hot`,
        { headers },
      ),
    ]);
    const { item, comments } = mapLemmyDetail(
      postRes?.post_view,
      commentRes?.comments,
    );
    const env = buildDetailEnvelope({ source: SOURCE, item, comments });
    return toolResult(env);
  },
);

// Connect over stdio only when run directly (`node servers/lemmy/server.js`),
// so importing this module for tests does NOT start a live transport.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await server.connect(new StdioServerTransport());
}
