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

// The complete tool union across all 11 sources. Task 2 fills the remaining
// sources; Task 1 asserts only the hn slice is mounted end-to-end.
const HN_TOOLS = ["hn_front_page", "hn_search", "hn_rising", "hn_get_item"];

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

test("aggregator exposes the hn tool slice (in-process listTools)", async () => {
  const names = await listAggregatorTools();
  for (const t of HN_TOOLS) {
    assert.ok(names.includes(t), `aggregator missing ${t}`);
  }
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
