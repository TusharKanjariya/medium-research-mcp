// servers/librariesio/server.js — Libraries.io source server (SRC-07).
//
// Copied from the Stack Exchange reference server (servers/stackexchange/server.js):
// same imports, McpServer, registerTool blocks, and direct-run transport guard.
// Libraries.io surfaces package-ecosystem momentum for blog topics — most-depended
// (or sort-overridden) packages ranked by dependents_count->score (D-04). It carries
// a SINGLE entity type on the uniform contract (type:"package"); packages have no
// comment concept, so num_comments is null (n/a). Everything reusable — defaulting,
// HTML stripping, envelope assembly, the dual content/structuredContent return,
// caching/retry/stale — lives in the shared modules and is imported here.
//
// Source: Libraries.io API (https://libraries.io/api). A REQUIRED LIBRARIESIO_KEY is
// resolved through librariesIoParams(), which THROWS "Missing credential: set
// LIBRARIESIO_KEY" when unset (D-10, CRED-04) — the server still registers/starts,
// but the error surfaces on the call, proving the required-credential path
// (criterion 4). Unlike GitHub's header PAT, the Libraries.io api_key is a QUERY
// param (exactly like Stack Exchange's key=), so libUrl mirrors seUrl: the authed
// URL carries api_key while the cacheKey is SECRET-FREE (Pitfall 3, WR-01, T-03-04).
// http_client's redactUrl separately strips the query from any thrown error text.
//
// The outbound host LIB is a FIXED module constant — never taken from tool input
// (SSRF invariant, T-03-06). Tool params only fill query values + encoded path
// segments (platform/name), never the host. `platform` is a free passthrough
// (default npm, D-06) validated server-side by Libraries.io, like SE's `site` — no
// local whitelist to maintain.
//
// All Libraries.io timestamps are already ISO-8601, so there is no epoch conversion
// (unlike Stack Exchange).

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
import { librariesIoParams } from "../../shared/credentials.js";

// Outbound host is a FIXED module constant — NEVER taken from tool input (SSRF
// invariant, T-03-06). Tool params only fill query values / encoded path segments.
const LIB = "https://libraries.io/api";
const SOURCE = "librariesio";

// --- Libraries.io-only field mapping (the ONLY source-specific logic) -----

/**
 * Map one raw Libraries.io project (a /search item or a /{platform}/{name} project)
 * onto a raw contract item (pre-normalize). Fed through buildListEnvelope /
 * buildDetailEnvelope -> normalizeItem, which applies defaulting and HTML-stripping
 * — so this is pure field mapping.
 *
 * dependents_count->score (D-04 default momentum signal, uniform regardless of the
 * request sort); num_comments is null (n/a for packages); id is the stable
 * composite `${platform}/${name}` (Libraries.io projects carry no numeric id);
 * author is null (a package has no single author); keywords->tags;
 * latest_release_published_at (already ISO-8601)->created_utc;
 * package_manager_url->permalink (canonical registry page), with a repository_url /
 * homepage fallback for the external url. `??` preserves a legitimate 0 dependents.
 */
export function mapLibProject(p) {
  return {
    id: `${p.platform}/${p.name}`,
    type: "package",
    title: p.name ?? "",
    author: null, // packages have no single author
    score: p.dependents_count ?? null, // §5 dependents (D-04)
    num_comments: null, // n/a for packages
    created_utc: p.latest_release_published_at ?? null, // already ISO-8601
    url: p.package_manager_url ?? p.repository_url ?? p.homepage ?? null,
    permalink: p.package_manager_url ?? null, // canonical registry page
    tags: p.keywords ?? [],
    text: p.description ?? null,
  };
}

/**
 * Guard the not-found case (CR-01, requireSeQuestion precedent). Libraries.io 404s
 * on an unknown platform/name and getJson throws a clear terminal 4xx error before
 * we get here — but if a response ever arrives null/absent, surface a clear,
 * actionable not-found error rather than dereferencing undefined in the mapper.
 */
export function requireLibProject(project, platform, name) {
  if (project == null) {
    throw new Error(`librariesio: package ${platform}/${name} not found`);
  }
  return project;
}

