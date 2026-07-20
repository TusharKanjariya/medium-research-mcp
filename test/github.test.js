// test/github.test.js — GitHub source server (SRC-06, OUT-01).
//
// Two concerns, both offline (fixtures pin the field map; no live network):
//   1. Field-mapping units — mapGhRepo / mapGhIssue / mapGhIssueDetail convert
//      captured GitHub Search + REST payloads into exact contract items/details
//      (stars->score, reactions.total_count->score, comments->num_comments,
//      labels->tags, issue comments->comments[]).
//   2. Registration smoke — the three D-01 tools register on the McpServer, each
//      with an outputSchema, without throwing.
//
// The issues fixture deliberately contains THREE list items:
//   - one issue WITH a non-zero reactions.total_count (primary D-09 path),
//   - one PULL REQUEST (a pull_request key) that MUST be skipped (Pitfall 5),
//   - one issue with NO reactions object (OQ1 contingency: score falls back to
//     null, never a fabricated 0).
// So the offline test proves BOTH OQ1 branches regardless of the live smoke.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  mapGhRepo,
  mapGhIssue,
  mapGhIssues,
  mapGhIssueDetail,
  requireGhResource,
  requireGhIssueNotPr,
  ghTrendingQualifiers,
  server,
} from "../servers/github/server.js";
import {
  buildListEnvelope,
  buildDetailEnvelope,
  ListEnvelopeSchema,
  DetailEnvelopeSchema,
} from "../shared/contract.js";

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)),
      "utf8",
    ),
  );

const repos = fixture("github-repos");
const issues = fixture("github-issues");
const issueDetail = fixture("github-issue-detail");
const issueComments = fixture("github-issue-comments");

const repoItem = repos.items[0]; // full metadata (language + topics)
const bareRepo = repos.items[1]; // language null, empty topics, empty homepage
const issueWithReactions = issues.items[0]; // reactions.total_count = 15
const prItem = issues.items[1]; // carries a pull_request key -> must be skipped
const issueNoReactions = issues.items[2]; // no reactions object -> score null

// --- mapGhRepo -----------------------------------------------------------

test("mapGhRepo maps a raw GitHub repo onto the exact contract fields", () => {
  const m = mapGhRepo(repoItem);
  assert.equal(m.id, String(repoItem.id));
  assert.equal(typeof m.id, "string");
  assert.equal(m.type, "repo"); // literal (pre-existing enum value)
  assert.equal(m.title, repoItem.full_name); // owner/repo reads better
  assert.equal(m.author, repoItem.owner.login);
  assert.equal(m.score, repoItem.stargazers_count); // stars -> score
  assert.equal(m.num_comments, null); // n/a for repos
  assert.equal(m.created_utc, repoItem.created_at); // already ISO-8601
  assert.equal(m.permalink, repoItem.html_url);
});

test("mapGhRepo tags include the language followed by the topics", () => {
  const m = mapGhRepo(repoItem);
  assert.deepEqual(m.tags, ["Rust", "cli", "performance"]);
});

test("mapGhRepo url prefers homepage but falls back to html_url when homepage is blank", () => {
  assert.equal(mapGhRepo(repoItem).url, repoItem.homepage); // homepage present
  const m2 = mapGhRepo(bareRepo); // homepage === ""
  assert.equal(m2.url, bareRepo.html_url, "blank homepage falls back to html_url");
});

test("mapGhRepo with a null language and no topics yields empty tags", () => {
  const m = mapGhRepo(bareRepo);
  assert.deepEqual(m.tags, []);
});

// --- mapGhIssue ----------------------------------------------------------

test("mapGhIssue maps a raw GitHub issue onto the exact contract fields", () => {
  const m = mapGhIssue(issueWithReactions);
  assert.equal(m.id, String(issueWithReactions.number)); // number, not id
  assert.equal(m.type, "issue"); // NEW enum value (Task 1 prerequisite)
  assert.equal(m.title, issueWithReactions.title);
  assert.equal(m.author, issueWithReactions.user.login);
  assert.equal(m.num_comments, issueWithReactions.comments); // comments -> num_comments
  assert.equal(m.created_utc, issueWithReactions.created_at);
  assert.equal(m.url, issueWithReactions.html_url);
  assert.equal(m.permalink, issueWithReactions.html_url);
});

