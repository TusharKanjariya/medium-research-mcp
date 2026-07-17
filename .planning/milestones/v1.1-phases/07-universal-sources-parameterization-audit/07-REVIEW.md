---
phase: 07-universal-sources-parameterization-audit
reviewed: 2026-07-14T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - servers/discourse/server.js
  - servers/mastodon/server.js
  - servers/lemmy/server.js
  - shared/contract.js
  - test/parameterization-audit.test.js
  - test/discourse.test.js
  - test/mastodon.test.js
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-07-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 7 adds two keyless servers whose instance host is a caller-supplied tool
parameter (Discourse, Mastodon), parameterizes Lemmy's instance, appends
`topic`/`status` to the contract TYPE enum, and adds a SEC-02 parameterization
audit test. I reviewed against the seven load-bearing invariants in the phase
context, and cross-read `shared/http_client.js`, `shared/credentials.js`, and
`shared/auth.js` to confirm the guards the new servers depend on.

**The core security invariants hold.** Every user-host fetch in all three
servers rides `getJson(url, { untrustedHost: true })`, which routes through
`fetchTextManual → assertSafeUrl` (scheme allowlist, userinfo rejection,
IP-literal + DNS denylist covering 127.0.0.1 / 169.254.169.254 / RFC1918 / ULA /
IPv4-mapped-v6, and per-hop redirect re-validation) plus the HTML content-type
gate. I found no bare `getJson`/`fetch` on a user host and no path that
interpolates the instance into the authority. The Lemmy Bearer is correctly
host-gated: `resolveLemmyHeaders → authInstanceMatches` compares the effective
base host to the credentialed host and fails closed (anonymous) on mismatch or
malformed input, so a caller-chosen instance is never sent the env token. The
contract remains frozen (11 item fields unchanged; TYPE append-only with exactly
`topic`+`status`). Neither new server reads `process.env`. The SEC-02 audit is
non-vacuous — its negative controls plant a forbidden host and an embedded
`@handle` and prove both are flagged, the comment-stripper preserves `https://`
inside string literals, and the allowlist uses a boundary-safe `.endsWith`
suffix check that correctly rejects `evil-medium.com` / `medium.com.attacker.net`.

No blockers. The findings below are robustness and failure-UX defects. The most
notable is Discourse's `category` path segment, which is the one place a user
value is interpolated into a URL without `encodeURIComponent`.

## Warnings

### WR-01: Discourse `category` interpolated into the path without encoding or validation

**File:** `servers/discourse/server.js:220` and `servers/discourse/server.js:256-258`
**Issue:** `category` is a raw `z.string().optional()` tool parameter spliced
directly into the request path:
```js
const path = category ? `/c/${category}/l/latest.json` : `/latest.json`;
// and
const path = category
  ? `/c/${category}/l/top.json?period=${period}`
  : `/top.json?period=${period}`;
```
Unlike every other user value in the phase (Lemmy `id`/`query` via
`encodeURIComponent`/`URLSearchParams`, Mastodon `tag` via `encodeURIComponent`,
Discourse `id` via `encodeURIComponent`), `category` is neither encoded nor
validated. This does **not** enable SSRF — the authority is already fixed by
`base`, so `category` cannot alter the host, and the caller already controls
`instance` anyway. But it is a real request-integrity defect within the host:
a `category` containing `?` folds the intended `/l/latest.json` suffix into a
query string (changing the endpoint), a `#` truncates the path with a fragment,
and `../` traverses the path. The intended format is the `"slug/id"` token
(e.g. `support/6`), so the `/` genuinely must survive — meaning a blanket
`encodeURIComponent` is wrong here.
**Fix:** Validate the token shape at the schema or handler boundary rather than
trusting it, e.g. reject anything that is not `<slug>/<digits>`:
```js
category: z.string().regex(/^[a-z0-9-]+\/\d+$/i, "category must be \"slug/id\"").optional(),
```
This keeps the legitimate `slug/id` form working while rejecting `?`, `#`,
`../`, and stray `//` before they reach the URL.

### WR-02: Mastodon handlers assume a JSON array — a non-array 200 body throws a raw `TypeError`

