# Installing the medium-research MCP servers

This repo ships as **one npm package, `medium-research-mcp`**, that exposes **11
separate MCP servers** — one per developer-community source. Each server is its own
`medium-research-<source>` executable (an npm `bin`), so you add only the sources you
want and each runs as an isolated stdio process.

The 11 servers:

| Bin (npx target) | Source | Credential |
| --- | --- | --- |
| `medium-research-hn` | Hacker News | none |
| `medium-research-stackexchange` | Stack Exchange | optional `STACKEXCHANGE_KEY` |
| `medium-research-lobsters` | Lobsters | none |
| `medium-research-lemmy` | Lemmy | optional `LEMMY_INSTANCE` / `LEMMY_USERNAME` / `LEMMY_PASSWORD` |
| `medium-research-devto` | Dev.to (Forem) | none |
| `medium-research-github` | GitHub | optional `GITHUB_TOKEN` |
| `medium-research-librariesio` | Libraries.io | **required `LIBRARIESIO_KEY`** |
| `medium-research-producthunt` | Product Hunt | **required `PRODUCTHUNT_TOKEN`** |
| `medium-research-rss` | Generic RSS/Atom | none (optional `RSS_ALLOWED_HOSTS`) |
| `medium-research-discourse` | Any public Discourse forum | none |
| `medium-research-mastodon` | Any public Mastodon instance | none |

Every server runs the same way: `npx -y -p medium-research-mcp medium-research-<source>`. The sections below
give the exact config for each client, **Windows first** (then macOS/Linux).

---

# Install paths

There are four ways to install, easiest first:

1. **One-shot installer (recommended)** — `npx medium-research-mcp install` does everything.
2. **Aggregator — one manual config entry** — a single `medium-research-all` server exposing every source.
3. **Per-source npm — manual client config** — add each `medium-research-<source>` you want by hand.
4. **GitHub (no npm registry)** — install straight from the repo with `npx github:…`.

---

## 1. One-shot installer (recommended)

The fastest path. From any terminal:

```bash
npx medium-research-mcp install
```

This runs the bundled installer (`bin/install.js`), which:

- **Auto-detects your client** — Claude Desktop, Cursor, Codex CLI, and OpenCode; it
  finds the right config file for whichever you have installed.
- **Backs up your existing config** before touching it, so a bad run is trivially undone.
- **Non-destructively merges** a single `medium-research-all` aggregator entry into your
  `mcpServers` (existing servers are left untouched — nothing is overwritten).
- **Prompts for the two optional keys** — `LIBRARIESIO_KEY` and `PRODUCTHUNT_TOKEN`.
  Both prompts are **skippable**: press Enter to leave them unset and the Libraries.io
  and Product Hunt tools simply return a clear "set X" error until you add a key later;
  every other source works with no credential.

After it finishes, restart your client. That's the whole install — the three paths below
are manual alternatives for people who want per-source control or can't use npm.

---

## 2. Aggregator — one manual config entry

If you'd rather edit config yourself but still want every source from a single entry, add
the **`medium-research-all`** aggregator (the same server the installer wires up). One
entry, all 11 sources:

```jsonc
// Claude Desktop / Cursor — Windows
"mcpServers": {
  "medium-research-all": {
    "command": "cmd",
    "args": ["/c", "npx", "-y", "-p", "medium-research-mcp", "medium-research-all"],
    "env": {
      "LIBRARIESIO_KEY": "your-libraries-io-key",
      "PRODUCTHUNT_TOKEN": "your-product-hunt-token"
    }
  }
}
```

```jsonc
// Claude Desktop / Cursor — macOS / Linux (drop the cmd /c wrapper)
"mcpServers": {
  "medium-research-all": {
    "command": "npx",
    "args": ["-y", "-p", "medium-research-mcp", "medium-research-all"],
    "env": {
      "LIBRARIESIO_KEY": "your-libraries-io-key",
      "PRODUCTHUNT_TOKEN": "your-product-hunt-token"
    }
  }
}
```

The two `env` keys are optional — omit them and only Libraries.io / Product Hunt degrade.
For Codex `config.toml` and OpenCode `opencode.json`, use the same per-client shapes shown
in path 3 below, just with the single bin name `medium-research-all`.

---

## 3. Per-source npm — manual client config

Add only the individual `medium-research-<source>` servers you want. The sections below
give the exact per-client config, **Windows first**. Read the two rules first.

## Two rules that apply to every client (read these first)

