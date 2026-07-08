# Pitfalls Research

**Domain:** Adding v1.1 features to an existing MCP server suite — author-blog feeds (Medium/Substack), trending/pain-point mining (Dev.to/SE/HN), Discourse + Mastodon servers, universal distribution (.mcpb + npm)
**Researched:** 2026-07-08
**Confidence:** MEDIUM (web-verified against official docs where available: Forem API spec, Mastodon docs, MCPB MANIFEST.md, SE throttle docs, hn.algolia.com/api; per-instance behavior for Discourse/Mastodon is inherently variable)

This overwrites the v1.0 pitfalls file. Scope is **mistakes specific to adding the v1.1 features to this codebase** — the existing v1.0 concerns live in `.planning/codebase/CONCERNS.md` and are referenced where they interact.

## Critical Pitfalls

### Pitfall 1: Medium feed bot-blocking turns into permanent hard errors under the no-4xx-retry policy

**What goes wrong:**
`medium.com/feed/@user` is served behind CDN bot protection that 403s non-browser user agents (the same Cloudflare-class blocking documented across NewsBlur, Home Assistant, and hypothes.is feed fetchers). This repo's HTTP client treats **any 4xx as terminal — no retry, no stale fallback** (deliberate, ARCHITECTURE §8 / WR-04). Result: the author-blog tool works in testing, then one 403 makes every Medium call in a session hard-error with a misleading message.

**Why it happens:**
Bot heuristics key on User-Agent and IP reputation; the default `fetch` UA (`node`/undici) is a classic block target. Datacenter IPs get blocked even with a good UA. Developers test from a residential IP with a fresh cache and never see it.

**How to avoid:**
- Send a descriptive, browser-plausible User-Agent on feed fetches (e.g. `medium-research-mcp/1.1 (+repo URL)` — many WAF rules allow identified feed readers; a bare `undici` UA is the worst case). Set it in `shared/http_client.js` `getText()` defaults, not per-server.
- Map 403/anti-bot responses to a **clear tool-level error** ("Medium is blocking automated fetches from this network; the feed may still work from another network") rather than a generic HTTP failure.
- Keep the 15-min cache as the shield: a successful fetch keeps serving; consider whether feed fetches deserve stale-fallback-on-403 as a *documented exception* — if so, change it once in the extracted retry core (see CONCERNS tech debt), never per-verb.

**Warning signs:**
Feed works via `curl` with `-A "Mozilla/..."` but 403s without; works locally but fails in CI or from a VPS; intermittent 403s that correlate with request bursts.

**Phase to address:**
Author-blog tools phase (Medium/Substack feed server). UA default belongs in the shared client, so do it before the server lands.

---

### Pitfall 2: Building dedup/follow-up/cadence features on truncated paywalled text

**What goes wrong:**
Medium feeds contain only the **latest 10 items**, and member-only posts carry only the public abstract in `description` — not the body. Substack feeds include only the public preview for paid posts and append a literal **"Read more"** marker to truncated items. If the v1.1 "topic dedup, follow-up detection, cadence view" features assume `text` is the full article, they silently produce wrong similarity/dedup results, and "cadence view" claims a 10-post history is the author's full history.

**Why it happens:**
The feeds are valid RSS and pass the output contract — nothing errors. Truncation is only visible if you compare against the live article.

**How to avoid:**
- Treat feed `text` as **teaser-quality**, and say so: detect the markers (Substack's trailing "Read more", Medium's abstract-only paid items) and surface a flag the consuming skill can use (e.g. append a `[preview only]` note in `text`, or use `tags`) — do **not** add a new contract field.
- Document the hard caps in tool descriptions: "Medium feeds return at most the 10 most recent posts; older history is not reachable keylessly."
- Do dedup/follow-up on **title + teaser**, and design the algorithm to tolerate short text (titles carry most of the signal for topic dedup anyway).
- Do not attempt cookie/subscription workarounds — out of scope and against the keyless premise.

**Warning signs:**
Dedup scores clustering near zero for paid authors; every Substack item's text ending in "Read more"; cadence view showing exactly 10 posts for every Medium author.

**Phase to address:**
Author-blog tools phase — bake the caps into tool descriptions and the dedup design from day one.

---

