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
import { createInterface } from "node:readline/promises";
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
export function mergeJson(cfgPath, containerKey, entries, whenAbsent = {}) {
  let obj = whenAbsent;
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
 * OpenCode entry: `command` is a single array, needs `type:"local"` + `enabled:true`,
 * and (caller-added) env goes under `environment`, not `env`. Windows folds the shell
 * shim into the array.
 */
export function opencodeEntry(bin, platform = process.platform) {
  return {
    type: "local",
    command:
      platform === "win32"
        ? ["cmd", "/c", "npx", "-y", bin]
        : ["npx", "-y", bin],
    enabled: true,
  };
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

// --- Codex TOML: generate + splice our OWN tables (never parse user TOML) -----

/**
 * Escape a string value for a TOML basic-string literal: escape `\` and `"`, and
 * REJECT control chars / newlines (a stray one would corrupt the file). Tab is allowed.
 */
export function escapeTomlString(s) {
  const str = String(s);
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(str)) {
    throw new Error("Secret contains a control character or newline; refusing to write TOML.");
  }
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Generate ONE `[mcp_servers.<name>]` table (+ nested `.env` sub-table) as a controlled
 * string — we own every byte. Platform-aware command/args, escaped env values.
 */
export function tomlBlock(name, bin, envObj, platform = process.platform) {
  const command = platform === "win32" ? "cmd" : "npx";
  const args = platform === "win32" ? ["/c", "npx", "-y", bin] : ["-y", bin];
  const argsStr = args.map((a) => `"${escapeTomlString(a)}"`).join(", ");
  let block = `[mcp_servers.${name}]\ncommand = "${command}"\nargs = [${argsStr}]\n`;
  const envKeys = envObj ? Object.keys(envObj) : [];
  if (envKeys.length) {
    block += `[mcp_servers.${name}.env]\n`;
    for (const k of envKeys) block += `${k} = "${escapeTomlString(envObj[k])}"\n`;
  }
  return block;
}

/**
 * Idempotent, non-destructive splice of OUR table into TOML text. Removes any existing
 * top-level block for `tableName` (and its `.env` sub-table), stopping at the next
 * line-start `[` so unrelated tables are never swallowed, then appends the fresh block.
 * ponytail: regex splice, not a TOML parser — safe because we only ever add/replace our
 * own [mcp_servers.medium-research-*] tables. Upgrade to a parser only if we ever need
 * to READ arbitrary user TOML.
 */
export function spliceTomlTable(text, tableName, block) {
  const re = new RegExp(
    `(^|\\n)\\[${tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.[^\\]]+)?\\][^]*?(?=\\n\\[|$)`,
    "g",
  );
  const cleaned = text.replace(re, "").replace(/\n{3,}/g, "\n\n").trimStart().trimEnd();
  return cleaned ? `${cleaned}\n\n${block.trim()}\n` : `${block.trim()}\n`;
}

/** Merge our `[mcp_servers.<name>]` tables (name -> block) into a Codex config.toml. */
export function mergeToml(cfgPath, tables) {
  let text = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, "utf8") : "";
  for (const [name, block] of Object.entries(tables)) {
    text = spliceTomlTable(text, name, block);
  }
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, text);
}

// --- Client detection --------------------------------------------------------

/**
 * Per-OS descriptors for the 4 target clients: `{ id, dir, configPath, format,
 * container? }`. `dir` is the existence-probe signal; `format` selects the writer.
 * home/platform/appData are injectable for tests.
 */
export function clientDescriptors(
  { home = os.homedir(), platform = process.platform, appData = process.env.APPDATA } = {},
) {
  const claudeDir =
    platform === "win32"
      ? path.join(appData || path.join(home, "AppData", "Roaming"), "Claude")
      : platform === "darwin"
        ? path.join(home, "Library", "Application Support", "Claude")
        : path.join(home, ".config", "Claude");
  const opencodeDir = path.join(home, ".config", "opencode");
  return [
    { id: "claude", dir: claudeDir, configPath: path.join(claudeDir, "claude_desktop_config.json"), format: "json", container: "mcpServers" },
    { id: "cursor", dir: path.join(home, ".cursor"), configPath: path.join(home, ".cursor", "mcp.json"), format: "json", container: "mcpServers" },
    { id: "codex", dir: path.join(home, ".codex"), configPath: path.join(home, ".codex", "config.toml"), format: "toml" },
    { id: "opencode", dir: opencodeDir, configPath: path.join(opencodeDir, "opencode.json"), format: "opencode", container: "mcp" },
  ];
}

