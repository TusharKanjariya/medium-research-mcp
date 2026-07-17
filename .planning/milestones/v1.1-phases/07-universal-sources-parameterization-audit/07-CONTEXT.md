# Phase 7: Universal Sources & Parameterization Audit - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Two new keyless sources plus a suite-wide parameterization guarantee:

1. **Discourse server (SRC-10)** — research any public Discourse forum by instance
   URL parameter: latest topics, top-by-period, topic detail, in the normalized contract.
2. **Mastodon server (SRC-11 + SRC-13)** — any Mastodon instance keylessly: public and
   hashtag timelines (instance + hashtag as parameters), plus trending tags and links.
3. **Parameterization audit (SEC-02)** — no hardcoded accounts/instances/feeds anywhere
   in the suite; Lemmy's instance becomes a tool parameter with env as an optional default only.

Both new servers are **hn-template copies over the Phase 5 guarded JSON path**
(`getJson(url,{untrustedHost:true})`) — the instance host is untrusted tool input, exactly
the threat SEC-01 was built for. No new runtime dependencies.

**In scope:** SRC-10, SRC-11, SRC-13, SEC-02 (5 ROADMAP success criteria).

**Not in this phase:** `.mcpb`/npm packaging (Phase 8, strictly last). Discourse full-text
search, deep pagination, and any authenticated (tokened) reads are out of scope (see Deferred).

**Depends on:** Phase 5 (SEC-01 guarded JSON path + content-type gate) — already shipped.

</domain>

<decisions>
## Implementation Decisions

### Discourse server (SRC-10)
- **D-01:** **Three tools, exactly the SRC-10 surface:**
  - `discourse_latest(instance, category?)`
  - `discourse_top(instance, period, category?)`
  - `discourse_topic(instance, id)`
  No `discourse_search` in v1.1 (deferred). `category` is an optional filter on
  latest/top.
- **D-02:** Endpoints: `/latest.json`, `/top.json?period=<p>`, `/t/<id>.json`; when
  `category` is supplied use the category route (e.g. `/c/<slug>/l/latest.json` /
  `/c/<slug>/l/top.json` — planner confirms exact shape against a live instance).
- **D-03:** **Single-page fetch + `limit` truncation — NO deep `more_topics_url`
  pagination** in v1.1 (research Pitfall 4; keeps scope tight and avoids per-version
  pagination variance). Document "most recent page only" in tool descriptions.
- **D-04:** `period` is a zod enum (`daily|weekly|monthly|quarterly|yearly|all`).
- **D-05:** Discourse topics map to **`type: "topic"`** (append to the `TYPE` enum).

### Mastodon server (SRC-11, SRC-13)
- **D-06:** **Four single-responsibility tools:**
  - `mastodon_public(instance, limit?)`
  - `mastodon_hashtag(instance, tag, limit?)`
  - `mastodon_trending_tags(instance)`
  - `mastodon_trending_links(instance)`
- **D-07:** Endpoints: `/api/v1/timelines/public`, `/api/v1/timelines/tag/:tag`,
  `/api/v1/trends/tags`, `/api/v1/trends/links`.
- **D-08:** **Clamp `limit` at 40 in zod** (`z.number().int().min(1).max(40)`) — Mastodon
  silently clamps server-side, and an unclamped request would make the envelope `count`
  mismatch the results (Pitfall 5). Reject >40 early with a readable message.
- **D-09:** Timeline statuses map to **`type: "status"`** (append to `TYPE`).
  Trending **links** are news cards → `type: "article"`; trending **tags** →
  `type: "topic"` (reuse the Discourse-added type), `title` = the `#name`.
- **D-10 (SRC-13):** A trends-disabled instance returns an **empty list envelope
  (`count: 0`), NEVER an error** (AC3). A 404 / empty / disabled trends endpoint maps
  to empty results, not a thrown tool error.

### Per-instance failure UX (AC4)
- **D-11:** **Locked-down instances yield a clear tool-level error, never a crash or
  contract violation.** Login-required Discourse (403, or an HTML-200 login page caught
  by the Phase 5 content-type gate) → "this Discourse instance requires login; only
  public instances are supported." Locked-down Mastodon (401/422 under
  `AUTHORIZED_FETCH` / disabled public preview) → "instance X disallows anonymous reads —
  try another instance (this tool is keyless)." Name the instance and the reason.
- **D-12:** Document **federation sparsity** in the `mastodon_hashtag` description
  ("results reflect what the chosen instance federates; larger instances see more") so
  sparse results aren't read as a bug.

### Instance parameterization + Lemmy (SEC-02)
- **D-13:** New servers take an **explicit instance base URL parameter** (e.g.
  `https://meta.discourse.org`). Scheme optional → default `https`; otherwise treated as a
  URL. This is NOT a smart/bare-name field — no host guessing beyond defaulting the scheme.
