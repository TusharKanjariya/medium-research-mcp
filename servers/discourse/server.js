#!/usr/bin/env node
// servers/discourse/server.js — Discourse source server (SRC-10).
//
// Keyless. Copied from the HN reference server (servers/hn/server.js) for its
// STRUCTURE — imports, McpServer, registerTool raw-shape wiring, map* helpers,
// the buildListEnvelope/toolResult chain, and the direct-run transport guard —
// but the FETCH CALL SITE is copied from servers/lemmy/server.js: every request
// rides `getJson(url, { untrustedHost: true })` so the caller-supplied instance
// host is vetted by the shared assertSafeUrl SSRF guard (D-14, SEC-01). Copying
// the bare HN `getJson(url)` here would reintroduce the SSRF hole (Pitfall 5).
//
// Source: any public Discourse forum (https://<instance>/latest.json, /top.json,
// /t/<id>.json). No auth — the instance is an untrusted per-call TOOL PARAMETER
// (D-13), never a hardcoded host: there is NO forum-host literal anywhere in this
// file (the base is always `${normalizeInstance(instance)}`). That is the SEC-02
// property the Phase 7 parameterization audit (plan 07-04) enforces.
//
// Field map verified against a live meta.discourse.org payload (07-RESEARCH
// §"Discourse Field Maps"): a topic maps id->String(id), type->"topic" (appended
// to TYPE in 07-01), title->title, score->like_count, num_comments->reply_count,
// created_utc->created_at, permalink->`${base}/t/${slug}/${id}`, tags->tags,
// text->excerpt, author->the OP resolved via posters[] + the response users[] map
// with a last_poster_username fallback. reply_count (not posts_count-1) is the
// truer reply count; Discourse's internal post.score is IGNORED (not our score).
//
// D-11 per-instance failure UX: a login-required instance answers HTTP 403, or an
// HTML login/interstitial page as a 200/403 with a text/html content-type that
// the Phase 5 content-type gate turns into a `non-JSON response (login required?)`
// terminal error. getJson exposes NO err.status, so we match the error MESSAGE
// string (Pitfall 3) and re-throw a clear tool-level error naming the instance —
// never a JSON.parse crash or contract violation (SC4).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isEntry } from "../../shared/main.js";
import { z } from "zod";
import { getJson } from "../../shared/http_client.js";
import {
  buildListEnvelope,
  buildDetailEnvelope,
  listEnvelopeShape,
  detailEnvelopeShape,
  toolResult,
} from "../../shared/contract.js";

const SOURCE = "discourse";

// Discourse `top` periods (D-04). The zod enum rejects a bogus period BEFORE the
// fetch, so the upstream `?period=bogus` -> HTTP 400 never surfaces.
const PERIOD = ["daily", "weekly", "monthly", "quarterly", "yearly", "all"];

// WR-01: `category` is the combined "slug/id" token interpolated straight into
// the request PATH (/c/<slug>/<id>/l/{latest,top}.json). It is the one user value
// in this server that is neither encoded nor validated, so validate its SHAPE at
// the schema boundary — a slug (lowercase letters/digits/hyphen) + "/" + numeric
// id — rejecting the value BEFORE the URL is built. This blocks a `?` (which would
// fold the intended `/l/...json` suffix into a query string and change the
// endpoint), a `#` (fragment-truncates the path), `../` (path traversal), and a
// stray extra `/`. A blanket encodeURIComponent is WRONG here: the single `/`
// between slug and id is legitimate and must survive (D-02 Option 1).
const CATEGORY_TOKEN = z
  .string()
  .regex(/^[a-z0-9-]+\/\d+$/i, 'category must be the "slug/id" token, e.g. "support/6"');

// --- Instance parameterization (D-13, SEC-02) -----------------------------
//
// The instance is an untrusted per-call tool parameter. normalizeInstance()
// defaults a missing scheme to https:// and strips trailing slashes so
// `${base}/latest.json` interpolates cleanly. It does NOT guess a bare name into
// a host (D-13) and NAMES NO SPECIFIC FORUM HOST in its error (SEC-02); the SSRF
// decision lives entirely in getJson({ untrustedHost: true }), not here.

/**
 * Normalize a Discourse instance base URL: trim, default a missing scheme to
 * https, strip trailing slashes. Throws a readable, host-literal-free (SEC-02)
 * error on empty input.
 * @param {string} instance
 * @returns {string} base URL incl. scheme, no trailing slash
 */
