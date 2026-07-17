# Phase 6: Author-Blog Awareness - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 5 (2 source-modified, 1 shared-modified, 1 test-modified/new, 1 doc-new)
**Analogs found:** 4 / 5 (the doc file has no `docs/` analog)

This phase EXTENDS `servers/rss` — every new tool reuses the shipped
`getText → parseFeed → normalizeFeed → slice → buildListEnvelope → toolResult`
pipeline. No new runtime deps, no new server, no contract change. The only shared
touch is a Medium-403 error mapping (+ optional UA version bump).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `servers/rss/server.js` (add 3 `registerTool` blocks + update SINGLE-TOOL note) | server / route | request-response (feed fetch → normalize) | existing `rss_fetch` block in the SAME file (lines 220-258) | exact |
| ↳ `rss_substack_archive` handler (guarded JSON + RSS fallback) | route | request-response + graceful degrade | `servers/lemmy/server.js` `getJson(..., { untrustedHost: true })` (lines 149-168) | exact (untrustedHost path) |
| `shared/http_client.js` (Medium-403 → clear tool error mapping) | shared utility | error-mapping on existing fetch loop | existing 4xx terminal branch in `getText` (lines 566-570) | role-match (same file, new branch) |
| `shared/credentials.js` (optional `1.0 → 1.1` UA bump) | config | constant edit | `userAgent()` (lines 79-81) | exact (one-line string) |
| `test/rss.test.js` (add author/tag/archive + fallback + SSRF-reject cases) | test | fixture-driven offline | existing `test/rss.test.js` + `servers/lemmy` untrustedHost tests | exact |
| `docs/AUTHOR-BLOG-RECIPES.md` | doc | n/a (prose) | none (no `docs/` recipe analog exists) | no analog |

## Pattern Assignments

### `servers/rss/server.js` — three new `registerTool` blocks (server, request-response)

**Analog:** the existing `rss_fetch` registration in the SAME file, lines 220-258.

**Core registerTool + handler skeleton to copy** (lines 220-258):
```javascript
server.registerTool(
  "rss_fetch",
  {
    title: "Fetch any RSS 2.0 / Atom 1.0 feed",
    description: "…RECIPE — … blocks …",
    inputSchema: {
      url: z.string().url(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ url, limit = DEFAULT_LIMIT }) => {
    const xml = await getText(url);
    const results = normalizeFeed(parseFeed(xml), url).slice(0, limit);
    const env = buildListEnvelope({ source: SOURCE, query: url, results });
    return toolResult(env);
  },
);
```

**Reusable normalizers already exported in this file (call, do not rewrite):**
- `parseFeed(xml)` (line 71) — XML → JS object
- `normalizeFeed(parsed, feedUrl)` (line 199) — dialect detect + per-entry map; throws a clear "not a valid RSS/Atom feed" error on a non-feed HTML 200 (this is the Medium block-page catch point)
- `mapRssItem` (line 134) / `mapAtomEntry` (line 167) — field maps; `score`/`num_comments` currently hard-null (lines 147-148, 181-182)
- `textOf` (line 79) — WR-01 CDATA/object-collapse for `content:encoded`/`dc:creator`; Medium/Substack CDATA bodies ride it unchanged
- `pickAlternate` (line 119) — Atom alternate link
- `rssTags` (line 88) / `atomTags` (line 97) — tag arrays (the append point for the `preview-only` marker, D-06)

**Per-tool notes for the three new blocks:**

- **`rss_author_posts(author, query?, published_before?)`** (D-01/02/03/04): resolve the `author` string to a feed URL via a new inference helper (`@…` → `https://medium.com/feed/@<user>`; `…substack.com` → `https://<pub>.substack.com/feed`; other `http(s)://` → raw; bare token → throw a clear tool-level error). Then the SAME `getText → parseFeed → normalizeFeed` chain, then apply `query`/`published_before` as post-fetch `.filter()` over `created_utc`/title before `buildListEnvelope`. `inputSchema`: `{ author: z.string(), query: z.string().optional(), published_before: z.string().optional() }`.
- **`rss_tag_posts(tag)`** (D-11, Medium-only): feed URL `https://medium.com/feed/tag/<tag>` (encode the tag segment). Identical chain. `inputSchema: { tag: z.string() }`.
- **`rss_substack_archive(publication)`** (D-08/09/10): see the untrustedHost sub-pattern below.

