// test/aggregator.test.js — the `medium-research-all` aggregator (AGG-01).
//
// Two independent checks:
//   1. Union completeness (in-process, deterministic): connect an MCP Client to
//      the aggregator's exported `server` over an in-memory transport, list the
//      tools, and assert the full union is present with the right names/count.
//   2. Standalone-bin regression (real stdio): spawn a standalone server as a
//      child process and complete the MCP initialize handshake — proves the
//      registerTools refactor did NOT break the direct-run bins.
//
// No network, no keys: listTools/initialize never invoke a tool handler.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { server as aggregator } from "../servers/aggregator/server.js";

const HN_TOOLS = ["hn_front_page", "hn_search", "hn_rising", "hn_get_item"];

// The complete tool union across all 11 sources (37 tools). Read straight from
// the server files — an accidental drop, rename, or dup fails this test loudly.
// Prefixes: hn_, so_ (stackexchange), lobsters_, lemmy_, devto_, gh_ (github),
// librariesio_, producthunt_, rss_, discourse_, mastodon_.
const UNION = [
  ...HN_TOOLS,
  "so_hot_questions", "so_search", "so_get_question", "so_unanswered",
  "lobsters_hottest", "lobsters_tag", "lobsters_get", "lobsters_search",
  "lemmy_hot", "lemmy_search", "lemmy_post",
  "devto_top", "devto_tag", "devto_search", "devto_get",
  "gh_trending_repos", "gh_search_issues", "gh_get_item",
  "librariesio_search", "librariesio_get",
  "producthunt_launches", "producthunt_get",
  "rss_fetch", "rss_author_posts", "rss_tag_posts", "rss_substack_archive",
  "discourse_latest", "discourse_top", "discourse_topic",
  "mastodon_public", "mastodon_hashtag", "mastodon_trending_tags",
  "mastodon_trending_links",
];

async function listAggregatorTools() {
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    aggregator.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => t.name);
}

test("aggregator exposes the full 37-tool union across all 11 sources", async () => {
  const names = await listAggregatorTools();
  for (const t of UNION) {
    assert.ok(names.includes(t), `aggregator missing ${t}`);
  }
  // Exact count: catches a silent drop OR an unexpected extra/dup tool.
  assert.equal(names.length, UNION.length, "aggregator tool count drifted");
  assert.equal(UNION.length, 37, "expected 37 tools across the 11 sources");
});

test("standalone hn bin still starts over real stdio", async () => {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["servers/hn/server.js"],
  });
  // connect() performs the MCP initialize handshake — if the bin failed to
  // start (e.g. registerTools left it toolless or crashed), this rejects.
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const t of HN_TOOLS) {
    assert.ok(names.includes(t), `standalone hn bin missing ${t}`);
  }
  await client.close();
});