**1. Always use `-y`, and expect a slow first run.** Every snippet spawns
`npx -y -p medium-research-mcp medium-research-<source>`. The `-y` is not optional: without it, the first
`npx` run stops at an interactive "Ok to proceed?" install prompt — and because these
are **stdio** servers with no TTY, that prompt hangs the connection forever with no
error. The **first** run also downloads the package and its deps (typically 5–30s); a
client with a short spawn timeout (e.g. Codex's `startup_timeout_sec`, default 10) may
give up before that finishes. If a first connection times out, run
`npx -y -p medium-research-mcp medium-research-hn </dev/null` once in a terminal to warm the npm cache, then
retry — or point the client at a globally installed copy (`npm i -g medium-research-mcp`)
with an absolute path.

**2. GUI clients do NOT inherit your shell environment.** Claude Desktop and Cursor
spawn servers from a GUI process with a **minimal environment** — variables you
`export` in `.bashrc`/`.zshrc`/`.profile` (or set with `setx` and a new PowerShell)
**never reach the server**. A credential you rely on from your shell will silently
vanish and the server runs keyless (Stack Exchange/GitHub degrade quietly; Libraries.io
and Product Hunt fail with a clear "set X" error). **Put every credential in the
client's own `env` block** (shown below), or use the `.mcpb` bundle so secrets come from
the OS keychain. Never paste a real secret into a file you commit — the values below are
placeholders.

---

## Claude Desktop — `claude_desktop_config.json`

Edit via **Settings → Developer → Edit Config**. Keyless server and a credentialed one:

```jsonc
// Windows
"mcpServers": {
  "medium-research-hn": {
    "command": "cmd",
    "args": ["/c", "npx", "-y", "-p", "medium-research-mcp", "medium-research-hn"]
  },
  "medium-research-librariesio": {
    "command": "cmd",
    "args": ["/c", "npx", "-y", "-p", "medium-research-mcp", "medium-research-librariesio"],
    "env": { "LIBRARIESIO_KEY": "your-libraries-io-key" }
  }
}
```

```jsonc
// macOS / Linux — same shape, drop the cmd /c wrapper
"mcpServers": {
  "medium-research-hn": {
    "command": "npx",
    "args": ["-y", "-p", "medium-research-mcp", "medium-research-hn"]
  },
  "medium-research-librariesio": {
    "command": "npx",
    "args": ["-y", "-p", "medium-research-mcp", "medium-research-librariesio"],
    "env": { "LIBRARIESIO_KEY": "your-libraries-io-key" }
  }
}
```

Restart Claude Desktop after editing. **Preferred install: the `.mcpb` bundle** — see
[.mcpb one-click](#mcpb-one-click-claude-desktop-preferred) below.

### Windows: why `cmd /c`

On Windows, `npx` is a `.cmd` batch shim, not a real executable — spawning `"npx"`
directly gives `spawn npx ENOENT`. Wrapping it in `"command": "cmd", "args": ["/c",
"npx", …]` runs it through the shell that can resolve the shim. macOS/Linux call `npx`
directly.

---

## Cursor — `~/.cursor/mcp.json` (global) or `<project>/.cursor/mcp.json`

Same `mcpServers` `{ command, args, env }` schema as Claude Desktop:

```jsonc
// Windows
"mcpServers": {
  "medium-research-hn": {
    "command": "cmd",
    "args": ["/c", "npx", "-y", "-p", "medium-research-mcp", "medium-research-hn"]
  },
  "medium-research-producthunt": {
    "command": "cmd",
    "args": ["/c", "npx", "-y", "-p", "medium-research-mcp", "medium-research-producthunt"],
    "env": { "PRODUCTHUNT_TOKEN": "your-product-hunt-token" }
  }
}
```

```jsonc
// macOS / Linux
"mcpServers": {
  "medium-research-hn": {
    "command": "npx",
    "args": ["-y", "-p", "medium-research-mcp", "medium-research-hn"]
  }
}
```

Cursor supports `${env:VAR}` substitution inside the `env` block and reads env **at
spawn** — restart Cursor after edits. Cursor is a GUI client, so rule 2 applies: put
creds in `env`, not your shell.

---

## Codex CLI — `~/.codex/config.toml` (or project `.codex/config.toml`)

TOML, not JSON. Env goes in a **nested `[mcp_servers.<name>.env]` sub-table**:

```toml
[mcp_servers.medium-research-hn]
command = "npx"
args = ["-y", "-p", "medium-research-mcp", "medium-research-hn"]
# Windows: command = "cmd"; args = ["/c", "npx", "-y", "-p", "medium-research-mcp", "medium-research-hn"]

[mcp_servers.medium-research-librariesio]
command = "npx"
args = ["-y", "-p", "medium-research-mcp", "medium-research-librariesio"]
[mcp_servers.medium-research-librariesio.env]
LIBRARIESIO_KEY = "your-libraries-io-key"
```

Or add one from the CLI:

```bash
codex mcp add medium-research-librariesio --env LIBRARIESIO_KEY=your-key -- npx -y -p medium-research-mcp medium-research-librariesio
```

Transport is derived from `command` vs `url` (there is no transport key). Because the
first `npx` run is slow, bump `startup_timeout_sec` (default 10) if the initial spawn
times out.

---

## OpenCode — `opencode.json`

Two schema differences from every other client: **`command` is a single array**, and
the env key is **`"environment"`, not `"env"`**:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "medium-research-hn": {
      "type": "local",
      "command": ["npx", "-y", "-p", "medium-research-mcp", "medium-research-hn"],
      "enabled": true
    },
    "medium-research-producthunt": {
      "type": "local",
      "command": ["npx", "-y", "-p", "medium-research-mcp", "medium-research-producthunt"],
      "enabled": true,
      "environment": { "PRODUCTHUNT_TOKEN": "your-product-hunt-token" }
    }
  }
}
```

On Windows, prefix the array with the shell shim: `["cmd", "/c", "npx", "-y",
"-p", "medium-research-mcp", "medium-research-hn"]`. `{env:NAME}` substitutes a host env var inside `environment`.

---

## Claude Code plugin path (note)

You can also register a server with the Claude Code CLI:

```bash
claude mcp add --transport stdio medium-research-hn -- npx -y -p medium-research-mcp medium-research-hn

