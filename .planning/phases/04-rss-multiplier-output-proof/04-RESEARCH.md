# Phase 4: RSS Multiplier & Output Proof - Research

**Researched:** 2026-07-03
**Domain:** Arbitrary-URL XML/feed fetching (RSS 2.0 + Atom 1.0), SSRF hardening in Node native `fetch`, multi-source uniform-output proof
**Confidence:** HIGH

## Summary

This phase adds one Node MCP server — a generic `rss_fetch(url, limit?)` tool — that ingests any RSS 2.0 or Atom 1.0 feed and emits contract-shaped items with `score`/`num_comments` `null`, plus an automated OUT-02 proof that 5+ shipped sources merge through one branch-free rank/filter path. It is the project's **first server whose outbound host comes from untrusted tool input**, so SSRF is the headline engineering problem, not the parsing.

Three findings drive the plan. **(1) SSRF:** Node's native `fetch` (undici) exposes no built-in SSRF guard and auto-follows redirects, so protection must be built on the fetch path: scheme allowlist, resolve-and-classify every host IP, and re-validate on **every** redirect hop via `redirect: "manual"`. Node ships `net.BlockList` (verified available in this environment, Node ≥18) which does IPv4/IPv6 subnet classification natively — use it instead of hand-rolling CIDR math. **(2) Parser:** `fast-xml-parser` is the right library (MIT, 81.8M downloads/wk, canonical `NaturalIntelligence` repo), but **pin the `^4.5.7` `legacy` line, not v5** — v4 carries a single zero-dependency transitive (`strnum@1`), whereas v5.9.3 (published 2026-07-02) refactored into 6+ brand-new, low-download sub-packages, needlessly enlarging the supply-chain surface D-08 explicitly wants minimal. **(3) YouTube (YT-01):** confirmed live — `youtube.com/feeds/videos.xml?channel_id=<UC…>` returns an Atom feed whose `<entry>` maps cleanly onto the item schema; no new code beyond a documented recipe.

**Primary recommendation:** Add `getText(url, opts)` to `shared/http_client.js` reusing the exact cache/retry/stale core, with SSRF validation (`assertSafeUrl` + `redirect:"manual"` re-validation loop) on that path; build `servers/rss/server.js` copying the HN/Dev.to template, parsing with `fast-xml-parser@^4.5.7` behind a hand-written RSS/Atom normalize layer; add `RSS_ALLOWED_HOSTS` to `credentials.js`; and prove OUT-02 with a `node:test` that merges existing `test/fixtures/*.json` through one branch-free helper.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Scheme allowlist — accept `http`/`https` only; reject `file:`, `ftp:`, `gopher:`, `data:`, everything else with a clear error.
- **D-02:** Private-range denylist — resolve host and reject loopback (`127.0.0.0/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`), link-local incl. cloud-metadata (`169.254.0.0/16`, esp. `169.254.169.254`), CGNAT (`100.64/10`), IPv6 ULA (`fc00::/7`). Applies to the initial host **and every redirect hop** — re-validate on redirect, never blindly follow.
- **D-03:** Optional operator allowlist — `RSS_ALLOWED_HOSTS` (comma-separated hostnames) via `credentials.js`. When set, only those hosts are fetchable (lock-down); when unset, default = public-internet minus the D-02 denylist.
- **D-04:** Single `rss_fetch(url, limit?)` list tool returning the contract list envelope. Deliberate deviation from the `*_hot`/`*_search`/`*_get` trio: no `*_get` (items carry their own content, no detail endpoint), no `*_search` (the feed URL is the query). Justified in the tool description.
- **D-05:** Item mapping — `type: "article"` (already in TYPE enum, no extension), `title`/`author`/`created_utc`/`url`/`permalink`/`tags`(categories)/`text`(description or `content:encoded`, HTML-stripped); **`score` = null, `num_comments` = null**. Handle both RSS 2.0 (`rss>channel>item`) and Atom 1.0 (`feed>entry`). `query` in the envelope = the feed URL (or feed title).
- **D-06:** Subreddit `.rss` = a documented recipe, not a tool — `rss_fetch("https://www.reddit.com/r/<sub>/.rss")`. Documented in tool description + README.
- **D-07:** Add shared `getText(url, opts)` to `shared/http_client.js`, reusing the exact cache + retry/backoff + stale-fallback plumbing as `getJson`/`postJson`, returning raw response text (no `JSON.parse`). Servers never call `fetch` directly. SSRF host/redirect validation lives on this fetch path.
- **D-08:** Parse feeds with a single lightweight, zero/minimal-transitive-dependency XML parser (candidate: `fast-xml-parser`) plus a hand-written normalize layer mapping RSS 2.0 and Atom 1.0 onto the item schema. Hand-roll is the fallback if no acceptable dep exists.
- **D-09:** OUT-02 proof = automated `node:test` (`test/uniform-run.test.js`) feeding recorded fixtures from 5+ shipped sources through one generic merge/rank/filter path with ZERO `if (source === …)` branches; asserts full item schema + source-agnostic ranking (by `score`, nulls last) and filtering.
- **D-10:** Use recorded fixtures (not live network) for the CI assertion; additionally ship a runnable `examples/uniform-run.mjs` that hits live sources as a documented manual smoke (not a CI gate).
- **D-13:** The Python `youtube-blog-mcp` OCR wrapper is DROPPED. No Python server, no async-job scaffold, no OCR/transcript code.
- **D-14:** YouTube deliverable = surfacing candidate video links with a short explanation each, as normalized contract items. No output-contract exception needed.
- **D-15:** Delivery = a YouTube RSS recipe on the SRC-09 fetcher — `rss_fetch("https://www.youtube.com/feeds/videos.xml?channel_id=<ID>")` (or `?playlist_id=<ID>`). Documented in tool description + README. Known limitation: per-channel/playlist only, no keyword search (retired); user supplies channel/playlist IDs.

### Claude's Discretion
- Exact `getText` signature and redirect-validation mechanism; the chosen XML parser + normalize function names; RSS-vs-Atom field-precedence details; `rss_fetch` page-size/limit defaults; the uniform-run merge/rank helper name and fixture-set selection.
- (Provided the SSRF guards D-01/D-02, the `rss_fetch` output contract, and the allowlist D-03 hold.)

