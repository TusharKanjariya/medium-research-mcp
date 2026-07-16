#!/usr/bin/env node
// scripts/build-mcpb.mjs — build all 11 .mcpb bundles (PKG-01, D-02/D-03).
//
// Per server: stage in Option-A repo-mirroring layout (manifest + prod
// node_modules + shared/ + servers/<name>/server.js), GATE with `mcpb validate`
// AND a real MCP-initialize spawn test (catches ERR_MODULE_NOT_FOUND that
// validate misses — Pitfall A), then `mcpb pack` to dist/. A failing stage
// aborts its bundle instead of emitting a broken .mcpb.
//
// The prod node_modules is built ONCE via `npm ci --omit=dev --ignore-scripts`
// (deterministic from the pinned lockfile; --ignore-scripts blocks any
// dependency postinstall from riding into a bundle — T-08-04) and reused across
// all 11 stages.

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const DIST = path.join(ROOT, "dist");

// The 11 frozen sources (each has servers/<name>/{server.js,manifest.json}).
const SERVERS = [
  "hn", "stackexchange", "lobsters", "lemmy", "devto", "github",
  "librariesio", "producthunt", "rss", "discourse", "mastodon",
];

const MIN_KB = 200;        // deps must be present (not source-only)
const MAX_KB = 20 * 1024;  // dev deps must be absent (not tens of MB)
const SPAWN_TIMEOUT_MS = 15000;

const mcpbBin = path.join(
  ROOT, "node_modules", ".bin",
  process.platform === "win32" ? "mcpb.cmd" : "mcpb",
);

function runMcpb(args) {
  // .cmd shims require shell:true on Windows (Node CVE-2024-27980 posture).
  execFileSync(mcpbBin, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

// Build the prod-only node_modules once, in an isolated temp dir seeded with the
// pinned package.json + lockfile, then hand back its node_modules path.
function buildProdModules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpb-prod-"));
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(dir, "package.json"));
  fs.copyFileSync(path.join(ROOT, "package-lock.json"), path.join(dir, "package-lock.json"));
  execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts"], {
    cwd: dir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return dir;
}

// Spawn the staged entry, complete an MCP `initialize` handshake over
// newline-delimited JSON-RPC (the stdio transport framing), and assert a real
// result comes back with no module-resolution failure. Rejects on any gate miss.
function spawnTest(entryPath, name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let settled = false;

    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      fn(arg);
    };

    const timer = setTimeout(
      () => done(reject, new Error(`${name}: spawn test timed out (no initialize response)\n${err}`)),
      SPAWN_TIMEOUT_MS,
    );

    child.stdout.on("data", (d) => {
      out += d.toString();
      for (const line of out.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        let msg;
        try { msg = JSON.parse(t); } catch { continue; }
        if (msg.id === 1 && msg.result && (msg.result.serverInfo || msg.result.capabilities)) {
          return done(resolve);
        }
        if (msg.id === 1 && msg.error) {
          return done(reject, new Error(`${name}: initialize returned an error: ${JSON.stringify(msg.error)}`));
        }
      }
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (err.includes("ERR_MODULE_NOT_FOUND")) {
        done(reject, new Error(`${name}: ERR_MODULE_NOT_FOUND (../../shared or a dep did not resolve in the stage)\n${err}`));
      }
    });
    child.on("error", (e) => done(reject, new Error(`${name}: failed to spawn — ${e.message}`)));
    child.on("close", () => {
      if (!settled) done(reject, new Error(`${name}: exited before an initialize response\n${err}`));
    });

    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcpb-build-smoke", version: "1.0.0" },
      },
    };
    child.stdin.write(JSON.stringify(initialize) + "\n");
  });
}

// Stage one server in Option-A layout and return the stage dir path.
function stageServer(name, prodModules) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `mcpb-${name}-`));
  fs.copyFileSync(
    path.join(ROOT, "servers", name, "manifest.json"),
    path.join(stage, "manifest.json"),
  );
  fs.cpSync(prodModules, path.join(stage, "node_modules"), { recursive: true });
  fs.cpSync(path.join(ROOT, "shared"), path.join(stage, "shared"), { recursive: true });
  const srvDir = path.join(stage, "servers", name);
  fs.mkdirSync(srvDir, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, "servers", name, "server.js"),
    path.join(srvDir, "server.js"),
  );
  return stage;
}

async function main() {
  // Fresh dist/ every run (gitignored; no partial artifact is ever committed).
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  console.log("Building prod-only node_modules (npm ci --omit=dev --ignore-scripts)…");
  const prodModules = path.join(buildProdModules(), "node_modules");

  const built = [];
  const stages = [];
  try {
    for (const name of SERVERS) {
      const stage = stageServer(name, prodModules);
      stages.push(stage);
      const entry = path.join(stage, "servers", name, "server.js");

      // Gate 1: manifest validity.
      runMcpb(["validate", path.join(stage, "manifest.json")]);
      // Gate 2: real spawn + MCP initialize (the resolvability gate).
      await spawnTest(entry, name);
      // Both gates passed — pack.
      const out = path.join(DIST, `medium-research-${name}.mcpb`);
      runMcpb(["pack", stage, out]);

      const kb = fs.statSync(out).size / 1024;
      if (kb < MIN_KB || kb > MAX_KB) {
        throw new Error(`${name}: bundle ${kb.toFixed(0)}KB out of band (${MIN_KB}–${MAX_KB}KB) — deps missing or dev deps leaked`);
      }
      built.push({ name, kb });
      console.log(`✓ medium-research-${name}.mcpb  (${kb.toFixed(0)} KB)`);
    }
  } finally {
    for (const s of stages) fs.rmSync(s, { recursive: true, force: true });
    fs.rmSync(path.dirname(prodModules), { recursive: true, force: true });
  }

  if (built.length !== SERVERS.length) {
    throw new Error(`only ${built.length}/${SERVERS.length} bundles built`);
  }
  console.log(`\nBuilt ${built.length} validated + spawn-tested bundles in dist/`);
}

main().catch((e) => {
  console.error(`\nBUILD FAILED: ${e.message}`);
  process.exit(1);
});