- **D-14:** Both new servers fetch via **`getJson(url, { untrustedHost: true })`** — the
  instance host is untrusted tool input; reuse the Phase 5 SSRF guard + content-type gate.
  They are hn-template copies but on the **guarded** path (the fixed-host HN template calls
  plain `getJson`; these MUST pass the flag).
- **D-15 (SECURITY — do not miss):** Lemmy's instance becomes an **optional tool parameter
  that overrides the `LEMMY_INSTANCE` env default.** TODAY Lemmy's host comes only from
  `lemmyInstance()` (operator-set env, explicitly documented as the SSRF mitigation at
  `servers/lemmy/server.js:121`) and its `getJson` call is **NOT** on the guarded path.
  Turning the instance into per-call user input **changes the threat model** — so Lemmy's
  `getJson` calls MUST switch to `untrustedHost: true`. Keep `LEMMY_INSTANCE` as the
  optional default via `lemmyInstance()`; a tool-param `instance` wins when provided.
- **D-16 (SEC-02 audit deliverable):** A committed **`test/parameterization-audit.test.js`**
  scans `servers/*/server.js` (and the `servers/rss` `resolve*` helpers) for `http(s)://`
  host literals and `@handle` literals, and **fails on any that is not an allowlisted fixed
  platform API/feed base.** Allowlist = the platform bases already in the suite
  (`hn.algolia.com`, `news.ycombinator.com`, `api.stackexchange.com`, `dev.to`,
  `medium.com`, `*.substack.com`, `lobste.rs`, `libraries.io`, `api.producthunt.com`,
  `api.github.com`, `www.youtube.com`, `www.reddit.com`) **plus Lemmy's `programming.dev`
  env-overridable default.** FORBIDDEN = any hardcoded user **account** (`@handle`),
  specific community **instance** (a particular Discourse/Mastodon/Lemmy forum other than
  the env default), or named-blog **feed URL**. The distinguishing rule the test encodes:
  *a fixed platform host is allowed; a user-specific target must be a tool parameter.*

### Claude's Discretion
- Exact `score` / `num_comments` **source fields** (confirm against live instances in
  research; the contract mapping *intent* is locked, the field names are not):
  Discourse topic → `score` from an engagement field (`like_count` or `views`),
  `num_comments` from `reply_count` (or `posts_count - 1`). Mastodon status → `score` from
  `favourites_count` (± `reblogs_count`), `num_comments` from `replies_count`. Trending
  tag → `score` from summed recent-days usage.
- Discourse category route shape (`/c/<slug>.json` vs `/c/<slug>/l/<latest|top>.json`).
- The precise allowlist representation/regex in `parameterization-audit.test.js`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research (already covers this phase — read first)
- `.planning/research/SUMMARY.md` §"Phase 3: New servers + parameterization sweep" — the
  hn-template-over-guarded-path approach, Lemmy parameterization, TYPE-enum append
- `.planning/research/PITFALLS.md` §Pitfall 3 — SSRF gap on user-supplied instance URLs
  (why D-14/D-15 exist)
- `.planning/research/PITFALLS.md` §Pitfall 4 — Discourse per-instance variance
  (login_required, operator rate limits, `more_topics_url` pagination, content-type check → D-02/D-03/D-11)
- `.planning/research/PITFALLS.md` §Pitfall 5 — Mastodon anonymous-access assumption,
  `limit` clamp at 40, federation sparsity (D-08/D-11/D-12)
- `.planning/research/PITFALLS.md` §"Looks Done But Isn't" + §"Integration Gotchas"
  (Discourse/Mastodon rows) — the multi-instance smoke checklist

### The guarded path + contract (code being extended)
- `.planning/phases/05-guarded-json-path-trending-signals/05-CONTEXT.md` §D-01..D-05 —
  `getJson({untrustedHost:true})`, the `assertSafeUrl` denylist, per-hop redirect
  re-validation, and the D-03 content-type gate (login-HTML-200 → clear error)
- `shared/http_client.js` — `getJson` `untrustedHost` option + content-type gate
- `shared/contract.js` — `TYPE` enum (APPEND `"topic"`, `"status"`; line 28); frozen item
  schema; `buildListEnvelope` / `normalizeItem` / `toolResult`

### Template + parameterization targets
- `servers/hn/server.js` — the copy template (registerTool shape, normalize helpers)
- `servers/lemmy/server.js` — the parameterization target; note the CURRENT env-only host
  (`lemmyInstance()`, line 121 "SSRF mitigation") and its plain `getJson` (D-15 switches it)