### Deferred Ideas (OUT OF SCOPE)
- RSS `*_search`/`*_get` (D-04 omits them).
- Feed persistence / polling / change-detection.
- v2 sources — Discourse (SRC-10), Mastodon (SRC-11), Bluesky (SRC-12).
- `.mcpb` packaging (PKG-01, v2) — manifest.json is scaffold/documentation only this phase.
- YouTube OCR/draft generation (permanently the user's own local Tesseract script).
- Keyword YouTube search (YouTube Data API — out of keyless scope).
- The Python `youtube-blog-mcp` server (dropped, D-13).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRC-09 | Generic RSS/Atom fetcher (any feed → newsletters, dev blogs, read-only subreddit `.rss`); feed-items with `score`/`num_comments` null. | Standard Stack (fast-xml-parser@4), Architecture Patterns (getText + normalize layer), SSRF Security Domain, RSS 2.0 + Atom 1.0 field maps (Code Examples). |
| OUT-02 | A single research run pulls from 5+ sources into one uniform list ranked/filtered with zero per-source branches. | OUT-02 Uniform-Run Proof section: branch-free merge/rank helper design over existing `test/fixtures/*.json`, plus `examples/uniform-run.mjs`. |
| YT-01 | Surface YouTube links + short explanations via the RSS fetcher's channel/playlist recipe; OCR/Python out of scope. | YouTube RSS Recipe section (live feed structure confirmed, field map to item schema). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Arbitrary feed URL fetch | Backend / shared HTTP (`getText` in `http_client.js`) | — | All HTTP is centralized (CLAUDE.md "never `fetch` directly"); the fetch path is where cache/retry/stale/SSRF must live so every text source inherits it. |
| SSRF validation (scheme/IP/redirect) | Backend / shared HTTP (`getText` path) | — | Untrusted tool input chooses the host; validation must sit on the single fetch chokepoint, not in the server, so it can't be bypassed and future text sources are covered. |
| Host allowlist (`RSS_ALLOWED_HOSTS`) | Config (`credentials.js`) | Backend HTTP | `credentials.js` is the only `process.env` reader (CRED-01); the value is consumed by the `getText` SSRF check. |
| RSS/Atom parse + normalize | Backend / RSS server (`servers/rss/`) | Shared contract (`normalizeItem`) | Source-specific field mapping is per-server; defaulting/HTML-strip/envelope stays in shared `contract.js`. |
| YouTube link surfacing | Backend / RSS server (recipe, no code) | Docs (README + tool description) | YouTube Atom is just another feed the same normalize layer handles; only documentation is new (D-15). |
| Uniform-run proof (OUT-02) | Test harness (`test/uniform-run.test.js`) | Optional shared merge/rank helper | The proof is an assertion over the contract, run offline against fixtures (D-09/D-10). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fast-xml-parser` | **`^4.5.7`** (the `legacy` dist-tag, NOT v5) | Parse RSS 2.0 + Atom 1.0 XML → JS object | MIT, 81.8M downloads/wk `[VERIFIED: npm registry]`, canonical `github.com/NaturalIntelligence` repo, single zero-dep transitive (`strnum@1`). Robust CDATA/namespace/entity handling that is error-prone to hand-roll (D-08). |
| `strnum` | `^1.0.5` (transitive of fast-xml-parser@4) | Numeric string coercion inside the parser | Zero dependencies `[VERIFIED: npm registry]` (v1 line); 67.9M downloads/wk; same vetted author. |
| `@modelcontextprotocol/sdk` | `^1.29.0` (already present) | MCP server + `registerTool` | Existing project dependency; unchanged. |
| `zod` | `^4.4` (already present) | Schema shapes for tools | Existing project dependency; unchanged. |
| `node:net` `BlockList` | built-in (Node ≥18) | IPv4/IPv6 subnet/CIDR classification for the SSRF denylist | Native — verified available in-env `[VERIFIED: node -e in this session]`; avoids a hand-rolled IP-range library. |
| `node:dns/promises` `lookup` | built-in | Resolve a feed host to its IP(s) before connect (SSRF) | Native; use `{ all: true }` to get **every** resolved address and classify all of them. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:url` `URL` | built-in | WHATWG parse/normalize of the feed URL and each `Location` redirect target | Every `getText` call — parse scheme/host, resolve relative redirects against the base. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fast-xml-parser@4` | `fast-xml-parser@5.9.3` (latest) | v5 pulls 6+ transitive deps (`is-unsafe`, `xml-naming`, `fast-xml-builder`, `@nodable/entities`, `path-expression-matcher`, `strnum@2`→`anynum`), several created within the last 1–3 months with low downloads — a larger supply-chain surface for no functional gain here. **Reject for this project.** |
| `fast-xml-parser` | `xml2js` (0.6.2) | Mature but pulls `sax` + `xmlbuilder` (~2 transitive deps), callback-based API, heavier. Acceptable but no advantage over fxp@4. |
| `fast-xml-parser` + hand-rolled normalize | `feedparser` (2.6.0) / `@rowanmanning/feed-parser` (2.1.3) | Feed-specific parsers do RSS/Atom mapping for you, but `feedparser` is stream-based (heavier integration) and `@rowanmanning/feed-parser` itself depends on `fast-xml-parser@^5.5.9` (drags in the v5 dep tree). Hand-rolling the ~40-line normalize keeps control of the exact contract mapping and the dep surface. |
| Custom CIDR math | `node:net` `BlockList` | Hand-rolled IP-range parsing is a classic SSRF bypass source (IPv4-mapped IPv6, octal/hex encodings). `BlockList` is native and correct. |

**Installation:**
```bash
npm install fast-xml-parser@^4.5.7
```
> Pin to the `legacy` major (`^4`), do **not** accept `^5`. Verify after install: `npm ls fast-xml-parser strnum` should show `fast-xml-parser@4.x` → `strnum@1.x` and **no other** transitive deps.

**Version verification (this session, 2026-07-03):**
- `npm view fast-xml-parser@4.5.7 dependencies` → `{ strnum: '^1.0.5' }`, license MIT `[VERIFIED]`
- `npm view strnum@1.1.2 dependencies` → empty (zero deps) `[VERIFIED]`
- `npm view fast-xml-parser dist-tags` → `{ legacy: '4.5.7', latest: '5.9.3' }` `[VERIFIED]`

## Package Legitimacy Audit

Ran `gsd-tools query package-legitimacy check --ecosystem npm fast-xml-parser strnum` plus manual `npm view` cross-checks.

| Package | Registry | Age | Downloads | Source Repo | Verdict (seam) | Disposition |
|---------|----------|-----|-----------|-------------|----------------|-------------|
| `fast-xml-parser@^4.5.7` | npm | created 2017-01-28 (8 yrs); v4.5.7 line current | 81.8M/wk | github.com/NaturalIntelligence/fast-xml-parser | SUS (`too-new`) | **Approved with checkpoint** — see note |
| `strnum@^1.0.5` | npm | v1 line mature | 67.9M/wk | github.com/NaturalIntelligence/strnum | SUS (`too-new`) | **Approved with checkpoint** — see note |

**Seam "too-new" is a false positive here (documented):** the seam keys `too-new` off the *latest published version's* timestamp. Both packages publish very frequently (fast-xml-parser 5.9.3 landed 2026-07-02), so the heuristic fires — but the **package** was created 2017-01-28, has 81.8M weekly downloads, the canonical maintainer repo, no `postinstall` script (`postinstall: null` in the seam signals), and is not deprecated. Manual evidence contradicts the `too-new` label. `npm view fast-xml-parser scripts.postinstall` → none.

**The real, actionable risk is version drift to v5, mitigated by pinning `^4`.** The v5 sub-packages (`is-unsafe`, `xml-naming`, `fast-xml-builder`, `@nodable/entities`, `path-expression-matcher`, `anynum`) are all authored by the same `amitgupta`/NaturalIntelligence maintainer (not a hijack), but are new and low-download — pinning `^4.5.7` avoids them entirely.

**Packages removed due to SLOP verdict:** none.
**Packages flagged SUS:** `fast-xml-parser`, `strnum` — per protocol, the planner should add one `checkpoint:human-verify` task before `npm install fast-xml-parser@^4.5.7`, confirming the resolved tree is `fast-xml-parser@4.x` + `strnum@1.x` only (`npm ls`), the lockfile records the expected `github.com/NaturalIntelligence` integrity hashes, and no `postinstall` runs.

## Architecture Patterns

### System Architecture Diagram

```
rss_fetch(url, limit?)  [untrusted url from tool input]
        │
        ▼
  servers/rss/server.js
   • validate limit (zod)
        │  getText(url)
        ▼
  shared/http_client.js  getText(url, opts)   ◄── NEW (D-07), sibling of getJson
   ┌──────────────────────────────────────────────┐
   │ 1. assertSafeUrl(url):                        │
   │      • URL parse (WHATWG)                     │
   │      • scheme ∈ {http,https}      (D-01)      │
   │      • host ∈ RSS_ALLOWED_HOSTS?  (D-03)      │
   │      • dns.lookup(host,{all:true})            │
   │      • every IP ∉ BlockList       (D-02)      │
   │ 2. getFresh(cacheKey)? → return (cache)       │
   │ 3. loop (max N hops):                         │
   │      fetch(url,{redirect:"manual"})           │
   │      if 3xx → resolve Location, assertSafeUrl │
   │              → re-loop        (redirect guard)│
   │      else → read .text()                      │
   │ 4. retry 5xx/network (500/1000/2000ms)        │
   │ 5. set(cacheKey, text); stale fallback        │
   └──────────────────────────────────────────────┘
        │ raw XML text
        ▼
  parseFeed(xml)  → fast-xml-parser@4  → JS object
        │
        ▼
  normalizeFeed(obj):  RSS 2.0 (rss>channel>item)  OR  Atom 1.0 (feed>entry)
        │  per-entry → { id,type:"article",title,author,score:null,
        │                num_comments:null,created_utc,url,permalink,tags,text }
        ▼
  buildListEnvelope({source:"rss", query:url, results})  → toolResult()
        │
        ▼
  { source, query, count, results:[…] }   ── consumed identically by medium-blog-pro
                                              and by the OUT-02 uniform-run proof
```

### Recommended Project Structure
```
servers/rss/
├── server.js            # rss_fetch tool + parseFeed + normalizeFeed (RSS+Atom)
├── manifest.json        # scaffold/doc only (PKG-01 deferred); user_config: {}
                         #   documents the subreddit .rss + YouTube recipes
shared/
├── http_client.js       # + getText(url, opts)  + assertSafeUrl (SSRF)  (D-07)
├── credentials.js       # + RSS_ALLOWED_HOSTS entry + rssAllowedHosts() (D-03)
test/
├── rss.test.js          # normalizeFeed units (RSS+Atom+YouTube fixtures) + registration
├── http_client.test.js  # + getText cache/retry/stale + assertSafeUrl SSRF cases
├── uniform-run.test.js   # OUT-02 branch-free merge/rank proof over 5+ fixtures (D-09)
└── fixtures/
    ├── rss-rss2.xml           # a real RSS 2.0 feed (e.g. a dev blog)
    ├── rss-atom.xml           # a real Atom 1.0 feed
    ├── rss-youtube.xml        # a real youtube.com/feeds/videos.xml capture (YT-01)
    └── rss-reddit.xml         # a real reddit /r/<sub>/.rss capture (D-06)
examples/
└── uniform-run.mjs      # live 5+-source demo (manual smoke, not CI — D-10)
```

### Pattern 1: `getText` as a text sibling of `getJson` (D-07)
**What:** A near-identical copy of `getJson`'s cache/retry/stale loop that returns `await response.text()` instead of `response.json()`, with the SSRF validation prepended and redirects handled manually.
**When to use:** Any non-JSON GET; RSS is the first caller.
**Key deltas from `getJson`:**
- Reuse `BACKOFF_MS`, `RETRYABLE_5XX`, `DEFAULT_TTL_MS`, `DEFAULT_TIMEOUT_MS`, `redactUrl`, `getFresh/getStale/set`, the `RetryableError`/timeout/network classification, and the `transientFailure` stale-fallback gate **verbatim** — do not fork the resilience policy.
- Replace `response.json()` (+ non-JSON→RetryableError) with `response.text()`. An empty body can be treated as a normal (possibly retryable) result; XML validity is the parser's concern, not the HTTP layer's.
- Pass `redirect: "manual"` in the `init` and drive the redirect loop yourself (see Pattern 2). Native `fetch` otherwise follows up to 20 redirects automatically **without** re-checking the SSRF policy per hop — that is the DNS-rebinding / redirect-to-internal hole.
- Keep `fetchImpl`/`sleep` injectable (tests). Add an injectable resolver (e.g. `opts.lookup = dnsLookup`) so SSRF tests can force a host to "resolve" to `169.254.169.254` without real DNS.

### Pattern 2: SSRF validate-then-fetch with per-hop redirect re-validation
**What:** Validate the URL, fetch with `redirect:"manual"`, and on any 3xx re-validate the `Location` target before following — capped at a small hop limit.
**When to use:** The `getText` path, before and between every network hop.
**Example:**
```javascript
// shared/http_client.js  — SSRF guard (OWASP SSRF Prevention in Node.js, 6-step)
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { rssAllowedHosts } from "./credentials.js";

// D-02 denylist — native subnet classification, no hand-rolled CIDR math.
const DENY = new BlockList();
// IPv4
DENY.addSubnet("0.0.0.0", 8, "ipv4");        // "this host"
DENY.addSubnet("10.0.0.0", 8, "ipv4");       // RFC1918 private
DENY.addSubnet("100.64.0.0", 10, "ipv4");    // CGNAT
DENY.addSubnet("127.0.0.0", 8, "ipv4");      // loopback
DENY.addSubnet("169.254.0.0", 16, "ipv4");   // link-local incl. 169.254.169.254 metadata
DENY.addSubnet("172.16.0.0", 12, "ipv4");    // RFC1918 private
DENY.addSubnet("192.0.0.0", 24, "ipv4");     // IETF protocol assignments
DENY.addSubnet("192.168.0.0", 16, "ipv4");   // RFC1918 private
DENY.addSubnet("198.18.0.0", 15, "ipv4");    // benchmarking
DENY.addSubnet("224.0.0.0", 4, "ipv4");      // multicast
DENY.addSubnet("240.0.0.0", 4, "ipv4");      // reserved
// IPv6
DENY.addAddress("::1", "ipv6");              // loopback
DENY.addSubnet("fc00::", 7, "ipv6");         // ULA (private)
DENY.addSubnet("fe80::", 10, "ipv6");        // link-local
DENY.addSubnet("ff00::", 8, "ipv6");         // multicast

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// Returns the validated URL (throws a clear error on any violation). `lookup` is
// injectable so tests can force a resolved IP without real DNS.
export async function assertSafeUrl(rawUrl, { lookup = dnsLookup } = {}) {
  let u;
  try { u = new URL(rawUrl); }
  catch { throw new Error(`rss: invalid URL`); }

  if (!ALLOWED_SCHEMES.has(u.protocol))                       // D-01
    throw new Error(`rss: scheme ${u.protocol} not allowed (http/https only)`);

  const allow = rssAllowedHosts();                            // D-03
  if (allow && !allow.has(u.hostname.toLowerCase()))
    throw new Error(`rss: host ${u.hostname} not in RSS_ALLOWED_HOSTS`);

  // Resolve EVERY address the host maps to and reject if ANY is internal.
  const addrs = await lookup(u.hostname, { all: true });      // D-02
  for (const { address } of addrs) {
    // Canonicalize IPv4-mapped IPv6 (::ffff:169.254.169.254) before checking.
    const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
    const fam = isIP(ip) === 6 ? "ipv6" : "ipv4";
    if (DENY.check(ip, fam))
      throw new Error(`rss: host ${u.hostname} resolves to a blocked address`);
  }
  return u;
}

const MAX_REDIRECTS = 5;
// Inside getText's attempt loop, replace the single fetch with a redirect loop:
async function fetchTextManual(fetchImpl, startUrl, init, timeoutMs, lookup) {
  let url = (await assertSafeUrl(startUrl, { lookup })).href;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchWithTimeout(
      fetchImpl, url, { ...init, redirect: "manual" }, timeoutMs);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;                       // 3xx w/o Location — let caller handle
      url = (await assertSafeUrl(new URL(loc, url).href, { lookup })).href; // re-validate!
      continue;
    }
    return res;                                   // 2xx/4xx/5xx handled by getText loop
  }
  throw new Error(`rss: too many redirects`);
}
```
> **Source:** [OWASP SSRF Prevention in Node.js](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs) 6-step model (normalize → scheme allow → WHATWG URL → resolve+classify → per-redirect re-validate → disable auto-redirect/short timeouts). CIDR list per RFC1918/RFC6598/RFC3927/RFC4193.

### Pattern 3: RSS-vs-Atom dialect detection + normalize (D-05)
**What:** After `fast-xml-parser` produces the object, branch once on the root element (`rss`/`rdf:RDF` = RSS/RDF, `feed` = Atom) to pick the entry list and field map, then funnel both into `normalizeItem`.
**When to use:** The single `normalizeFeed(parsed, feedUrl)` function.
See **Code Examples** for the concrete field maps.

### Anti-Patterns to Avoid
- **Validating the hostname string but letting `fetch` re-resolve DNS at connect** — the TOCTOU/rebinding gap (see Pitfall 1). Re-validate on redirects; accept or close the residual gap deliberately.
- **Blocking only `127.0.0.1`/`localhost`** — misses `169.254.169.254`, `[::1]`, `0.0.0.0`, IPv4-mapped IPv6, decimal/octal IP encodings. Use `BlockList` + canonicalization.
- **Letting native `fetch` auto-follow redirects** — a public feed can 302 to `http://169.254.169.254/…`. Always `redirect:"manual"`.
- **Regex-parsing XML** — CDATA, namespaces (`content:encoded`, `dc:creator`, `media:*`), and entity edge cases break naive regex. Use the parser (D-08).
- **Deriving `score` from YouTube `media:statistics views`** — D-05 fixes RSS `score`/`num_comments` to `null` for a uniform RSS row (§5). Keep them null even though the YouTube feed exposes view counts.
- **Putting `RSS_ALLOWED_HOSTS` reads anywhere but `credentials.js`** — violates CRED-01.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IPv4/IPv6 range classification | Custom CIDR/bitmask math | `node:net` `BlockList` | Native, handles IPv6 + subnets; hand-rolled range math is a top SSRF-bypass source. |
| XML → object parsing | Regex / string scanning | `fast-xml-parser@4` | CDATA, namespaces, entities, both dialects, quirky reddit `.rss` — robust and battle-tested. |
| HTTP cache / retry / stale | A second fetch wrapper | Extend `getText` on the existing `http_client.js` core | The resilience policy (backoff steps, no-4xx-retry, stale gate) is already correct and tested — reuse it, don't fork. |
| HTML→text in `text` | New stripper | `shared/contract.js` `stripHtml` (via `normalizeItem`) | Already centralized (OUT-03); handles entities + tag removal. |
| Envelope assembly / null defaulting | Per-server object building | `buildListEnvelope`/`normalizeItem`/`toolResult` | The contract linchpin; guarantees `score`/`num_comments` never drift. |
| Date parsing | Custom RFC-822 / ISO parser | `new Date(str)` then `.toISOString()` | JS `Date` parses both RFC-822 (RSS `pubDate`) and ISO-8601 (Atom `updated`/`published`); guard `NaN` → `null` (see Pitfall 4). |

