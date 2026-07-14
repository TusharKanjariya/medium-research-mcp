---
status: testing
phase: 06-author-blog-awareness
source: [06-VERIFICATION.md]
started: 2026-07-14T07:30:00Z
updated: 2026-07-14T07:30:00Z
---

## Current Test

number: 1
name: rss_author_posts preview-only tagging against real paid Medium + paywalled Substack
expected: |
  Member-only / paywalled items carry the literal `preview-only` tag in tags[];
  free items do not; text stays teaser-quality and is never mutated.
awaiting: user response

## Tests

### 1. Live preview-only tagging (rss_author_posts)
expected: Call `rss_author_posts` against a REAL paid Medium author (e.g. an `@handle` with member-only stories) and a paywalled Substack publication over the live network. Member-only / paywalled items carry the literal `preview-only` entry in `tags[]`; free items do not; `text` stays teaser-quality and is never mutated. The preview heuristic (markers like "Continue reading on Medium" / "Read more" / member-only) fires on genuine paywalled bodies.
result: [pending]

### 2. Live Substack archive enrichment + degrade (rss_substack_archive)
expected: Call `rss_substack_archive` against a live Substack publication whose archive endpoint is reachable. `score` is filled from real `reaction_count` and `num_comments` from real `comment_count`; when the endpoint is down / login-gated / returns an unexpected shape, it silently degrades to the ~20-item `/feed` RSS window with null engagement and NEVER hard-errors.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