# with a credential (the --env flag goes BEFORE the server name):
claude mcp add --transport stdio --env LIBRARIESIO_KEY=your-key medium-research-librariesio -- npx -y -p medium-research-mcp medium-research-librariesio
```

Scopes: `local` (default, per-project in `~/.claude.json`), `user` (global), `project`
(a committable `.mcp.json`).

**Known gotcha:** a bundled server that relies on `${user_config.*}` (the `.mcpb`
keychain path) **can silently fail to spawn** on the plugin path — the credential never
arrives and the server either errors with "set X" or degrades quietly. After adding a
credentialed server this way, confirm it actually started with `claude mcp list` before
relying on it. For the two required-credential servers (Libraries.io, Product Hunt),
prefer the explicit `--env` form above (or the Claude Desktop `.mcpb`) over a bundled
`user_config`.

---

## 4. GitHub (no npm registry)

You can install straight from the repo without the npm registry — useful before/without a
published release, or to run an unreleased commit. Two forms:

```bash
# Run the one-shot installer straight from GitHub (mirrors path 1):
npx github:TusharKanjariya/medium-research-mcp install

# Run one specific server over GitHub (note the --package flag):
npx --package=github:TusharKanjariya/medium-research-mcp medium-research-hn
npx --package=github:TusharKanjariya/medium-research-mcp medium-research-all
```

**Why the bare command runs the installer, not a server.** When you give `npx` a package
with multiple bins and no explicit command, npm picks the bin whose name matches the
package name. The package is `medium-research-mcp` and it has a `medium-research-mcp` bin
(`bin/install.js`), so `npx github:TusharKanjariya/medium-research-mcp` runs the
**installer**. To start a specific server over GitHub you must name it with
`npx --package=github:… medium-research-<source>` as shown above. In a client config,
substitute the `--package` form for the `-y medium-research-<source>` args.

---

## Credentials reference

| Server | Env var | Required? | Where to get it |
| --- | --- | --- | --- |
| `medium-research-librariesio` | `LIBRARIESIO_KEY` | **Required** — fails loudly without it | https://libraries.io/account |
| `medium-research-producthunt` | `PRODUCTHUNT_TOKEN` | **Required** — fails loudly without it | https://www.producthunt.com/v2/oauth/applications |
| `medium-research-github` | `GITHUB_TOKEN` | Optional — raises rate limit | GitHub → Settings → Developer settings → tokens |
| `medium-research-stackexchange` | `STACKEXCHANGE_KEY` | Optional — raises quota | https://stackapps.com/apps/oauth/register |
| `medium-research-lemmy` | `LEMMY_INSTANCE`, `LEMMY_USERNAME`, `LEMMY_PASSWORD` | Optional — anonymous reads work without | your Lemmy instance |
| `medium-research-rss` | `RSS_ALLOWED_HOSTS` | Optional hardening — comma-separated host allowlist | n/a |

The two **required-credential** servers do not degrade: with no key they return a clear
`set LIBRARIESIO_KEY` / `set PRODUCTHUNT_TOKEN` error rather than making an
unauthenticated call. The optional ones degrade to keyless/anonymous mode. **Remember
rule 2:** in a GUI client these must live in the client's `env`/`environment` block,
because a shell-exported value is not inherited.

Secrets in a client config file are **stored in plaintext on disk**. For Claude Desktop,
prefer the `.mcpb` bundle so secrets go to the OS keychain instead.

---

## .mcpb one-click (Claude Desktop preferred)

Claude Desktop can install a server from a **`.mcpb` bundle**: double-click
`dist/medium-research-<source>.mcpb` and Desktop installs it and prompts for any required
credential, which it stores in the **OS keychain** (not in a plaintext config file). This
is the recommended install for Claude Desktop and the only path that keeps secrets out of
an on-disk config. Bundles are produced by the maintainer (see
[Publishing](#publishing-maintainer-manual--do-not-automate)); packaging is not required
to use the npx path above.

---

## Cross-source pain-point sweep (DOC-01)

Once the package is installed (or from a clone), run the cross-source sweep — one tag
queried across Stack Exchange + Discourse + Mastodon + Dev.to, merged into one ranked
list via the shared `mergeRank`:

```bash
node examples/pain-point-sweep.mjs rust
# or, from an install with the package scripts:
npm run example:sweep -- rust
```

It prints a single ranked list (highest engagement first) across all four sources. A
source that errors, rate-limits, or is locked down is skipped with a one-line note on
stderr — the sweep still returns the other sources. The Discourse and Mastodon instances
are overridable example values (`node examples/pain-point-sweep.mjs rust
https://meta.discourse.org https://mastodon.social`). See
[`examples/pain-point-sweep.mjs`](../examples/pain-point-sweep.mjs).

