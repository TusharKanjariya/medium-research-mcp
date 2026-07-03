// shared/rank.js — OUT-02: branch-free multi-source merge / rank / filter.
//
// This is the project's thesis made reusable. Because every source server emits
// the SAME normalized item shape (shared/contract.js), a research run that pulls
// from many sources needs NO per-source logic to combine them: the merge is a
// flat concat of each envelope's `results`, and the rank is one comparator over
// the contract `score` field. There is deliberately ZERO `if (source === ...)`
// anywhere in this module — that branch-free property is exactly what OUT-02
// proves (test/uniform-run.test.js).
//
// This ships in shared/ (not test-local) on purpose: it is the same operation
// the consuming `medium-blog-pro` skill performs, so the OUT-02 proof asserts the
// REAL code path and the consumer gets a reference implementation. It reads only
// contract fields, so it introduces no source coupling. Keep it tiny and
// dependency-free.

// Merge many list envelopes into ONE ranked array of items.
//
// Input: an array of contract list envelopes ({ source, query, count, results }).
// Output: a single array of every envelope's items, sorted by `score`
// descending, with items whose score is null/undefined placed last (two null
// scores compare equal). Reads only the contract `score` field — nothing here
// knows or cares which server an item came from.
export function mergeRank(envelopes) {
  const items = envelopes.flatMap((e) => e.results);
  return items.sort((a, b) => {
    const as = a.score;
    const bs = b.score;
    if (as == null && bs == null) return 0; // both missing -> equal
    if (as == null) return 1; // a missing -> a after b (nulls last)
    if (bs == null) return -1; // b missing -> b after a
    return bs - as; // both numeric -> higher score first
  });
}

// A source-agnostic filter example: keep only items whose numeric score is at
// least `min`. Null/undefined scores are dropped (never throw). Like mergeRank,
// it reads only the contract `score` field, so filtering is uniform across every
// source — the same way the consumer narrows a merged list.
export function filterByMinScore(items, min) {
  return items.filter((i) => i.score != null && i.score >= min);
}