**Also update** the `SINGLE-TOOL DESIGN (deliberate)` note (lines 10-14 header comment + lines 230-233 in the `rss_fetch` description) so it no longer claims the server exposes only `rss_fetch` (D-01).

**Preview-only marker (D-06/D-07):** after mapping, append the literal string `"preview-only"` to `item.tags` when truncation is detected (Substack text ending in a "Read more" marker; Medium member-only/abstract-only). `tags` is an existing contract field (`itemShape.tags`, contract.js line 55) — no schema change.

---

### `rss_substack_archive` handler — guarded JSON with RSS fallback (route, request-response + graceful degrade)

**Analog:** `servers/lemmy/server.js` lines 149-168 (the `untrustedHost: true` guarded-JSON call).

**Guarded-JSON call pattern to copy** (lemmy lines 157-160):
```javascript
const raw = await getJson(`${base}/api/v3/post/list?${qs}`, {
  headers,
  untrustedHost: true, // SEC-01: instance host rides the shared SSRF guard
});
```

**For the archive:** `getJson(\`https://<pub>.substack.com/api/v1/archive\`, { untrustedHost: true })`. The publication host is user-supplied tool input → `untrustedHost: true` is mandatory (D-08). The content-type gate inside `getJson` (http_client.js lines 327-335) turns a Substack login-HTML-200 into a terminal error instead of a `JSON.parse` crash.

**Graceful degrade (D-10) — the expected path, test first-class:** wrap the `getJson` archive call in try/catch; on ANY throw, fall back to `getText(\`https://<pub>.substack.com/feed\`)` → `parseFeed` → `normalizeFeed` and return THAT envelope. Never hard-error.

**Enrichment (D-09):** map archive JSON reactions → `score` and comment count → `num_comments` (both `null` on the RSS path). Exact archive JSON key names are the planner's to confirm against a live probe (CONTEXT "Claude's Discretion"); the contract mapping (reactions→`score`, comments→`num_comments`) is locked. `inputSchema: { publication: z.string() }`.

**`getJson` signature reference** (http_client.js line 289): `getJson(url, { headers, ttlMs, timeoutMs, cacheKey, untrustedHost, lookup })` — `lookup` is injectable for the offline SSRF-reject test.

---

### `shared/http_client.js` — Medium-403 → clear tool-level error (shared utility, error-mapping)

**Analog:** the existing 4xx terminal branch in `getText`, lines 566-570:
```javascript
// Any 4xx (incl. 429/408) or other non-retryable status: do NOT retry, and
// do NOT serve stale — this is a definitive client-error terminal state.
lastError = new Error(`getText: HTTP ${status} from ${redactUrl(url)}`);
transientFailure = false;
break;
```

**Change (D-14):** when `status === 403` (and the host is a Medium host), set `lastError` to a clearer message — e.g. `"Medium is blocking automated fetches from this network; the feed may still work from another network"` — while keeping the STRICT no-4xx-retry policy (do NOT add a retry loop around the browser UA; lines 566-570 already fall through to terminal). The identified UA is already merged at line 537 (`mergedHeaders = { "User-Agent": userAgent(), ...headers }`) — no UA change needed here.

**Constraint:** keep `redactUrl` on any error text (no query-string leak) and do NOT touch the `RETRYABLE_5XX` / transient-failure gating.

---

### `shared/credentials.js` — optional UA version bump (config)

**Analog / exact edit site:** `userAgent()`, lines 79-81:
```javascript
export const userAgent = () =>
  get("userAgent") ||
  "medium-research-mcp/1.0 (+https://github.com/TusharRedlioDesigns/medium-research-mcp)";
```
Optional `1.0 → 1.1` bump (D-14). One-line string change; no logic.

---

### `test/rss.test.js` — new offline cases (test, fixture-driven)

**Analog:** the existing `test/rss.test.js` structure (fully offline, fixture-pinned) + the `servers/lemmy` untrustedHost/`lookup`-injection tests.