---

## Publishing (maintainer, manual — do NOT automate)

These steps are run **by hand by the maintainer**. Nothing in this repo publishes,
tags, or uploads automatically — that is a deliberate release gate. The version bump to
`1.2.1` is already in `package.json`; edit the version string directly on future bumps —
do **not** run `npm version minor` (it also commits + tags, colliding with the manual
`git tag` step below).

1. **Re-confirm the npm name is still free** immediately before publishing (an unscoped
   public name is first-come — verify it's still unclaimed):

   ```bash
   npm view medium-research-mcp version   # expect: 404 / "not found" for a first publish
   ```

2. **Inspect the tarball before publishing.** Confirm `servers/` and `shared/` are
   present and no secrets or `test/` / `.planning/` files leak in:

   ```bash
   npm pack --dry-run    # lists exactly what would ship (expect 34 files)
   npm pack              # writes medium-research-mcp-1.2.1.tgz to inspect
   ```

3. **Smoke-test the tarball install on Windows** (the primary target platform): install
   the packed `.tgz` into a scratch project and confirm at least one bin spawns:

   ```bash
   npm i -g ./medium-research-mcp-1.2.1.tgz
   npx -y -p medium-research-mcp medium-research-hn </dev/null   # should start and wait on stdio, not ENOENT
   ```

4. **Publish to npm** (only after 1–3 pass):

   ```bash
   npm login
   npm publish
   ```

5. **Make the GitHub repo public and push latest** so the `npx github:…` path resolves
   the current commit:

   ```bash
   gh repo edit --visibility public    # or GitHub web UI → Settings → Danger Zone
   git push origin master
   ```

6. **Live-verify BOTH install paths from a clean dir OUTSIDE the repo** with a fresh npm
   cache (a warm cache or running inside the repo tree resolves the local copy and gives a
   false pass):

   ```bash
   # npm path — after publish
   mkdir /tmp/verify-npm && cd /tmp/verify-npm
   npm_config_cache=$(mktemp -d) npx -y -p medium-research-mcp medium-research-hn </dev/null      # starts on stdio, not 404
   npm_config_cache=$(mktemp -d) npx -y -p medium-research-mcp medium-research-all </dev/null     # aggregator

   # github path — after public + push
   mkdir /tmp/verify-gh && cd /tmp/verify-gh
   npm_config_cache=$(mktemp -d) npx --package=github:TusharKanjariya/medium-research-mcp medium-research-hn </dev/null
   npx github:TusharKanjariya/medium-research-mcp install                  # runs bin/install.js (default bin)
   ```

   On Windows, run these from a folder outside the repo (e.g. `%TEMP%\verify-npm`);
   `npx --ignore-existing` is an alternative to a fresh cache dir.

7. **Build the `.mcpb` bundles** for the Claude Desktop one-click path:

   ```bash
   npm run build:mcpb    # writes dist/medium-research-<source>.mcpb
   ```

8. **Tag the release and attach the bundles.** Create the git tag and upload every
   `dist/*.mcpb` to the corresponding GitHub release:

   ```bash
   git tag v1.2.1
   git push origin v1.2.1
   # then attach dist/*.mcpb to the v1.2.1 GitHub release (gh release create v1.2.1 dist/*.mcpb)
   ```

Do not wire any of the above into CI or a repo script — publish, tag, and upload stay
manual.