**Key insight:** Almost everything in this server is already solved by shared modules. The *only* genuinely new logic is (a) the SSRF guard on `getText` and (b) the ~40-line RSS/Atom field map. Keep both small and heavily unit-tested.

## Common Pitfalls

### Pitfall 1: DNS-rebinding / TOCTOU between validate and connect
**What goes wrong:** `assertSafeUrl` resolves `evil.com` → a public IP and passes; native `fetch` then does its *own* DNS resolution at connect time, which returns `127.0.0.1` (attacker flips the record between the two lookups).
**Why it happens:** Native `fetch`/undici does not accept a pre-resolved IP or expose a validating connect hook without a custom dispatcher.
**How to avoid:** For this **local, single-user, personal-use MCP tool** the pragmatic level is: validate the host + re-validate every redirect hop (closes the far more common redirect-to-internal vector), and document the residual rebinding gap. If a stronger guarantee is wanted later, pass an undici `Agent` with a custom `connect.lookup` that runs `BlockList` at socket-connect time (`import { Agent } from "undici"; fetch(url, { dispatcher })`) — this validates the *actual* connected IP and closes TOCTOU. Note: a custom dispatcher is **not** exercised by the project's injected `fetchImpl` test stub, so the `redirect:"manual"` + `assertSafeUrl` approach is the testable primary; the dispatcher is an optional hardening layer.
**Warning signs:** SSRF test only checks the initial hostname string, never a resolved IP.

