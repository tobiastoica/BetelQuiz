import { v4 as uuidv4 } from 'uuid';

const COOKIE_NAME = 'betelquiz_user_uuid';
const STORAGE_KEY = 'betelquiz_user_uuid';
const IDB_DB_NAME = 'betelquiz_idb';
const IDB_STORE_NAME = 'identity';
const IDB_KEY = 'device_uuid';
const CACHE_NAME = 'betelquiz-identity-v1';
const CACHE_ENTRY_URL = '/__betelquiz_device_identity__';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(str: unknown): str is string {
  return typeof str === 'string' && UUID_REGEX.test(str.trim());
}

let cachedDeviceUuid: string = '';
const listeners = new Set<(uuid: string) => void>();
let inFlightSync: Promise<string> | null = null;

function notifyListeners(uuid: string): void {
  for (const listener of listeners) {
    try {
      listener(uuid);
    } catch (err) {
      console.error('Error in device UUID listener:', err);
    }
  }
}

/**
 * Register a listener that fires whenever an authoritative device UUID is resolved or healed.
 */
export function onDeviceUuidChange(callback: (uuid: string) => void): () => void {
  listeners.add(callback);
  if (cachedDeviceUuid && isValidUuid(cachedDeviceUuid)) {
    try {
      callback(cachedDeviceUuid);
    } catch {}
  }
  return () => {
    listeners.delete(callback);
  };
}

// ---------------------------------------------------------------------------
// Store 1: Cookie (Synchronous)
// ---------------------------------------------------------------------------
function readCookie(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.match(new RegExp(`(^|;\\s*)(${COOKIE_NAME})=([^;]*)`));
    if (match && match[3]) {
      const decoded = decodeURIComponent(match[3]).trim();
      return isValidUuid(decoded) ? decoded : null;
    }
  } catch {}
  return null;
}

function writeCookie(uuid: string): void {
  if (typeof document === 'undefined' || !isValidUuid(uuid)) return;
  try {
    // 10 years expiration
    const maxAge = 10 * 365 * 24 * 60 * 60;
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(uuid)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch {}
}

// ---------------------------------------------------------------------------
// Store 2: LocalStorage (Synchronous)
// ---------------------------------------------------------------------------
function readLocalStorage(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const val = (localStorage.getItem(STORAGE_KEY) || '').trim();
    return isValidUuid(val) ? val : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(uuid: string): void {
  if (typeof localStorage === 'undefined' || !isValidUuid(uuid)) return;
  try {
    localStorage.setItem(STORAGE_KEY, uuid);
  } catch {}
}

// ---------------------------------------------------------------------------
// Store 3: IndexedDB (Asynchronous, survives cookie clearing)
// ---------------------------------------------------------------------------
function readIndexedDB(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      return resolve(null);
    }

    let settled = false;
    // Safety timeout: Never allow IndexedDB to hang indefinitely if blocked
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 600);

    try {
      const request = indexedDB.open(IDB_DB_NAME, 1);

      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
            db.createObjectStore(IDB_STORE_NAME);
          }
        } catch {}
      };

      request.onsuccess = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(null);
            }
            return;
          }
          const tx = db.transaction(IDB_STORE_NAME, 'readonly');
          const store = tx.objectStore(IDB_STORE_NAME);
          const getReq = store.get(IDB_KEY);

          getReq.onsuccess = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              const val = getReq.result;
              resolve(typeof val === 'string' && isValidUuid(val) ? val.trim() : null);
            }
          };

          getReq.onerror = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(null);
            }
          };
        } catch {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        }
      };

      request.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      };
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

function writeIndexedDB(uuid: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined' || !isValidUuid(uuid)) {
      return resolve(false);
    }

    try {
      const request = indexedDB.open(IDB_DB_NAME, 1);

      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
            db.createObjectStore(IDB_STORE_NAME);
          }
        } catch {}
      };

      request.onsuccess = () => {
        try {
          const db = request.result;
          const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
          const store = tx.objectStore(IDB_STORE_NAME);
          store.put(uuid, IDB_KEY);

          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      };

      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Store 4: Cache API (Asynchronous, survives cookie and localStorage clearing)
// ---------------------------------------------------------------------------
async function readCache(): Promise<string | null> {
  if (typeof window === 'undefined' || !('caches' in window) || typeof caches.open !== 'function') {
    return null;
  }
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(CACHE_ENTRY_URL);
    if (!response) return null;
    const text = (await response.text()).trim();
    return isValidUuid(text) ? text : null;
  } catch {
    return null;
  }
}

async function writeCache(uuid: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('caches' in window) || typeof caches.open !== 'function' || !isValidUuid(uuid)) {
    return false;
  }
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      new Request(CACHE_ENTRY_URL),
      new Response(uuid, {
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'max-age=315360000' },
      })
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resilient Multi-Store Synchronization & Self-Healing
// ---------------------------------------------------------------------------

let provisionalUuid: string | null = null;

