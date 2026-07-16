// shared/main.js — the ONE entry-point guard every server shares (PKG-02, Pitfall B).
//
// Each server.js gates its stdio `server.connect(...)` on isEntry(import.meta.url)
// so the module can be imported by tests WITHOUT starting a live transport, yet
// still auto-connects when run directly as a bin (`npx medium-research-<source>`).
//
// Why not the naive `import.meta.url === pathToFileURL(process.argv[1]).href`?
// Under a SYMLINKED install (pnpm, `npm link`, `npm install <local-path>`),
// process.argv[1] is the symlink path but import.meta.url is the realpath -> the
// naive compare is false and the server silently never connects (Pitfall B). We
// realpath process.argv[1] before comparing so the guard is TRUE for both copy
// installs (npx/registry/Windows `cmd /c npx`) and symlinked installs.

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * True when `importMetaUrl` (a server's `import.meta.url`) is the process entry.
 * Resolves process.argv[1] to its real path first so symlinked installs match
 * too. Never throws at import time: a missing argv[1] returns false, and a
 * realpath failure falls back to comparing the raw argv[1].
 */
export function isEntry(importMetaUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  let real;
  try {
    real = realpathSync(argv1);
  } catch {
    real = argv1; // e.g. argv1 already gone/virtual — compare raw
  }
  return importMetaUrl === pathToFileURL(real).href;
}
