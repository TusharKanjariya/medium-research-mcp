---
phase: 04-rss-multiplier-output-proof
plan: 03
subsystem: rss-server
tags: [rss, atom, youtube, reddit, fast-xml-parser, ssrf, contract, src-09, yt-01]

# Dependency graph
requires:
  - phase: 04-rss-multiplier-output-proof (04-01)
    provides: getText (SSRF-guarded text fetch) + assertSafeUrl + rssAllowedHosts
  - phase: 04-rss-multiplier-output-proof (04-02)
    provides: fast-xml-parser@4.5.7 runtime dependency
provides:
  - servers/rss/server.js — single rss_fetch(url, limit?) tool (D-04) mapping RSS 2.0 / RDF / Atom 1.0 onto the contract
  - parseFeed / normalizeFeed / mapRssItem / mapAtomEntry / pickAlternate exported helpers
  - Documented subreddit (.rss, D-06) and YouTube channel/playlist (YT-01, D-15) recipes
  - Four real captured feed fixtures (rss2, atom, youtube, reddit) for offline tests
affects: [rss, out-02-uniform-run, medium-blog-pro-consumer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-tool server (D-04) — deliberate deviation from the *_hot/*_search/*_get trio, justified in the tool description"
    - "Branch-free YouTube support: mapAtomEntry prefers media:group>media:description so YouTube needs zero host-specific code"
    - "Parser DoS tuning: raise fast-xml-parser maxTotalExpansions (predefined entities are 1:1 chars) while keeping maxExpandedLength + maxExpansionDepth as the real billion-laughs bounds"

key-files:
  created:
    - servers/rss/server.js
    - servers/rss/manifest.json
    - test/rss.test.js
    - test/fixtures/rss-rss2.xml
    - test/fixtures/rss-atom.xml
    - test/fixtures/rss-youtube.xml
    - test/fixtures/rss-reddit.xml
  modified: []

key-decisions:
  - "Configured fast-xml-parser processEntities (maxTotalExpansions raised to 1M, maxExpandedLength 5MB, maxExpansionDepth 3) — the default maxTotalExpansions:1000 counts predefined entities cumulatively and fails legitimate code-heavy feeds; DTD entities are not expanded so the billion-laughs vector is neutral regardless (Rule 2 correctness fix)"
  - "Attribute prefix is fast-xml-parser's default '@_' — pickAlternate reads l['@_rel']/l['@_href'] (the RESEARCH pseudocode's unprefixed l.rel/l.href was simplified)"
  - "id for RSS from guid||link||title; for Atom from entry.id||alternate href||title — always stringified"

patterns-established:
  - "A single-operation source ships one list tool, not the trio, when there is no detail endpoint and no searchable corpus"

requirements-completed: [SRC-09, YT-01]

coverage:
  - id: C1
    description: "rss_fetch ingests RSS 2.0, Atom 1.0, YouTube, and reddit .rss feeds into contract items with type article and score/num_comments both null"
    requirement: "SRC-09"
    verification:
      - kind: unit
        ref: "node --test test/rss.test.js — mapRssItem/mapAtomEntry over all four real fixtures; ListEnvelopeSchema.parse guard"
        status: pass
    human_judgment: false
  - id: C2
    description: "YouTube channel/playlist recipe surfaces watch URL + channel author + video description text"
    requirement: "YT-01"
    verification:
      - kind: unit
        ref: "test/rss.test.js 'YouTube feed maps to watch-URL url, channel author, and media:description text (YT-01)'"
        status: pass
      - kind: other
        ref: "recipe documented in rss_fetch tool description + servers/rss/manifest.json"
        status: pass
    human_judgment: false
  - id: C3
    description: "Universal Server Bar: single tool + outputSchema; getText-only fetch; no getJson/postJson/process.env/direct fetch; non-feed HTML -> clear error"
    requirement: "SRC-09"
    verification:
      - kind: unit
        ref: "registration smoke (exactly rss_fetch + outputSchema); non-feed HTML throws test"
        status: pass
      - kind: other
        ref: "grep servers/rss/server.js — getText present; getJson/postJson/process.env/fetch( only in comments"
        status: pass
    human_judgment: false
  - id: C4
    description: "Full suite green after adding the RSS server"
    requirement: "SRC-09"
    verification:
      - kind: unit
        ref: "npm test — 242 pass, 0 fail (was 227)"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-03
status: complete
---

# Phase 4 Plan 03: RSS/Atom Fetcher (SRC-09) + Subreddit & YouTube Recipes (YT-01) Summary

**Built `servers/rss/server.js` — a single `rss_fetch(url, limit?)` tool (D-04) that ingests any RSS 2.0, RDF, or Atom 1.0 feed and maps every entry onto the shared item contract with `type:"article"` and both `score` and `num_comments` null, fetching exclusively through the SSRF-guarded `getText`. The documented subreddit `.rss` (D-06) and YouTube channel/playlist (D-15) recipes are proven by real captured fixtures, completing SRC-09 and YT-01.**

## Performance
- **Duration:** ~8 min
- **Started:** 2026-07-03T10:22:27Z
- **Completed:** 2026-07-03T10:30:27Z
- **Tasks:** 3 (all auto)
- **Files created:** 7

## Accomplishments
- Captured four REAL feed fixtures (css-tricks RSS 2.0, rust-lang Atom 1.0, a YouTube channel Atom feed, and reddit `/r/programming/.rss`), trimmed to a handful of entries with wrappers intact.
- Built the RSS server: `parseFeed` (fast-xml-parser@4, namespace prefixes kept, attributes on), `normalizeFeed` (RSS 2.0 / RDF / Atom detection + non-feed guard), `mapRssItem`, `mapAtomEntry`, and `pickAlternate`.
- Made YouTube support branch-free: `mapAtomEntry` prefers `media:group>media:description` for `text`, so the YouTube recipe needs zero host-specific code (D-14/D-15).
- Registered exactly one `rss_fetch` tool with `outputSchema: listEnvelopeShape` and raw input shape; the tool + manifest descriptions document the D-04 single-tool rationale and both recipes (incl. the YouTube per-channel/playlist limitation and the handle→channel_id note).
- Wrote 15 offline unit tests over the four fixtures; full suite 242 pass / 0 fail.

## Task Commits
1. **Task 1: Capture four real RSS/Atom fixtures** — `3357b7b` (test)
2. **Task 2: Build servers/rss/server.js + manifest** — `54b1ad9` (feat)
3. **Task 3: test/rss.test.js** — `b87a714` (test)

## Files Created
- `servers/rss/server.js` — `rss_fetch` + parse/normalize/map helpers.
- `servers/rss/manifest.json` — scaffold-only (PKG-01 v2); documents both recipes.
- `test/rss.test.js` — normalize + recipes + guards + registration (15 tests).
- `test/fixtures/rss-rss2.xml`, `rss-atom.xml`, `rss-youtube.xml`, `rss-reddit.xml` — real captures.

## Decisions Made
- **Tuned `fast-xml-parser` `processEntities`** (see Deviations — Rule 2). The default `maxTotalExpansions:1000` counts even predefined entities (`&amp;`/`&lt;`, one char each) cumulatively across a document, so a legitimate code-heavy feed (the rust blog) tripped it at 1200. Custom DTD entities are NOT expanded by the parser (verified: `&lol9;` stays literal), so the billion-laughs vector is neutral regardless. Raised `maxTotalExpansions` to 1,000,000 while keeping `maxExpandedLength` (5 MB) and `maxExpansionDepth` (3) as the real DoS output/depth bounds.
- **Attribute prefix `@_`** — `pickAlternate` reads `l["@_rel"]`/`l["@_href"]`; the RESEARCH pseudocode's unprefixed `l.rel`/`l.href` assumed a non-default parser config. Verified against the captured Atom/YouTube/reddit fixtures.
- **`id` derivation** — RSS: `guid ?? link ?? title`; Atom: `entry.id ?? alternate-href ?? title`; always stringified (contract requires `id: string`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Parser entity-expansion limit would fail legitimate large feeds**
- **Found during:** Task 1/2 (probing fixtures before writing the server).
- **Issue:** With `fast-xml-parser`'s default `processEntities`, the real rust-lang Atom feed threw `Entity expansion limit exceeded: 1200 > 1000`. The default `maxTotalExpansions:1000` counts predefined single-character entities cumulatively, so any large code-heavy dev-blog feed fails to parse — the RSS server would hard-error on legitimate real-world input, defeating SRC-09's "any feed" promise.
- **Fix:** Configured the module-level parser with `processEntities: { maxEntitySize:10_000, maxExpansionDepth:3, maxExpandedLength:5_000_000, maxTotalExpansions:1_000_000 }`. This keeps the genuine billion-laughs bounds (nested-entity depth + total expanded output) while not false-positiving on predefined-entity-dense content. Confirmed the parser still does not expand custom DTD entities (`&lol9;` remains literal), so the DoS posture in threat T-04-09 is preserved (bounded, and DTD entities un-expanded).
- **Files modified:** `servers/rss/server.js` (parser config).
- **Commit:** `54b1ad9`
- **Threat-model impact:** T-04-09 (XML entity expansion / billion laughs) — still mitigated: DTD entities are not expanded, output is capped at 5 MB, nesting depth at 3, and `limit` caps emitted items.

**2. [Rule 1 - Doc/reality mismatch] RESEARCH `pickAlternate` used unprefixed attribute keys**
- **Found during:** Task 2.
- **Issue:** The RESEARCH `mapAtomEntry`/`pickAlternate` examples read `l.rel`/`l.href`, but fast-xml-parser's default `attributeNamePrefix` is `@_`, so attributes parse as `@_rel`/`@_href`.
- **Fix:** Implemented `pickAlternate` against the `@_`-prefixed keys; verified against the captured Atom, YouTube, and reddit fixtures.
- **Files modified:** `servers/rss/server.js`.
- **Commit:** `54b1ad9`

## Fixture substitutions
- **RSS 2.0:** `https://css-tricks.com/feed/` (has `content:encoded` + `dc:creator` + `<category>`).
- **Atom 1.0:** `https://blog.rust-lang.org/feed.xml`.
- **YouTube:** `https://www.youtube.com/feeds/videos.xml?channel_id=UCXuqSBlHAE6Xw-yeJA0Tunw` (the RESEARCH-cited channel; resolves to "Linus Tech Tips").
- **Reddit:** `https://www.reddit.com/r/programming/.rss` (Atom, 25 entries).
All four are genuine live captures (2026-07-03); the two large feeds were trimmed to 3 items each with their `channel`/`feed` wrappers intact.

## Universal Server Bar
- ✅ Registers exactly `rss_fetch` with `outputSchema` (raw `listEnvelopeShape`).
- ✅ Map helpers unit-tested over four real fixtures; every item is contract-valid (`ListEnvelopeSchema.parse`).
- ✅ `score`/`num_comments` strictly `null` for every RSS/Atom item.
- ✅ Fetches ONLY via `getText`; `getJson`/`postJson`/`process.env`/direct `fetch(` appear only in comments (grep-verified).
- ✅ Non-feed HTML → clear `is not a valid RSS/Atom feed` error (no junk item).

## Issues Encountered
- The pre-existing `npm audit` moderate advisory (GHSA-gh4j-gqv2-49f6, XMLBuilder) from 04-02 remains non-applicable — this server only parses feeds, never builds XML. No action.

## User Setup Required
None — RSS is keyless. The optional `RSS_ALLOWED_HOSTS` hardening knob (04-01) remains unset by default (public-internet-minus-denylist mode).

## Next Phase Readiness
- SRC-09 and YT-01 are complete. The parsed `rss-atom.xml` fixture is available for the OUT-02 uniform-run proof (04-04) as the null-score RSS source in the branch-free merge.
- No blockers.

## Self-Check: PASSED
- `servers/rss/server.js`, `servers/rss/manifest.json`, `test/rss.test.js` — FOUND
- `test/fixtures/rss-{rss2,atom,youtube,reddit}.xml` — FOUND
- Task commits `3357b7b`, `54b1ad9`, `b87a714` — FOUND
- `npm test` — 242 pass / 0 fail

---
*Phase: 04-rss-multiplier-output-proof*
*Completed: 2026-07-03*