**Fixture-loading + parse pattern to copy** (rss.test.js lines 35-48):
```javascript
const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}.xml`, import.meta.url)), "utf8");
const rss2Parsed = parseFeed(fixture("rss-rss2"));
```

**Field-map assertion style to copy** (lines 52-66): assert `type`, string `id`, `author`, `url`/`permalink`, `created_utc` ISO, `tags` array, `score`/`num_comments` null.

**New cases to add** (from CONTEXT `<code_context>` Integration Points):
- Platform-inference table (D-03) incl. the ambiguous-bare-token reject
- Paywalled-Substack fixture: trailing "Read more" → `preview-only` in `tags[]`
- Medium member-only abstract fixture → `preview-only`
- Substack archive JSON success fixture → `score`/`num_comments` filled
- Archive-failure → RSS-window fallback fixture (D-10, the expected path)
- SSRF-reject on the archive host (`127.0.0.1` / `169.254.169.254`) via injected `lookup` (mirror the `assertSafeUrl` test seam)
- Registration smoke: now `["rss_fetch", "rss_author_posts", "rss_tag_posts", "rss_substack_archive"]`, each with an `outputSchema` (update the existing line-18 "exactly `['rss_fetch']`" assertion)

**New fixtures:** add `test/fixtures/` entries (Substack feed w/ paywall, Medium author feed, Medium member-only, Medium tag feed, Substack archive JSON success + a login-HTML/failure body). Existing fixtures live at `test/fixtures/rss-*.xml`.

---

## Shared Patterns

### Single fetch chokepoint
**Source:** `shared/http_client.js` — `getText` (line 522), `getJson` (line 289)
**Apply to:** every new tool. Author/tag feeds use `getText` (fixed shapes, UA already merged). Archive uses `getJson(url, { untrustedHost: true })`. NEVER call `fetch` directly (CLAUDE.md).

### Frozen output contract
**Source:** `shared/contract.js` — `itemShape` (line 45), `buildListEnvelope` (line 137), `toolResult` (line 160)
**Apply to:** every new tool. Map fields → `buildListEnvelope({ source: SOURCE, query, results })` → `toolResult(env)`. New writer signals ride EXISTING fields: reactions→`score`, comments→`num_comments`, preview state→`tags` (append `"preview-only"`). Zero schema change; do not rename/drop `score`/`num_comments`. `SOURCE = "rss"` (server.js line 44). Item `type` stays `"article"` (already in the append-only `TYPE` enum).

### Untrusted-host SSRF guard + content-type gate
**Source:** `shared/http_client.js` `assertSafeUrl` (line 173) + content-type gate (lines 327-335), reached via `untrustedHost: true`
**Apply to:** `rss_substack_archive` only (user-supplied publication host). Fixed Medium/Substack feed hosts on `getText` already ride `fetchTextManual → assertSafeUrl` unconditionally.

### RECIPE-block description style
**Source:** `rss_fetch` description, server.js lines 234-245 (`RECIPE — …` blocks)
**Apply to:** the three new tool descriptions (D-12 in-description recipe pointers + D-05 honest-window caveats: "Medium ~10, Substack ~20, paywalled text is teaser-quality"). The fuller worked recipes go in `docs/AUTHOR-BLOG-RECIPES.md`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `docs/AUTHOR-BLOG-RECIPES.md` | doc | prose | No existing `docs/` recipe file; `docs/` holds ARCHITECTURE.md, PRD.md, ROADMAP.md, server-spec-template.md only. Model the recipe TONE on the in-code `RECIPE —` blocks (server.js lines 234-245). Lead with the D-13 honesty caveat ("reflects only the ~10 most recent Medium / ~20 Substack posts, not lifetime cadence"). |

## Metadata

**Analog search scope:** `servers/rss`, `servers/lemmy`, `shared/`, `test/`, `docs/`
**Files scanned:** 6 (rss/server.js, lemmy/server.js, shared/contract.js, shared/http_client.js, shared/credentials.js, test/rss.test.js) + fixture/doc listings
**Pattern extraction date:** 2026-07-14
</content>
</invoke>