**File:** `servers/mastodon/server.js:252`, `:290`, `:316-320`, `:343-347` (and `fetchTrends` at `:199`)
**Issue:** Every Mastodon handler does `(arr ?? []).map(mapMastodon…)`, and
`fetchTrends` returns `(await getJson(...)) ?? []`. `getJson` returns whatever
JSON the upstream sent. If an instance answers `200 application/json` with an
**object** instead of an array (e.g. `{"error":"..."}` returned with a 200, or a
proxy/interstitial that emits a JSON object), `arr` is an object, `??` does not
replace it, and `.map` throws `TypeError: arr.map is not a function`. In the
timeline/hashtag handlers this TypeError falls into `catch (err) { throw
mapMastodonError(err, base); }`, but its message matches neither `HTTP 401` nor
`HTTP 422`, so it is re-thrown verbatim — a confusing crash rather than a clear
tool-level error. In the trends handlers there is no catch at all, so it
propagates raw. This contradicts the "a tool call never hard-errors" resilience
rule for a case the codebase otherwise defends everywhere.
**Fix:** Coerce to an array once, at the fetch boundary:
```js
const arr = await getJson(url, { untrustedHost: true });
const items = Array.isArray(arr) ? arr : [];
// …results: items.map(mapMastodonStatus)
```
and in `fetchTrends`, `return Array.isArray(data) ? data : [];`.

### WR-03: Lemmy Bearer token is forwarded across cross-origin redirects

**File:** `servers/lemmy/server.js:230-234`, `:300-308` (mechanism in `shared/http_client.js` `fetchTextManual`)
**Issue:** When the effective instance host matches the credentialed host,
`resolveLemmyHeaders` attaches `Authorization: Bearer <jwt>` and the request is
issued via `getJson({ headers, untrustedHost: true })`. `fetchTextManual`
follows redirects manually and re-validates each hop's host against the SSRF
denylist, but it re-sends the **same `init` (including the `Authorization`
header) to every hop**, cross-origin ones included — it never strips auth on an
origin change. So if the operator's configured Lemmy instance issues a 3xx to a
different (public, non-internal) host, the env JWT is delivered to that host.
Exploitability is bounded (it only triggers for the operator's own trusted
instance, and HTTPS prevents an on-path attacker from injecting the redirect),
and Phase 7 did not regress it — the Bearer only attaches for the same trusted
host it always did. But it is a genuine credential-forwarding-on-redirect gap:
Discourse/Mastodon are unaffected because they send no auth header.
**Fix:** In `fetchTextManual`, drop `Authorization` (and any other sensitive
header) from `init.headers` when the redirect target's origin differs from the
current origin, mirroring browser fetch semantics.

## Info

### IN-01: Mastodon `score` reports 0 (not null) when both counts are missing

**File:** `servers/mastodon/server.js:116`
**Issue:** `score: (s.favourites_count ?? 0) + (s.reblogs_count ?? 0)` yields `0`
for a status that carries neither count, conflating "unknown engagement" with
"zero engagement." The contract permits `number | null`, and the phase guidance
prefers `null` over a synthesized `0`. This is a documented, tested choice (the
sum semantics make `0` defensible), so it is informational, not a bug.
**Fix:** If genuine-unknown vs zero matters downstream, emit `null` when both
raw counts are absent; otherwise leave as-is and keep the intent documented.

### IN-02: Mastodon trends endpoints skip `mapMastodonError`, surfacing raw errors on an auth-gated trends API

**File:** `servers/mastodon/server.js:314-323`, `:341-350`
**Issue:** `fetchTrends` only maps `HTTP 404` → `[]`; the trends handlers do not
wrap the call in `mapMastodonError`. An instance that gates trends behind auth
(returning 401/422 rather than 404/empty) therefore surfaces the raw
`getJson: HTTP 401 …` string instead of the friendly "disallows anonymous reads"
message the timeline handlers produce. Not a crash or contract violation — just
inconsistent failure UX for a case the spec treats as unlikely.
**Fix:** Apply `mapMastodonError` in the trends handlers too (after the 404→empty
branch), so 401/422 there gets the same clear message.

### IN-03: Mastodon tag mapping does not guard a missing/null tag name

**File:** `servers/mastodon/server.js:121`
**Issue:** `tags: (s.tags ?? []).map((t) => t.name)` assumes every tag entry is a
non-null object with a `name`. A `null` entry throws, and an entry missing
`name` yields `undefined` inside a `string[]`, which then fails the contract's
`z.array(z.string())` validation on return (the SDK validates
`structuredContent` against the output schema). Real Mastodon payloads always
include `name`, so probability is low, but the mapping is less defensive than
its siblings (`mapTrendingTag`/`mapTrendingLink`, which `String()`-guard).
**Fix:** `tags: (s.tags ?? []).map((t) => t?.name).filter((n) => typeof n === "string")`.

---

_Reviewed: 2026-07-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
