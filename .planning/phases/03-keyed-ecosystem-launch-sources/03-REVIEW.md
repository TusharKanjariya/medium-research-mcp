---
phase: 03-keyed-ecosystem-launch-sources
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - servers/github/server.js
  - servers/librariesio/server.js
  - servers/producthunt/server.js
  - shared/contract.js
  - test/github.test.js
  - test/libraries.test.js
  - test/producthunt.test.js
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the three new keyed/ecosystem source servers (GitHub SRC-06, Libraries.io
SRC-07, Product Hunt SRC-08), the shared output contract, and their offline test
suites. The project-specific invariants called out in the review brief all hold on
inspection:

- **Output contract** — every handler routes through `buildListEnvelope` /
  `buildDetailEnvelope` / `toolResult`; the item schema fields are never renamed or
  dropped; the three new `type` values (`issue`, `package`, `launch`) are appended to
  `TYPE` (contract.js:38-40), not reordered.
- **HTTP path** — all outbound calls go through `getJson()`/`postJson()`; no direct
  `fetch(` in any server (grep-verified by the tests themselves).
- **No `process.env`** outside `shared/credentials.js` — servers use
  `githubHeaders()` / `librariesIoParams()` / `productHuntHeaders()`.
- **Secret never in cache key** — `libUrl` builds a secret-free `cacheKey` from
  `publicQs` (no `api_key`) and both callers explicitly pass `{ cacheKey }`
  (librariesio/server.js:169,198). GitHub PAT and PH token ride only in the
  `Authorization` header.
- **SSRF** — every outbound host is a fixed module constant; tool input fills only q
  qualifiers, GraphQL variables, or `encodeURIComponent`'d path segments.
- **GraphQL 200-with-errors** — `requirePhOk(raw)` is called after every `postJson`
  before reading `raw.data`.

No Critical/BLOCKER defects were provable. The findings below are robustness,
consistency, and correctness-edge issues that should be addressed before this ships.

## Warnings

### WR-01: Product Hunt mappers dereference `edge.node` without null-safety, unlike the rest of the suite

**File:** `servers/producthunt/server.js:96-105` (`mapPhDetail`) and `:199-204` (list handler)
**Issue:** The list handler does `edges.map((e) => mapPhPost(e.node))` and `mapPhPost`
reads `node.id`, `node.name`, `node.votesCount`, etc. directly (no `node?.`). The detail
mapper does `post.comments?.edges ?? []).map((e) => ({ id: String(e.node.id), author: phAuthor(e.node.user) ...}))`
— `e.node` is dereferenced with no guard. This is inconsistent with the deliberately
defensive style used everywhere else in the same file (`node.topics?.edges ?? []`,
`e?.node?.slug`) and in the GitHub server (`mapGhIssues` filters/guards, `labelNames`
null-coalesces). A single `null` edge or `null` node in a Product Hunt GraphQL response
throws an uncaught `TypeError` and fails the whole tool call instead of degrading — the
opposite of the resilience posture (`shared/http_client.js` never hard-errors on a blip).
**Fix:**
```js
// list handler
results: edges.filter((e) => e?.node).map((e) => mapPhPost(e.node)),

// mapPhDetail comments
comments: (post.comments?.edges ?? [])
  .filter((e) => e?.node)
  .map((e) => ({
    id: String(e.node.id),
    author: phAuthor(e.node.user),
    text: e.node.body ?? null,
  })),
```

### WR-02: `??` on URL/permalink fields silently preserves blank strings — asymmetric with `mapGhRepo`'s `||`

