# Phase 7: Universal Sources & Parameterization Audit - Research

**Researched:** 2026-07-14
**Domain:** Keyless Discourse + Mastodon MCP servers over the Phase 5 guarded JSON path; suite-wide instance parameterization audit (SEC-02)
**Confidence:** HIGH on field maps / response shapes (live-probed 2026-07-14); MEDIUM on per-instance failure signatures (some un-fixture-able, noted below)

## Summary

Every field mapping the planner needs was live-probed today against real Discourse and
Mastodon instances. The two new servers are mechanical hn-template copies over
`getJson(url, { untrustedHost: true })` — no new dependencies, no contract changes beyond
appending `"topic"` and `"status"` to the `TYPE` enum. The output-contract intent from
CONTEXT.md is confirmed implementable with the exact field names documented below.

**Two findings materially change the CONTEXT assumptions and MUST reach the planner:**

1. **mastodon.social now requires authentication for the public timeline** — anonymous
   `GET /api/v1/timelines/public` returns **HTTP 422 `{"error":"This method requires an
   authenticated user"}`**. The flagship instance is now the *locked-down* example, not the
   "works" example. Anonymous public-timeline access still works on fosstodon.org,
   mstdn.social, mas.to, hachyderm.io, techhub.social, universeodon.com, fediscience.org.
   Critically, lockdown is **per-endpoint**: on mastodon.social the *hashtag* timeline and
   *both trends* endpoints still return 200 anonymously. D-11 error mapping must key on the
   real signal (**422 with that JSON body**, and 401), and must be applied per tool call, not
   assumed per instance.

2. **The Discourse `category` route requires BOTH slug AND numeric id** —
   `/c/<slug>/<id>/l/latest.json` and `/c/<slug>/<id>/l/top.json?period=` are the only forms
   that return JSON 200. The CONTEXT-suggested `/c/<slug>/l/latest.json` and `/c/<slug>.json`
   both **301 → HTML** (which the content-type gate would reject). This forces a design
   decision on the `category` param (see D-02 resolution below).

**Primary recommendation:** Copy `servers/hn/server.js`, wire the field maps in this doc, pass
`untrustedHost: true` on every call, append two TYPE values, switch Lemmy to the guarded path,
and implement the SEC-02 audit as a comment-stripped host-literal allowlist scan. Use the live
smoke lists below verbatim.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Discourse/Mastodon fetch + normalize | Server (servers/discourse, servers/mastodon) | shared/http_client (guarded fetch) | Per-source field mapping is the only per-server logic; transport is shared |
| SSRF defense on instance host | shared/http_client `assertSafeUrl` | — | Untrusted host is tool input; single chokepoint (SEC-01) |
| Content-type gate (HTML-200 login pages) | shared/http_client (untrustedHost) | server (catches thrown error → D-11 msg) | Gate lives on the fetch path; UX message lives in the server |
| Instance parameterization audit | test/parameterization-audit.test.js | — | Static enforcement, not runtime |
| Envelope assembly / TYPE enum | shared/contract.js | — | Frozen contract; append-only |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRC-10 | Research any public Discourse forum by instance URL param — latest, top-by-period, topic detail, in contract | `/latest.json`, `/top.json?period=`, `/t/<id>.json` shapes + field map pinned below; period enum confirmed `daily\|weekly\|monthly\|quarterly\|yearly\|all` (bogus → 400 JSON) |
| SRC-11 | Research any Mastodon instance public + hashtag timelines, keyless, instance+hashtag params | `/api/v1/timelines/public` + `/tag/:tag` status shape pinned; limit silently clamps at 40 (live-confirmed); anon-accessible instance list provided |
| SRC-13 | Trending tags/links from a Mastodon instance; empty (not error) where trends disabled | `/trends/tags` + `/trends/links` shapes pinned incl. `history[]`; disabled-signature handling (empty array / 404) documented |
| SEC-02 | No hardcoded accounts/instances/feeds anywhere — verified by parameterization audit | Host-literal inventory of all current servers captured; comment-stripped allowlist-scan approach specified |
</phase_requirements>

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Discourse (SRC-10):**
- **D-01:** Three tools exactly: `discourse_latest(instance, category?)`, `discourse_top(instance, period, category?)`, `discourse_topic(instance, id)`. No `discourse_search` in v1.1. `category` is an optional filter on latest/top.
- **D-02:** Endpoints `/latest.json`, `/top.json?period=<p>`, `/t/<id>.json`; category → category route (planner confirms exact shape against a live instance).
- **D-03:** Single-page fetch + `limit` truncation — NO deep `more_topics_url` pagination. Document "most recent page only" in tool descriptions.
- **D-04:** `period` is a zod enum (`daily|weekly|monthly|quarterly|yearly|all`).
- **D-05:** Discourse topics map to `type: "topic"` (append to TYPE).

**Mastodon (SRC-11, SRC-13):**
- **D-06:** Four tools: `mastodon_public(instance, limit?)`, `mastodon_hashtag(instance, tag, limit?)`, `mastodon_trending_tags(instance)`, `mastodon_trending_links(instance)`.
- **D-07:** Endpoints `/api/v1/timelines/public`, `/api/v1/timelines/tag/:tag`, `/api/v1/trends/tags`, `/api/v1/trends/links`.
- **D-08:** Clamp `limit` at 40 in zod (`z.number().int().min(1).max(40)`). Reject >40 early with a readable message.
- **D-09:** Timeline statuses → `type: "status"`. Trending links → `type: "article"`. Trending tags → `type: "topic"`, `title` = the `#name`.
- **D-10 (SRC-13):** Trends-disabled instance → empty list envelope (`count: 0`), NEVER an error.