test("mapGhIssue reads score from reactions.total_count when the reactions object is present (D-09 primary)", () => {
  const m = mapGhIssue(issueWithReactions);
  assert.equal(m.score, 15);
});

test("mapGhIssue score is null (never a fabricated 0) when the reactions object is absent (OQ1 contingency)", () => {
  const m = mapGhIssue(issueNoReactions);
  assert.equal(m.score, null, "absent reactions -> null, not 0");
});

test("mapGhIssue maps labels to tags for both object labels and string labels", () => {
  assert.deepEqual(mapGhIssue(issueWithReactions).tags, ["bug", "help wanted"]);
  assert.deepEqual(mapGhIssue(issueNoReactions).tags, ["question"]); // string label
});

// --- mapGhIssues: PR skip (Pitfall 5) ------------------------------------

test("mapGhIssues skips items carrying a pull_request key so PRs never pollute results (Pitfall 5)", () => {
  const mapped = mapGhIssues(issues.items);
  assert.equal(mapped.length, 2, "the PR item is dropped, two issues remain");
  const ids = mapped.map((m) => m.id);
  assert.ok(!ids.includes(String(prItem.number)), "PR number is absent");
  assert.deepEqual(ids.sort(), ["42", "44"]);
  for (const m of mapped) assert.equal(m.type, "issue");
});

// --- HTML stripping through the shared contract path (OUT-03) ------------

test("issue body HTML is stripped through buildListEnvelope -> normalizeItem", () => {
  const env = buildListEnvelope({
    source: "github",
    query: "flaky",
    results: mapGhIssues(issues.items),
  });
  const first = env.results.find((r) => r.id === "42");
  assert.ok(first.text != null);
  assert.ok(!/</.test(first.text), "no HTML tags remain in text");
  assert.ok(first.text.includes("randomly fails"), "text content preserved");
});

// --- contract conformance (OUT-01) --------------------------------------

test("mapGhRepo results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "github",
    query: null,
    results: repos.items.map(mapGhRepo),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, repos.items.length);
});

test("mapGhIssues results build a list envelope that parses against the contract schema", () => {
  const env = buildListEnvelope({
    source: "github",
    query: "flaky tests",
    results: mapGhIssues(issues.items),
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, 2); // PR skipped
});

// --- mapGhIssueDetail (gh_get_item issue) -------------------------------

test("mapGhIssueDetail maps the issue onto the item and top-level comments onto comments[]", () => {
  const { item, comments } = mapGhIssueDetail(issueDetail, issueComments);
  assert.equal(item.id, String(issueDetail.number));
  assert.equal(item.type, "issue");
  assert.equal(item.num_comments, issueDetail.comments);
  assert.equal(comments.length, issueComments.length);
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const src = issueComments[i];
    assert.deepEqual(Object.keys(c).sort(), ["author", "id", "text"]);
    assert.equal(c.id, String(src.id));
    assert.equal(typeof c.id, "string");
    assert.equal(c.author, src.user.login);
  }
});