/**
 * Runs a full 4-tier check (Cookie, LocalStorage, IndexedDB, Cache API).
 * Detects any surviving UUID, and if any stores were cleared, self-heals them.
 * If no store had a UUID, securely creates one and propagates it to all 4 stores.
 */
export async function syncResilientDeviceUuid(): Promise<string> {
  if (inFlightSync) {
    return inFlightSync;
  }

  inFlightSync = (async () => {
    try {
      const cookieVal = readCookie();
      const localVal = readLocalStorage();

      // Read asynchronous stores in parallel
      const [idbVal, cacheVal] = await Promise.all([readIndexedDB(), readCache()]);

      // Determine the authoritative surviving UUID
      // Check IDB & Cache first, or non-provisional cookie / localStorage
      let surviving: string | null = null;
      if (idbVal && isValidUuid(idbVal)) {
        surviving = idbVal;
      } else if (cacheVal && isValidUuid(cacheVal)) {
        surviving = cacheVal;
      } else if (cookieVal && isValidUuid(cookieVal) && cookieVal !== provisionalUuid) {
        surviving = cookieVal;
      } else if (localVal && isValidUuid(localVal) && localVal !== provisionalUuid) {
        surviving = localVal;
      } else if (cookieVal && isValidUuid(cookieVal)) {
        surviving = cookieVal;
      } else if (localVal && isValidUuid(localVal)) {
        surviving = localVal;
      }

      const authoritativeUuid = surviving || provisionalUuid || uuidv4();
      provisionalUuid = null;
      const oldCached = cachedDeviceUuid;
      cachedDeviceUuid = authoritativeUuid;

      // Self-heal: propagate the authoritative UUID to any stores that missed it
      if (cookieVal !== authoritativeUuid) {
        writeCookie(authoritativeUuid);
      }
      if (localVal !== authoritativeUuid) {
        writeLocalStorage(authoritativeUuid);
      }
      if (idbVal !== authoritativeUuid) {
        await writeIndexedDB(authoritativeUuid);
      }
      if (cacheVal !== authoritativeUuid) {
        await writeCache(authoritativeUuid);
      }

      // Request persistent storage from browser to prevent eviction under disk pressure
      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
        navigator.storage.persist().catch(() => {});
      }

      // If the authoritative UUID was restored from IndexedDB/Cache and differs from an early temporary guess
      if (oldCached && oldCached !== authoritativeUuid) {
        notifyListeners(authoritativeUuid);
      }

      return authoritativeUuid;
    } finally {
      inFlightSync = null;
    }
  })();

  return inFlightSync;
}

/**
 * Retrieves the device/user UUID immediately and synchronously.
 * If already known or in synchronous stores (Cookie/LocalStorage), returns it.
 * If synchronous stores were cleared, uses a temporary fallback while immediately
 * triggering asynchronous self-healing from IndexedDB/Cache API.
 */
export function getDeviceUuid(): string {
  if (cachedDeviceUuid && isValidUuid(cachedDeviceUuid)) {
    return cachedDeviceUuid;
  }

  // 1. Check synchronous stores
  const cookieVal = readCookie();
  if (cookieVal) {
    cachedDeviceUuid = cookieVal;
    // Kick off async self-healing in background to ensure IDB & Cache are in sync
    syncResilientDeviceUuid().catch(() => {});
    return cookieVal;
  }

  const localVal = readLocalStorage();
  if (localVal) {
    cachedDeviceUuid = localVal;
    // Heal cookie immediately & kick off async self-healing
    writeCookie(localVal);
    syncResilientDeviceUuid().catch(() => {});
    return localVal;
  }

  // 2. Neither synchronous store has it (e.g. cookies & localStorage were wiped, or brand new visitor)
  // Generate a provisional UUID so caller has an immediate string without preempting async stores
  const provisional = uuidv4();
  provisionalUuid = provisional;
  cachedDeviceUuid = provisional;

  // 3. Immediately trigger async deep query. If IndexedDB or Cache API has a surviving UUID,
  // it will overwrite `provisional`, self-heal cookie + localStorage, and notify listeners!
  syncResilientDeviceUuid().catch(() => {});

  return provisional;
}

/**
 * Manually updates the device UUID across all 4 multi-store tiers.
 */
export function saveDeviceUuid(uuid: string): void {
  if (!uuid || !isValidUuid(uuid)) return;
  cachedDeviceUuid = uuid;
  writeLocalStorage(uuid);
  writeCookie(uuid);
  writeIndexedDB(uuid).catch(() => {});
  writeCache(uuid).catch(() => {});
  notifyListeners(uuid);
}

// Automatically initiate multi-store synchronization on script load in browser environments
if (typeof window !== 'undefined') {
  syncResilientDeviceUuid().catch(() => {});

  // Cross-tab synchronization via storage event
  try {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && e.newValue && isValidUuid(e.newValue) && e.newValue !== cachedDeviceUuid) {
        cachedDeviceUuid = e.newValue;
        writeCookie(e.newValue);
        notifyListeners(e.newValue);
      }
    });
  } catch {}
}