### Pitfall 3: SSRF guard does not cover the new user-supplied instance URLs (Discourse/Mastodon)

**What goes wrong:**
v1.0's SSRF chokepoint (`assertSafeUrl`, private-range BlockList, redirect re-validation) was built **on `getText`** because RSS was the only user-controlled outbound host. Discourse (SRC-10) and Mastodon (SRC-11) take an **instance URL as a tool parameter** and will call `getJson()` — which today does not pass through the SSRF guard. The parameterization rule ("targets are tool inputs") makes every new server a user-controlled-host server. An LLM-driven `discourse_latest("http://169.254.169.254/...")` walks straight past the v1.0 hardening.

**Why it happens:**
The guard was scoped to where the threat existed at the time; copying `servers/hn/` as the template (fixed host) doesn't surface the difference.

**How to avoid:**
- Before writing either server, extend the SSRF validation to `getJson`/`postJson` for caller-supplied base URLs — ideally as an opt-in flag or a `getJsonFromUserHost()` wrapper so fixed-host servers (HN, Dev.to) skip the DNS-resolution cost.
- Enforce `https:` scheme and reject credentials-in-URL / non-default ports if that matches the RSS guard's posture.
- Reuse the existing BlockList and redirect re-validation — do not fork a second guard implementation.

**Warning signs:**
A new server whose handler interpolates a tool input into a URL origin and calls plain `getJson`; threat model review finding "instance parameter" with no mitigations row.

**Phase to address:**
Must land in (or before) the Discourse phase, since that's the first `getJson`-with-user-host server; Mastodon inherits it.

---

### Pitfall 4: Treating Discourse instances as uniform — login_required, operator-tuned rate limits, and `more_topics_url` pagination

**What goes wrong:**
`/latest.json` is only public on instances that haven't enabled `login_required` — those sites redirect or 403 anonymous JSON requests. Rate limits are **per-operator** (`DISCOURSE_MAX_REQS_PER_MINUTE` and friends in app.yml), so a pace that's fine on meta.discourse.org 429s elsewhere. Pagination is not a simple `?page=N` contract across versions: the canonical mechanism is `topic_list.more_topics_url`, a **relative URL that needs `.json` appended**. Code tested against one instance breaks on the second.

**Why it happens:**
Discourse is self-hosted software, not one API. The dev tests against a single friendly instance (usually meta.discourse.org, which has generous limits) and generalizes.

**How to avoid:**
- Map login-required responses (403, or an HTML login redirect where JSON was expected) to a specific error: "This Discourse instance requires login; only public instances are supported."
- Honor `Retry-After` on 429 in messaging even though the policy is no-retry — tell the caller *when* to try again instead of a bare failure. (If Retry-After honoring ever becomes retry behavior, change it in the one extracted retry core.)
- Paginate via `more_topics_url` if a "next page" capability is exposed at all; safest v1.1 scope is single-page `/latest.json` + `/c/<slug>.json` with `limit` truncation, no deep pagination.
- Guard JSON parsing: a login redirect returns HTML with a 200 on some configs — check content-type before `JSON.parse` and produce the login-required error, not a parse crash.
- Test against ≥3 real instances (e.g. meta.discourse.org, users.rust-lang.org, forum.obsidian.md) before calling it done.

**Warning signs:**
`SyntaxError: Unexpected token '<'` from a Discourse tool; 429s only on certain instances; pagination code that hand-builds `?page=2`.

**Phase to address:**
Discourse phase.

---

### Pitfall 5: Assuming Mastodon anonymous timeline access is universal

**What goes wrong:**
Instances can disable unauthenticated API access entirely (`AUTHORIZED_FETCH`, "disable public preview"), and **Mastodon 4.5 added granular per-timeline controls** — admins choose which timelines are visible to everyone, signed-in users only, or nobody. Anonymous `GET /api/v1/timelines/public` or `/tag/:tag` then returns 401 (or 422). A "keyless Mastodon server" that hard-codes the assumption works on mastodon.social and fails on fosstodon.org-style locked-down instances with a confusing error. Separately: `limit` maxes at **40** (silently clamped), and a hashtag timeline only contains statuses **that instance has federated** — small instances have sparse hashtag results, which looks like a bug but is federation physics.