/** Return descriptors for only the clients whose config directory exists. */
export function detectClients(opts = {}) {
  return clientDescriptors(opts).filter((d) => fs.existsSync(d.dir));
}

// --- Entry sets: aggregator (default) vs the 11 separate (--separate) ---------

/** Per-source key placement (separate mode): keys go ONLY on their own server. */
function keysForSource(source, keys) {
  const env = {};
  if (source === "librariesio" && keys?.LIBRARIESIO_KEY) env.LIBRARIESIO_KEY = keys.LIBRARIESIO_KEY;
  if (source === "producthunt" && keys?.PRODUCTHUNT_TOKEN) env.PRODUCTHUNT_TOKEN = keys.PRODUCTHUNT_TOKEN;
  return env;
}

/** Assemble one JSON entry. format "opencode" → array command + `environment`; else `env`. */
function jsonEntry(bin, env, format, platform) {
  const hasEnv = env && Object.keys(env).length > 0;
  if (format === "opencode") {
    return { ...opencodeEntry(bin, platform), ...(hasEnv ? { environment: env } : {}) };
  }
  return { ...stdioEntry(bin, platform), ...(hasEnv ? { env } : {}) };
}

/**
 * Default D-06 entry set: the SINGLE `medium-research-all` aggregator entry carrying
 * whichever provided keys in ONE env/environment block (both keyed servers run inside
 * the aggregator process). `format` = "env" (Claude/Cursor) | "opencode".
 */
export function aggregatorEntries(keys, platform = process.platform, format = "env") {
  const bin = "medium-research-all";
  return { [bin]: jsonEntry(bin, envFor(keys), format, platform) };
}

/**
 * `--separate` entry set: the 11 `medium-research-<source>` entries, with keys attached
 * only to librariesio / producthunt.
 */
export function separateEntries(keys, platform = process.platform, format = "env") {
  const out = {};
  for (const s of SOURCES) {
    const bin = `medium-research-${s}`;
    out[bin] = jsonEntry(bin, keysForSource(s, keys), format, platform);
  }
  return out;
}

/** TOML table map (name -> block) for the aggregator single entry. */
export function aggregatorTomlTables(keys, platform = process.platform) {
  const name = "medium-research-all";
  const env = envFor(keys);
  return {
    [`mcp_servers.${name}`]: tomlBlock(name, name, Object.keys(env).length ? env : null, platform),
  };
}

/** TOML table map (name -> block) for the 11 separate entries. */
export function separateTomlTables(keys, platform = process.platform) {
  const out = {};
  for (const s of SOURCES) {
    const name = `medium-research-${s}`;
    const env = keysForSource(s, keys);
    out[`mcp_servers.${name}`] = tomlBlock(name, name, Object.keys(env).length ? env : null, platform);
  }
  return out;
}

// --- Argv parsing ------------------------------------------------------------

export const CLIENT_IDS = ["claude", "cursor", "codex", "opencode"];

/**
 * Parse the install argv (process.argv.slice(2)). Validates `--client` against the
 * 4-value allowlist and rejects unknown flags/values with a clear error (V5 input
 * validation, T-09B-04).
 */
export function parseArgs(argv) {
  const opts = { install: argv[0] === "install", separate: false, yes: false, client: null };
  const rest = opts.install ? argv.slice(1) : argv;
  for (const a of rest) {
    if (a === "--separate") opts.separate = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a.startsWith("--client=")) {
      const v = a.slice("--client=".length);
      if (!CLIENT_IDS.includes(v)) {
        throw new Error(`Unknown --client "${v}" (expected one of: ${CLIENT_IDS.join(", ")}).`);
      }
      opts.client = v;
    } else {
      throw new Error(`Unknown argument "${a}".`);
    }
  }
  return opts;
}

// --- Write dispatch ----------------------------------------------------------

const OPENCODE_SKELETON = { $schema: "https://opencode.ai/config.json", mcp: {} };

/** Back up then non-destructively write the chosen entry set to one client. */
export function writeToClient(desc, mode, keys, platform = process.platform) {
  const bak = backupConfig(desc.configPath);
  if (desc.format === "toml") {
    const tables = mode === "separate"
      ? separateTomlTables(keys, platform)
      : aggregatorTomlTables(keys, platform);
    mergeToml(desc.configPath, tables);
  } else if (desc.format === "opencode") {
    const entries = mode === "separate"
      ? separateEntries(keys, platform, "opencode")
      : aggregatorEntries(keys, platform, "opencode");
    mergeJson(desc.configPath, desc.container, entries, structuredClone(OPENCODE_SKELETON));
  } else {
    const entries = mode === "separate"
      ? separateEntries(keys, platform, "env")
      : aggregatorEntries(keys, platform, "env");
    mergeJson(desc.configPath, desc.container, entries);
  }
  return bak;
}

