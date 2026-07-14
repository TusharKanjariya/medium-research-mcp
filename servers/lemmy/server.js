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
import { lemmyInstance, lemmyCreds } from "../../shared/credentials.js";
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

// --- Instance parameterization (D-13/D-15, SEC-02) ------------------------
//
// The instance is now an optional per-call TOOL PARAMETER that overrides the
// LEMMY_INSTANCE env default (lemmyInstance()); the env value is only the
// default when no `instance` arg is supplied. normalizeInstance() defaults a
// missing scheme to https:// and strips trailing slashes so `${base}/api/v3/...`
// interpolates cleanly. It does NOT guess a bare name into a host (D-13). The
// SSRF guard still lives in getJson({ untrustedHost: true }) — this helper only
// shapes the string; it never decides whether the host is safe to reach.

/**
 * Normalize a Lemmy instance base URL: trim, default a missing scheme to https,
 * strip trailing slashes. Throws a readable (host-literal-free, SEC-02) error on
 * empty input.
 * @param {string} instance
 * @returns {string} base URL incl. scheme, no trailing slash
 */
export function normalizeInstance(instance) {
  const raw = String(instance ?? "").trim();
  if (!raw) throw new Error("instance is required (e.g. https://your.lemmy.instance)");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

// --- Conditional Bearer auth wire (D-06) + host gate (D-15) ----------------
//
// bearerHeaders() is a pure header-builder so the auth decision is unit-testable
// offline; lemmyAuthHeaders() is the async seam that resolves lemmyJwt() (a Bearer
// token when LEMMY_* creds are present, else null) into the getJson `headers`
// fragment. `null` => {} => anonymous, no error.
//
// SECURITY (D-15, Open Q3): the env JWT is minted for lemmyCreds().instance
// (= LEMMY_INSTANCE). It must NEVER be replayed to a caller-chosen instance. The
// effective base is host-gated BEFORE the token is resolved: when the tool-param
// instance host differs from the auth-instance host, the request is anonymous.

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

/**
 * Pure host-match decision (D-15): does the effective request base target the
 * SAME host the env JWT was minted for (lemmyCreds().instance)? Only then may the
 * Bearer be attached. Returns false when auth creds are absent or the hosts
 * differ. `credsImpl` is injectable for offline tests. A malformed base host
 * fails closed (false => anonymous).
 * @param {string} base effective (already-normalized) instance base URL
 * @param {{ credsImpl?: () => ({instance:string}|undefined) }} [opts]
 * @returns {boolean}
 */
export function authInstanceMatches(base, { credsImpl = lemmyCreds } = {}) {
  const creds = credsImpl();
  if (!creds?.instance) return false;
  try {
    return (
      new URL(normalizeInstance(base)).host ===
      new URL(normalizeInstance(creds.instance)).host
    );
  } catch {
    return false;
  }
}

/**
 * Host-gated read headers for an effective base: attach the Bearer ONLY when the
 * base targets the env auth host (authInstanceMatches); otherwise anonymous ({}).
 * This is the seam every handler calls — it wraps lemmyAuthHeaders() behind the
 * D-15 host gate so the env token never crosses to a caller-chosen instance.
 * @param {string} base effective (already-normalized) instance base URL
 * @param {{ jwtImpl?: () => Promise<string|null>, credsImpl?: () => ({instance:string}|undefined) }} [opts]
 */
export async function resolveLemmyHeaders(base, opts = {}) {
  if (!authInstanceMatches(base, opts)) return {};
  return lemmyAuthHeaders(opts);
}

// --- MCP wiring (identical shape to the HN template) ----------------------
//
// registerTool takes RAW Zod shapes (NOT z.object(...) — Pitfall 7). Every
// handler fetches through getJson (never fetch directly — CLAUDE.md), passing the
// conditional Bearer header via getJson's `headers` option, maps via the helpers
// above, assembles the envelope with the shared factories, and returns
// toolResult() so both structuredContent and JSON-text content are emitted.
//
// The base URL is the optional per-call `instance` tool parameter (D-13/D-15)
// falling back to lemmyInstance() (operator-set env default). Whichever host is
// effective, the request rides getJson({ untrustedHost: true }) so the shared
// assertSafeUrl SSRF guard vets it (T-02-02-SSRF); user input only ever populates
// query params via URLSearchParams or encodeURIComponent'd path segments
// (T-02-02-URL, Pitfall 8). Authenticated reads (Bearer) apply ONLY when the
// effective instance host matches the env-configured LEMMY_INSTANCE host — the
// env token is never replayed to a caller-chosen instance (D-15).

export const server = new McpServer({ name: "lemmy", version: "1.0.0" });

const AUTH_NOTE =
  "`instance` is an optional per-call override of the LEMMY_INSTANCE default " +
  "(scheme defaults to https). Authenticated reads require LEMMY_INSTANCE to be " +
  "set explicitly (even to the default https://programming.dev) ALONGSIDE " +
  "LEMMY_USERNAME/LEMMY_PASSWORD, and apply ONLY when the effective instance " +
  "matches the env-configured LEMMY_INSTANCE; a differing `instance` is read " +
  "anonymously. With username/password set but LEMMY_INSTANCE unset, reads stay " +
  "anonymous by design (no error).";

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
      instance: z.string().optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ limit = 20, sort = "Hot", instance }) => {
    const base = normalizeInstance(instance ?? lemmyInstance());
    const qs = new URLSearchParams({
      type_: "All",
      sort,
      limit: String(limit),
    });
    const headers = await resolveLemmyHeaders(base);
    const raw = await getJson(`${base}/api/v3/post/list?${qs}`, {
      headers,
      untrustedHost: true, // SEC-01: instance host rides the shared SSRF guard
    });
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
      instance: z.string().optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, sort = "TopWeek", instance }) => {
    const base = normalizeInstance(instance ?? lemmyInstance());
    const qs = new URLSearchParams({
      q: query,
      type_: "Posts",
      listing_type: "All",
      sort,
    });
    const headers = await resolveLemmyHeaders(base);
    const raw = await getJson(`${base}/api/v3/search?${qs}`, {
      headers,
      untrustedHost: true, // SEC-01: instance host rides the shared SSRF guard
    });
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
      instance: z.string().optional(),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ id, instance }) => {
    const base = normalizeInstance(instance ?? lemmyInstance());
    const pid = encodeURIComponent(id);
    const headers = await resolveLemmyHeaders(base);
    const [postRes, commentRes] = await Promise.all([
      getJson(`${base}/api/v3/post?id=${pid}`, {
        headers,
        untrustedHost: true, // SEC-01: instance host rides the shared SSRF guard
      }),
      getJson(
        `${base}/api/v3/comment/list?post_id=${pid}&max_depth=1&sort=Hot`,
        { headers, untrustedHost: true }, // SEC-01: shared SSRF guard
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
