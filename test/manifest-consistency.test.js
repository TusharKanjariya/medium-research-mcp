// D-05 manifest⇄credentials consistency test.
//
// Locks the contract that ties each .mcpb manifest to shared/credentials.js:
//   manifest env ref  ⇒  exists in ENV_VAR (single source of truth)  AND  is
//   actually imported/read by that server. This catches the scaffold-era
//   over-declaration (hn listed reddit_client_secret + librariesio_key it never
//   reads) and any future drift where a manifest promises a secret its server
//   ignores (dead secret ref) or points at an ENV var credentials.js doesn't know.
//
// Direction-safe (RESEARCH §Manifest Cleanup): a manifest env ref must map to an
// ENV_VAR AND be read by its server — but NOT every ENV_VAR must appear in a
// manifest (REDDIT_* legitimately has no server). No network, no external deps
// (node:test + node:assert, matching test/credentials.test.js style).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SERVERS = [
  "hn", "stackexchange", "lobsters", "lemmy", "devto", "github",
  "librariesio", "producthunt", "rss", "discourse", "mastodon",
];

// ENVNAME -> the credentials.js accessor the owning server.js must read
// (import-match, per RESEARCH §Manifest Cleanup). An env declared by a manifest
// but absent here is an unexpected/over-declared credential and fails the test.
const ACCESSOR = {
  GITHUB_TOKEN: "githubHeaders",
  STACKEXCHANGE_KEY: "stackExchangeParams",
  LIBRARIESIO_KEY: "librariesIoParams",
  PRODUCTHUNT_TOKEN: "productHuntHeaders",
  LEMMY_INSTANCE: "lemmyInstance",
  LEMMY_USERNAME: "lemmyCreds",
  LEMMY_PASSWORD: "lemmyCreds",
};

// Single source of truth: ENV var names are read from credentials.js SOURCE TEXT,
// never re-listed here. An ENVNAME counts as known iff it appears as a quoted
// string literal in shared/credentials.js (its ENV_VAR values).
const credSource = readFileSync(join(root, "shared/credentials.js"), "utf8");

// Assert one manifest's declared env block is consistent with credentials.js and
// the server source. No env block => nothing to check (direction-safe). Throws on
// any violation, so it doubles as the lever for the negative control below.
function assertEnvConsistency(name, manifest, serverSource) {
  const env = manifest.server?.mcp_config?.env;
  if (!env) return;
  const userConfig = manifest.user_config ?? {};
  for (const [envName, ref] of Object.entries(env)) {
    const m = /^\$\{user_config\.([A-Za-z0-9_]+)\}$/.exec(ref);
    assert.ok(m, `${name}: env ${envName} ref ${JSON.stringify(ref)} is not \${user_config.<field>}`);
    const field = m[1];
    assert.ok(
      Object.prototype.hasOwnProperty.call(userConfig, field),
      `${name}: env ${envName} references user_config.${field} which is not declared`,
    );
    assert.ok(
      credSource.includes(`"${envName}"`),
      `${name}: env ${envName} is not an ENV_VAR in shared/credentials.js`,
    );
    const accessor = ACCESSOR[envName];
    assert.ok(accessor, `${name}: env ${envName} has no known credentials accessor (over-declared)`);
    assert.ok(
      serverSource.includes(accessor) || serverSource.includes(envName),
      `${name}: server.js does not read ${envName} (via ${accessor}()) — over-declared credential`,
    );
  }
}

for (const name of SERVERS) {
  test(`${name}: manifest env refs ⊆ ENV_VAR and are read by the server`, () => {
    const manifest = JSON.parse(readFileSync(join(root, "servers", name, "manifest.json"), "utf8"));
    assert.equal(manifest.manifest_version, "0.3", `${name}: manifest_version must stay "0.3"`);
    const serverSource = readFileSync(join(root, "servers", name, "server.js"), "utf8");
    assertEnvConsistency(name, manifest, serverSource);
  });
}

// Non-vacuous: a bogus env ref whose user_config field does not exist must throw,
// proving the assertion actually bites (not silently passing everything).
test("negative control: a bogus env ref makes the assertion throw", () => {
  const bogus = {
    manifest_version: "0.3",
    user_config: { real_field: {} },
    server: { mcp_config: { env: { BOGUS_KEY: "${user_config.bogus}" } } },
  };
  assert.throws(() => assertEnvConsistency("synthetic", bogus, ""), /user_config\.bogus/);
});