// --- CLI ---------------------------------------------------------------------

const PLAINTEXT_WARNING =
  "NOTE: keys are stored in PLAINTEXT in the client config file. For Claude Desktop, " +
  "the .mcpb bundle stores secrets in the OS keychain instead.";

function printUsage() {
  console.log(
    "Usage: npx medium-research-mcp install [--separate] [--client=<claude|cursor|codex|opencode>] [--yes]\n" +
      "\n  Interactive by default: detects your MCP client(s), backs up the config, and\n" +
      "  non-destructively merges the medium-research server entries.\n" +
      "  --separate  install the 11 individual servers instead of the single aggregator\n" +
      "  --client=   non-interactive target (required in a non-TTY/CI run)\n" +
      "  --yes       skip the confirm prompt",
  );
}

/** Non-interactive (CI / non-TTY) install: requires --client, writes keyless. */
function runNonInteractive(opts, mode) {
  const desc = clientDescriptors().find((d) => d.id === opts.client);
  const bak = writeToClient(desc, mode, {});
  const what = mode === "separate" ? `${SOURCES.length} separate entries` : "medium-research-all";
  console.log(`Wrote ${what} to ${desc.configPath}`);
  if (bak) console.log(`Backed up previous config to ${bak}`);
}

/** Interactive wizard: detect → pick → prompt keys (skippable) → confirm → write. */
async function runInteractive(opts, mode) {
  const detected = detectClients();
  if (detected.length === 0) {
    console.log("No supported MCP client detected. Looked for:");
    for (const d of clientDescriptors()) console.log(`  - ${d.id}: ${d.dir}`);
    console.log("Nothing written.");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("Detected MCP clients:");
    detected.forEach((d, i) => console.log(`  ${i + 1}. ${d.id} (${d.configPath})`));
    const pick = (await rl.question("Install to which? (comma-separated numbers, or 'all') [all]: ")).trim();
    let targets;
    if (!pick || pick.toLowerCase() === "all") {
      targets = detected;
    } else {
      targets = pick
        .split(",")
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((i) => i >= 0 && i < detected.length)
        .map((i) => detected[i]);
    }
    if (targets.length === 0) {
      console.log("No client selected. Nothing written.");
      return;
    }

    console.log(
      "\nEnter API keys (press Enter to skip — a skipped key leaves that server keyless / fail-loud):",
    );
    console.log(PLAINTEXT_WARNING);
    const keys = {};
    const lib = (await rl.question("LIBRARIESIO_KEY (Enter to skip): ")).trim();
    if (lib) keys.LIBRARIESIO_KEY = lib;
    const ph = (await rl.question("PRODUCTHUNT_TOKEN (Enter to skip): ")).trim();
    if (ph) keys.PRODUCTHUNT_TOKEN = ph;

    const what = mode === "separate" ? `${SOURCES.length} separate entries` : "the single medium-research-all entry";
    console.log(`\nAbout to write ${what} to:`);
    targets.forEach((d) => console.log(`  - ${d.configPath}`));
    const ok = opts.yes || /^y(es)?$/i.test((await rl.question("Proceed? [y/N]: ")).trim());
    if (!ok) {
      console.log("Aborted. Nothing written.");
      return;
    }

    for (const d of targets) {
      const bak = writeToClient(d, mode, keys);
      console.log(`  ${d.id}: wrote to ${d.configPath}${bak ? ` (backup: ${bak})` : ""}`);
    }
    console.log("Done. Restart your client to load the new server(s).");
  } finally {
    rl.close();
  }
}

async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }
  if (!opts.install) {
    printUsage();
    return;
  }

  const mode = opts.separate ? "separate" : "aggregator";

  // Non-TTY guard (T-09B-05): never block on a prompt — require --client in CI.
  if (opts.client) {
    runNonInteractive(opts, mode);
    return;
  }
  if (!process.stdin.isTTY) {
    console.error(
      "Non-interactive run (no TTY): pass --client=<claude|cursor|codex|opencode> " +
        "(optionally with --separate/--yes). Nothing written.",
    );
    process.exitCode = 1;
    return;
  }

  await runInteractive(opts, mode);
}

if (isEntry(import.meta.url)) {
  await main(process.argv.slice(2));
}
