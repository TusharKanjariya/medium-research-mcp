# Phase 4: RSS Multiplier & Output Proof - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 4-RSS Multiplier & Output Proof
**Areas discussed:** RSS SSRF & tool surface, XML parsing (dep vs hand-roll), OUT-02 uniform-run proof, YouTube wrapper scope

---

> **Session note:** The area-selection question timed out (user away). Per the
> "proceed on best judgment" fallback, Claude captured recommended defaults for
> all four gray areas. One item (D-13, the YouTube OCR-script logistics) genuinely
> depends on facts only the user has and is flagged [NEEDS CONFIRMATION]. The
> "Selected" column marks Claude's recommended default, tagged [REC].

## RSS SSRF & tool surface

| Option | Description | Selected |
|--------|-------------|----------|
| http/https scheme allowlist + private-range denylist (incl. redirect re-validation) + optional RSS_ALLOWED_HOSTS | Real SSRF fence for the first user-controlled outbound host | ✓ [REC] (D-01/02/03) |
| Open fetch, rely on network egress rules | Simpler but exposes cloud metadata / internal services | |
| Mandatory operator allowlist only (closed by default) | Safest but unusable out-of-the-box | |
| Single rss_fetch(url) list tool; no *_get/*_search; subreddit .rss = recipe | RSS has one operation; items carry own content; documented deviation | ✓ [REC] (D-04/05/06) |

**User's choice:** (timeout) — Claude defaults D-01..D-06.
**Notes:** SSRF is the phase's headline risk; must apply to initial host AND every redirect hop.

---

## XML parsing (dependency vs hand-roll)

| Option | Description | Selected |
|--------|-------------|----------|
| Add shared getText() + a zero-transitive-dep XML parser (e.g. fast-xml-parser) + hand-written RSS/Atom normalize | Robust across RSS2.0/Atom/subreddit .rss; small supply-chain cost | ✓ [REC] (D-07/08) |
| Add getText() + hand-rolled regex/XML parser | Keeps sdk+zod-only, but fragile on CDATA/namespaces/entities | |
| Reuse getJson (parse XML as JSON) | Not viable — getJson JSON.parses the body | |

**User's choice:** (timeout) — Claude defaults D-07/D-08 (getText + lightweight parser).
**Notes:** Exact package + zero-transitive-dep confirmation is a researcher task; hand-roll is the fallback.

---

## OUT-02 uniform-run proof

| Option | Description | Selected |
|--------|-------------|----------|
| Automated node:test merging 5+ fixtures through one branch-free rank/filter path + a live example script | Deterministic CI proof of the branch-free thesis + a real demo | ✓ [REC] (D-09/10) |
| Live-network integration test | Real but flaky/non-deterministic in CI | |
| Documentation-only example | Not a verifiable proof | |

**User's choice:** (timeout) — Claude defaults D-09/D-10 (fixture-based test + live example smoke).
**Notes:** "Zero per-source branches" proven by a single merge code path with no `if (source === …)`.

---

## YouTube wrapper scope — RESOLVED by user (2026-07-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Build Python youtube-blog-mcp OCR wrapper (async job, scaffold+adapter or full pipeline) | Original YT-01 plan | ✗ dropped |
| No Python/OCR code — surface YouTube links + short explanations via the RSS fetcher's YouTube recipe; user runs their own local OCR script manually | User owns the OCR script; project just feeds it links | ✓ USER-CHOSEN (D-13/14/15) |

**User's choice:** "For Tesseract OCR script I have already there in my own system. So you don't need to generate the code now. But instead just give me youtube links with small explanation and I will run my script manually to generate draft from the link."
**Notes:** Drops the Python `youtube-blog-mcp` server entirely. YouTube = a documented `rss_fetch` channel/playlist recipe (D-15), normal contract output (no exception). ROADMAP/REQUIREMENTS/PROJECT YT-01 text needs updating (noted in CONTEXT.md). Keyword YouTube search (Data API) stays out of scope — user supplies channel/playlist IDs.

---

## Claude's Discretion

- getText signature + redirect-validation mechanism, XML parser + normalize names,
  RSS/Atom field precedence, rss_fetch limit defaults, uniform-run merge helper +
  fixture set, Python job-id scheme / FastMCP tool names — all planner/executor
  calls within the SSRF guards, the rss_fetch contract, and the async job pattern.

## Deferred Ideas

- RSS *_search/*_get (intentionally omitted, D-04); feed persistence/polling;
  v2 sources (Discourse/Mastodon/Bluesky); .mcpb packaging (PKG-01); full YouTube
  OCR pipeline if D-13 lands as scaffold+adapter for v1.