### Pitfall 2: `content:encoded` and namespaced fields lost by the parser
**What goes wrong:** RSS `text` comes back empty because the richer body lives in `<content:encoded>` (namespaced), and the author is in `<dc:creator>`, not `<author>`.
**Why it happens:** By default `fast-xml-parser` keeps the prefixed key literally (`"content:encoded"`, `"dc:creator"`) unless `removeNSPrefix: true` is set.
**How to avoid:** Decide the parser options explicitly. Recommended: keep prefixes (do **not** set `removeNSPrefix`) and read the exact keys — `item["content:encoded"] ?? item.description` for text, `item["dc:creator"] ?? item.author` for author. Set `ignoreAttributes: false` so Atom `<link href="…" rel="alternate">` attributes and `yt:videoId` are readable. Capture a real fixture per dialect and assert against it.
**Warning signs:** `text` null on feeds that clearly have full-content bodies; author null on feeds using Dublin Core.

### Pitfall 3: Atom `<link>` is an array; pick `rel="alternate"`
**What goes wrong:** Atom entries have multiple `<link>` elements (`alternate`, `self`, `enclosure`); grabbing `entry.link.href` yields the wrong URL or `undefined` when it's an array.
**Why it happens:** `fast-xml-parser` returns a single object for one `<link>` but an array for many — shape varies per entry.
**How to avoid:** Normalize to an array (`[].concat(entry.link ?? [])`), then find `rel === "alternate"` (default to the first). RSS `<link>` is a plain string — handle both. YouTube's watch URL is exactly the `rel="alternate"` href (`https://www.youtube.com/watch?v=<id>`), confirmed live.
**Warning signs:** `url` intermittently null or pointing at the feed's `self` URL.

