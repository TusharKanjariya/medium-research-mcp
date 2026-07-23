#!/usr/bin/env node
// bin/install.js — `npx medium-research-mcp install` (INST-01).
//
// A stdlib-only install wizard (node:fs/path/os/readline) that detects the user's
// MCP client(s) among Claude Desktop, Cursor, Codex CLI, and OpenCode, backs up the
// existing config, and NON-DESTRUCTIVELY merges the medium-research server entries.
// Zero new runtime dependencies (research §Standard Stack): no inquirer, no TOML
// parser — we only ever generate + splice our OWN named tables, never parse user TOML.
//
// process.env boundary: CLAUDE.md forbids reading process.env in a *server* (secrets).
// This is a CLI doing OS config-path discovery; reading process.env.APPDATA for the
// Windows Claude path is path discovery, NOT a credential read. Keys flow ONLY through
// the interactive prompt into the client config's env/environment block — never from
// process.env, never hardcoded.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isEntry } from "../shared/main.js";

// The 11 source bins (mirror package.json bin map / docs/INSTALL.md).
export const SOURCES = [
  "hn", "stackexchange", "lobsters", "lemmy", "devto", "github",
  "librariesio", "producthunt", "rss", "discourse", "mastodon",
];

// The two REQUIRED-key servers (shared/credentials.js ENV_VAR is the source of truth
// for the variable names). Skipping a key leaves that server keyless / fail-loud (D-05).
export const KEY_VARS = ["LIBRARIESIO_KEY", "PRODUCTHUNT_TOKEN"];

// --- Backup ------------------------------------------------------------------

/**
 * Back up an existing config file to `<cfg>.bak-<compact-ISO>` BEFORE any write.
 * Timestamped so repeated runs never clobber a prior backup. Returns the backup
 * path, or null when the file does not yet exist (nothing to preserve).
 */
export function backupConfig(cfgPath) {
  if (!fs.existsSync(cfgPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace(/-/g, "");
  const bak = `${cfgPath}.bak-${stamp}`;
  fs.copyFileSync(cfgPath, bak);
  return bak;
}

// --- JSON merge (Claude Desktop / Cursor / OpenCode) -------------------------

/**
 * Non-destructively merge `entries` (name -> entryObj) into the container object
 * (`mcpServers` or `mcp`) of a JSON config. Reads-or-starts-`{}`, sets ONLY our
 * named keys (never replaces the container — unrelated servers survive, D-06), and
 * writes pretty JSON. A parse failure ABORTS and names the untouched file (no
 * partial write). Caller is responsible for backupConfig() first.
 */
export function mergeJson(cfgPath, containerKey, entries) {
  let obj = {};
  if (fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, "utf8");
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error(
        `Cannot parse ${cfgPath} as JSON (comments or a syntax error?). Left unchanged.`,
      );
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error(`${cfgPath} is not a JSON object. Left unchanged.`);
  }
  obj[containerKey] ??= {};
  for (const [name, entry] of Object.entries(entries)) obj[containerKey][name] = entry;
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2) + "\n");
}

// --- Platform-aware entry builders -------------------------------------------

/**
 * stdio entry for Claude / Cursor / Codex: `cmd /c npx -y <bin>` on win32 (npx is a
 * `.cmd` shim → bare "npx" gives spawn ENOENT), bare `npx -y <bin>` elsewhere.
 */
export function stdioEntry(bin, platform = process.platform) {
  return platform === "win32"
    ? { command: "cmd", args: ["/c", "npx", "-y", bin] }
    : { command: "npx", args: ["-y", bin] };
}

/**
 * Reduce a raw key map to only the provided (non-empty) required keys. A skipped key
 * is simply absent, so the server stays keyless with its existing fail-loud behavior.
 */
export function envFor(keys) {
  const env = {};
  for (const v of KEY_VARS) if (keys?.[v]) env[v] = keys[v];
  return env;
}

// --- CLI ---------------------------------------------------------------------

/** Resolve the Claude Desktop config path per-OS (see constraints callout). */
function claudeConfigPath(
  { home = os.homedir(), platform = process.platform, appData = process.env.APPDATA } = {},
) {
  const dir =
    platform === "win32"
      ? path.join(appData || path.join(home, "AppData", "Roaming"), "Claude")
      : platform === "darwin"
        ? path.join(home, "Library", "Application Support", "Claude")
        : path.join(home, ".config", "Claude");
  return path.join(dir, "claude_desktop_config.json");
}

async function main(argv) {
  if (argv[0] !== "install") {
    console.log("Usage: npx medium-research-mcp install");
    return;
  }
  // Task-1 minimal path: write the single medium-research-all aggregator entry into
  // Claude Desktop, backup-first. The full wizard (other clients, prompts, flags)
  // lands in later tasks.
  const cfgPath = claudeConfigPath();
  const entries = { "medium-research-all": stdioEntry("medium-research-all") };
  const bak = backupConfig(cfgPath);
  mergeJson(cfgPath, "mcpServers", entries);
  console.log(`Wrote medium-research-all to ${cfgPath}`);
  if (bak) console.log(`Backed up previous config to ${bak}`);
}

if (isEntry(import.meta.url)) {
  await main(process.argv.slice(2));
}
