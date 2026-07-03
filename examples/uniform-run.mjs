// examples/uniform-run.mjs — OUT-02 LIVE demo (MANUAL smoke, NOT a CI gate).
//
// The human-facing companion to test/uniform-run.test.js. Where the test proves
// the branch-free merge OFFLINE against recorded fixtures, this script does the
// real thing: it calls one list tool on 5+ shipped sources over the LIVE network,
// merges every envelope through the SAME `mergeRank` from shared/rank.js, and
// prints the top-N ranked items. It is exactly what the medium-blog-pro skill
// does in one pass — with zero per-source logic in the merge.
//
// This is a MANUAL smoke, like the Phase 3 keyed smokes: it hits the network and
// is deliberately NOT part of `npm test` (it lives in examples/, and `node --test`
// only discovers test/*.test.js). Run it by hand:
//
//     node examples/uniform-run.mjs
//     node examples/uniform-run.mjs 15          # print the top 15
//
// All sources here are KEYLESS, so it runs with no credentials (GitHub is called
// anonymously — subject to the low unauthenticated rate limit). If one source
// errors (rate limit, transient network), it is logged and skipped so the demo
// still shows the merge across the sources that did respond.

import { server as hn } from "../servers/hn/server.js";
import { server as stackexchange } from "../servers/stackexchange/server.js";
import { server as lobsters } from "../servers/lobsters/server.js";
import { server as devto } from "../servers/devto/server.js";
import { server as github } from "../servers/github/server.js";
import { server as rss } from "../servers/rss/server.js";

import { mergeRank, filterByMinScore } from "../shared/rank.js";

const TOP_N = Number(process.argv[2]) || 10;

// A public, stable Atom feed for the RSS source (any http/https feed works —
// this is also how the documented subreddit `.rss` and YouTube channel recipes
// are exercised). Swap freely; it is just a demo feed.
const RSS_FEED = "https://blog.rust-lang.org/feed.xml";

// Each entry: a distinct shipped source, the tool to call, and its arguments.
// The demo calls the REAL registered tool handler — the exact live path — and
// reads its structuredContent envelope. No endpoint knowledge is duplicated here.
const SOURCES = [
  { label: "hackernews", server: hn, tool: "hn_front_page", args: { limit: 10 } },
  { label: "stackexchange", server: stackexchange, tool: "so_hot_questions", args: { limit: 10 } },
  { label: "lobsters", server: lobsters, tool: "lobsters_hottest", args: { limit: 10 } },
  { label: "devto", server: devto, tool: "devto_top", args: { limit: 10 } },
  { label: "github", server: github, tool: "gh_trending_repos", args: { limit: 10 } },
  { label: "rss", server: rss, tool: "rss_fetch", args: { url: RSS_FEED, limit: 10 } },
];

async function fetchEnvelope({ label, server, tool, args }) {
  const registered = server._registeredTools?.[tool];
  if (!registered) throw new Error(`tool ${tool} not registered on ${label}`);
  const res = await registered.handler(args);
  const env = res.structuredContent;
  // Tag each item with its origin ONLY for the printed demo output — the merge
  // itself never reads this; mergeRank is branch-free over the contract.
  for (const item of env.results) item.__source = label;
  return env;
}

async function main() {
  console.log(`\nOUT-02 live uniform-run — pulling from ${SOURCES.length} sources...\n`);

  const envelopes = [];
  for (const s of SOURCES) {
    try {
      const env = await fetchEnvelope(s);
      console.log(`  ok    ${s.label.padEnd(14)} ${env.count} items`);
      envelopes.push(env);
    } catch (err) {
      console.log(`  skip  ${s.label.padEnd(14)} ${err.message}`);
    }
  }

  if (envelopes.length === 0) {
    console.log("\nNo sources responded — check your network and retry.\n");
    process.exitCode = 1;
    return;
  }

  // The whole point: ONE branch-free call merges + ranks every source together.
  const merged = mergeRank(envelopes);
  const distinct = new Set(envelopes.map((e) => e.source));

  console.log(
    `\nMerged ${merged.length} items from ${distinct.size} distinct sources ` +
      `through one branch-free mergeRank() — top ${TOP_N}:\n`,
  );

  const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
  for (const item of merged.slice(0, TOP_N)) {
    const score = item.score == null ? "  —" : String(item.score).padStart(5);
    console.log(`  ${score}  ${pad(item.__source, 14)}  ${pad(item.title, 70)}`);
  }

  // Demonstrate the source-agnostic filter too (contract-field-only).
  const notable = filterByMinScore(merged, 100);
  console.log(
    `\nfilterByMinScore(merged, 100) kept ${notable.length} items ` +
      `(source-agnostic, null scores dropped).\n`,
  );
}

main().catch((err) => {
  console.error("uniform-run demo failed:", err);
  process.exitCode = 1;
});