### Pitfall 4: RFC-822 vs ISO-8601 dates, and unparseable dates
**What goes wrong:** RSS `pubDate` is RFC-822 (`Wed, 02 Jul 2026 16:56:30 GMT`); Atom `published`/`updated` is ISO-8601. A naive parser or a malformed date yields `Invalid Date` → `.toISOString()` throws.
**Why it happens:** Two date formats across dialects; feeds in the wild carry junk dates.
**How to avoid:** `const d = new Date(raw); created_utc = isNaN(d) ? null : d.toISOString();` — JS `Date` handles both formats; guard `NaN`. (Mirrors the null-safe `toIso` helpers already in `hn`/`stackexchange`.)
**Warning signs:** A tool call throwing on a single bad feed instead of returning `created_utc: null`.

### Pitfall 5: single-item feeds parse as an object, not an array
**What goes wrong:** A feed with exactly one `<item>`/`<entry>` gives `channel.item` as an object; `.map()` throws.
**Why it happens:** `fast-xml-parser` collapses a single repeated element to a scalar object unless told otherwise.
**How to avoid:** Normalize with `const entries = [].concat(channel.item ?? feed.entry ?? [])` before mapping, **or** set `isArray` in parser options for `item`/`entry`. Test with a one-item fixture.
**Warning signs:** Crash on short/new feeds; works on long ones.

### Pitfall 6: HTML/XHTML block pages returned with 200
**What goes wrong:** A host returns an HTML error/consent page (200) that isn't a feed; the parser yields an object with no `rss`/`feed` root and mapping dereferences `undefined`.
**Why it happens:** `getText` (unlike `getJson`) can't detect "not a feed" from the HTTP layer.
**How to avoid:** After parsing, detect the root; if neither `rss`/`rdf:RDF`/`feed` is present, throw a clear `rss: <url> is not a valid RSS/Atom feed` (same guard-clause discipline as `requireSeQuestion`/`requireDevtoArticle`). Do **not** serve a junk item.
**Warning signs:** Envelope with `count:0` on a URL you know has content, or an uncaught TypeError.

### Pitfall 7: `registerTool` needs the RAW Zod shape
**What goes wrong:** Passing `z.object({...})` as `inputSchema`/`outputSchema` breaks at SDK 1.29.
**How to avoid:** Pass `listEnvelopeShape` and a raw `{ url: z.string().url(), limit: z.number().int().min(1).max(...).optional() }` — exactly as HN/Dev.to do (documented in `contract.js`).
**Warning signs:** Tool fails to register or output validation errors on return.

## Code Examples

### RSS 2.0 → item schema (field map, D-05)
```javascript
// Source: RSS 2.0 spec (https://www.rssboard.org/rss-specification) — rss>channel>item
// item.guid|link -> id ; "article" -> type ; item.title -> title
// item["dc:creator"] ?? item.author -> author
// score = null ; num_comments = null                              (D-05 / ARCHITECTURE §5)
// item.pubDate (RFC-822) -> created_utc (Date→ISO, NaN→null)
// item.link -> url & permalink
// [].concat(item.category ?? []) -> tags
// item["content:encoded"] ?? item.description -> text (stripHtml downstream)
function mapRssItem(item) {
  const d = new Date(item.pubDate);
  return {
    id: String(item.guid?.["#text"] ?? item.guid ?? item.link ?? item.title),
    type: "article",
    title: item.title ?? "",
    author: item["dc:creator"] ?? item.author ?? null,
    score: null,
    num_comments: null,
    created_utc: isNaN(d) ? null : d.toISOString(),
    url: item.link ?? null,
    permalink: item.link ?? null,
    tags: [].concat(item.category ?? [])
             .map((c) => (typeof c === "object" ? c["#text"] : c))
             .filter(Boolean),
    text: item["content:encoded"] ?? item.description ?? null,
  };
}
```

