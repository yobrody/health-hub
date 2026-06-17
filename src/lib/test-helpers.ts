// Tiny in-memory localStorage shim for Node-environment vitest runs.
// Importing this from a test file installs `globalThis.localStorage` if
// missing — no-op in jsdom/browser environments where the real API exists.

interface ShimStorage {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  removeItem: (k: string) => void
  clear: () => void
}

export function installLocalStorageShim(): ShimStorage {
  if (typeof globalThis.localStorage !== 'undefined') {
    return globalThis.localStorage as unknown as ShimStorage
  }
  const store = new Map<string, string>()
  const shim: ShimStorage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
    clear: () => { store.clear() },
  }
  ;(globalThis as { localStorage?: ShimStorage }).localStorage = shim
  return shim
}
