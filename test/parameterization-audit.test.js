// test/parameterization-audit.test.js — SEC-02 (D-16): the parameterization audit.
//
// The suite's security thesis is "no hardcoded targets — a target is always a
// TOOL PARAMETER." A fixed PLATFORM base (hn.algolia.com, dev.to, an instance's
// API root that is the same for every user) may be a literal; a user-specific
// TARGET (a particular forum/instance, a named account @handle, a named-blog feed
// URL) must NOT. The two new v1.1 servers pass precisely because their base is
// `${normalizeInstance(instance)}` — a variable — so they contain no forum-host
// literal at all.
//
// This is a STATIC source scan (the analog is uniform-run.test.js §(d), which
// asserts over source text). It reads every `servers/*/server.js` (the rss
// `resolve*` feed-URL helpers live inside servers/rss/server.js, so scanning that
// file covers them) and enforces an ALLOWLIST of fixed platform bases. It does
// NOT scan `shared/` — the isMediumHost / SSRF DENY lists there are security
// infrastructure, not per-source targets (RESEARCH §Scan scope).
//
// It is deliberately NON-VACUOUS: the negative-control tests below run the exact
// same checker functions over synthetic snippets containing a hardcoded forum host
// and a hardcoded account-feed handle and assert each is flagged — proving the
// guard would fail the moment a real hardcoded target were introduced.
//
// Offline, zero-dependency, zero network (node:fs only).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVERS_DIR = resolve(HERE, "../servers");

// --- Allowlist: fixed PLATFORM bases only ---------------------------------
//
// A host PASSES only if it is one of these fixed platform API/feed roots, ends
// with an allowed rss-platform suffix, or is a known non-routable documentation
// placeholder. Anything else — a specific Discourse/Mastodon/Lemmy community
// instance, a named-blog feed host, a hardcoded account — FAILS. This Set is the
// contract: adding a source means adding its platform base here (a deliberate,
// reviewable act), never sprinkling a user target into a server.
const ALLOWED_HOSTS = new Set([
  "hn.algolia.com",
  "news.ycombinator.com",
  "api.stackexchange.com",
  "dev.to",
  "medium.com",
  "lobste.rs",
  "libraries.io",
  "api.producthunt.com",
  "api.github.com",
  "www.youtube.com",
  "www.reddit.com",
  "programming.dev", // Lemmy's env-overridable DEFAULT (LEMMY_INSTANCE); not a user target
]);

// rss resolves user publications to these platform hosts (pub.substack.com,
// medium subdomains) — the subdomain is the user's slug but the PLATFORM suffix
// is fixed, so a suffix match is the correct allow rule.
const ALLOWED_SUFFIXES = [".substack.com", ".medium.com"];

// Non-routable documentation placeholders that appear ONLY inside a human-facing
// error message (e.g. `throw new Error("... e.g. https://your.lemmy.instance")`).
// `.instance` is not a real TLD — this is never fetched; it is copy that shows a
// user the expected shape of the `instance` parameter. Allowed as an explicit,
// documented exception, NOT as a platform base.
const PLACEHOLDER_HOSTS = new Set(["your.lemmy.instance"]);

function hostAllowed(host) {
  const h = host.toLowerCase();
  if (ALLOWED_HOSTS.has(h)) return true;
  if (PLACEHOLDER_HOSTS.has(h)) return true;
  return ALLOWED_SUFFIXES.some((s) => h.endsWith(s));
}