**File:** `servers/librariesio/server.js:74-75` (`mapLibProject`), `servers/producthunt/server.js:82` (`mapPhPost`)
**Issue:** `mapGhRepo` intentionally uses `||` for its external URL so a blank homepage
(`""`) falls back to `html_url` (github/server.js:87, with a dedicated regression test at
github.test.js:77-81). But `mapLibProject` uses `??`:
`url: p.package_manager_url ?? p.repository_url ?? p.homepage ?? null` and
`permalink: p.package_manager_url ?? null`. `??` only short-circuits on `null`/`undefined`,
so an empty-string `package_manager_url` (`""` — which registry APIs do emit) yields
`url === ""` / `permalink === ""` instead of falling back. `mapPhPost` has the same shape
with `url: node.website ?? null` (blank `website` → `""`). `""` still passes the
`z.string().nullable()` schema, so it fails silently: the consuming `medium-blog-pro`
skill gets an empty citation URL rather than the intended fallback (or `null`). This is a
latent contract-quality bug, not caught by the fixture tests (which only exercise
`undefined`, e.g. libraries.test.js:74-82).
**Fix:** Use `||` for the human-facing URL fields where a blank string must fall back:
```js
// mapLibProject
url: p.package_manager_url || p.repository_url || p.homepage || null,
permalink: p.package_manager_url || null,
// mapPhPost
url: node.website || null,
```
(Keep `??` for `score`/`num_comments`, where a legitimate `0` must be preserved.)

### WR-03: `gh_get_item` issue path does not filter pull requests, so a PR number is returned typed `"issue"`

**File:** `servers/github/server.js:291-302`
**Issue:** The list tool `gh_search_issues` drops PRs twice (the `is:issue` qualifier plus
`mapGhIssues` filtering any item with a `pull_request` key — Pitfall 5). The detail tool
takes an explicit `{ owner, repo, number }` and calls
`GET /repos/{o}/{r}/issues/{number}`. GitHub's issues endpoint also resolves pull-request
numbers, returning a node that carries a `pull_request` key. `mapGhIssueDetail` →
`mapGhIssue` unconditionally stamps `type: "issue"`, so requesting a PR number yields a
contract item mislabeled as an issue (wrong `type`, and `num_comments` counts issue
comments only, excluding review comments). The list tool's own invariant ("Pull requests
are excluded") is not upheld on the detail path.
**Fix:** Detect the `pull_request` key on the fetched node and surface a clear error (or
map it honestly), e.g.:
```js
const issue = await getJson(base, { headers: ghHeaders() });
requireGhResource(issue, "issue", `${owner}/${repo}#${number}`);
if (issue.pull_request) {
  throw new Error(`github: ${owner}/${repo}#${number} is a pull request, not an issue`);
}
```

## Info

### IN-01: Detail comment lists are silently truncated; `num_comments` can exceed `comments.length`

**File:** `servers/github/server.js:297-300`, `servers/producthunt/server.js:225`
**Issue:** GitHub's `/issues/{n}/comments` returns the first page only (default 30) and
the PH detail query requests `comments(first: 20)`, while `num_comments` reflects the full
upstream count. A consumer comparing `num_comments` to `comments.length` sees a mismatch
with no signal that the list was capped. This matches the HN precedent (top-level comments
only), so it is acceptable, but the truncation is undocumented in the output.
**Fix:** Note the cap in each tool `description`, or expose the page size, so downstream
callers know `comments[]` is a bounded sample rather than the complete thread.

### IN-02: Product Hunt GraphQL field/argument names ship unverified against the live schema

**File:** `servers/producthunt/server.js:186-192` (`posts(order: VOTES, postedAfter: $after, topic: $topic, first: $n)`)
**Issue:** The inline comment concedes these arg names are cited-but-unconfirmed
("confirm against the live PH GraphQL explorer, see SUMMARY"). If any of `order: VOTES`,
`postedAfter`, or the `topic` argument on `posts` is wrong, every call returns a GraphQL
error — which `requirePhOk` now surfaces loudly rather than masking, so the failure mode
is at least clean. Flagging so the deferred live-smoke verification is not lost.
**Fix:** Run the one live smoke against the PH GraphQL explorer and pin the confirmed field
set; remove the "confirm against live" hedge once verified.

### IN-03: Second-fetch failure aborts an otherwise-successful GitHub issue detail

**File:** `servers/github/server.js:295-301`
**Issue:** The issue node is fetched successfully, then a second `getJson` fetches
comments. A transient failure on the comments call (after stale fallback is exhausted)
throws and discards the already-retrieved issue, so the tool returns nothing even though
the primary resource was available.
**Fix:** Optionally wrap the comments fetch so a comments-only failure degrades to
`comments: []` rather than failing the whole detail call:
```js
let rawComments = [];
try { rawComments = await getJson(`${base}/comments`, { headers: ghHeaders() }); }
catch { /* comments are best-effort; issue detail still returns */ }
```

---

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
