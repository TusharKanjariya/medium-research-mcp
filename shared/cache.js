// shared/cache.js — in-memory TTL cache with STALE RETENTION (FOUND-01).
//
// Backs shared/http_client.js getJson(). Entries are keyed by a logical cache
// key (never a secret — Pitfall 7) and hold { value, expires }.
//
// Stale-retention contract (ARCHITECTURE §8):
//   - getFresh(key) returns the value ONLY while it is inside its TTL.
//   - getStale(key) returns the value even after expiry.
//   - Entries are NEVER deleted on expiry; they are overwritten only by a
//     successful refresh via set(). This is what makes the getJson() stale
//     fallback possible when an upstream is fully unavailable.
//
// Memory is unbounded and resets on process restart (accepted per §8).

const store = new Map(); // key -> { value, expires }

/** Return the cached value only while it is still within its TTL. */
export function getFresh(key) {
  const entry = store.get(key);
  return entry && entry.expires > Date.now() ? entry.value : undefined;
}

/** Return the cached value even if it has expired (stale fallback). */
export function getStale(key) {
  const entry = store.get(key);
  return entry ? entry.value : undefined;
}

/**
 * Store a value under key with a TTL of ttlMs. Overwrites any existing entry.
 * Never schedules deletion — expiry is evaluated lazily by getFresh().
 */
export function set(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}
