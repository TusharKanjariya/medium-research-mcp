---
status: resolved
phase: 06-author-blog-awareness
source: [06-VERIFICATION.md]
started: 2026-07-14T07:30:00Z
updated: 2026-07-14T08:00:00Z
---

## Current Test

number: 2
name: rss_substack_archive live enrichment + degrade
expected: |
  Archive path fills score/num_comments from real reactions/comments; on failure
  degrades to the ~20-item RSS window with null engagement and never hard-errors.
awaiting: none — complete

## Tests

### 1. Live preview-only tagging (rss_author_posts)
expected: Member-only / paywalled items carry the literal `preview-only` tag in tags[]; free items do not; text stays teaser-quality and is never mutated.
result: passed
evidence: |
  Live runs 2026-07-14 against real paid/member content:
  - rss_tag_posts("programming") [Medium]: 6/10 member-only items tagged preview-only
    (e.g. "Paging 3 in Jetpack Compose" → "…Continue reading on Medium »" marker).
  - rss_author_posts("noahpinion.substack.com"): 6/20 paid posts tagged preview-only; free clean.
  - rss_author_posts("@dhh"): all-free author → 0 false positives.
  - OWNER ACCOUNT rss_author_posts("@TusharKanjariya"): 9/10 member-only posts tagged
    preview-only (each carries "Continue reading on Medium »"); the one free post untagged;
    text teaser-quality and unmutated; Medium topic tags preserved alongside preview-only.
  - OWNER ACCOUNT rss_author_posts("https://tusharkanjariya.substack.com/"): 0 preview-only
    (all public posts) — correct, no false positives.

### 2. Live Substack archive enrichment + degrade (rss_substack_archive)
expected: score is filled from real reaction_count and num_comments from real comment_count; when the endpoint is down/login-gated it silently degrades to the ~20-item /feed RSS window with null engagement and never hard-errors.
result: passed
evidence: |
  Live runs 2026-07-14:
  - rss_substack_archive("noahpinion"): ARCHIVE path (enriched=true), 23 posts, score from
    real reactions (380/773/331…), num_comments from real comments (74/174/85…).
  - OWNER ACCOUNT rss_substack_archive("https://tusharkanjariya.substack.com/"): ARCHIVE path,
    9 posts, score=1 (real reactions), num_comments=0 (real), richer archive tags.
  - Archive-vs-window distinction confirmed on the owner's own publication: the archive tool
    enriches score/num_comments where rss_author_posts (RSS window) returns null.
  - Degrade paths (HTML-200 login page, non-array/empty body, SSRF-blocked host) are fully
    exercised offline in test/rss.test.js — no hard-error, always the RSS-window fallback.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None — both human-verification items passed against real paid/member content and the owner's own Medium + Substack accounts.
