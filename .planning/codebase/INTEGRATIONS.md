# External Integrations

**Analysis Date:** 2026-07-07

## APIs & External Services

Every integration is a public developer-community API wrapped by one MCP server in `servers/<name>/server.js`. ALL HTTP goes through `shared/http_client.js` (`getJson`/`postJson`/`getText`) — never direct `fetch` — inheriting the ~15-min TTL cache, retry/backoff (500/1000/2000ms, 5xx/network/timeout only, strict no-4xx-retry), and stale-cache fallback for transient failures.

**Content/Research sources (keyless):**
- Hacker News (Algolia HN Search API) - front page, search, item detail
  - Endpoint: `https://hn.algolia.com/api/v1` (`servers/hn/server.js`)
  - Tools: `hn_front_page`, `hn_search`, `hn_get_item`
  - Auth: none
- Lobsters - hottest, tag listing, story detail, client-side search
  - Endpoint: `https://lobste.rs` `.json` endpoints (`servers/lobsters/server.js`)
  - Tools: `lobsters_hottest`, `lobsters_tag`, `lobsters_get`, `lobsters_search`
  - Auth: none
- Dev.to (Forem API) - top articles, tag, search, article detail
  - Endpoint: `https://dev.to/api` (`servers/devto/server.js`)
  - Tools: `devto_top`, `devto_tag`, `devto_search`, `devto_get`
  - Auth: none
- Generic RSS/Atom feeds - single fetch tool over any http/https feed URL
  - Any feed URL from tool input (`servers/rss/server.js`), parsed with `fast-xml-parser`; handles RSS 2.0, RDF, and Atom 1.0. Documented recipes: subreddit feeds (`https://www.reddit.com/r/<sub>/.rss`) and YouTube channel feeds (`https://www.youtube.com/feeds/videos.xml?channel_id=...` — plain Atom, zero YouTube-specific code)
  - Tool: `rss_fetch` (deliberately a single tool — no `*_search`/`*_get`)
  - Auth: none; SSRF-guarded (see Security below); optional `RSS_ALLOWED_HOSTS` lock-down

**Content/Research sources (optional credentials, degrade gracefully):**
- Stack Exchange API v2.3 - hot questions, search, question detail with answers
  - Endpoint: `https://api.stackexchange.com/2.3` (`servers/stackexchange/server.js`)
  - Tools: `so_hot_questions`, `so_search`, `so_get_question`
  - Auth: optional `key=` query param via `stackExchangeParams()` in `shared/credentials.js` (env `STACKEXCHANGE_KEY`); keyless works at a lower quota. App registration: `https://stackapps.com/apps/oauth/register`
- GitHub REST API - trending repos (search), issue search, item detail
  - Endpoint: `https://api.github.com` (`servers/github/server.js`)
  - Tools: `gh_trending_repos`, `gh_search_issues`, `gh_get_item`
  - Auth: optional PAT as `Authorization: Bearer` via `githubHeaders()` (env `GITHUB_TOKEN`); anonymous works at the low unauthenticated rate limit
- Lemmy (federated) - hot posts, search, post detail with comments
  - Endpoint: `<LEMMY_INSTANCE>/api/v3/...`, default instance `https://programming.dev` (`servers/lemmy/server.js`); instance is OPERATOR-SET env only, never tool input (SSRF mitigation)
  - Tools: `lemmy_hot`, `lemmy_search`, `lemmy_post`
  - Auth: optional login (`LEMMY_INSTANCE` + `LEMMY_USERNAME` + `LEMMY_PASSWORD`) → JWT via `lemmyJwt()` in `shared/auth.js` (POST `/api/v3/user/login`, cached ~24h); otherwise anonymous reads
- Reddit (OAuth2 password grant) - auth plumbing only; reads currently flow through the RSS server's subreddit `.rss` recipe
  - Token endpoint: `https://www.reddit.com/api/v1/access_token` (`shared/auth.js` `redditToken()`), HTTP Basic client_id:secret + real User-Agent; token cached ~55 min
  - Auth: optional four-part creds (env `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`/`REDDIT_USERNAME`/`REDDIT_PASSWORD`) via `redditCreds()`; absent → keyless `www.reddit.com/.json`/`.rss` reads. No dedicated `servers/reddit/` exists yet.

**Content/Research sources (required credentials, fail loudly):**
- Libraries.io - package search and package detail
  - Endpoint: `https://libraries.io/api` (`servers/librariesio/server.js`)
  - Tools: `librariesio_search`, `librariesio_get`
  - Auth: REQUIRED `api_key=` query param via `librariesIoParams()` (env `LIBRARIESIO_KEY`); throws "Missing credential: set LIBRARIESIO_KEY" at call time. Key from `https://libraries.io/account`. Query-string secrets are redacted from all error messages (`redactUrl()` in `shared/http_client.js`)