**Per-instance failure UX (AC4):**
- **D-11:** Locked-down instances → clear tool-level error, never a crash/contract violation. Login-required Discourse (403, or HTML-200 login caught by content-type gate) → "this Discourse instance requires login; only public instances are supported." Locked-down Mastodon (401/422) → "instance X disallows anonymous reads — try another instance (this tool is keyless)." Name instance + reason.
- **D-12:** Document federation sparsity in `mastodon_hashtag` description.

**Instance parameterization + Lemmy (SEC-02):**
- **D-13:** New servers take an explicit instance base URL parameter. Scheme optional → default `https`; otherwise treated as a URL. No host guessing beyond defaulting the scheme.
- **D-14:** Both new servers fetch via `getJson(url, { untrustedHost: true })`. hn-template copies but on the GUARDED path.
- **D-15 (SECURITY):** Lemmy's instance becomes an optional tool parameter overriding the `LEMMY_INSTANCE` env default. Lemmy's `getJson` calls MUST switch to `untrustedHost: true`. Keep `LEMMY_INSTANCE` as optional default via `lemmyInstance()`; tool-param `instance` wins when provided. *(NOTE: Lemmy already passes `untrustedHost: true` today — see Runtime State Inventory; the remaining work is the instance param + default-override, not the guard flag.)*
- **D-16 (SEC-02 deliverable):** Committed `test/parameterization-audit.test.js` scanning `servers/*/server.js` (+ rss `resolve*` helpers) for `http(s)://` host literals and `@handle` literals, failing on any non-allowlisted fixed platform base. Allowlist = platform bases already in the suite + Lemmy's `programming.dev`. FORBIDDEN = hardcoded user account (`@handle`), specific community instance, or named-blog feed URL.

### Claude's Discretion (RESOLVED in this research — see Field Maps)
- Exact `score`/`num_comments` source fields for Discourse topic, Mastodon status, trending tag → **resolved below**.
- Discourse category route shape → **resolved: requires `/c/<slug>/<id>/l/<latest|top>.json`**.
- Precise allowlist representation/regex in `parameterization-audit.test.js` → **specified below**.

### Deferred Ideas (OUT OF SCOPE)
- `discourse_search`; deep Discourse pagination (`more_topics_url`); authenticated/tokened reads; Bluesky; SEC-03 DNS-rebinding TOCTOU residual (accepted risk).
</user_constraints>

## Standard Stack

**No new packages.** Existing stack covers everything: `@modelcontextprotocol/sdk`, `zod`,
`fast-xml-parser`, Node ≥18 built-ins. `type: module`. Test runner: `node --test`.

| Component | Role in this phase | Source |
|-----------|-------------------|--------|
| `getJson(url, { untrustedHost: true })` | Guarded fetch for both new servers + Lemmy | `shared/http_client.js` [VERIFIED: read source] |
| `buildListEnvelope` / `buildDetailEnvelope` / `toolResult` | Envelope assembly, HTML strip, dual content return | `shared/contract.js` [VERIFIED: read source] |
| `TYPE` enum | Append `"topic"`, `"status"` (append-only) | `shared/contract.js:28` [VERIFIED] |
| `lemmyInstance()` | Optional-env-default accessor for Lemmy | `shared/credentials.js:95` [VERIFIED] |

**No `## Package Legitimacy Audit` needed** — this phase installs zero external packages.

## Discourse Field Maps (LIVE-PROBED — HIGH confidence)

All probed against `https://meta.discourse.org` on 2026-07-14. `User-Agent` header sent.

### `/latest.json` and `/top.json?period=<p>` — list shape

Top-level: `{ users[], primary_groups, flair_groups, topic_list }`.
`topic_list.topics[]` is the array; `topic_list.more_topics_url` exists (ignored per D-03).

Each `topic` carries (verified keys): `id`, `title`, `slug`, `posts_count`, `reply_count`,
`highest_post_number`, `created_at` (ISO-8601), `last_posted_at`, `bumped_at`, `excerpt`
(HTML-ish, `&hellip;` truncation), `tags[]` (array of strings), `views`, `like_count`,
`op_like_count`, `last_poster_username`, `category_id`, `posters[]` (`{user_id, description}`).

**Recommended contract map (`mapDiscourseTopic`):** [VERIFIED: live probe meta.discourse.org]

| Contract field | Source field | Notes |
|----------------|-------------|-------|
| `id` | `String(topic.id)` | |
| `type` | `"topic"` | new TYPE value |
| `title` | `topic.title` | prefer plain `title` over `fancy_title` (HTML entities) |
| `author` | resolve OP: `topic.posters[]` entry whose `description` includes "Original Poster" → `.user_id` → look up in top-level `users[]` by `id` → `.username`. **Fallback:** `topic.last_poster_username`. | See author-resolution note |
| `score` | **`topic.like_count`** (primary) | engagement signal; `views` is the high-magnitude alternative. Recommend `like_count`. |
| `num_comments` | **`topic.reply_count`** | Recommend `reply_count` over `posts_count - 1`: live topic 1 had `posts_count=1` but `reply_count=5` (whispers/small-actions diverge; `reply_count` is the truer reply count) |
| `created_utc` | `topic.created_at` | already ISO-8601 |
| `url` | `null` (list has no canonical URL) OR construct `${base}/t/${slug}/${id}` | Recommend constructing the permalink form (see permalink) and leaving `url` null |
| `permalink` | `` `${base}/t/${topic.slug}/${topic.id}` `` | canonical topic URL |
| `tags` | `topic.tags ?? []` | already array of strings |
| `text` | `topic.excerpt ?? null` | HTML-ish; `buildListEnvelope`→`normalizeItem` strips it |

