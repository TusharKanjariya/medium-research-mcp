// Tests for shared/cache.js — TTL cache with stale retention (FOUND-01).
// Node built-in runner only (D-06): node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { getFresh, getStale, set } from "../shared/cache.js";

test("getFresh returns the value while inside TTL", () => {
  set("cache:fresh", { a: 1 }, 60_000);
  assert.deepEqual(getFresh("cache:fresh"), { a: 1 });
});

test("getFresh returns undefined once the entry has expired", () => {
  set("cache:expired", { a: 2 }, -1000); // expires in the past
  assert.equal(getFresh("cache:expired"), undefined);
});

test("getStale returns the value even after expiry (never deleted)", () => {
  set("cache:stale", { a: 3 }, -1000); // already expired
  assert.equal(getFresh("cache:stale"), undefined, "must be stale to fresh reads");
  assert.deepEqual(getStale("cache:stale"), { a: 3 }, "stale read still returns it");
});

test("getStale returns undefined for a key that was never set", () => {
  assert.equal(getStale("cache:missing"), undefined);
});

test("set overwrites an existing entry and refreshes its expiry", () => {
  set("cache:overwrite", { v: "old" }, -1000); // expired
  assert.equal(getFresh("cache:overwrite"), undefined);
  set("cache:overwrite", { v: "new" }, 60_000); // successful refresh
  assert.deepEqual(getFresh("cache:overwrite"), { v: "new" });
});

test("an expired entry is retained (stale) and never auto-deleted on a fresh miss", () => {
  set("cache:retain", { keep: true }, -1000);
  // Multiple fresh misses must NOT delete the stale entry.
  assert.equal(getFresh("cache:retain"), undefined);
  assert.equal(getFresh("cache:retain"), undefined);
  assert.deepEqual(getStale("cache:retain"), { keep: true });
});