**Why it happens:**
docs.joinmastodon.org describes the software's defaults, not each instance's config; the anonymous-access landscape tightened after 2023 (AUTHORIZED_FETCH adoption) and again with 4.5.

**How to avoid:**
- Treat 401/422 from timeline endpoints as a **per-instance capability error**: "Instance X does not allow anonymous timeline reads — try another instance (this tool is keyless)." Never generic-error it, never retry it.
- Clamp `limit` to 40 in the input schema (`z.number().max(40)`) so the silent server-side clamp never causes a count mismatch against the envelope's `count`.
- Document federation sparsity in the tool description: "results reflect what the chosen instance federates; larger instances see more."
- Pace politely: the commonly-cited anonymous ceiling is 300 req/5 min per IP — far above research-burst usage, but the 15-min cache should key on instance+hashtag so repeat calls don't spend it.
- Per the parameterization rule there is no hardcoded default instance — but the tool description can *suggest* large instances for broad hashtag coverage without defaulting to one.

**Warning signs:**
401 with an empty-ish JSON error body from `/api/v1/timelines/*`; hashtag results dramatically smaller on one instance than another; `count` in the envelope exceeding results length after server clamping.

**Phase to address:**
Mastodon phase.

---

### Pitfall 6: Trending params that abuse quotas — SE `backoff` ignored, keyless bursts, HN "rising" that doesn't exist

**What goes wrong:**
Three related failures when adding trending/pain-point tools:
1. **Stack Exchange:** every response may carry a `backoff` field (seconds you must wait before hitting the same method); ignoring it escalates to throttle violations and a temporary IP ban that takes out *all* SE tools. The new "high-view unanswered" queries add call volume to a keyless daily quota of ~300 (10k with a key) — and this repo's strict no-429-retry policy means a violated throttle hard-errors every subsequent call.
2. **Dev.to:** `top` is an **integer number of days** ("most popular in the last N days"), not an enum — passing `"week"` fails; and `state` combined with `username` only permits `all`. Platform rate limit is ~10 req/30 s.
3. **HN:** Algolia has **no "rising" endpoint**. Approximating it means `search_by_date` + `numericFilters` (points/comments thresholds over a recent `created_at` window), which is date-ordered, not relevance-ordered — a semantic change from the existing `/search` tools that can silently reorder merged results. Algolia's ceiling is 10,000 req/hr/IP (rarely the problem; the semantics are).

**Why it happens:**
`backoff` only appears under load, so offline fixtures never contain it; `top`'s unit is easy to misread from blog posts; "rising" sounds like a first-class HN concept because the site has one, but the public APIs don't expose it directly.