**Author resolution note:** the topic object does NOT directly carry the OP username. Build a
`Map<user_id, username>` from the top-level `users[]` array once per response, then resolve
`posters[0].user_id`. `posters[0]` is conventionally the OP but confirm via the
`description` string containing "Original Poster". Keep it defensive — fall back to
`last_poster_username`, then `null`.

### `period` enum — CONFIRMED [VERIFIED: live probe]

`daily`, `weekly`, `monthly`, `quarterly`, `yearly`, `all` all return **200**. An invalid
period (`?period=bogus`) returns **HTTP 400 with JSON** (`application/json`). D-04's zod enum
matches exactly — the zod enum rejects bad values before the fetch, so the 400 never surfaces.

### Category route — RESOLVED [VERIFIED: live probe]

The **only** working JSON forms require slug **and** numeric id:

- `/c/<slug>/<id>/l/latest.json` → 200 JSON, `topic_list.topics[]` (30 topics)
- `/c/<slug>/<id>/l/top.json?period=<p>` → 200 JSON (period accepted)
- `/c/<slug>/<id>.json` → 200 JSON (defaults to latest)

**These FAIL (301 → `text/html`, would trip the content-type gate):**
`/c/<slug>/l/latest.json`, `/c/<slug>.json`, `/c/<id>/l/latest.json`, `/c/<id>.json`.

**Design decision for the planner (`category` param, D-01/D-02):** the CONTEXT text assumed a
slug-only route, which does not exist. Two viable options:

1. **(Recommended, simplest, no extra fetch):** Define `category` as the combined
   **`"slug/id"`** token (e.g. `"support/6"`) and interpolate directly:
   `/c/${category}/l/latest.json`. Document the format in the tool description. Zero extra
   round-trips, no per-instance category cache.
2. **(Nicer UX, one extra fetch):** Accept a bare slug, resolve slug→id via
   `GET /categories.json` (`category_list.categories[]` → `{id, slug}`), then build the route.
   Adds a fetch + a slug-not-found error path. `/categories.json` was live-confirmed.

Recommend **Option 1** for v1.1 scope (matches the "no host guessing" posture of D-13 and the
single-page simplicity of D-03). Flag the choice for discuss/plan.

### `/t/<id>.json` — topic detail shape [VERIFIED: live probe]

Top-level keys include: `id`, `title`, `slug`, `posts_count`, `reply_count`, `like_count`,
`views`, `created_at`, `tags[]`, `category_id`, `word_count`, `participant_count`,
`post_stream { posts[], stream[] }`, `details { created_by { id, username, name } }`.

- **Item** (topic-level, same map as list but from top-level fields): `score = like_count`,
  `num_comments = reply_count`, `views`/`created_at`/`tags` all present at the top level.
  `author` = `details.created_by.username` (direct — no users-array lookup needed here).
  `text` = `post_stream.posts[0].cooked` (the OP body, HTML) → stripped downstream.
- **Comments** (`buildDetailEnvelope` `comments[]`): map `post_stream.posts[]` **excluding the
  first** (the OP is the item). Each post: `{ id: String(post.id), author: post.username,
  text: post.cooked }`. Note `post.cooked` is HTML → stripped by `buildDetailEnvelope`.
  Ignore `post.score` (Discourse's internal 45547.4-style relevance score — NOT our contract
  score; do not surface it).

## Mastodon Field Maps (LIVE-PROBED — HIGH confidence)

Timeline/status probed against `fosstodon.org`; trends against `mastodon.social` (both anon,
2026-07-14).

### `/api/v1/timelines/public` and `/api/v1/timelines/tag/:tag` — status shape

Returns a **JSON array** of statuses. Each status (verified keys): `id`, `created_at`
(ISO-8601, e.g. `2026-07-14T09:38:21.000Z`), `language`, `uri`, `url`, `replies_count`,
`reblogs_count`, `favourites_count`, `content` (HTML), `reblog` (nested status or `null`),
`account`, `tags[]` (array of `{name, url}` — `name` has NO leading `#`), `card`.

**Recommended contract map (`mapMastodonStatus`):** [VERIFIED: live probe fosstodon.org]

| Contract field | Source field | Notes |
|----------------|-------------|-------|
| `id` | `String(status.id)` | |
| `type` | `"status"` | new TYPE value |
| `title` | `""` | Mastodon statuses have no title; contract `title` is a non-null string, `""` is correct |
| `author` | `status.account.acct` | `user@remotehost` for remote, bare `user` for local |
| `score` | **`(favourites_count ?? 0) + (reblogs_count ?? 0)`** | total engagement; favourites-alone is the alternative. Recommend the sum. |
| `num_comments` | `status.replies_count` | |
| `created_utc` | `status.created_at` | ISO-8601 already |
| `url` | `status.url` | canonical status URL (may be remote) |
| `permalink` | `status.url ?? status.uri` | |
| `tags` | `(status.tags ?? []).map(t => t.name)` | strip to name strings (no `#`) |
| `text` | `status.content` | HTML → stripped by `normalizeItem` |