- Product Hunt API v2 (GraphQL — the ONE GraphQL integration) - launches leaderboard, launch detail
  - Endpoint: `https://api.producthunt.com/v2/api/graphql` via shared `postJson()` (`servers/producthunt/server.js`); fixed module-constant host, never tool input
  - Tools: `producthunt_launches`, `producthunt_get`
  - Auth: REQUIRED developer token as `Authorization: Bearer` via `productHuntHeaders()` (env `PRODUCTHUNT_TOKEN`); token never enters URL, cache key, or logs. GraphQL 200-with-errors guarded by `requirePhOk()`. App registration: `https://www.producthunt.com/v2/oauth/applications`. Non-commercial use by default.

## Data Storage

**Databases:**
- None. No database of any kind.

**File Storage:**
- None. Nothing is persisted to disk; no local file writes.

**Caching:**
- In-memory TTL cache with stale retention: `shared/cache.js` (`getFresh`/`getStale`/`set`). Default TTL ~15 min (`DEFAULT_TTL_MS` in `shared/http_client.js`). Entries never evicted (enables stale fallback); memory unbounded; resets on process restart.
- Separate in-memory token cache: `tokenCache` Map in `shared/auth.js` (Reddit access token ~55 min, Lemmy JWT ~24h). Stores tokens only — passwords never enter the cache.

## Authentication & Identity

**Auth Provider:**
- Not applicable (no end-user auth — these are local single-user tools). Outbound API credential handling is custom:
  - `shared/credentials.js` - the ONLY module reading `process.env`; `ENV_VAR` map is the single source of truth for variable names. Required creds throw clear "set X" errors; optional creds return `{}`/`undefined` to degrade.
  - `shared/auth.js` - username/password → cached-token exchange for Reddit (OAuth2 password grant) and Lemmy (JWT login). Passwords live only in the exchange closure and request body; never logged, never cached.

## Monitoring & Observability

**Error Tracking:**
- None. Errors surface as MCP tool-call errors; messages name only HTTP status and redacted URL (origin+path — query strings stripped so key-in-URL secrets never leak).

**Logs:**
- No logging framework. Servers are stdio MCP processes (stdout is the protocol channel). `examples/uniform-run.mjs` logs skipped-source errors to console during manual smokes only.

## CI/CD & Deployment

**Hosting:**
- None (local-only). Each server runs as a Claude Desktop-spawned stdio process (`node servers/<name>/server.js` per `servers/*/manifest.json` `mcp_config`). Planned distribution is `.mcpb` bundles (mcpb `manifest_version: "0.3"`); actual packing deferred to v2 (PKG-01) — manifests are scaffold/documentation.

**CI Pipeline:**
- None detected (no `.github/` workflows). Tests run locally via `npm test` (`node --test`); `examples/uniform-run.mjs` is a deliberate manual live smoke, not a CI gate.

## Environment Configuration

**Required env vars (only when using that source):**
- `LIBRARIESIO_KEY` - Libraries.io API key
- `PRODUCTHUNT_TOKEN` - Product Hunt developer token

**Optional env vars:**
- `STACKEXCHANGE_KEY`, `GITHUB_TOKEN` - raise rate limits / quotas
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD` - all four required together for the authenticated Reddit path
- `LEMMY_INSTANCE` (default `https://programming.dev`), `LEMMY_USERNAME`, `LEMMY_PASSWORD` - authenticated Lemmy reads require all three (instance must be set explicitly even to the default)
- `MCP_USER_AGENT` - overrides the default outbound User-Agent (Reddit requires a real UA)
- `RSS_ALLOWED_HOSTS` - comma-separated hostname allowlist locking down `rss_fetch` targets

**Secrets location:**
- `.env.example` at repo root documents the variables (existence noted only; never committed with values — `.gitignore` present). In `.mcpb` deployment, each secret is a `user_config` field marked `"sensitive": true` (OS keychain, masked input) injected into the server's env via `${user_config.<field>}` at spawn — see `servers/hn/manifest.json` for the reference pattern.
- Hard rule: no `process.env` reads outside `shared/credentials.js`; no credential ever hardcoded, logged, cached, or placed in a URL/cache key.

## Webhooks & Callbacks

**Incoming:**
- None. Servers are stdio-only; no HTTP listeners of any kind.

**Outgoing:**
- None. All outbound traffic is request/response API calls listed above.

## SSRF Guard (untrusted-URL fetch path)

The RSS server is the only integration whose outbound host comes from untrusted tool input, so `shared/http_client.js` enforces at the shared chokepoint (`assertSafeUrl` + `fetchTextManual`, used by `getText`):
- Scheme allowlist (http/https only)
- Private-range denylist via `node:net` `BlockList` (RFC1918, CGNAT, loopback, link-local incl. cloud metadata `169.254.169.254`, IPv6 ULA/link-local, NAT64 prefix, IPv4-mapped-IPv6 canonicalization)
- DNS resolution check on every resolved address; per-hop re-validation of redirect Locations (`redirect: "manual"`, max 5 hops)
- Optional `RSS_ALLOWED_HOSTS` operator lock-down
- Known accepted residual: DNS-rebinding TOCTOU between check and connect (documented in `shared/http_client.js`)

---

*Integration audit: 2026-07-07*