- `shared/credentials.js` — `lemmyInstance()` / `LEMMY_INSTANCE` `ENV_VAR` (optional-default pattern)

### Requirements / roadmap
- `.planning/REQUIREMENTS.md` — SRC-10, SRC-11, SRC-13, SEC-02 (verbatim ACs)
- `.planning/ROADMAP.md` §"Phase 7" — goal + 5 success criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`servers/hn/server.js`** — the server template: `registerTool` shape, `normalize*`
  helpers, envelope assembly. Both new servers are copies of this over the guarded path.
- **`getJson(url, { untrustedHost: true })` (`shared/http_client.js`)** — the Phase 5
  guarded path with `assertSafeUrl` + redirect re-validation + content-type gate; every
  Discourse/Mastodon call and the reparameterized Lemmy calls ride it.
- **`buildListEnvelope` / `normalizeItem` / `toolResult` (`shared/contract.js`)** — no
  envelope hand-rolling; `TYPE` append-only (`topic`, `status`).
- **`lemmyInstance()` (`shared/credentials.js`)** — the optional-env-default accessor; the
  Lemmy tool-param `instance` overrides it (D-15).

### Established Patterns
- **Fixed hosts are module constants; only untrusted input selects a host** — HN/SE/Dev.to
  keep plain `getJson`; Discourse/Mastodon/(now) Lemmy pass `untrustedHost:true` because the
  host is a tool parameter. This is exactly the SEC-02 line the audit test enforces.
- **`TYPE` enum is append-only; `score`/`num_comments` never renamed** — new sources ride
  existing fields; two new type values only.
- **Single fetch chokepoint** — all HTTP via `shared/http_client.js`; never `fetch()`.
- **Per-instance failure → clear tool-level error, never a crash** (D-11) — mirrors the RSS
  guard's disposition (a rejected/guarded response is a plain thrown Error, not a fake envelope).

### Integration Points
- `servers/lemmy/server.js` — add an `instance?` param and **switch its `getJson` to
  `untrustedHost:true`** (the one behavioral security change in an existing server; D-15).
- `shared/contract.js` — append `"topic"` and `"status"` to `TYPE` (one-line, append-only).
- `test/parameterization-audit.test.js` — NEW enforcement test (D-16); scans server sources.
- Two new server dirs `servers/discourse/`, `servers/mastodon/` (+ `manifest.json` scaffold
  each, mirroring `servers/hn/` per CLAUDE.md step 6).

</code_context>

<specifics>
## Specific Ideas

- **Multi-instance live smoke is mandatory** (research "Looks Done But Isn't"): ≥3 real
  Discourse instances incl. **one login-required** (e.g. a `login_required` forum) yielding
  the D-11 error not a parse crash; ≥3 Mastodon incl. **one locked-down** (401/422) and one
  small/sparse instance (federation sparsity). Per-instance behavior is un-fixture-able.
- **Content-type gate proves out here:** a Discourse login redirect returns HTML-200 on some
  configs — the Phase 5 gate must turn that into the D-11 "login required" error, not a
  `JSON.parse` crash. Add a fixture for it.
- **SSRF acceptance test per new server:** an instance param resolving to `127.0.0.1` /
  `169.254.169.254` must be rejected on the guarded path (mirror the RSS/archive tests) —
  and the SAME test must now cover **Lemmy** once its instance is a parameter (D-15).
- **`limit > 40` rejected by zod** for Mastodon (D-08) — a fixture/unit test asserts the
  readable rejection.
- **Trends-disabled → empty envelope** (D-10): synthesize a fixture where `/trends/tags`
  returns `[]` / 404 and assert `count: 0`, no throw.

</specifics>

<deferred>
## Deferred Ideas

- **`discourse_search`** (SRC-10 AC doesn't require it; research listed it) — deferred; the
  three latest/top/topic tools satisfy SRC-10. Revisit as a v2 pain-point-mining add.
- **Deep Discourse pagination** (`more_topics_url` chasing) — v2; v1.1 is single-page + limit (D-03).
- **Authenticated / tokened reads** for `AUTHORIZED_FETCH` Mastodon or login-required
  Discourse — out of scope; the tools are keyless by premise (locked-down instances get the
  D-11 error and the user picks another instance).
- **Bluesky (AT Protocol)** — v2+ anti-feature per `SUMMARY.md` (marginal signal, protocol complexity).
- **SEC-03 (DNS-rebinding TOCTOU residual)** — remains the accepted risk re-affirmed in
  Phase 5 (local single-user tool); not reopened here.

None of the above blocks Phase 7. Discussion stayed within the SRC-10/11/13 + SEC-02 boundary.

</deferred>

---

*Phase: 7-Universal Sources & Parameterization Audit*
*Context gathered: 2026-07-14*