**Boost (`reblog`) handling — DECIDE:** when `status.reblog` is non-null, the wrapper carries
empty `content` and zero counts; the real payload is in `status.reblog`. **Recommend:** when
`reblog` is present, map from `status.reblog` (its content, counts, account, url) so boosts
surface the original post's signal instead of a blank item. Note this in the field-map helper.

### `limit` clamp — CONFIRMED [VERIFIED: live probe fosstodon.org]

`?limit=100` → **HTTP 200 returns exactly 40 items** (silent server-side clamp). D-08's zod
`max(40)` is correct and prevents the envelope `count` from ever mismatching. (The earlier
422 on mastodon.social was the *auth* error, not a limit rejection — see below.)

### `/api/v1/trends/tags` — shape [VERIFIED: live probe mastodon.social]

JSON array of `{ id, name, url, history[] }`. `history[]` = **7 entries**, most-recent-first,
each `{ day: "<epoch-seconds-string>", accounts: "<string>", uses: "<string>" }` (values are
STRINGS — parse with `Number()`).

**Recommended map (`mapTrendingTag`):** [VERIFIED]

| Contract field | Source | Notes |
|----------------|--------|-------|
| `id` | `tag.name` (or `String(tag.id)` if present) | name is stable/unique enough |
| `type` | `"topic"` | reuse Discourse-added type (D-09) |
| `title` | `` `#${tag.name}` `` | D-09: title = the `#name` |
| `author` | `null` | |
| `score` | **`sum(history[].uses.map(Number))`** | summed recent-days usage (D discretion resolved) |
| `num_comments` | `null` | Recommend null; `sum(history[].accounts)` is a defensible "participants" alternative |
| `created_utc` | `null` | tags have no creation time |
| `url` | `tag.url` | |
| `permalink` | `tag.url` | |
| `tags` | `[tag.name]` | |
| `text` | `null` | |

### `/api/v1/trends/links` — card shape [VERIFIED: live probe mastodon.social]

JSON array of preview cards: `{ url, title, description, type ("link"), author_name,
provider_name, image, blurhash, published_at, history[] }`. `history[]` same
`{day, accounts, uses}` string shape as trends/tags.

**Recommended map (`mapTrendingLink`):** [VERIFIED]

| Contract field | Source | Notes |
|----------------|--------|-------|
| `id` | `card.url` | cards have no id; url is the natural key |
| `type` | `"article"` | D-09 |
| `title` | `card.title` | |
| `author` | `card.author_name || card.provider_name || null` | e.g. "TechCrunch" |
| `score` | `sum(history[].uses.map(Number))` (or `null`) | Recommend summed uses for consistency with tags |
| `num_comments` | `null` | |
| `created_utc` | `card.published_at ?? null` | ISO-8601 when present |
| `url` | `card.url` | |
| `permalink` | `card.url` | |
| `tags` | `[]` | |
| `text` | `card.description ?? null` | |

## Per-Instance Failure Signatures (partly LIVE, partly execution-time)

### Mastodon lockdown — LIVE-CONFIRMED signal [VERIFIED: live probe]

- **Locked-down public timeline:** `mastodon.social`, `infosec.exchange`, `mastodon.online`
  return **HTTP 422** with body `{"error":"This method requires an authenticated user"}`
  (content-type `application/json`). This is a **4xx → terminal error** in `getJson` (no
  retry, no stale), so the server's `try/catch` maps it to the D-11 message.
- **401** is the other documented anonymous-denied code (older `AUTHORIZED_FETCH` /
  disable-public-preview configs). Map **both 401 and 422** → D-11 "instance X disallows
  anonymous reads" message. The `getJson` error text is `getJson: HTTP 422 from <url>` /
  `HTTP 401 …`, so the server matches on the status number in the message OR (cleaner) the
  server should detect the status itself. **Recommendation:** since `getJson` throws a plain
  `Error` with the status embedded in the message, match `/HTTP (401|422)/` on the caught
  error message to produce the D-11 message — OR add a small structured-error affordance.
  Flag for planner: the current `getJson` does not expose `err.status`; matching the message
  string is the pragmatic path (mirrors how RSS/Medium errors are surfaced).
- **Lockdown is per-endpoint:** on mastodon.social the **hashtag** timeline and **both
  trends** endpoints returned **200 anonymously** even though the public timeline is 422. Do
  not disable a whole instance on one 422 — map per tool call.

### Discourse login_required — PARTIALLY LIVE (signature is execution-time-confirmable)

- **Documented Discourse behavior** (Discourse source + meta docs, [CITED: meta.discourse.org
  "anonymous users when login required"]): a `login_required` instance returns **HTTP 403 with
  a JSON body** `{"errors":["You are not permitted to view the requested resource."],
  "error_type":"invalid_access"}`. This is a 4xx → terminal in `getJson`; the server maps it
  to the D-11 "requires login" message. **`[ASSUMED]` exact body — I could not find a live
  login_required Discourse to confirm the JSON shape today; the 403 status handling does not
  depend on the body, so implementation is safe regardless.**
