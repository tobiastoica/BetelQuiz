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
    } catch (err) {
      console.error('Error calling device UUID change callback:', err);
    }
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
  } catch (err) {
    console.warn('Failed to read device UUID from cookie:', err);
  }
  return null;
}

function writeCookie(uuid: string): void {
  if (typeof document === 'undefined' || !isValidUuid(uuid)) return;
  try {
    // 10 years expiration
    const maxAge = 10 * 365 * 24 * 60 * 60;
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(uuid)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch (err) {
    console.warn('Failed to write device UUID to cookie:', err);
  }
}

// ---------------------------------------------------------------------------
// Store 2: LocalStorage (Synchronous)
// ---------------------------------------------------------------------------
function readLocalStorage(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const val = (localStorage.getItem(STORAGE_KEY) || '').trim();
    return isValidUuid(val) ? val : null;
  } catch (err) {
    console.warn('Failed to read device UUID from localStorage:', err);
    return null;
  }
}

function writeLocalStorage(uuid: string): void {
  if (typeof localStorage === 'undefined' || !isValidUuid(uuid)) return;
  try {
    localStorage.setItem(STORAGE_KEY, uuid);
  } catch (err) {
    console.warn('Failed to write device UUID to localStorage:', err);
  }
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
        } catch (err) {
          console.warn('Failed to create IndexedDB object store:', err);
        }
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

          getReq.onerror = (e) => {
            console.warn('IndexedDB read request error:', e);
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(null);
            }
          };
        } catch (err) {
          console.warn('IndexedDB transaction error:', err);
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        }
      };

      request.onerror = (e) => {
        console.warn('IndexedDB open error:', e);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      };
    } catch (err) {
      console.warn('IndexedDB access error:', err);
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
        } catch (err) {
          console.warn('Failed to upgrade IndexedDB on write:', err);
        }
      };

      request.onsuccess = () => {
        try {
          const db = request.result;
          const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
          const store = tx.objectStore(IDB_STORE_NAME);
          store.put(uuid, IDB_KEY);

          tx.oncomplete = () => resolve(true);
          tx.onerror = (e) => {
            console.warn('IndexedDB write transaction error:', e);
            resolve(false);
          };
        } catch (err) {
          console.warn('IndexedDB write execution error:', err);
          resolve(false);
        }
      };

      request.onerror = (e) => {
        console.warn('IndexedDB write open error:', e);
        resolve(false);
      };
    } catch (err) {
      console.warn('IndexedDB write error:', err);
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
  } catch (err) {
    console.warn('Failed to read device UUID from Cache API:', err);
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
  } catch (err) {
    console.warn('Failed to write device UUID to Cache API:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resilient Multi-Store Synchronization & Self-Healing
// ---------------------------------------------------------------------------

/**
 * Runs a full 4-tier check (Cookie, LocalStorage, IndexedDB, Cache API).
 * Detects any surviving authoritative UUID, and if any stores were cleared, self-heals them.
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

      // Determine authoritative surviving UUID across all 4 tiers
      let surviving: string | null = null;
      if (idbVal && isValidUuid(idbVal)) {
        surviving = idbVal;
      } else if (cacheVal && isValidUuid(cacheVal)) {
        surviving = cacheVal;
      } else if (cookieVal && isValidUuid(cookieVal)) {
        surviving = cookieVal;
      } else if (localVal && isValidUuid(localVal)) {
        surviving = localVal;
      }

      const authoritativeUuid = surviving || uuidv4();
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
        navigator.storage.persist().catch((err) => console.warn('Persistent storage request failed:', err));
      }

      // If the authoritative UUID was restored and differs from any early cached state
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
 * Authoritatively resolves the device UUID before the UI is unlocked.
 * Awaits multi-store sync without provisional guesses.
 */
export async function initDeviceUuid(): Promise<string> {
  if (cachedDeviceUuid && isValidUuid(cachedDeviceUuid)) {
    return cachedDeviceUuid;
  }
  return await syncResilientDeviceUuid();
}

/**
 * Retrieves the device/user UUID immediately and synchronously.
 * Reads existing sync stores, or falls back to an immediate authoritative UUID
 * persisted across stores.
 */
export function getDeviceUuid(): string {
  if (cachedDeviceUuid && isValidUuid(cachedDeviceUuid)) {
    return cachedDeviceUuid;
  }

  const cookieVal = readCookie();
  if (cookieVal) {
    cachedDeviceUuid = cookieVal;
    syncResilientDeviceUuid().catch((err) => console.warn('Background sync error:', err));
    return cookieVal;
  }

  const localVal = readLocalStorage();
  if (localVal) {
    cachedDeviceUuid = localVal;
    writeCookie(localVal);
    syncResilientDeviceUuid().catch((err) => console.warn('Background sync error:', err));
    return localVal;
  }

  const fresh = uuidv4();
  cachedDeviceUuid = fresh;
  writeCookie(fresh);
  writeLocalStorage(fresh);
  writeIndexedDB(fresh).catch((err) => console.warn('IDB write error on fresh UUID:', err));
  writeCache(fresh).catch((err) => console.warn('Cache write error on fresh UUID:', err));
  return fresh;
}

/**
 * Manually updates the device UUID across all 4 multi-store tiers.
 */
export function saveDeviceUuid(uuid: string): void {
  if (!uuid || !isValidUuid(uuid)) return;
  cachedDeviceUuid = uuid;
  writeLocalStorage(uuid);
  writeCookie(uuid);
  writeIndexedDB(uuid).catch((err) => console.warn('IDB write error on saveDeviceUuid:', err));
  writeCache(uuid).catch((err) => console.warn('Cache write error on saveDeviceUuid:', err));
  notifyListeners(uuid);
}

// Automatically initiate multi-store synchronization on script load in browser environments
if (typeof window !== 'undefined') {
  syncResilientDeviceUuid().catch((err) => console.warn('Initial syncResilientDeviceUuid error:', err));

  // Cross-tab synchronization via storage event
  try {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && e.newValue && isValidUuid(e.newValue) && e.newValue !== cachedDeviceUuid) {
        cachedDeviceUuid = e.newValue;
        writeCookie(e.newValue);
        notifyListeners(e.newValue);
      }
    });
  } catch (err) {
    console.warn('Storage event listener registration failed:', err);
  }
}