// --- Comment stripper (string-literal-preserving) -------------------------
//
// We CANNOT strip comments with a naive `//.*$` regex: every host literal in this
// codebase lives inside a string as `https://…`, and the `//` in the scheme would
// be mistaken for a line comment, decapitating every URL and making the host scan
// blind. So we walk the source char-by-char, tracking string/template/comment
// state, and drop ONLY real comments while KEEPING string contents intact (a real
// hardcoded target would live in a string/template, so strings must survive the
// scan). Escapes inside strings are honored so an escaped quote can't end a string
// early. Template `${…}` bodies are treated as string content — none of our URL
// literals hide a comment inside an interpolation, and doing so would be invalid.
function stripComments(src) {
  let out = "";
  let state = "code"; // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = i + 1 < src.length ? src[i + 1] : "";

    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i++; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i++; continue; }
      out += c;
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "tpl";
      continue;
    }

    if (state === "line") {
      if (c === "\n") { state = "code"; out += c; }
      continue;
    }

    if (state === "block") {
      if (c === "*" && c2 === "/") { state = "code"; i++; continue; }
      if (c === "\n") out += c; // keep newlines so line context is preserved
      continue;
    }

    // string states (sq | dq | tpl): keep every char; honor escapes; detect close
    out += c;
    if (c === "\\") {
      if (i + 1 < src.length) { out += src[i + 1]; i++; }
      continue;
    }
    if (state === "sq" && c === "'") state = "code";
    else if (state === "dq" && c === '"') state = "code";
    else if (state === "tpl" && c === "`") state = "code";
  }
  return out;
}

// --- The two checks -------------------------------------------------------

// (1) Every `https?://<host>` literal must be an allowlisted platform host.
//     Returns the list of FORBIDDEN hosts found (empty === clean).
function findForbiddenHosts(code) {
  const stripped = stripComments(code);
  const re = /https?:\/\/([a-z0-9.\-]+)/gi;
  const forbidden = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    if (!hostAllowed(m[1])) forbidden.push(m[1]);
  }
  return forbidden;
}