- **LIVE HTML cases that the content-type gate catches (both real, use as smoke fixtures):**
  - `community.monday.com/latest.json` → **HTTP 200 with `text/html`** (a custom "Not Found"
    app-shell page). The Phase 5 content-type gate turns this into the terminal
    `getJson: non-JSON response (login required?)` error — exactly the HTML-200 case D-11
    must survive without a `JSON.parse` crash. [VERIFIED: live probe]
  - `connect.mozilla.org/latest.json` → **HTTP 403 with `text/html`** (Cloudflare "Just a
    moment…" challenge). Terminal 4xx; message is a bare `HTTP 403`. [VERIFIED: live probe]
    Note: Cloudflare-fronted instances are indistinguishable from login_required at the HTTP
    layer — the D-11 "requires login; only public instances supported" message is an
    acceptable superset. Consider softening the wording to "requires login or is not publicly
    accessible."
- **Implementation for D-11 (Discourse):** wrap the `getJson` call; on a caught error whose
  message matches `/HTTP 40[13]/` OR `/non-JSON response \(login required/`, throw the D-11
  message naming the instance. The content-type gate (HTML-200) and the 403 path converge on
  the same UX.

### Multi-instance smoke lists (un-fixture-able per-instance behavior — LIVE 2026-07-14)

**Discourse — public (all returned 200 JSON `/latest.json`):**
`meta.discourse.org`, `forum.obsidian.md`, `community.openai.com`, `discuss.python.org`,
`users.rust-lang.org`, `community.home-assistant.io`, `forum.djangoproject.com`,
`forum.gitlab.com`, `community.wanikani.com`, `forum.cursor.com`, `community.n8n.io`,
`community.auth0.com`.

**Discourse — login-required / non-public (for the D-11 path):**
`community.monday.com` (HTML-200 → content-type gate), `connect.mozilla.org` (403 HTML /
Cloudflare). *(A pure Discourse JSON-403 `login_required` instance should be located at
execution time for the cleanest smoke; the two above already exercise both gate branches.)*

**Mastodon — anonymous public timeline WORKS:**
`fosstodon.org`, `mstdn.social`, `mas.to`, `hachyderm.io`, `techhub.social`,
`universeodon.com`, `fediscience.org`.

**Mastodon — locked down (422, for the D-11 path):**
`mastodon.social`, `infosec.exchange`, `mastodon.online`.

**Mastodon — trends work anonymously (for SRC-13 happy path):** `mastodon.social`,
`fosstodon.org`, `mstdn.social`, `hachyderm.io`.

## Architecture Patterns

### Recommended structure
```
servers/discourse/
├── server.js        # 3 tools; mapDiscourseTopic / mapDiscourseDetail helpers
└── manifest.json    # scaffold, mirror servers/hn/ (no user_config — keyless)
servers/mastodon/
├── server.js        # 4 tools; mapMastodonStatus / mapTrendingTag / mapTrendingLink
└── manifest.json    # scaffold, keyless
test/parameterization-audit.test.js   # SEC-02 enforcement (NEW)
test/discourse.test.js / test/mastodon.test.js  # field-map units + registration smoke
```

### Pattern: guarded untrusted-host fetch (copy from Lemmy, NOT bare HN)
```js
// Source: servers/lemmy/server.js:157 (already on the guarded path — VERIFIED)
const base = normalizeInstance(instance); // D-13: default scheme to https, else parse as URL
const raw = await getJson(`${base}/latest.json`, { untrustedHost: true });
```
`normalizeInstance` (D-13): if the input has no scheme, prepend `https://`; strip a trailing
slash; otherwise treat as a URL. No bare-name guessing. The SSRF guard + content-type gate in
`getJson` do the rest (127.0.0.1 / 169.254.169.254 rejected — inherited, not re-implemented).

### Pattern: D-10 trends-disabled → empty envelope
Trends endpoints return a JSON array. When trends are disabled, Mastodon returns an **empty
array `[]` with 200** (maps naturally to `count: 0`). Some very locked instances return
**404** — a 4xx terminal error in `getJson`. **Recommendation:** wrap the trends `getJson` in
`try/catch`; on a caught error whose message matches `/HTTP 404/`, return an empty envelope
(`count: 0`) instead of throwing. An empty `[]` needs no special handling — it already yields
`count: 0`. *(I could not find a live trends-disabled instance in the sample — all returned
non-empty arrays — so the exact disabled signature (`[]` vs 404) is `[ASSUMED]` from docs;
handling both is safe.)*

### Anti-patterns to avoid
- **Copying bare HN `getJson(url)`** — omits `untrustedHost: true`; reintroduces the SSRF hole
  (Pitfall 3). Copy the Lemmy call shape.
- **Hand-building `?page=N`** Discourse pagination — D-03 forbids; single page + `limit`.
- **Surfacing Discourse `post.score`** (internal relevance) as contract `score` — use topic
  `like_count`.
- **Disabling a Mastodon instance on one 422** — lockdown is per-endpoint.
- **`JSON.parse` on a raw response** anywhere — always through `getJson` (the gate lives there).

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|------------|-------------|-----|
| SSRF validation of instance host | New guard in the server | `getJson(url,{untrustedHost:true})` | Single chokepoint; redirect re-validation + mapped-IPv6 canonicalization already covered (D-14) |
| HTML → text (`content`, `cooked`, `excerpt`) | Regex in the server | `normalizeItem` / `buildDetailEnvelope` (auto-strip) | Contract-uniform stripping + entity decode already centralized |
| Envelope + dual content/structuredContent | Manual object | `buildListEnvelope` / `toolResult` | Frozen-contract compliance is structurally guaranteed |
| HTML-login-page detection | Sniff body in server | content-type gate in `getJson` (untrustedHost) | Already fails closed on `text/html` 200 (D-11 HTML case) |

## SEC-02 Parameterization Audit — implementation approach (D-16)

**Host-literal inventory of current servers** (live grep, 2026-07-14) — every one is an
allowlisted fixed platform base:

| Server | Host literals found | In code vs comment/string |
|--------|--------------------|--------------------------|
| librariesio | `libraries.io` | code + comment |
| stackexchange | `api.stackexchange.com` | code + comment |
| lemmy | `programming.dev` | env-default + comment |
| lobsters | `lobste.rs` | code + comment |
| rss | `medium.com`, `pub.substack.com`, `www.reddit.com`, `www.youtube.com` | code + comments/error strings |
| hn | `hn.algolia.com`, `news.ycombinator.com` | code + comment |
| github | `api.github.com` | code + comment |
| producthunt | `api.producthunt.com` | code + comment |
| devto | `dev.to` | code + comment |

**Key implementation insight:** host literals appear in **comments and error-message example
strings** as well as live code (e.g. rss's `resolveSubstackPublication` error text says
`pub.substack.com`; comments say `@ev`). A naive raw-source regex will flag these. Two robust
options for the planner:

1. **(Recommended) Strip comments, then allowlist-scan hosts + scan `@handle` in code only.**
   Read each `server.js`, remove `//…` line comments and `/*…*/` block comments (a small,
   well-tested stripper — or use `node:module` / a tiny regex pass with the known caveat that
   string literals containing `//` are rare here), then:
   - Extract every `https?:\/\/([a-z0-9.-]+)` → hostname; assert each hostname matches the
     allowlist (exact host or a suffix rule for `*.substack.com`, `*.medium.com`).
   - Extract `@[A-Za-z0-9_]+` (and Mastodon `@[\w]+@[\w.]+`) from the stripped code; assert
     **none** remain (all real `@` usage is built from `encodeURIComponent(user)` — no literal
     handle exists in code today, verified).
2. **(Simpler, slightly weaker) Host-only allowlist over raw source, no comment stripping.**
   Because every currently-mentioned host (even in comments) IS allowlisted, a raw scan passes
   today and only fails when someone adds a *non-allowlisted* host literal (e.g. a hardcoded
   `meta.discourse.org` in the discourse server) — which is exactly the SEC-02 threat. Skip
   the `@handle` scan (no literal handles exist). Lower fidelity on the "example handle in a
   new comment" edge, but zero comment-stripper fragility.

**Recommended allowlist representation** (a `Set` + a suffix list):
```js
const ALLOWED_HOSTS = new Set([
  "hn.algolia.com","news.ycombinator.com","api.stackexchange.com","dev.to",
  "medium.com","lobste.rs","libraries.io","api.producthunt.com","api.github.com",
  "www.youtube.com","www.reddit.com","programming.dev", // Lemmy env-overridable default
]);
const ALLOWED_SUFFIXES = [".substack.com", ".medium.com"]; // pub.substack.com, medium subdomains
// PASS if host ∈ ALLOWED_HOSTS || ALLOWED_SUFFIXES.some(s => host.endsWith(s))
```
The test **must exclude the two new servers' *instance param* usage** — Discourse/Mastodon
build `${base}/…` from the tool param, so they contain **no host literal at all** (the base is
a variable). That is the SEC-02 pass condition: a fixed platform host is allowed as a literal;
a user-specific target must be a variable/param. If discourse/mastodon `server.js` contains any
`https://<specific-forum>` literal, the audit fails — which is the intended behavior.

**Scan scope (D-16):** `servers/*/server.js` + the rss `resolve*` helpers (same file). Do not
scan `shared/` (the `isMediumHost` / DENY lists there are security infrastructure, not
per-source targets) — or if scanned, `medium.com` is already allowlisted and DENY IPs are not
`http(s)://` literals.

## Runtime State Inventory

Rename/parameterization phase — explicit answers required:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — servers are network-only, no datastore keys on the renamed thing. | None |
| Live service config | None — no external service stores an instance/handle for this suite. | None |
| OS-registered state | None. | None |
| Secrets/env vars | `LEMMY_INSTANCE` (`shared/credentials.js:27`) — **stays** as the optional default; D-15 adds a tool param that overrides it. No env var renamed. | Code: add `instance?` param to Lemmy tools; `lemmyInstance()` remains the default. `lemmyCreds()` (auth) still reads `LEMMY_INSTANCE` for the JWT host — verify the tool-param instance and the auth instance agree (see note). |
| Build artifacts | None — no compiled output; `manifest.json` scaffolds are new (discourse/mastodon), not stale. | Add two new manifest scaffolds (keyless, no `user_config`). |

**Lemmy auth-vs-param note (execution-time verify):** `lemmyJwt()` (`shared/auth.js`) builds
its token against `lemmyCreds().instance` = `LEMMY_INSTANCE`. If a caller passes a tool-param
`instance` that differs from `LEMMY_INSTANCE`, a Bearer token minted for the env instance would
be sent to a different host. **Recommendation:** when a tool-param `instance` is provided AND
differs from the env default, send **anonymous** (no Bearer) — a token for instance A is
meaningless (and a minor credential-leak vector) on instance B. Only attach the Bearer when the
effective instance equals `lemmyCreds().instance`. Flag this for the planner as a security
sub-decision within D-15.

**Verified-nothing categories** were checked against the codebase (network-only servers, single
`process.env` reader in `credentials.js`).

## Common Pitfalls

### Pitfall 1: Assuming mastodon.social is the "works" instance
**What goes wrong:** tests/smokes written against mastodon.social's public timeline get a 422,
read as "our code is broken."
**Avoid:** use the anon-accessible list above for happy-path smokes; use mastodon.social as the
**locked-down** D-11 fixture. **Warning sign:** `{"error":"This method requires an
authenticated user"}` in a "public timeline" test.

### Pitfall 2: Discourse category route built slug-only
**What goes wrong:** `/c/<slug>/l/latest.json` → 301 → HTML → content-type gate error on every
category call. **Avoid:** use `/c/<slug>/<id>/l/…` (Option 1: `category = "slug/id"`).

### Pitfall 3: getJson error has no `.status`
**What goes wrong:** D-11 mapping tries `err.status === 403` — undefined; every instance falls
through to a generic error. **Avoid:** `getJson` throws a plain `Error` with the status in the
message (`getJson: HTTP 422 from …`); match the message (`/HTTP (401|422|403|404)/`) or the
content-type-gate text. Consider adding a structured error to `getJson` as a small enhancement
(coordinate — it touches the shared file).

### Pitfall 4: Boosts surface as blank items
**What goes wrong:** a reblog wrapper has empty `content`/zero counts → blank low-signal items.
**Avoid:** map from `status.reblog` when present.

### Pitfall 5: SSRF regression by copying bare HN
Covered in Anti-Patterns — copy the Lemmy call, not the HN call. Add the `127.0.0.1` /
`169.254.169.254` rejection acceptance test per new server (mirror existing guarded-path tests).

## Code Examples

### D-13 instance normalization
```js
// Default scheme to https; otherwise treat as a URL. No bare-name guessing (D-13).
function normalizeInstance(instance) {
  const raw = String(instance ?? "").trim();
  if (!raw) throw new Error("instance is required (e.g. https://meta.discourse.org)");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, ""); // strip trailing slash for clean interpolation
}
```

### D-11 Mastodon lockdown mapping
```js
try {
  const raw = await getJson(`${base}/api/v1/timelines/public?limit=${limit}`, { untrustedHost: true });
  // ... map array ...
} catch (err) {
  if (/HTTP (401|422)/.test(err.message)) {
    throw new Error(`Instance ${base} disallows anonymous reads — try another instance (this tool is keyless).`);
  }
  throw err; // genuine transient/other error propagates unchanged
}
```

### D-10 trends-disabled → empty
```js
let arr = [];
try {
  arr = await getJson(`${base}/api/v1/trends/tags`, { untrustedHost: true });
} catch (err) {
  if (!/HTTP 404/.test(err.message)) throw err; // 404 = trends disabled → empty; else propagate
}
const env = buildListEnvelope({ source: "mastodon", query: null, results: (arr ?? []).map(mapTrendingTag) });
```

## State of the Art

| Old assumption (CONTEXT/PITFALLS, 2026-07-08) | Current reality (probed 2026-07-14) | Impact |
|-----------------------------------------------|-------------------------------------|--------|
| mastodon.social public timeline is the keyless happy path | 422 "requires authenticated user" — flagship is now locked down | Smoke list rewritten; D-11 fixture uses mastodon.social |
| Mastodon lockdown is per-instance | Per-**endpoint**: tag+trends anon-OK while public is 422 on the same instance | Map D-11 per tool call, not per instance |
| Discourse `category` = slug-only route | Requires `slug/id`; slug-only 301→HTML | `category` param design decision (Option 1 recommended) |
| Mastodon `limit>40` "silently clamped" | Confirmed: 100→200 returns 40 (clamp real); the 422 seen was auth, not limit | D-08 clamp correct |

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | Discourse `login_required` returns 403 with `{"errors":[…],"error_type":"invalid_access"}` JSON body | Failure signatures | LOW — the 403 *status* handling is body-independent; only the exact body is unconfirmed |
| A2 | Mastodon trends-disabled returns `[]` (200) or 404 | D-10 pattern | LOW — handling both is implemented; no live disabled instance found to confirm which |
| A3 | `posters[0]` with "Original Poster" description is the OP for author resolution | Discourse list map | LOW — fallback to `last_poster_username` then null; author is nullable in contract |
| A4 | `*.substack.com` / `*.medium.com` suffix allowlist covers all current feed hosts | SEC-02 audit | LOW — grep-verified against current source |
| A5 | Instance lists remain anon-accessible at execution time | Smoke lists | MEDIUM — instance policies drift; re-probe at execution; lists are starting points |

## Open Questions (RESOLVED)

All four are resolved and encoded in decisions + executable plan tasks (plan-checker 07 confirmed).

1. **Discourse `category` param format** — Option 1 (`"slug/id"`) vs Option 2 (slug→id
   resolve via `/categories.json`). Recommendation: Option 1.
   RESOLVED: Option 1 (`category="slug/id"` → `/c/<slug>/<id>/l/<latest|top>.json`), locked in D-02 and used by plan 07-02.
2. **`getJson` structured error** — add `err.status` to the shared client (touches
   `http_client.js`, coordinate) vs. match on message string in the servers. Recommendation:
   message-match for this phase (no shared-file change); note the enhancement.
   RESOLVED: message-string matching (no shared-file change) — used for the D-11 mapping across plans 07-02/07-03; `err.status` noted as a future enhancement only.
3. **Lemmy tool-param instance vs env-auth host** — send anonymous when the param instance
   differs from `LEMMY_INSTANCE` (security). → planner sub-decision within D-15.
   RESOLVED: send ANONYMOUS (drop the env Bearer) when the tool-param instance host ≠ the `lemmyCreds().instance` host — plan 07-01 Task 2 + acceptance criterion; never replay LEMMY creds to a caller-chosen host.
4. **Pure Discourse JSON-403 `login_required` smoke instance** — locate one at execution time
   for the cleanest D-11 fixture (the two HTML cases already cover both gate branches).
   RESOLVED: deferred to execution-time live smoke (marked [ASSUMED] A1); the HTML-200 and 403-HTML fixtures in plan 07-02 already exercise both content-type-gate branches offline, so this is a smoke-nicety, not a correctness gap.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥18 built-ins (`fetch`, `node:net`, `node:test`) | all | ✓ | Node 24.18 present | — |
| `@modelcontextprotocol/sdk`, `zod`, `fast-xml-parser` | servers | ✓ | installed | — |
| Network to live Discourse/Mastodon instances | execution-time smokes only | ✓ (probed today) | — | Offline unit tests via captured fixtures; live smoke is a documented manual step |

No new install. Unit tests (field maps, registration, SSRF rejection, limit rejection,
trends-empty) are fully offline via fixtures; per-instance behavior is the documented live
smoke.

## Security Domain

`security_enforcement` enabled (ASVS L1). Relevant categories:

| ASVS Category | Applies | Standard control in this phase |
|---------------|---------|-------------------------------|
| V5 Input Validation | yes | zod schemas: `period` enum (D-04), `limit` `max(40)` (D-08), `instance` normalized not guessed (D-13) |
| V7 Error/Logging | yes | `redactUrl` already strips query strings from thrown errors; D-11 messages name host only (hostnames aren't secrets) |
| V12/SSRF (custom) | yes | `getJson({untrustedHost:true})` — `assertSafeUrl` denylist + per-hop redirect re-validation; **new SSRF acceptance test per server** (`127.0.0.1`, `169.254.169.254`) incl. Lemmy once instance is a param |
| V6 Cryptography | no | keyless; no crypto |
| V2/V3 Auth/Session | partial | Lemmy Bearer must NOT be sent to a mismatched tool-param instance (Runtime State note) |

| Threat pattern | STRIDE | Mitigation |
|----------------|--------|-----------|
| Instance URL → internal/metadata SSRF | Information disclosure | Guarded path (SEC-01), acceptance test per new server |
| Hardcoded account/instance/feed creeps in | Tampering/Repudiation | SEC-02 audit test (D-16) — allowlist scan |
| Lemmy token replayed to attacker-chosen instance | Information disclosure | Anonymous when param-instance ≠ env-instance (D-15 sub-decision) |
| HTML login page parsed as JSON → crash/DoS | DoS | Content-type gate (Phase 5) already fails closed; smoke with community.monday.com |

## Sources

### Primary (HIGH — live probes 2026-07-14)
- Discourse: `meta.discourse.org` `/latest.json`, `/top.json?period=*`, `/t/1.json`,
  `/categories.json`, `/c/support/6/l/{latest,top}.json`; instance reachability sweep (12
  public + 2 non-public).
- Mastodon: `fosstodon.org` public timeline (status shape, limit clamp); `mastodon.social`
  `/trends/tags`, `/trends/links`, tag timeline; anon-access sweep across 9 instances.
- Codebase (read): `shared/http_client.js`, `shared/contract.js`, `shared/credentials.js`,
  `servers/hn/server.js`, `servers/lemmy/server.js`, `servers/rss/server.js` (grep),
  `test/hn.test.js`, host-literal grep of `servers/*`.

### Secondary (MEDIUM/CITED)
- `.planning/research/SUMMARY.md` §Phase 3; `.planning/research/PITFALLS.md` §3/4/5.
- Discourse login_required behavior: meta.discourse.org "anonymous users when login required"
  thread [CITED] (exact JSON body `[ASSUMED]`, not live-confirmed).
- Mastodon trends-disabled `[]`/404: docs.joinmastodon.org [CITED] (`[ASSUMED]` exact signal).

## Metadata

**Confidence breakdown:**
- Field maps (Discourse + Mastodon): HIGH — every field live-probed today.
- Category route / period enum / limit clamp: HIGH — live-probed.
- Failure signatures: MEDIUM — Mastodon 422 live-confirmed; Discourse JSON-403 body assumed.
- SEC-02 audit approach: HIGH on inventory (grep), MEDIUM on comment-strip fidelity.
- Smoke lists: HIGH as of today; MEDIUM durability (instance policies drift).

**Research date:** 2026-07-14
**Valid until:** ~2026-08-14 for field maps; instance access lists re-verify at execution
(Mastodon lockdown is actively spreading — treat lists as starting points).
