export function createTtlCache<K, V>(ttlMs: number) {
  const store = new Map<K, { expiresAt: number; value: V }>();

  function sweepExpired() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
  }

  return {
    get(key: K): undefined | V {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: K, value: V) {
      // Bound growth: sweep expired entries before adding a new one, rather than only
      // ever removing entries lazily on read — otherwise stale entries for repos/branches
      // no longer being browsed sit in memory indefinitely.
      sweepExpired();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
  };
}