// (2) No URL literal may embed a hardcoded account/handle in its authority or
//     path (e.g. `https://medium.com/feed/@someuser`). The host may be allowlisted
//     (medium.com is), so check (1) alone can't catch a hardcoded account feed —
//     THIS is that guard. The current suite builds every handle segment via
//     `encodeURIComponent(user)` from a tool param (`.../feed/@${…}`), so the char
//     after the literal `@` is `$`, never a word char — no literal handle exists.
//     Returns the list of offending URL fragments (empty === clean).
function findEmbeddedHandles(code) {
  const stripped = stripComments(code);
  const re = /https?:\/\/[^\s"'`)]*@[A-Za-z0-9_]+/gi;
  return stripped.match(re) ?? [];
}

// --- Discover the scan targets -------------------------------------------

function serverFiles() {
  const files = [];
  for (const name of readdirSync(SERVERS_DIR)) {
    const dir = join(SERVERS_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const file = join(dir, "server.js");
    try {
      if (statSync(file).isFile()) files.push({ name, file });
    } catch {
      // no server.js in this dir — skip
    }
  }
  return files;
}

// --- The audit ------------------------------------------------------------

test("SEC-02: the audit actually scans the suite (scope is servers/*/server.js, not shared/)", () => {
  const files = serverFiles();
  const names = files.map((f) => f.name).sort();

  // Non-vacuous scope: the scan must include real servers AND the parameterized
  // v1.1 additions whose SEC-02 property this test exists to enforce.
  assert.ok(files.length >= 9, `expected to scan the server suite, found ${files.length}`);
  for (const required of ["discourse", "mastodon", "lemmy", "rss"]) {
    assert.ok(names.includes(required), `scan must include servers/${required}/server.js`);
  }

  // shared/ is out of scope by construction — every scanned path is under servers/.
  for (const { file } of files) {
    assert.ok(
      file.includes(`${SERVERS_DIR.split(/[\\/]/).pop()}`),
      "scan target must live under servers/",
    );
    assert.ok(!/[\\/]shared[\\/]/.test(file), "shared/ must NOT be scanned");
  }
});

test("SEC-02: no server hardcodes a non-allowlisted host literal (no forum/instance/feed target)", () => {
  for (const { name, file } of serverFiles()) {
    const code = readFileSync(file, "utf8");
    assert.ok(code.length > 0, `servers/${name}/server.js should not be empty`);
    const forbidden = findForbiddenHosts(code);
    assert.deepEqual(
      forbidden,
      [],
      `servers/${name}/server.js hardcodes non-allowlisted host(s): ${forbidden.join(", ")} — ` +
        `a user-specific target must be a tool parameter, not a literal`,
    );
  }
});

test("SEC-02: no server embeds a hardcoded @handle in a URL (accounts come from encodeURIComponent(param))", () => {
  for (const { name, file } of serverFiles()) {
    const code = readFileSync(file, "utf8");
    const handles = findEmbeddedHandles(code);
    assert.deepEqual(
      handles,
      [],
      `servers/${name}/server.js embeds a hardcoded account in a URL: ${handles.join(", ")}`,
    );
  }
});

// --- Negative controls: prove the guard is NOT vacuous --------------------

test("SEC-02 negative control: a hardcoded forum host WOULD be flagged", () => {
  // A synthetic server line that hardcodes a specific community instance.
  const violation = `const raw = await getJson("https://someforum.example.com/latest.json", { untrustedHost: true });`;
  const forbidden = findForbiddenHosts(violation);
  assert.ok(
    forbidden.includes("someforum.example.com"),
    "the host scan must flag a hardcoded non-allowlisted forum host",
  );

  // Selectivity: an allowlisted platform base in the SAME snippet is NOT flagged,
  // so the checker discriminates rather than flagging everything.
  const mixed = `fetch("https://dev.to/api/articles"); fetch("https://someforum.example.com/x");`;
  assert.deepEqual(
    findForbiddenHosts(mixed),
    ["someforum.example.com"],
    "the host scan must allow platform bases and flag only the hardcoded target",
  );

  // And a comment mentioning a non-allowlisted host is NOT a violation (comments
  // are stripped) — a doc reference is not a runtime target.
  assert.deepEqual(
    findForbiddenHosts(`// see https://someforum.example.com for the field map\nconst x = 1;`),
    [],
    "a host named only in a comment must not trip the audit",
  );
});

test("SEC-02 negative control: a hardcoded account-feed @handle WOULD be flagged", () => {
  const violation = `return \`https://medium.com/feed/@someuser\`;`;
  // The host itself is allowlisted (medium.com), so check (1) does NOT catch it —
  const forbidden = findForbiddenHosts(violation);
  assert.deepEqual(forbidden, [], "medium.com is an allowlisted platform base");
  // …check (2) is the guard that catches the hardcoded account in the path.
  const handles = findEmbeddedHandles(violation);
  assert.ok(
    handles.some((h) => h.includes("@someuser")),
    "the handle scan must flag a hardcoded account embedded in a feed URL",
  );

  // Selectivity: the PARAMETERIZED form (the real code shape) is NOT flagged,
  // because the char after the literal `@` is `$` (an interpolation), not a handle.
  const parameterized = "return `https://medium.com/feed/@${encodeURIComponent(user)}`;";
  assert.deepEqual(
    findEmbeddedHandles(parameterized),
    [],
    "an encodeURIComponent(param) handle segment must NOT be flagged",
  );
});

// --- Stripper unit guard: the load-bearing invariant ----------------------

test("SEC-02: stripComments preserves https:// inside string literals (does not decapitate URLs)", () => {
  // If the stripper mistook the `//` in a scheme for a line comment, the host scan
  // would be silently blind. Pin the behavior that makes the whole audit valid.
  const withUrlAndComment = `const A = "https://api.github.com"; // https://not-a-target.example.com\n`;
  const stripped = stripComments(withUrlAndComment);
  assert.ok(stripped.includes("https://api.github.com"), "string URL must survive stripping");
  assert.ok(
    !stripped.includes("not-a-target.example.com"),
    "the trailing line comment (and its host) must be stripped",
  );
});
