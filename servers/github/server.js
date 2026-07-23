#!/usr/bin/env node
// servers/github/server.js — GitHub source server (SRC-06).
//
// Copied from the Stack Exchange reference server (servers/stackexchange/server.js):
// same imports, McpServer, three registerTool blocks, and direct-run transport
// guard. GitHub carries TWO entity types on the one uniform contract — trending
// repos (stars->score) and issues for pain-point mining (reactions->score,
// comments->num_comments) — so it exposes a repo tool, an issue tool, and a
// polymorphic detail tool (D-01). Everything reusable — defaulting, HTML
// stripping, envelope assembly, the dual content/structuredContent return,
// caching/retry/stale — lives in the shared modules and is imported here.
//
// Source: GitHub REST API (https://api.github.com), pinned X-GitHub-Api-Version
// 2022-11-28. An optional GITHUB_TOKEN raises rate limits (30 req/min search,
// 5000/hr core) and degrades to anonymous when unset (10/60 respectively) via
// githubHeaders() -> {} (CRED-04). The PAT rides ONLY in the Authorization header
// (never in the URL/cacheKey/logs, T-03-01), and the outbound host is a module
// constant — tool input fills only the q string + encoded path segments, never
// the host (SSRF invariant, T-03-02, same as lemmyInstance).
//
// Field maps verified against the RESEARCH §Field Mapping tables + fixtures under
// test/fixtures/github-*.json. All GitHub timestamps are already ISO-8601, so
// there is no epoch conversion (unlike Stack Exchange).
//
// D-09 / OQ1: issue `score` comes from reactions.total_count present in the
// /search/issues LIST item (reactions are GA on application/vnd.github+json — no
// squirrel-girl preview header, no per-issue N+1 fetch, Pitfall 2). mapGhIssue is
// null-safe: when the reactions object is absent, score stays null (contract-legal,
// never a fabricated 0) and the reaction total is instead sourced from the detail
// tool (gh_get_item, whose per-issue GET returns reactions). See SUMMARY for the
// live-smoke outcome recording which branch is live.

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
import { githubHeaders } from "../../shared/credentials.js";

// Outbound host is a FIXED module constant — NEVER taken from tool input (SSRF
// invariant, T-03-02). Tool params only fill the q string / encoded path segments.
const GH = "https://api.github.com";
const GH_HEADERS_BASE = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
const SOURCE = "github";

// Merge the pinned base headers with the optional PAT fragment. githubHeaders()
// returns { Authorization } when GITHUB_TOKEN is set, else {} (anonymous, CRED-04).
// The PAT lives ONLY here in a request header (T-03-01): it never enters the URL,
// the cache key (default cacheKey = url, which is secret-free), or any log/error.
const ghHeaders = () => ({ ...GH_HEADERS_BASE, ...githubHeaders() });

// --- GitHub-only field mapping (the ONLY GitHub-specific logic) ----------

// A GitHub label is either an object { name } (Search + REST) or, defensively, a
// bare string; normalize both to the label name and drop anything empty.
function labelNames(labels = []) {
  return (labels ?? [])
    .map((l) => (typeof l === "string" ? l : l?.name))
    .filter(Boolean);
}

/**
 * Map one raw GitHub repo (a /search/repositories or /repos/{o}/{r} item) onto a
 * raw contract item (pre-normalize). Fed through buildListEnvelope -> normalizeItem,
 * which applies defaulting and HTML-stripping — so this is pure field mapping.
 * stars->score; num_comments is null (n/a for repos); tags = language followed by
 * topics; url prefers a non-blank homepage, else the canonical html_url.
 */
export function mapGhRepo(r) {
  return {
    id: String(r.id),
    type: "repo",
    title: r.full_name ?? r.name ?? "",
    author: r.owner?.login ?? null,
    score: r.stargazers_count ?? null, // §5 stars
    num_comments: null, // n/a for repos
    created_utc: r.created_at ?? r.pushed_at ?? null, // already ISO-8601
    url: r.homepage || r.html_url || null, // blank homepage -> html_url
    permalink: r.html_url ?? null,
    tags: [r.language].filter(Boolean).concat(r.topics ?? []),
    text: r.description ?? null,
  };
}

/**
 * Map one raw GitHub issue (a /search/issues or /repos/{o}/{r}/issues/{n} item)
 * onto a raw contract item (pre-normalize). id uses `number` (what the detail +
 * comment URLs need). score = reactions.total_count when the reactions object is
 * present, else null — NEVER a fabricated 0 (OQ1 contingency; `?.` + `??` keeps a
 * legitimate 0 while mapping an absent reactions object to null). comments (the
 * integer count) -> num_comments; labels -> tags; body -> text (HTML stripped
 * downstream).
 */
