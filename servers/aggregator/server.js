#!/usr/bin/env node
// servers/aggregator/server.js — the `medium-research-all` bin (AGG-01, D-01/D-02).
//
// ONE McpServer that mounts the full union of every source's tools, so a single
// Claude Desktop config entry exposes all 11 sources at once. The SDK has no
// merge/mount primitive (verified: registerTool is the only public add path), so
// each server exports a `registerTools(server)` seam and we call all of them
// against this one server. Tool names, schemas, and the output envelope are
// byte-identical to the standalone bins — this file adds no per-source logic.
//
// No double stdio (research Pitfall 1): importing a server runs its top level,
// but its `isEntry(import.meta.url)` is false here (its URL != this entry), so no
// imported server connects. Exactly one connect happens — this aggregator's own,
// and only when run directly.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isEntry } from "../../shared/main.js";
import { registerTools as hn } from "../hn/server.js";
import { registerTools as stackexchange } from "../stackexchange/server.js";
import { registerTools as lobsters } from "../lobsters/server.js";
import { registerTools as lemmy } from "../lemmy/server.js";
import { registerTools as devto } from "../devto/server.js";
import { registerTools as github } from "../github/server.js";
import { registerTools as librariesio } from "../librariesio/server.js";
import { registerTools as producthunt } from "../producthunt/server.js";
import { registerTools as rss } from "../rss/server.js";
import { registerTools as discourse } from "../discourse/server.js";
import { registerTools as mastodon } from "../mastodon/server.js";

export const server = new McpServer({
  name: "medium-research-all",
  version: "1.2.0",
});

// Mount every source. Union is collision-free by D-01 prefixes; registerTool
// throws loudly on a real duplicate, so no dedup/collision code is needed
// (research Pitfall 2). D-02: keyed sources (librariesio, producthunt) are
// mounted unconditionally — they keep their fail-loud "set X" behavior at call
// time, not at mount time.
for (const registerTools of [
  hn,
  stackexchange,
  lobsters,
  lemmy,
  devto,
  github,
  librariesio,
  producthunt,
  rss,
  discourse,
  mastodon,
]) {
  registerTools(server);
}

if (isEntry(import.meta.url)) {
  await server.connect(new StdioServerTransport());
}