test("gh_get_item issue detail builds a DetailEnvelopeSchema-valid envelope with comments[] populated", () => {
  const env = buildDetailEnvelope({
    source: "github",
    ...mapGhIssueDetail(issueDetail, issueComments),
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
  assert.equal(env.item.comments.length, issueComments.length);
  for (const c of env.item.comments) {
    if (c.text != null) assert.ok(!/<[a-z]/i.test(c.text), "comment HTML stripped");
  }
});

test("a repo detail builds a DetailEnvelopeSchema-valid envelope with comments []", () => {
  const env = buildDetailEnvelope({
    source: "github",
    item: mapGhRepo(repoItem),
    comments: [],
  });
  assert.doesNotThrow(() => DetailEnvelopeSchema.parse(env));
  assert.deepEqual(env.item.comments, []);
});

// --- CR-01: not-found guard ----------------------------------------------

test("requireGhResource throws a clear not-found error for an absent resource", () => {
  assert.throws(
    () => requireGhResource(undefined, "issue", "octocat/awesome-lib#999"),
    /issue octocat\/awesome-lib#999 not found/,
  );
  assert.throws(() => requireGhResource(null, "repo", "a/b"), /not found/);
});

test("requireGhResource returns the resource unchanged when present (happy path)", () => {
  const r = { id: 1 };
  assert.equal(requireGhResource(r, "repo", "a/b"), r);
});

// --- WR-03: gh_get_item detail path rejects a PR number ------------------

test("requireGhIssueNotPr rejects a node carrying a pull_request key (WR-03)", () => {
  // GitHub's issues endpoint resolves PR numbers too; the list tool excludes
  // PRs (Pitfall 5) and the detail path must uphold the same invariant.
  assert.throws(
    () => requireGhIssueNotPr(prItem, "octocat/awesome-lib#43"),
    /octocat\/awesome-lib#43 is a pull request, not an issue/,
  );
});

test("requireGhIssueNotPr returns a genuine issue unchanged (happy path)", () => {
  assert.equal(requireGhIssueNotPr(issueWithReactions, "a/b#42"), issueWithReactions);
  // an issue detail node with no pull_request key passes through
  assert.equal(requireGhIssueNotPr(issueDetail, "a/b#42"), issueDetail);
});

// --- ghTrendingQualifiers: trending q-string builder (newOnly window) -----
// Deterministic via an injected `now` (seUrl/devtoTopUrl exported-pure-builder
// precedent). Default path MUST stay byte-identical to the historical inline
// construction (pushed:>cutoff); newOnly swaps the window to created:>cutoff so
// genuinely new repos surface instead of all-time star giants pushed daily.

const FIXED_NOW = Date.UTC(2026, 0, 15); // 2026-01-15T00:00:00Z

test("ghTrendingQualifiers default emits pushed:>cutoff (now - 7d for week) — frozen behavior", () => {
  const q = ghTrendingQualifiers({ since: "week", now: FIXED_NOW });
  assert.equal(q, "pushed:>2026-01-08");
  assert.ok(!q.includes("created:>"), "default never uses the creation window");
});

test("ghTrendingQualifiers newOnly swaps the window to created:>cutoff (same date)", () => {
  const q = ghTrendingQualifiers({ since: "week", newOnly: true, now: FIXED_NOW });
  assert.equal(q, "created:>2026-01-08");
  assert.ok(!q.includes("pushed:>"), "newOnly never uses the pushed window");
});

test("ghTrendingQualifiers preserves composition order: query, language, window (falsy dropped)", () => {
  const q = ghTrendingQualifiers({
    query: "rust cli",
    language: "Rust",
    since: "day",
    now: FIXED_NOW,
  });
  assert.equal(q, "rust cli language:Rust pushed:>2026-01-14");
});

test("gh_trending_repos inputSchema gained newOnly append-only (query/language/since/limit intact)", () => {
  const schema = server._registeredTools["gh_trending_repos"].inputSchema;
  const shape = schema?.shape ?? schema;
  for (const key of ["query", "language", "since", "limit", "newOnly"]) {
    assert.ok(key in shape, `inputSchema carries ${key}`);
  }
});

// --- registration smoke (FOUND-05) --------------------------------------

test("github server registers exactly gh_get_item, gh_search_issues, gh_trending_repos", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, [
    "gh_get_item",
    "gh_search_issues",
    "gh_trending_repos",
  ]);
});

test("each github tool declares an outputSchema (contract validation on return)", () => {
  for (const name of ["gh_trending_repos", "gh_search_issues", "gh_get_item"]) {
    assert.ok(
      server._registeredTools[name].outputSchema,
      `${name} has an outputSchema`,
    );
  }
});

// --- security invariants: no direct fetch, no process.env in the server --

test("servers/github/server.js never calls fetch directly and never reads process.env", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../servers/github/server.js", import.meta.url)),
    "utf8",
  );
  assert.ok(!/\bfetch\s*\(/.test(src), "no direct fetch( — all HTTP via getJson()");
  assert.ok(
    !/process\.env/.test(src),
    "no process.env — creds only via githubHeaders()",
  );
});