export function mapGhIssue(i) {
  return {
    id: String(i.number ?? i.id),
    type: "issue",
    title: i.title ?? "",
    author: i.user?.login ?? null,
    score: i.reactions?.total_count ?? null, // GA in the list response (D-09)
    num_comments: i.comments ?? null, // integer comment count
    created_utc: i.created_at ?? null,
    url: i.html_url ?? null,
    permalink: i.html_url ?? null,
    tags: labelNames(i.labels),
    text: i.body ?? null,
  };
}

/**
 * Filter + map a /search/issues items array: DROP any item carrying a
 * `pull_request` key so PRs never pollute pain-point results (Pitfall 5), then map
 * the remaining issues. The `is:issue` qualifier already asks GitHub to exclude
 * PRs; this is the belt-and-suspenders second guard.
 */
export function mapGhIssues(items = []) {
  return (items ?? []).filter((it) => !it.pull_request).map(mapGhIssue);
}

/**
 * Map a raw GitHub issue + its top-level comments onto { item, comments } for the
 * detail tool. Only top-level issue comments become comments[] (HN precedent, no
 * nested reply tree); text stripping happens downstream in buildDetailEnvelope.
 */
export function mapGhIssueDetail(issue, comments = []) {
  const item = mapGhIssue(issue);
  return {
    item,
    comments: (comments ?? []).map((c) => ({
      id: String(c.id),
      author: c.user?.login ?? null,
      text: c.body ?? null,
    })),
  };
}

/**
 * Guard the not-found case (CR-01, requireSeQuestion precedent). GitHub 404s on a
 * missing repo/issue and getJson throws a clear terminal 4xx error before we get
 * here — but if a response ever arrives null/absent, surface a clear, actionable
 * not-found error rather than dereferencing undefined in the mapper.
 */
export function requireGhResource(resource, kind, ref) {
  if (resource == null) {
    throw new Error(`github: ${kind} ${ref} not found`);
  }
  return resource;
}

/**
 * Uphold the list tool's "Pull requests are excluded" invariant on the DETAIL
 * path (WR-03, Pitfall 5). GitHub's issues endpoint also resolves pull-request
 * numbers, returning a node carrying a `pull_request` key. mapGhIssue would
 * unconditionally stamp `type: "issue"`, so a PR number would yield a contract
 * item mislabeled as an issue (wrong type; num_comments excludes review
 * comments). Surface a clear not-an-issue error instead — mirrors the list
 * tool's mapGhIssues PR-skip rather than returning a mislabeled item.
 */
export function requireGhIssueNotPr(issue, ref) {
  if (issue?.pull_request) {
    throw new Error(`github: ${ref} is a pull request, not an issue`);
  }
  return issue;
}

// Compose GitHub Search qualifiers INTO the q string (Pitfall 6): language:,
// label:, repo:, is:issue, is:open and the pushed:>cutoff recency window are all q
// qualifiers — only sort/order/per_page are real query params. The whole q is
// URL-encoded so passthrough values can never break out of the query (T-03-03).
function searchUrl(path, q, { sort, order = "desc", limit }) {
  return (
    `${GH}${path}?q=${encodeURIComponent(q)}` +
    `&sort=${sort}&order=${order}&per_page=${limit}`
  );
}

// --- MCP wiring (identical shape to the SE/HN template) ------------------
//
// registerTool takes RAW Zod shapes for inputSchema/outputSchema (NOT z.object(...)
// — Pitfall 7). Every handler fetches through getJson (never fetch directly —
// CLAUDE.md), maps via the helpers above, assembles the envelope with the shared
// factories, and returns toolResult() so both structuredContent and JSON-text
// content are emitted.

export const server = new McpServer({ name: "github", version: "1.0.0" });

const SINCE = z.enum(["day", "week", "month"]);
const SINCE_DAYS = { day: 1, week: 7, month: 30 };

/**
 * Build the gh_trending_repos search q string (exported pure builder — the
 * seUrl/devtoTopUrl convention — so the window logic tests offline with an
 * injected `now`). Recency window as a YYYY-MM-DD date string (D-03): GitHub has
 * no trending API, so `pushed:>cutoff` + sort=stars emulates it. That default
 * lets all-time star giants (pushed daily, score = total stars) dominate every
 * window; `newOnly` swaps the window to `created:>cutoff` so only repos CREATED
 * inside the window qualify — genuinely new repos, opt-in, default frozen.
 * Composition order (query, language, window) and falsy-drop are unchanged.
 */
