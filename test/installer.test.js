// test/installer.test.js — the `npx medium-research-mcp install` installer (INST-01).
//
// Every merge/build/escape/detect helper is PURE + exported, so these tests exercise
// them against os.tmpdir() fixtures and in-memory strings — never a real client config.
// No network, no keys read from env: the installer only ever writes keys the caller
// hands it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  backupConfig,
  mergeJson,
  stdioEntry,
  envFor,
  opencodeEntry,
  escapeTomlString,
  tomlBlock,
  spliceTomlTable,
  mergeToml,
  detectClients,
} from "../bin/install.js";

// A fresh tmpdir per call so cases never collide.
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mrm-install-"));
}

// --- backupConfig ------------------------------------------------------------

test("backupConfig copies an existing file to a timestamped .bak-* and returns its path", () => {
  const dir = tmp();
  const cfg = path.join(dir, "claude_desktop_config.json");
  fs.writeFileSync(cfg, '{"mcpServers":{}}');
  const bak = backupConfig(cfg);
  assert.ok(bak, "returns a backup path");
  assert.match(path.basename(bak), /\.bak-\d{8}T\d+Z$/, "timestamped .bak name");
  assert.equal(fs.readFileSync(bak, "utf8"), '{"mcpServers":{}}', "backup is a byte copy");
});

test("backupConfig returns null and writes nothing when the file is absent", () => {
  const dir = tmp();
  const cfg = path.join(dir, "nope.json");
  assert.equal(backupConfig(cfg), null);
  assert.deepEqual(fs.readdirSync(dir), [], "no backup created");
});

// --- mergeJson: non-destructive merge (the load-bearing case) ----------------

test("mergeJson preserves an unrelated server entry and adds medium-research-all", () => {
  const dir = tmp();
  const cfg = path.join(dir, "claude_desktop_config.json");
  const original = {
    mcpServers: {
      "some-other-server": { command: "node", args: ["/opt/other/server.js"], env: { FOO: "bar" } },
    },
  };
  fs.writeFileSync(cfg, JSON.stringify(original, null, 2));

  mergeJson(cfg, "mcpServers", { "medium-research-all": stdioEntry("medium-research-all", "linux") });

  const after = JSON.parse(fs.readFileSync(cfg, "utf8"));
  // Unrelated entry byte-preserved.
  assert.deepEqual(
    after.mcpServers["some-other-server"],
    original.mcpServers["some-other-server"],
    "unrelated server survives untouched",
  );
  // Our entry added.
  assert.deepEqual(after.mcpServers["medium-research-all"], {
    command: "npx",
    args: ["-y", "medium-research-all"],
  });
});

test("mergeJson is idempotent — re-running does not duplicate or corrupt entries", () => {
  const dir = tmp();
  const cfg = path.join(dir, "cfg.json");
  const entries = { "medium-research-all": stdioEntry("medium-research-all", "linux") };
  mergeJson(cfg, "mcpServers", entries);
  const first = fs.readFileSync(cfg, "utf8");
  mergeJson(cfg, "mcpServers", entries);
  const second = fs.readFileSync(cfg, "utf8");
  assert.equal(first, second, "second merge produces identical bytes");
  assert.equal(Object.keys(JSON.parse(second).mcpServers).length, 1);
});

test("mergeJson creates a fresh config when the file does not exist", () => {
  const dir = tmp();
  const cfg = path.join(dir, "sub", "cfg.json"); // nested dir must be created
  mergeJson(cfg, "mcpServers", { "medium-research-all": stdioEntry("medium-research-all", "linux") });
  const obj = JSON.parse(fs.readFileSync(cfg, "utf8"));
  assert.deepEqual(Object.keys(obj.mcpServers), ["medium-research-all"]);
});

test("mergeJson on a non-JSON file throws and leaves the file byte-unchanged", () => {
  const dir = tmp();
  const cfg = path.join(dir, "cfg.json");
  const garbage = "{ this is : not json, // with a comment\n }";
  fs.writeFileSync(cfg, garbage);
  assert.throws(
    () => mergeJson(cfg, "mcpServers", { x: {} }),
    /Cannot parse .* as JSON/,
  );
  assert.equal(fs.readFileSync(cfg, "utf8"), garbage, "file left exactly as it was");
});

// --- stdioEntry: platform shape ----------------------------------------------

test("stdioEntry emits cmd /c npx on win32 and bare npx elsewhere", () => {
  assert.deepEqual(stdioEntry("medium-research-all", "win32"), {
    command: "cmd",
    args: ["/c", "npx", "-y", "medium-research-all"],
  });
  assert.deepEqual(stdioEntry("medium-research-all", "linux"), {
    command: "npx",
    args: ["-y", "medium-research-all"],
  });
  assert.deepEqual(stdioEntry("medium-research-all", "darwin"), {
    command: "npx",
    args: ["-y", "medium-research-all"],
  });
});

// --- envFor: skippable keys --------------------------------------------------

test("envFor keeps only provided keys; a skipped key is absent", () => {
  assert.deepEqual(envFor({ LIBRARIESIO_KEY: "abc" }), { LIBRARIESIO_KEY: "abc" });
  assert.deepEqual(
    envFor({ LIBRARIESIO_KEY: "abc", PRODUCTHUNT_TOKEN: "xyz" }),
    { LIBRARIESIO_KEY: "abc", PRODUCTHUNT_TOKEN: "xyz" },
  );
  assert.deepEqual(envFor({ LIBRARIESIO_KEY: "", PRODUCTHUNT_TOKEN: undefined }), {});
  assert.deepEqual(envFor({}), {});
  assert.deepEqual(envFor(undefined), {});
});