// Build a Libraries.io request URL + a secret-free cache key — a DIRECT mirror of
// seUrl (WR-01, Pitfall 3, T-03-04). The authed URL folds in the required api_key
// fragment from librariesIoParams(); the cacheKey deliberately OMITS api_key (and
// the literal `api_key=`) so a credential can never become part of the cache key
// (http_client's cacheKey contract: "NEVER a secret"). getJson's error text is
// separately redacted (redactUrl), so the key also never leaks into a thrown error.
//
// Because librariesIoParams() THROWS when LIBRARIESIO_KEY is unset, calling libUrl
// with no key throws the clear "set LIBRARIESIO_KEY" error BEFORE any request is
// built or sent (D-10, required-cred, criterion 4). Callers:
// `const { url, cacheKey } = libUrl(...); await getJson(url, { cacheKey })`.
export function libUrl(path, params = {}) {
  const publicQs = new URLSearchParams({ ...params }); // NO api_key
  const authedQs = new URLSearchParams({ ...params, ...librariesIoParams() }); // + api_key (throws if unset)
  return {
    url: `${LIB}${path}?${authedQs.toString()}`,
    cacheKey: `${LIB}${path}?${publicQs.toString()}`, // secret-free
  };
}

// --- MCP wiring (identical shape to the SE/HN template) ------------------
//
// registerTool takes RAW Zod shapes for inputSchema/outputSchema (NOT z.object(...)
// — Pitfall 7). Every handler fetches through getJson (never fetch directly —
// CLAUDE.md), maps via the helpers above, assembles the envelope with the shared
// factories, and returns toolResult() so both structuredContent and JSON-text
// content are emitted.

export const server = new McpServer({ name: "librariesio", version: "1.0.0" });

// The CITED valid Libraries.io /search sort values (libraries.io/api). dependents_count
// is the D-04 default (most-depended); the others let a caller switch the momentum
// signal (e.g. `rank`, recently-updated via latest_release_published_at).
const SORT = z.enum([
  "rank",
  "stars",
  "dependents_count",
  "dependent_repos_count",
  "latest_release_published_at",
  "contributions_count",
  "created_at",
]);

server.registerTool(
  "librariesio_search",
  {
    title: "Libraries.io package search",
    description:
      "Most-depended (or sort-overridden) packages across a package ecosystem, " +
      "via the Libraries.io Search API. `platform` is a free passthrough (default " +
      "\"npm\"; pass any Libraries.io platform string, e.g. \"pypi\", \"cargo\", " +
      "\"maven\") validated server-side. `sort` defaults to \"dependents_count\" " +
      "(most-depended; overridable: rank/stars/dependent_repos_count/" +
      "latest_release_published_at/contributions_count/created_at). Optional " +
      "`query` free text scopes the search. dependents_count -> score.",
    inputSchema: {
      query: z.string().optional(),
      platform: z.string().optional(),
      sort: SORT.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, platform = "npm", sort = "dependents_count", limit = 20 }) => {
    // platforms (plural) is the Search param; sort defaults to the most-depended
    // momentum signal (D-04). `query` is optional — attempt a broad most-depended
    // list; only include `q` when provided (URLSearchParams would otherwise emit a
    // literal "q=undefined"). See SUMMARY for the empty-q live-smoke outcome (OQ2/A2).
    const params = {
      platforms: platform,
      sort,
      per_page: String(limit),
    };
    if (query != null) params.q = query;
    const { url, cacheKey } = libUrl("/search", params);
    const raw = await getJson(url, { cacheKey });
    const env = buildListEnvelope({
      source: SOURCE,
      query: query ?? null,
      results: (Array.isArray(raw) ? raw : []).map(mapLibProject),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "librariesio_get",
  {
    title: "Libraries.io package detail",
    description:
      "Fetch one Libraries.io package (project) as a detail envelope. `platform` " +
      "is a free passthrough (e.g. \"npm\", \"pypi\", \"cargo\") and `name` is the " +
      "package name. Packages carry no comment concept, so comments is always [].",
    inputSchema: {
      platform: z.string(),
      name: z.string(),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ platform, name }) => {
    // encodeURIComponent the path segments so a passthrough platform/name can never
    // break out of the path (T-03-06 injection guard).
    const encPath = `/${encodeURIComponent(platform)}/${encodeURIComponent(name)}`;
    const { url, cacheKey } = libUrl(encPath, {});
    const raw = await getJson(url, { cacheKey });
    const project = requireLibProject(raw, platform, name);
    const env = buildDetailEnvelope({
      source: SOURCE,
      item: mapLibProject(project),
      comments: [], // n/a for packages
    });
    return toolResult(env);
  },
);

// Connect over stdio only when run directly (`node servers/librariesio/server.js`),
// so importing this module for tests does NOT start a live transport.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await server.connect(new StdioServerTransport());
}