export function ghTrendingQualifiers({
  query,
  language,
  since = "week",
  newOnly = false,
  now = Date.now(),
} = {}) {
  const cutoff = new Date(now - SINCE_DAYS[since] * 864e5)
    .toISOString()
    .slice(0, 10);
  return [
    query,
    language && `language:${language}`,
    `${newOnly ? "created" : "pushed"}:>${cutoff}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function registerTools(server) {
server.registerTool(
  "gh_trending_repos",
  {
    title: "GitHub trending repositories",
    description:
      "Recently-active repositories ranked by stars, via the GitHub Search API " +
      "(GitHub has no official trending API — this emulates it). `since` = " +
      "day/week/month (default week) sets the recent-activity window; optional " +
      "`query` free text and `language` narrow the results. stars -> score. " +
      "Set `newOnly` true to window by repo CREATION date instead of recent " +
      "pushes, surfacing genuinely new repos rather than all-time star giants " +
      "(default false — behavior unchanged).",
    inputSchema: {
      query: z.string().optional(),
      language: z.string().optional(),
      since: SINCE.optional(),
      limit: z.number().int().min(1).max(50).optional(),
      newOnly: z.boolean().optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, language, since = "week", limit = 20, newOnly = false }) => {
    const qualifiers = ghTrendingQualifiers({ query, language, since, newOnly });
    const url = searchUrl("/search/repositories", qualifiers, {
      sort: "stars",
      limit,
    });
    const raw = await getJson(url, { headers: ghHeaders() });
    const env = buildListEnvelope({
      source: SOURCE,
      query: query ?? null,
      results: (raw.items ?? []).map(mapGhRepo),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "gh_search_issues",
  {
    title: "GitHub issue search (pain-point mining)",
    description:
      "Open GitHub issues for pain-point mining, ranked by reactions so the " +
      "highest-signal 'what developers are frustrated by' issues surface first. " +
      "`query` is free text; optional `labels` (e.g. bug, help wanted, question, " +
      "good first issue) and an optional `repo` (owner/name) scope narrow it. " +
      "Pull requests are excluded. reactions total -> score, comments -> num_comments.",
    inputSchema: {
      query: z.string(),
      labels: z.array(z.string()).optional(),
      repo: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ query, labels = [], repo, limit = 20 }) => {
    // is:issue excludes PRs at the source; mapGhIssues also skips any that slip
    // through (Pitfall 5). sort=reactions surfaces the highest-signal pain points
    // first even when reactions land null in the list (OQ1 fallback ordering).
    const qualifiers = [
      query,
      "is:issue",
      "is:open",
      ...labels.map((l) => `label:"${l}"`),
      repo && `repo:${repo}`,
    ]
      .filter(Boolean)
      .join(" ");
    const url = searchUrl("/search/issues", qualifiers, {
      sort: "reactions",
      limit,
    });
    const raw = await getJson(url, { headers: ghHeaders() });
    const env = buildListEnvelope({
      source: SOURCE,
      query,
      results: mapGhIssues(raw.items),
    });
    return toolResult(env);
  },
);

server.registerTool(
  "gh_get_item",
  {
    title: "GitHub repo or issue detail",
    description:
      "Fetch one GitHub repository or issue as a detail envelope. Pass " +
      "`{ owner, repo, number }` for an issue (its top-level comments become " +
      "comments[]) or `{ owner, repo }` for a repository (comments []).",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      number: z.union([z.string(), z.number()]).optional(),
    },
    outputSchema: detailEnvelopeShape,
  },
  async ({ owner, repo, number }) => {
    const encOwner = encodeURIComponent(owner);
    const encRepo = encodeURIComponent(repo);

    if (number != null) {
      // Issue detail: the issue node + its top-level comments (HN precedent).
      const encNum = encodeURIComponent(number);
      const base = `${GH}/repos/${encOwner}/${encRepo}/issues/${encNum}`;
      const issue = await getJson(base, { headers: ghHeaders() });
      requireGhResource(issue, "issue", `${owner}/${repo}#${number}`);
      // Uphold the list tool's PR-exclusion on the detail path too (WR-03): the
      // issues endpoint resolves PR numbers, so reject a PR rather than return
      // a node mislabeled type:"issue".
      requireGhIssueNotPr(issue, `${owner}/${repo}#${number}`);
      const rawComments = await getJson(`${base}/comments`, {
        headers: ghHeaders(),
      });
      const { item, comments } = mapGhIssueDetail(issue, rawComments ?? []);
      return toolResult(buildDetailEnvelope({ source: SOURCE, item, comments }));
    }

    // Repo detail: no comments concept for a repo -> comments [].
    const repoRes = await getJson(`${GH}/repos/${encOwner}/${encRepo}`, {
      headers: ghHeaders(),
    });
    requireGhResource(repoRes, "repo", `${owner}/${repo}`);
    return toolResult(
      buildDetailEnvelope({
        source: SOURCE,
        item: mapGhRepo(repoRes),
        comments: [],
      }),
    );
  },
);
}

registerTools(server);

// Connect over stdio only when run directly (`node servers/github/server.js`), so
// importing this module for tests does NOT start a live transport.
if (isEntry(import.meta.url)) {
  await server.connect(new StdioServerTransport());
}