### Atom 1.0 → item schema (field map, D-05)
```javascript
// Source: RFC 4287 (Atom) — feed>entry
// entry.id -> id ; entry.title -> title ; entry.author.name -> author
// entry.updated ?? entry.published (ISO-8601) -> created_utc
// link[rel=alternate].href -> url & permalink
// entry.summary ?? entry.content -> text
function pickAlternate(link) {
  const links = [].concat(link ?? []);
  const alt = links.find((l) => l?.rel === "alternate") ?? links[0];
  return alt?.href ?? (typeof alt === "string" ? alt : null);
}
function mapAtomEntry(entry) {
  const raw = entry.updated ?? entry.published;
  const d = new Date(raw);
  const href = pickAlternate(entry.link);
  const content = typeof entry.content === "object"
    ? entry.content["#text"] : entry.content;
  return {
    id: String(entry.id ?? href ?? entry.title),
    type: "article",
    title: (typeof entry.title === "object" ? entry.title["#text"] : entry.title) ?? "",
    author: entry.author?.name ?? null,
    score: null,
    num_comments: null,
    created_utc: isNaN(d) ? null : d.toISOString(),
    url: href,
    permalink: href,
    tags: [].concat(entry.category ?? []).map((c) => c?.term ?? c).filter(Boolean),
    text: entry.summary ?? content ?? null,
  };
}
```

### YouTube Atom entry → item schema (YT-01, D-15) — confirmed against a live feed
```javascript
// Source: live GET youtube.com/feeds/videos.xml?channel_id=UC... (2026-07-03)
// It IS an Atom feed, so mapAtomEntry already handles most of it. YouTube extras:
//   entry["yt:videoId"]                    -> canonical id (also in link[alternate])
//   link[rel=alternate].href               -> "https://www.youtube.com/watch?v=<id>" (url)
//   entry.author.name                      -> channel name (author)
//   entry.published                        -> created_utc
//   entry["media:group"]["media:description"] -> richer text than entry.summary
//   entry["media:group"]["media:community"]["media:statistics"]["@_views"] -> views
//        (DELIBERATELY NOT mapped to score — D-05 keeps score null for the RSS row)
function youtubeText(entry) {
  return entry["media:group"]?.["media:description"] ?? entry.summary ?? null;
}
// Recipe (documented in tool description + README, no special-casing in code):
//   rss_fetch("https://www.youtube.com/feeds/videos.xml?channel_id=UCXuqSBlHAE6Xw-yeJA0Tunw")
//   rss_fetch("https://www.youtube.com/feeds/videos.xml?playlist_id=PL...")
// Handle→channel_id: view-source the channel page for `"externalId":"UC..."`, or use
// the RSS-generator tools noted in Sources. Native feed returns ~15 most-recent videos.
```
> **Note (media:group text detection):** because the richer body sits in `media:group>media:description`, either special-case it in `normalizeFeed` for `youtube.com` hosts *or* (cleaner, branch-free) extend `mapAtomEntry` to prefer `media:group>media:description` when present — the latter keeps YT-01 as pure config with zero YouTube-specific code paths, honoring D-14/D-15.

### OUT-02 branch-free merge/rank (D-09)
```javascript
// The whole thesis: NO `if (source === ...)`. Every source already yields the same
// item shape, so merge is a flat concat and rank is one comparator (nulls last).
export function mergeRank(envelopes) {                  // envelopes: ListEnvelope[]
  const items = envelopes.flatMap((e) => e.results);    // uniform items, no per-source code
  return items.sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;                      // nulls last
    if (b.score == null) return -1;
    return b.score - a.score;                           // score desc
  });
}
// filter is likewise source-agnostic, e.g. by tag / recency / min-score over the
// contract fields only.
```

## OUT-02 Uniform-Run Proof (design)

**CI assertion — `test/uniform-run.test.js` (D-09/D-10, offline):**
1. Load ≥5 existing fixtures spanning different sources, e.g. `hn-story.json`, `stackexchange-list.json`, `lobsters-list.json`, `devto-list.json`, `github-repos.json`, and the new `rss-atom.xml` (parsed) — deliberately mixing sources whose `score` means points/votes/upvotes/reactions/stars and RSS whose score is `null`.
2. Map each through its server's existing `map*` helper into `buildListEnvelope` (import the mappers; the test only exercises the *merge*, not the network).
3. Feed all envelopes through **one** `mergeRank([...])` call (no source branches).
4. Assert: (a) every merged item `.parse()`s against `ItemSchema` (full contract shape); (b) ordering is non-increasing by `score` with all `null`-score items (the RSS ones) at the tail; (c) a source-agnostic `.filter()` (e.g. by a tag or min-score) works uniformly. A structural guard — `assert.ok(!/if\s*\(\s*source/.test(mergeRankSource))` or simply the absence of any source param in `mergeRank`'s signature — documents "zero per-source branches."