export function normalizeInstance(instance) {
  const raw = String(instance ?? "").trim();
  if (!raw) throw new Error("instance is required (a public Discourse forum base URL)");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

// --- Discourse-only field mapping (the ONLY Discourse-specific logic) ------
//
// The topic object does NOT carry the OP username directly. Build a
// Map<user_id, username> from the response top-level users[] once, then resolve
// posters[] (the entry whose description contains "Original Poster", else the
// first poster). Fall back to last_poster_username, then null (author is a
// nullable contract field).

/**
 * Resolve a topic's author username defensively (A3): OP poster -> users[] map,
 * fallback last_poster_username, then null.
 * @param {object} topic
 * @param {Map<number,string>} usersById
 * @returns {string|null}
 */
function resolveTopicAuthor(topic, usersById) {
  const posters = topic?.posters ?? [];
  const op =
    posters.find((p) => /Original Poster/i.test(p?.description ?? "")) ?? posters[0];
  if (op != null && usersById.has(op.user_id)) return usersById.get(op.user_id);
  return topic?.last_poster_username ?? null;
}

/**
 * Map one Discourse topic_list.topics[] entry onto a raw contract item
 * (pre-normalize). Pure field mapping — buildListEnvelope -> normalizeItem does
 * the String(id)/?? null defaulting and strips `excerpt` HTML downstream.
 * @param {object} topic
 * @param {Map<number,string>} usersById users[] map for author resolution
 * @param {string} base normalized instance base URL (for the permalink)
 */
export function mapDiscourseTopic(topic, usersById, base) {
  const t = topic ?? {};
  return {
    id: String(t.id),
    type: "topic", // new TYPE value (07-01)
    title: t.title ?? "",
    author: resolveTopicAuthor(t, usersById),
    score: t.like_count ?? null, // engagement signal (NOT Discourse's internal post.score)
    num_comments: t.reply_count ?? null, // truer reply count than posts_count-1
    created_utc: t.created_at ?? null, // already ISO-8601
    url: null, // list carries no canonical URL; permalink is constructed
    permalink: `${base}/t/${t.slug}/${t.id}`,
    tags: t.tags ?? [], // already an array of strings
    text: t.excerpt ?? null, // HTML-ish; stripped by normalizeItem
  };
}

/**
 * Map a /t/<id>.json detail payload onto { item, comments }. The item is the
 * topic (same field map as the list, from the top-level fields); the OP body is
 * post_stream.posts[0].cooked. Comments are post_stream.posts[] EXCLUDING index 0
 * (the OP is the item), each flattened to {id, author, text}. post.cooked is HTML
 * -> stripped by buildDetailEnvelope. Discourse's internal post.score is IGNORED.
 * @param {object} raw the /t/<id>.json response
 * @param {string} base normalized instance base URL (for the permalink)
 */
export function mapDiscourseDetail(raw, base) {
  const r = raw ?? {};
  const posts = r.post_stream?.posts ?? [];
  const op = posts[0] ?? {};
  const item = {
    id: String(r.id),
    type: "topic",
    title: r.title ?? "",
    author: r.details?.created_by?.username ?? null, // direct — no users[] lookup here
    score: r.like_count ?? null,
    num_comments: r.reply_count ?? null,
    created_utc: r.created_at ?? null,
    url: null,
    permalink: `${base}/t/${r.slug}/${r.id}`,
    tags: r.tags ?? [],
    text: op.cooked ?? null, // OP body (HTML) -> stripped downstream
  };
  const comments = posts.slice(1).map((p) => ({
    id: String(p.id),
    author: p.username ?? null,
    text: p.cooked ?? null, // HTML -> stripped by buildDetailEnvelope
  }));
  return { item, comments };
}

// --- D-11 per-instance failure UX -----------------------------------------
//
// getJson throws a plain Error with NO `.status` (Pitfall 3): the message is
// `getJson: HTTP <status> from <url>` for a 4xx, or `getJson: non-JSON response
// (login required?) from <url>` when the content-type gate catches an HTML-200
// login page. Map the login/lockdown branches (403 or the gate message) to a
// clear tool-level error naming the instance; propagate everything else. Wording
// says "requires login or is not publicly accessible" because a Cloudflare-fronted
// instance (403 HTML) is indistinguishable from login_required at the HTTP layer.
// Exported so the D-11 mapping is unit-testable offline (the handler wraps its own
// getJson opts, so there is no injection seam at the tool boundary).
export function mapDiscourseError(err, base) {
  if (
    /HTTP 40[13]/.test(err?.message ?? "") ||
    /non-JSON response \(login required/.test(err?.message ?? "")
  ) {
    return new Error(
      `Discourse instance ${base} requires login or is not publicly accessible; ` +
        `only public instances are supported.`,
    );
  }
  return err;
}

// --- MCP wiring (HN structure; Lemmy guarded fetch) -----------------------
//
// registerTool takes RAW Zod shapes (NOT z.object(...) — Pitfall 7). Every
// handler resolves the base from the untrusted `instance` param via
// normalizeInstance, fetches through getJson({ untrustedHost: true }) (never
// fetch directly — CLAUDE.md), maps via the helpers above, assembles the envelope
// with the shared factories, and returns toolResult() so both structuredContent
// and JSON-text content are emitted. Single page + `limit` truncation only — NO
// deep more_topics_url pagination (D-03); each description says "most recent page
// only". `category` is the combined "slug/id" token (D-02 Option 1) interpolated
// as /c/<slug>/<id>/l/{latest,top}.json (slug-only routes 301 -> HTML).

export const server = new McpServer({ name: "discourse", version: "1.0.0" });

const CATEGORY_NOTE =
  "Optional `category` filters by a Discourse category as the combined " +
  '"slug/id" token (e.g. "support/6") — both the slug AND the numeric id are ' +
  "required (a slug-only route redirects to HTML). ";
const PAGE_NOTE =
  "Returns the most recent page only (single fetch, `limit`-truncated; no deep " +
  "pagination). ";

server.registerTool(
  "discourse_latest",
  {
    title: "Discourse latest topics",
    description:
      "Latest topics from any public Discourse forum, by `instance` base URL " +
      "(scheme defaults to https), normalized. " +
      CATEGORY_NOTE +
      PAGE_NOTE +
      "`limit` bounds results.",
    inputSchema: {
      instance: z.string(),
      category: CATEGORY_TOKEN.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ instance, category, limit = 20 }) => {
    const base = normalizeInstance(instance);
    const path = category ? `/c/${category}/l/latest.json` : `/latest.json`;
    try {
      const raw = await getJson(`${base}${path}`, { untrustedHost: true });
      const usersById = new Map((raw.users ?? []).map((u) => [u.id, u.username]));
      const results = (raw.topic_list?.topics ?? [])
        .slice(0, limit)
        .map((t) => mapDiscourseTopic(t, usersById, base));
      const env = buildListEnvelope({ source: SOURCE, query: null, results });
      return toolResult(env);
    } catch (err) {
      throw mapDiscourseError(err, base);
    }
  },
);

server.registerTool(
  "discourse_top",
  {
    title: "Discourse top topics by period",
    description:
      "Top topics from any public Discourse forum over a `period` " +
      "(daily/weekly/monthly/quarterly/yearly/all), by `instance` base URL " +
      "(scheme defaults to https), normalized. " +
      CATEGORY_NOTE +
      PAGE_NOTE +
      "`limit` bounds results.",
    inputSchema: {
      instance: z.string(),
      period: z.enum(PERIOD),
      category: CATEGORY_TOKEN.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ instance, period, category, limit = 20 }) => {
    const base = normalizeInstance(instance);
    const path = category
      ? `/c/${category}/l/top.json?period=${period}`
      : `/top.json?period=${period}`;
    try {
      const raw = await getJson(`${base}${path}`, { untrustedHost: true });
      const usersById = new Map((raw.users ?? []).map((u) => [u.id, u.username]));
      const results = (raw.topic_list?.topics ?? [])
        .slice(0, limit)
        .map((t) => mapDiscourseTopic(t, usersById, base));
      const env = buildListEnvelope({ source: SOURCE, query: null, results });
      return toolResult(env);
    } catch (err) {
      throw mapDiscourseError(err, base);
    }
  },
);

server.registerTool(
  "discourse_topic",
  {
    title: "Discourse topic detail",
    description:
      "Fetch one Discourse topic by its numeric id with its replies, normalized, " +
      "from any public Discourse forum by `instance` base URL " +
      "(scheme defaults to https).",
    inputSchema: {
      instance: z.string(),
      id: z.union([z.string(), z.number()]),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ instance, id }) => {
    const base = normalizeInstance(instance);
    try {
      const raw = await getJson(`${base}/t/${encodeURIComponent(id)}.json`, {
        untrustedHost: true, // SEC-01: instance host rides the shared SSRF guard
      });
      const { item, comments } = mapDiscourseDetail(raw, base);
      const env = buildDetailEnvelope({ source: SOURCE, item, comments });
      return toolResult(env);
    } catch (err) {
      throw mapDiscourseError(err, base);
    }
  },
);

// Connect over stdio only when run directly (`node servers/discourse/server.js`),
// so importing this module for tests does NOT start a live transport.
if (isEntry(import.meta.url)) {
  await server.connect(new StdioServerTransport());
}