// --- opencodeEntry: array command, type/enabled, environment (not env) -------

test("opencodeEntry uses an array command, type:local, enabled:true", () => {
  assert.deepEqual(opencodeEntry("medium-research-all", "linux"), {
    type: "local",
    command: ["npx", "-y", "medium-research-all"],
    enabled: true,
  });
  assert.deepEqual(opencodeEntry("medium-research-all", "win32"), {
    type: "local",
    command: ["cmd", "/c", "npx", "-y", "medium-research-all"],
    enabled: true,
  });
});

test("OpenCode merge seeds $schema when absent and puts keys under environment", () => {
  const dir = tmp();
  const cfg = path.join(dir, "opencode.json");
  const entry = { ...opencodeEntry("medium-research-all", "linux"), environment: { LIBRARIESIO_KEY: "k" } };
  mergeJson(cfg, "mcp", { "medium-research-all": entry }, { $schema: "https://opencode.ai/config.json", mcp: {} });
  const obj = JSON.parse(fs.readFileSync(cfg, "utf8"));
  assert.equal(obj.$schema, "https://opencode.ai/config.json");
  assert.deepEqual(obj.mcp["medium-research-all"].command, ["npx", "-y", "medium-research-all"]);
  assert.equal(obj.mcp["medium-research-all"].type, "local");
  assert.equal(obj.mcp["medium-research-all"].enabled, true);
  assert.deepEqual(obj.mcp["medium-research-all"].environment, { LIBRARIESIO_KEY: "k" });
  assert.equal(obj.mcp["medium-research-all"].env, undefined, "env key is not used for OpenCode");
});

// --- escapeTomlString --------------------------------------------------------

test("escapeTomlString escapes backslash and quote, rejects control chars", () => {
  assert.equal(escapeTomlString('a"b\\c'), 'a\\"b\\\\c');
  assert.equal(escapeTomlString("plain-key-123"), "plain-key-123");
  assert.throws(() => escapeTomlString("has\nnewline"), /control character or newline/);
  assert.throws(() => escapeTomlString("has\ttab is\x00null"), /control character or newline/);
});

// --- TOML splice: non-destructive + idempotent -------------------------------

test("spliceTomlTable adds our table, keeps sandwiching unrelated tables, is idempotent", () => {
  const original =
    `[mcp_servers.other-a]\ncommand = "a"\nargs = ["x"]\n\n` +
    `[mcp_servers.other-b]\ncommand = "b"\nargs = ["y"]\n`;
  const block = tomlBlock("medium-research-all", "medium-research-all", { LIBRARIESIO_KEY: "k" }, "linux");

  const once = spliceTomlTable(original, "mcp_servers.medium-research-all", block);
  assert.match(once, /\[mcp_servers\.other-a\]/, "unrelated table a survives");
  assert.match(once, /\[mcp_servers\.other-b\]/, "unrelated table b survives");
  assert.match(once, /\[mcp_servers\.medium-research-all\]/, "our table added");
  assert.match(once, /\[mcp_servers\.medium-research-all\.env\]/, "our env sub-table added");
  assert.match(once, /LIBRARIESIO_KEY = "k"/);

  // Idempotent: a second splice of the same block produces exactly one of our tables.
  const twice = spliceTomlTable(once, "mcp_servers.medium-research-all", block);
  const count = (s) => (s.match(/\[mcp_servers\.medium-research-all\]/g) || []).length;
  assert.equal(count(twice), 1, "no duplicate table on re-run");
  assert.match(twice, /\[mcp_servers\.other-a\]/);
  assert.match(twice, /\[mcp_servers\.other-b\]/);
});

test("mergeToml writes our block to a file and preserves an unrelated table", () => {
  const dir = tmp();
  const cfg = path.join(dir, "config.toml");
  fs.writeFileSync(cfg, `[mcp_servers.other]\ncommand = "z"\nargs = ["q"]\n`);
  const block = tomlBlock("medium-research-all", "medium-research-all", null, "linux");
  mergeToml(cfg, { "mcp_servers.medium-research-all": block });
  const text = fs.readFileSync(cfg, "utf8");
  assert.match(text, /\[mcp_servers\.other\]/, "unrelated table survives");
  assert.match(text, /\[mcp_servers\.medium-research-all\]/, "our table written");
  // No env sub-table when no keys provided.
  assert.doesNotMatch(text, /\.env\]/);
});

// --- detectClients -----------------------------------------------------------

test("detectClients returns exactly the clients whose config dir exists", () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, ".cursor"));
  fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
  const found = detectClients({ home, platform: "linux" }).map((d) => d.id).sort();
  assert.deepEqual(found, ["cursor", "opencode"]);

  // With all four present.
  fs.mkdirSync(path.join(home, ".config", "Claude"), { recursive: true });
  fs.mkdirSync(path.join(home, ".codex"));
  const all = detectClients({ home, platform: "linux" }).map((d) => d.id).sort();
  assert.deepEqual(all, ["claude", "codex", "cursor", "opencode"]);
});