**Helper placement (Claude's discretion, recommendation):** put `mergeRank` in `shared/rank.js` rather than test-local. Rationale: it is exactly the branch-free operation the `medium-blog-pro` skill performs, so shipping it as shared infra (a) makes the OUT-02 proof assert the *real* code path, and (b) gives the consumer a reference. It reads only contract fields, so it introduces no source coupling. Keep it tiny (merge + rank + one filter example).

**Live demo — `examples/uniform-run.mjs` (D-10, manual smoke, not CI):** `import` 5+ server modules, call one tool on each over the live network, `mergeRank` the envelopes, print the top N. Documented in README as a manual smoke like the Phase 3 keyed smokes (per the MEMORY "live-API smokes deferred" pattern — it verifies wiring, not a CI gate).

## Runtime State Inventory

> Greenfield addition (a new server + shared helpers). No rename/migration.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore; the only persistence is the in-memory TTL cache (resets on restart). | None. |
| Live service config | None — `rss_fetch` takes the host from tool input; no external service registration. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | New optional env var `RSS_ALLOWED_HOSTS` (D-03) — additive; unset = default public-internet-minus-denylist mode. No existing var renamed. | Add to `ENV_VAR` in `credentials.js`, `.env.example`, and (scaffold) manifest docs. |
| Build artifacts | `package.json`/lockfile gain `fast-xml-parser@^4` + `strnum@1`. | `npm install`; commit lockfile. |

## Common Pitfalls Recap → Verification hooks

Each pitfall maps to a test in `test/rss.test.js` / `test/http_client.test.js`:
- SSRF: `assertSafeUrl` rejects `file://`, `http://127.0.0.1`, `http://169.254.169.254`, `http://[::1]`, a host whose injected `lookup` returns a private IP, and a 302→internal `Location`; accepts a normal public feed; `RSS_ALLOWED_HOSTS` lock-down accepts only listed hosts.
- Parsing: RSS-2.0, Atom-1.0, YouTube, and reddit `.rss` fixtures each map to schema-valid items; one-item feed; `content:encoded`/`dc:creator`; RFC-822 vs ISO date; non-feed HTML → clear error.
- Contract: `ListEnvelopeSchema.parse(env)` passes; `score`/`num_comments` are `null`; registration smoke lists exactly `["rss_fetch"]` with an `outputSchema`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SSRF via a 3rd-party agent (`request-filtering-agent`, `ssrf-req-filter`) | Native `net.BlockList` + `dns.lookup({all}) ` + `redirect:"manual"` on native `fetch` | Node ≥18 (BlockList since 15) | No new runtime dep; keeps the keyless/minimal-dep posture. |
| `fast-xml-parser@4` single-dep | `fast-xml-parser@5` modular (6+ sub-packages) | v5 line, 2026 | For a minimal-surface project, **stay on v4** (`legacy` tag). |
| YouTube keyword-search RSS feed | Retired by YouTube — only channel_id/playlist_id feeds remain | pre-2026 | YT-01 is per-channel/playlist by design (D-15); keyword search needs the paid Data API (out of scope). |

**Deprecated/outdated:**
- YouTube `gdata`/search RSS endpoints — gone; do not attempt.
- Node `http.get` with manual socket handling for feeds — unnecessary; native `fetch` + `redirect:"manual"` suffices.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `net.BlockList` + injectable `dns.lookup` gives adequate SSRF protection for a **local single-user** MCP tool; residual DNS-rebinding TOCTOU is accepted and documented. | Security Domain / Pitfall 1 | If the tool is ever exposed multi-tenant/server-side, the TOCTOU gap becomes exploitable — would need the undici custom-`lookup` dispatcher. Low risk given the personal-use constraint. |
| A2 | `fast-xml-parser@4` parses the real reddit `/r/<sub>/.rss` and arbitrary dev-blog feeds without extra options beyond `ignoreAttributes:false` (+ namespace handling). | Standard Stack / Pitfall 2 | If a real feed needs different options, the normalize layer/options need a tweak — caught by fixture tests. Mitigation: capture real fixtures during the plan, not synthetic ones. |
| A3 | Keeping RSS `score`/`num_comments` `null` even for YouTube (which exposes view counts) is the intended uniform behavior (per D-05/§5). | Anti-Patterns / Code Examples | If the user later wants YouTube views as `score`, that's a small map change — but it would break the "RSS row = null" uniformity (§5). Confirm during discuss if desired. |
| A4 | The seam `SUS/too-new` on `fast-xml-parser`/`strnum` is a false positive (evidence: 81.8M/67.9M downloads, 2017 creation, canonical repo, no postinstall). | Package Legitimacy Audit | If the checkpoint reveals an unexpected tree (e.g. a typosquat resolving), stop. Low risk — cross-checked manually this session. |

## Open Questions

1. **Reddit `.rss` User-Agent / rate-limits.**
   - What we know: `reddit.com/r/<sub>/.rss` is a public Atom feed; Reddit is strict about a real UA on its JSON API.
   - What's unclear: whether the `.rss` path 429s without a UA. `getText` should send `userAgent()` (already in `credentials.js`) as a default header — cheap insurance.
   - Recommendation: default `getText` headers to include `User-Agent: userAgent()`; capture a real reddit `.rss` fixture during planning to confirm.

2. **Handle→channel_id resolution ergonomics (YT-01).**
   - What we know: the user supplies channel/playlist IDs (D-15); `@handle` isn't directly a feed param.
   - What's unclear: whether to document only the manual "view-source for `externalId`" method or also mention 3rd-party generator tools.
   - Recommendation: document the manual method (no dependency, always works) in the README recipe; mention generators as convenience only.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v25.9.0 (≥18 required) | — |
| `net.BlockList` | SSRF denylist | ✓ | built-in (verified in-env) | — |
| `dns/promises.lookup` | SSRF resolution | ✓ | built-in | — |
| `fast-xml-parser@^4.5.7` | RSS/Atom parse | ✗ (not yet installed) | 4.5.7 available on npm | Hand-rolled parser (D-08 fallback) — avoid; large effort |
| npm registry | install parser | ✓ (verified via `npm view`) | — | — |
| Live feed endpoints (reddit/youtube/dev blogs) | manual smoke only | ✓ (YouTube feed fetched live this session) | — | Offline fixture tests are the CI path (D-10) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `fast-xml-parser` (install step; hand-roll is the documented but undesirable fallback).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (built-in) |
| Config file | none — `package.json` `"test": "node --test"` |
| Quick run command | `node --test test/rss.test.js` |
| Full suite command | `npm test` (`node --test`, runs all `test/*.test.js`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRC-09 | RSS 2.0 + Atom fixtures map to schema-valid items; `score`/`num_comments` null | unit | `node --test test/rss.test.js` | ❌ Wave 0 |
| SRC-09 | SSRF: reject file://, loopback, 169.254.169.254, ::1, injected-private-IP, redirect→internal; allow public; allowlist lock-down | unit | `node --test test/http_client.test.js` | ⚠️ extend existing |
| SRC-09 | `getText` cache hit / 5xx retry / stale fallback (mirrors getJson tests) | unit | `node --test test/http_client.test.js` | ⚠️ extend existing |
| SRC-09 | Non-feed HTML → clear error; one-item feed; RFC-822 vs ISO date | unit | `node --test test/rss.test.js` | ❌ Wave 0 |
| YT-01 | YouTube feed fixture → watch-URL `url`, channel `author`, `media:description` text | unit | `node --test test/rss.test.js` | ❌ Wave 0 |
| OUT-02 | 5+ source fixtures merge branch-free; schema-valid; score-desc nulls-last; source-agnostic filter | integration (offline) | `node --test test/uniform-run.test.js` | ❌ Wave 0 |
| SRC-09 | Registration smoke: exactly `rss_fetch`, has outputSchema | unit | `node --test test/rss.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/rss.test.js` (or the touched test file).
- **Per wave merge:** `npm test` (full suite green).
- **Phase gate:** Full suite green before `/gsd-verify-work`; live `examples/uniform-run.mjs` smoke recorded as a manual UAT item (keyless, so it can run without credentials — unlike the deferred keyed smokes).

### Wave 0 Gaps
- [ ] `test/fixtures/rss-rss2.xml` — real RSS 2.0 capture (SRC-09)
- [ ] `test/fixtures/rss-atom.xml` — real Atom 1.0 capture (SRC-09)
- [ ] `test/fixtures/rss-youtube.xml` — real `youtube.com/feeds/videos.xml` capture (YT-01)
- [ ] `test/fixtures/rss-reddit.xml` — real `/r/<sub>/.rss` capture (D-06)
- [ ] `test/rss.test.js` — normalize + registration + guard tests
- [ ] `test/uniform-run.test.js` — OUT-02 merge/rank proof
- [ ] `test/http_client.test.js` — extend with `getText` + `assertSafeUrl` cases
- [ ] Framework install: `npm install fast-xml-parser@^4.5.7` (behind the legitimacy checkpoint)

## Security Domain

SSRF is the defining security concern of this phase (`security_enforcement` enabled — this section is required).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | `zod` on `rss_fetch` input (`url` is a string; deep validation is in `assertSafeUrl`); reject non-http(s) schemes. |
| V5.2.6 SSRF / URL fetch | **yes (primary)** | Scheme allowlist (D-01), resolve+`BlockList` denylist (D-02), per-redirect re-validation, optional host allowlist (D-03). |
| V12/V13 Server-side request (SSRF) | yes | `redirect:"manual"` + re-validate each hop; short timeout (10s, existing); no auto-retry beyond the resilience policy. |
| V7 Error Handling & Logging | yes | Errors name only the URL origin/path via existing `redactUrl`; no secret in `RSS_ALLOWED_HOSTS` path anyway (it's not a secret). |
| V2 Authentication | no | RSS is unauthenticated (§5). |
| V6 Cryptography | no | No crypto beyond the existing `sha1` cache-key helper (non-security use). |

### Known Threat Patterns for an arbitrary-URL fetch
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Fetch cloud metadata `169.254.169.254` | Information Disclosure | `BlockList` link-local `169.254.0.0/16` (D-02). |
| Loopback / internal service scan (`127.0.0.1`, `10/8`, `192.168/16`) | Information Disclosure / Elevation | `BlockList` loopback+RFC1918 (D-02). |
| `file://` / `gopher://` / `data:` scheme abuse | Tampering / Info Disclosure | Scheme allowlist http/https only (D-01). |
| Public feed 302→`http://169.254.169.254/…` | Info Disclosure | `redirect:"manual"` + `assertSafeUrl` on every `Location` (D-02). |
| DNS rebinding (public→internal between check and connect) | Info Disclosure | Re-validate per hop; residual TOCTOU documented; optional undici custom-`lookup` dispatcher closes it (A1). |
| IPv4-mapped IPv6 / alternate IP encodings bypass | Info Disclosure | Canonicalize `::ffff:` before `BlockList`; use WHATWG `URL` + `net.isIP` (never string-compare). |
| Non-feed/huge-body resource abuse | DoS | 10s timeout (existing), `limit` cap on emitted items; consider a max-bytes read (discretion). |

## Sources

### Primary (HIGH confidence)
- [OWASP SSRF Prevention in Node.js](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs) — 6-step model (scheme allow, WHATWG URL, DNS resolve+classify, per-redirect re-validate, disable auto-redirect, short timeouts). `[CITED]`
- Node.js core `net.BlockList`, `dns/promises.lookup`, `net.isIP` — verified available in-env (`node -e`, Node v25.9.0). `[VERIFIED: node in this session]`
- npm registry `npm view` (this session): `fast-xml-parser@4.5.7` deps `{strnum:^1.0.5}`, `strnum@1.1.2` zero deps, dist-tags `{legacy:4.5.7, latest:5.9.3}`, 81.8M/67.9M weekly downloads, MIT, NaturalIntelligence repo. `[VERIFIED: npm registry]`
- Live GET `youtube.com/feeds/videos.xml?channel_id=UCXuqSBlHAE6Xw-yeJA0Tunw` (2026-07-03) — confirmed Atom `<entry>` with `yt:videoId`, `link[rel=alternate]` watch URL, `author>name`, `published`, `media:group>media:description`, `media:community>media:statistics@views`. `[VERIFIED: live fetch]`
- Project source: `shared/http_client.js`, `shared/contract.js`, `shared/credentials.js`, `shared/cache.js`, `servers/{hn,stackexchange,devto}/server.js`, `test/devto.test.js`, `test/http_client.test.js` — the exact templates/patterns to extend. `[VERIFIED: codebase read]`

### Secondary (MEDIUM confidence)
- RSS 2.0 spec (rssboard.org) and RFC 4287 (Atom) field structure — standard, applied to the field maps. `[CITED]`
- [nodejs/undici #2019 — SSRF in native fetch](https://github.com/nodejs/undici/issues/2019) — confirms native fetch has no built-in SSRF guard; validate before fetch. `[CITED]`
- YouTube RSS feed format guides (guissmo.com, chuck.is) — channel_id/playlist_id URL forms, `UULF` long-form-only playlist trick, ~15-item cap. `[CITED]`

### Tertiary (LOW confidence)
- General SSRF npm packages (`request-filtering-agent`, `ssrf-req-filter`, `dssrf`) — noted as alternatives; not recommended (native approach preferred). `[ASSUMED]`

## Project Constraints (from CLAUDE.md)

- Every list tool returns `{ source, query, count, results:[item] }`; item schema fixed; `score`/`num_comments` may be `null` but **never renamed or dropped**. RSS: both null.
- Return an object → SDK emits both `structuredContent` and JSON-text `content` (use `toolResult`).
- **Never call `fetch` directly in a server** — go through `http_client.js` (`getText` added there, D-07).
- **Never read `process.env` outside `credentials.js`** — `RSS_ALLOWED_HOSTS` goes in `ENV_VAR` there (D-03).
- Fetch through the shared client to inherit caching/retry/stale.
- Optional creds degrade gracefully; RSS needs none (keyless). `RSS_ALLOWED_HOSTS` is an optional hardening knob, not a credential.
- Don't scrape sources without a usable API — RSS/Atom feeds are the API.
- Tool output trimmed + LLM-readable; HTML stripped from `text` (via `stripHtml`).
- All work goes through a GSD workflow (`.claude/CLAUDE.md` enforcement).

## Metadata

**Confidence breakdown:**
- Standard stack (fast-xml-parser@4 pin): HIGH — deps/downloads/license/dist-tags verified this session.
- SSRF architecture: HIGH — OWASP-aligned, `net.BlockList`/`dns.lookup` verified in-env, testable with injected fetch/lookup.
- RSS/Atom field maps: HIGH — standard specs + confirmed live YouTube structure; MEDIUM only on per-feed option quirks (mitigated by real fixtures).
- OUT-02 design: HIGH — built directly on existing fixtures + the contract.
- Package legitimacy: MEDIUM — seam SUS/too-new is a documented false positive; planner checkpoint recommended.

**Research date:** 2026-07-03
**Valid until:** 2026-08-02 (stable; recheck the fast-xml-parser `legacy` dist-tag before install in case the v4 line advances).