**How to avoid:**
- Read `backoff` in the SE server (it's in every response envelope next to `quota_remaining`) and at minimum **record it against the cache key / warn in output**; ideally sleep `backoff` seconds before any follow-up SE call in the same tool invocation (question+answers double fetch). Surface `quota_remaining` in errors when it hits 0 with the existing "set STACKEXCHANGE_KEY" guidance.
- Define Dev.to trending input as `top: z.number().int().min(1)` (days) and document "7 = top of week, 30 = top of month"; forbid `state` + `username` combinations other than `all` in the schema.
- For HN rising, pick and document one approximation (e.g. `search_by_date` with `numericFilters=points>N,created_at_i>now-24h`) and set the item ordering expectation in the tool description; don't pretend it's the front-page algorithm.

**Warning signs:**
SE responses containing `"backoff": 10` in dev logs; 502/throttle_violation errors from SE; Dev.to 422s on `top=week`; HN "rising" results ordered newest-first when the consumer expected hottest-first.

**Phase to address:**
Trending & pain-point mining phase (params on existing servers).

---

### Pitfall 7: Packing `.mcpb` per-server breaks the `shared/` imports — the monorepo layout fights the bundle format

**What goes wrong:**
Every server imports `../../shared/*.js`, and dependencies live in one root `node_modules`. A `.mcpb` is a self-contained ZIP: for Node servers, `node_modules/` **must be vendored inside the archive** and all code must resolve within it. Naively running `mcpb pack servers/hn/` produces a bundle that installs cleanly and then crashes at spawn with `ERR_MODULE_NOT_FOUND` for `shared/contract.js` (and `zod`). This is the single most likely PKG-01 failure mode for this specific repo.

**Why it happens:**
The v1.0 layout optimizes for shared-module reuse; the bundle format optimizes for isolation. The manifests were written as scaffold before any packing existed (see CONCERNS: ".mcpb packaging is scaffold-only").

**How to avoid:**
- Build a staging step per server: copy `servers/<name>/`, `shared/`, and a production-only `node_modules` (from `npm ci --omit=dev` against the root lockfile) into a temp dir with **rewritten or path-stable imports** (simplest: stage as `<stage>/server.js` + `<stage>/shared/` and keep relative depth identical, or stage the whole repo layout), then `mcpb pack` the stage — never pack the live source tree.
- Validate each bundle with `mcpb validate` (manifest) **and** an actual spawn test (`node` the staged entry point) before shipping.
- Check the manifest_version against the current MCPB spec (repo moved to `modelcontextprotocol/mcpb`; spec has advanced to ~0.4 with 0.1/0.2 grandfathered) — the v1.0 scaffold manifests predate this and may need updating.
- Keep dev deps and `test/` out of the archive (ignore file) — bundle bloat is pure download cost.

**Warning signs:**
A packed bundle that passes `mcpb validate` but whose server exits instantly on install; bundle size ≈ source-only KBs (node_modules missing) or ≈ tens of MB (dev deps included).

**Phase to address:**
Distribution phase (PKG-01), first task before per-server packaging.

---

### Pitfall 8: `${user_config.*}` env injection and keychain secrets behave differently per install path

**What goes wrong:**
MCPB `user_config` entries flow into the server as env vars via `${user_config.key}` references in the manifest, and `"sensitive": true` values are stored in the OS keychain. This works in Claude Desktop's custom-connector path — but the repo's own manifest already documents a KNOWN GOTCHA: on the Claude Code plugin path a bundled server "can silently fail to spawn." A Libraries.io/Product Hunt bundle whose required key never arrives in env will hit `credentials.js` and produce the "set X" error — or worse, silently run keyless where an optional cred was expected, degrading quality with no visible failure.

**Why it happens:**
The MCPB spec defines the manifest, but each host implements variable substitution and keychain storage itself; coverage differs by host and version.

**How to avoid:**
- After packing, verify each install path actually delivers the env: Claude Desktop install + a tool call that requires the cred; `claude mcp list` on the plugin path (per the existing manifest note).
- Design for absence: required-cred servers already fail with "set X" — make sure that error also names the `.mcpb` user_config field, not just the env var, so a Desktop user knows which settings box to fill.
- Keep the env-var names in `shared/credentials.js` `ENV_VAR` as the single source of truth and generate/check manifests against it (a 5-line test can assert every manifest `user_config` env ref matches an `ENV_VAR` entry).

**Warning signs:**
Bundle installs, tools list, but every call to a credentialed server errors; secrets appearing in plaintext config files instead of keychain (missing `sensitive: true`).

**Phase to address:**
Distribution phase (PKG-01), verification checklist.

---

### Pitfall 9: npm/npx distribution that works everywhere except Windows — and hangs on first run

**What goes wrong:**
Three compounding failures for npm-published stdio servers:
1. **Windows spawn:** clients that `spawn("npx", ...)` hit `spawn npx ENOENT` because `npx.cmd` is a batch file needing a shell — the universally-cited fix is `"command": "cmd", "args": ["/c", "npx", "-y", "@scope/pkg"]`. Docs that only show the macOS config strand Windows users (this project's own dev machine is Windows).
2. **Cold start:** first `npx` run downloads the package tree (5–30 s), which can exceed client startup timeouts and produce "server disconnected" on the very first install experience. Omitting `-y` makes npx *prompt*, which hangs a stdio server forever.
3. **Entry point:** the MCP SDK is ESM-only; the `bin` target needs `#!/usr/bin/env node` and the package needs `"type": "module"` — a CJS-resolved entry fails with cryptic `require() of ES module` errors on the user's machine, not yours.

**Why it happens:**
npm's `.cmd` shims paper over Windows *in a terminal*, but MCP clients spawn processes directly without a shell; cold-start latency is invisible once your local cache is warm.

**How to avoid:**
- Publish under one scope (e.g. `@redlio/…` or one `medium-research-mcp` package with multiple `bin` entries — fewer names to squat, one install for all servers; claim the name(s) early).
- Each `bin` file: shebang line first, then `import("./server.js")` or the server itself; keep `type: module`.
- Client config docs must show **per-OS** examples: bare `npx -y` for macOS/Linux, `cmd /c npx -y` for Windows, plus the "install globally / use absolute node path" fallback for clients with short spawn timeouts.
- Test the published artifact via `npm pack` + install of the tarball on Windows before `npm publish` — the `files` field must include `shared/` and `servers/` or the same ERR_MODULE_NOT_FOUND as Pitfall 7 ships to npm.

**Warning signs:**
`spawn npx ENOENT` in client logs; server connects on second attempt but not first (cold start); tarball from `npm pack` missing `shared/` when listed.

**Phase to address:**
Distribution phase (npm packaging + client config docs).

---

### Pitfall 10: Assuming clients pass your shell environment and a sane cwd

**What goes wrong:**
MCP clients spawn stdio servers with a **minimal, platform-dependent env** — not your shell profile. GUI-launched clients (Claude Desktop, Cursor) often miss nvm/volta-managed `node` on PATH; env vars exported in `.bashrc` never reach the server, so optional creds silently vanish (server runs keyless, quality degrades, nothing errors). The spawn **cwd is client-defined** — some spawn at `/`, some at the app dir, IDE clients sometimes at the workspace — so any relative path (fixture, config file) resolves differently per client. Each client (Claude Desktop, Claude Code, Cursor, Codex CLI, OpenCode) has its own config file schema/location for `command/args/env`, and "universal distribution" fails if docs only cover one.

**Why it happens:**
Everything works in dev because you launch from a terminal where PATH, env, and cwd are all right. `credentials.js` reading env is correct design — but only if the client is configured to *put* the values in env.

**How to avoid:**
- Zero cwd dependence: resolve any file access from `import.meta.url` (audit: the servers are network-only today — keep it that way).
- Docs: per-client config snippets (Claude Desktop `claude_desktop_config.json`, Cursor `~/.cursor/mcp.json`, Claude Code `claude mcp add`, Codex/OpenCode equivalents) each showing the `env` block for credentials — state explicitly that shell-exported vars are NOT inherited by GUI clients.
- Make keyless degradation *visible*: when an optional cred is absent, keep degrading gracefully but consider noting the mode in the tool result text (e.g. GitHub server noting anonymous limits) so silent-missing-env is diagnosable.
- Smoke each documented client at least once on Windows + one Unix-like OS before declaring "universal."

**Warning signs:**
"Works in terminal, not in Claude Desktop"; credentialed features behaving as keyless despite exported vars; client logs showing `node: command not found`.

**Phase to address:**
Distribution phase (client config docs); the cwd audit is a one-hour check that can happen any time earlier.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Add 429/Retry-After handling inside one server instead of the shared client | Ships the Discourse server faster | Forks the resilience policy per-verb/per-server — the exact drift CONCERNS warns about | Never — if 429 policy changes, extract the retry core first |
| Point Medium/Substack tools at the existing `rss_fetch` internals without a dedicated server | Reuses parsing | Author-blog semantics (dedup, cadence, paywall markers) leak into the generic RSS server; tool descriptions blur | Acceptable to *reuse the parser module*; not acceptable to overload `rss_fetch`'s tool surface |
| Hand-zip `.mcpb` instead of using the `mcpb` CLI | No new dev dep | Misses manifest validation, spec-version drift (0.2 scaffold vs current ~0.4), ignore rules | Never — the CLI is `npx`-runnable, zero install |
| Publish one npm package per server | "Clean" separation | 10+ names to maintain/squat-protect; `shared/` duplicated or a cross-dep web; 10 cold-start downloads | Never for this repo — one package, many `bin` entries |
| Skip per-instance Discourse/Mastodon integration smokes ("fixtures pass") | Faster phase close | Per-instance variance (login_required, AUTHORIZED_FETCH, version skew) is the *primary* risk of these servers and is invisible offline | Only if the phase explicitly defers a documented manual smoke list |
| Hardcode a "known good" Mastodon instance as default | Nicer first-run UX | Violates the v1.1 parameterization rule; breaks when that instance locks down | Never — suggest in description text, require as parameter |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Medium feeds | Default UA; expecting >10 items; treating paid-post abstract as full text | Browser-plausible UA in shared client; document 10-item cap; flag preview-only text |
| Substack feeds | Missing the "Read more" truncation marker; hammering per-second | Detect marker → preview flag; cache absorbs polling; minute-scale pacing |
| Dev.to `/articles` | `top="week"` (it's integer days); `state=rising` + `username` | `top: int` days in schema; forbid invalid combos in Zod; respect ~10 req/30 s |
| Stack Exchange | Ignoring `backoff`; burning keyless 300/day quota with new trending calls | Read `backoff` + `quota_remaining` from every envelope; sleep backoff within multi-call tools; push `STACKEXCHANGE_KEY` in errors |
| HN (Algolia) | Pretending a "rising" endpoint exists; forgetting date-vs-relevance ordering | `search_by_date` + `numericFilters` approximation, ordering documented in tool description |
| Discourse | One-instance testing; `?page=N` pagination; parsing login-redirect HTML as JSON | Multi-instance smoke; `more_topics_url` (+`.json`); content-type check → "login required" error |
| Mastodon | Assuming anonymous access; `limit>40`; expecting uniform hashtag coverage | 401/422 → per-instance capability error; clamp limit at 40 in schema; document federation sparsity |
| MCPB | Packing `servers/<name>/` directly (breaks `../../shared`); stale manifest_version | Stage server+shared+prod node_modules, then `mcpb pack`; `mcpb validate` + spawn test |
| npm/npx | Unix-only docs; missing `-y`; `files` excluding `shared/` | `cmd /c npx -y` Windows examples; tarball inspection via `npm pack` |
| All MCP clients | Assuming shell env/cwd inheritance | Explicit `env` blocks in every per-client config doc; zero relative paths |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Trending tools multiply keyless SE/Dev.to calls in one research burst | Later tool calls hard-error (no-429-retry policy) mid-run | Cache keys per (site, window); honor `backoff`; recommend keys in docs | A single multi-source run with 2–3 trending calls per source, keyless |
| npx cold start vs client spawn timeout | "Server disconnected" only on first install | Document `-y`; suggest global install for slow networks; keep package small (no dev deps, no fixtures) | First run on any new machine, 5–30 s download |
| Per-instance cache-key explosion (Discourse/Mastodon/feed URLs are all user input) | Monotonic memory growth in long sessions — same unbounded-cache concern as `rss_fetch`, now ×3 servers | The already-recommended LRU cap in `shared/cache.js` covers every server in one change | Long-lived Desktop sessions exploring many instances/authors |
| Fetching Discourse category + topic detail serially per item | Slow "mine this forum" runs | Same `Promise.all` guidance as the SE double-fetch concern; or keep v1.1 to list-level tools | Only if detail tools loop over topics |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Instance-URL parameters reaching `getJson` without the SSRF guard (Pitfall 3) | SSRF to internal/cloud-metadata endpoints via LLM-driven tool input — bypasses all v1.0 hardening | Extend `assertSafeUrl` path to JSON verbs for user-supplied hosts before Discourse/Mastodon land |
| `.mcpb` user_config secrets without `"sensitive": true` | API keys stored plaintext in host config instead of OS keychain | Manifest-vs-`ENV_VAR` consistency test; review each manifest at pack time |
| Publishing npm package with `.env`/local config in the tarball | Credential leak to the public registry | `files` allowlist in package.json; inspect `npm pack` output before first publish |
| Copying the Medium browser-UA workaround into an aggressive retry loop | Behaves like the bot it's pretending not to be; IP reputation damage affecting the user | Keep no-retry-on-4xx; UA identification honest (`+repo URL`); cache-first |
| New servers reading `process.env` directly for instance defaults | Breaks the credentials.js invariant; untestable config surface | Optional defaults, if any, go through `credentials.js`-style accessors; targets stay tool parameters |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Generic "HTTP 401" from a locked-down Mastodon instance | User assumes the server is broken | "Instance X disallows anonymous reads; pick another instance" — name the instance and the reason |
| Silent 40-item clamp vs requested limit=100 | Consuming skill thinks data is missing | Zod `max(40)` rejects early with a readable message |
| Cadence view built from a 10-item Medium feed presented as full history | Wrong editorial conclusions ("author slowed down") | Tool description + result note: "most recent 10 posts only" |
| Windows user follows macOS-only npx config | Total setup failure, worst possible first impression | Per-OS config blocks in every client doc, Windows first (dev's own platform) |
| Preview-only paywalled text fed to the blog skill unlabeled | Skill cites a teaser as the article's content | Preview marker detection surfaced in `text` or `tags` |

## "Looks Done But Isn't" Checklist

- [ ] **Medium/Substack server:** Works for free authors — verify against a **paid** Medium author and a **paywalled** Substack (preview markers detected, no `[object Object]`, CDATA `content:encoded` goes through `textOf()` — the known WR-01-class bug in CONCERNS).
- [ ] **Trending params:** Fixtures pass — verify a live SE response carrying `backoff` is handled (synthesize one in fixtures) and `quota_remaining: 0` produces the "set STACKEXCHANGE_KEY" message.
- [ ] **Discourse server:** Works on meta.discourse.org — verify a login-required instance yields the capability error (not a JSON parse crash) and a second/third public instance paginates.
- [ ] **Mastodon server:** Works on mastodon.social — verify a locked-down instance (401) and a small instance (sparse hashtag) both produce sensible output; `limit` schema caps at 40.
- [ ] **.mcpb bundle:** `mcpb validate` passes — verify the bundle **spawns** (shared/ + node_modules resolved) and a credentialed server receives its `${user_config.*}` env in Claude Desktop *and* is checked via `claude mcp list` on the plugin path.
- [ ] **npm package:** Publishes — verify `npm pack` tarball contains `shared/`, `bin` entries have shebangs, and a Windows machine connects via `cmd /c npx -y`.
- [ ] **Client docs:** Claude Desktop covered — verify at least one non-Anthropic client (Cursor or Codex) config was actually executed, with `env` block, on Windows.
- [ ] **SSRF:** RSS guard intact — verify Discourse/Mastodon instance params are refused for private/link-local targets (test with `http://127.0.0.1` and `http://169.254.169.254`).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Medium 403 blocking discovered post-ship | LOW | Add/adjust UA default in shared client (one file); improve error mapping; no contract change |
| Dedup built on truncated text | MEDIUM | Rework similarity to title-weighted; add preview flag; re-verify with paid authors |
| SSRF gap shipped in Discourse/Mastodon | MEDIUM | Route JSON verbs through the guard (one shared-client change), patch release; audit logs are N/A (local tool) |
| SE IP throttle ban triggered | LOW (time-bound) | Wait out the ban; ship `backoff` handling; document key setup |
| `.mcpb` bundles broken on shared imports | MEDIUM | Build the staging script; re-pack all bundles; version-bump manifests |
| npm package missing files/Windows-broken | LOW | Patch release with fixed `files`/docs; npm re-publish is cheap — but reputation cost of a broken first release is why the tarball check comes first |
| Client env not delivered (silent keyless mode) | LOW | Docs fix + visible degraded-mode notes in tool output |

## Pitfall-to-Phase Mapping

Phases below refer to the v1.1 feature areas (roadmap phases not yet numbered).

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Medium bot-blocking | Author-blog tools | Live fetch of 2–3 Medium feeds incl. from a non-residential network if possible; 403 error message reviewed |
| 2. Truncated paywalled text | Author-blog tools | Paid-author fixture tests; preview markers asserted |
| 3. SSRF gap on instance URLs | Discourse phase (or a small shared-infra pre-task) | `127.0.0.1`/`169.254.169.254` instance params rejected in tests |
| 4. Discourse per-instance variance | Discourse phase | 3-instance manual smoke incl. one login-required instance |
| 5. Mastodon anonymous-access assumption | Mastodon phase | Locked-down-instance smoke; `limit` schema test |
| 6. Quota/backoff abuse in trending | Trending phase | Fixture with `backoff` field; Dev.to schema rejects `top="week"` |
| 7. `.mcpb` shared-import breakage | Distribution phase | Spawn test of every packed bundle |
| 8. user_config env divergence | Distribution phase | Desktop + `claude mcp list` checklist per bundle |
| 9. Windows npm/npx failures | Distribution phase | Tarball inspection + Windows `cmd /c npx` connection test |
| 10. Client env/cwd assumptions | Distribution phase (docs) | One non-Anthropic client executed per OS family |

## Sources

All web findings cross-checked against official documentation where it exists; confidence tiers from the classify-confidence seam (websearch verified → MEDIUM).

- Medium feed caps/paywall: [Medium Help Center — RSS feeds](https://help.medium.com/hc/en-us/articles/214874118-Using-RSS-feeds-of-profiles-publications-and-topics), [quickcoder.org Medium RSS in detail](https://quickcoder.org/rss-overview/)
- Feed bot-blocking class: [Cloudflare Community — NewsBlur fetchers blocked](https://community.cloudflare.com/t/cloudflare-is-blocking-newsblur-rss-feed-fetchers/649373), [home-assistant#159250 UA-blocked feeds](https://github.com/home-assistant/core/issues/159250)
- Substack paywall/RSS: [FreshRSS discussion #6667](https://github.com/FreshRSS/FreshRSS/discussions/6667), [RSS-Bridge Substack notes](https://rss-bridge.github.io/rss-bridge/Bridge_Specific/Substack.html), [wprssaggregator Substack RSS guide](https://www.wprssaggregator.com/substack-rss-feed/)
- Dev.to/Forem API (`top`, `state`, auth): [Forem API v1 spec](https://developers.forem.com/api/v1) (fetched directly)
- Stack Exchange throttling/backoff: [SE API throttle docs (Teams mirror)](https://api.stackoverflowteams.com/docs/throttle), [Kevin Montrose — API v2.0 Throttling](https://kevinmontrose.com/2012/03/22/stack-exchange-api-v2-0-throttling/)
- Algolia HN limits: [hn.algolia.com/api](https://hn.algolia.com/api)
- Discourse rate limits/pagination: [Discourse Meta — rate limits for API users](https://meta.discourse.org/t/rate-limits-for-api-users/63328), [429 with Retry-After](https://meta.discourse.org/t/429-error-with-api/182523), [anonymous users with login required](https://meta.discourse.org/t/anonymous-users-when-login-required-checked/182265)
- Mastodon anonymous access/limits: [Mastodon timelines API docs](https://docs.joinmastodon.org/methods/timelines/), [mastodon#19803 AUTHORIZED_FETCH + REST API](https://github.com/mastodon/mastodon/pull/19803), [Mastodon 4.5 for developers](https://blog.joinmastodon.org/2025/10/mastodon-4-5-for-devs/), [issue #11289 disable unauth API](https://github.com/tootsuite/mastodon/issues/11289)
- MCPB format: [modelcontextprotocol/mcpb MANIFEST.md](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md), [MCP blog — adopting .mcpb](https://blog.modelcontextprotocol.io/posts/2025-11-20-adopting-mcpb/), [MCPBundles format reference](https://www.mcpbundles.com/docs/concepts/mcpb-files)
- npm/npx/Windows spawn: [claude-code#58510 npx spawn ENOENT](https://github.com/anthropics/claude-code/issues/58510), [Cursor forum — spawn npx ENOENT](https://forum.cursor.com/t/facing-spawn-npx-enoent-error-when-setting-up-mcp-servers/120410), [aihero.dev — publish MCP server to npm](https://www.aihero.dev/publish-your-mcp-server-to-npm), [Mastra — publishing an MCP server](https://mastra.ai/guides/guide/publishing-mcp-server)
- Client env/cwd behavior: [MCP debugging docs](https://modelcontextprotocol.io/docs/tools/debugging), [claude-code#1254 env not passed](https://github.com/anthropics/claude-code/issues/1254), [Emmanuel Bernard — MCP servers and PATHs](https://emmanuelbernard.com/blog/2025/04/07/mcp-servers-and-claude-desktop-path/)
- Repo-specific interactions: `.planning/codebase/CONCERNS.md` (no-4xx-retry policy, SSRF chokepoint scope, unbounded cache, manifest scaffold status), `servers/hn/manifest.json` KNOWN GOTCHA note

---
*Pitfalls research for: medium-research-mcp v1.1 (author feeds, trending mining, Discourse, Mastodon, universal distribution)*
*Researched: 2026-07-08*
