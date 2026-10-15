import test from 'node:test';
import assert from 'node:assert';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(str) {
  return typeof str === 'string' && UUID_REGEX.test(str.trim());
}

/**
 * Pure model of the 4-tier resilient self-healing storage engine.
 */
class ResilientMultiStoreSimulator {
  constructor() {
    this.cookie = null;
    this.localStorage = null;
    this.indexedDb = null;
    this.cacheApi = null;
  }

  setAll(uuid) {
    this.cookie = uuid;
    this.localStorage = uuid;
    this.indexedDb = uuid;
    this.cacheApi = uuid;
  }

  async sync(generator) {
    const cookieVal = isValidUuid(this.cookie) ? this.cookie : null;
    const localVal = isValidUuid(this.localStorage) ? this.localStorage : null;
    const idbVal = isValidUuid(this.indexedDb) ? this.indexedDb : null;
    const cacheVal = isValidUuid(this.cacheApi) ? this.cacheApi : null;

    const surviving = cookieVal || localVal || idbVal || cacheVal || generator();

    // Self-heal any tier that was cleared or missing
    if (this.cookie !== surviving) this.cookie = surviving;
    if (this.localStorage !== surviving) this.localStorage = surviving;
    if (this.indexedDb !== surviving) this.indexedDb = surviving;
    if (this.cacheApi !== surviving) this.cacheApi = surviving;

    return surviving;
  }
}

test('Resilient Multi-Store: Self-heals when cookies are cleared', async () => {
  const sim = new ResilientMultiStoreSimulator();
  const originalUuid = '11111111-2222-3333-4444-555555555555';

  sim.setAll(originalUuid);

  // User clears cookies
  sim.cookie = null;
  assert.strictEqual(sim.cookie, null);

  // Sync is triggered
  const resolved = await sim.sync(() => '99999999-9999-9999-9999-999999999999');

  // Should have preserved originalUuid and self-healed the cookie!
  assert.strictEqual(resolved, originalUuid);
  assert.strictEqual(sim.cookie, originalUuid);
  assert.strictEqual(sim.localStorage, originalUuid);
  assert.strictEqual(sim.indexedDb, originalUuid);
  assert.strictEqual(sim.cacheApi, originalUuid);
});

test('Resilient Multi-Store: Self-heals when both cookies and localStorage are cleared', async () => {
  const sim = new ResilientMultiStoreSimulator();
  const originalUuid = '22222222-3333-4444-5555-666666666666';

  sim.setAll(originalUuid);

  // User clears cookies AND localStorage (leaving IndexedDB and Cache intact)
  sim.cookie = null;
  sim.localStorage = null;

  // Sync is triggered
  const resolved = await sim.sync(() => '00000000-0000-0000-0000-000000000000');

  // Should have restored from IndexedDB/Cache and resurrected both cookie and localStorage
  assert.strictEqual(resolved, originalUuid);
  assert.strictEqual(sim.cookie, originalUuid);
  assert.strictEqual(sim.localStorage, originalUuid);
});

test('Resilient Multi-Store: Generates fresh UUID only on clean device and populates all 4 tiers', async () => {
  const sim = new ResilientMultiStoreSimulator();
  const freshUuid = '33333333-4444-5555-6666-777777777777';

  // Completely clean device
  const resolved = await sim.sync(() => freshUuid);

  assert.strictEqual(resolved, freshUuid);
  assert.strictEqual(sim.cookie, freshUuid);
  assert.strictEqual(sim.localStorage, freshUuid);
  assert.strictEqual(sim.indexedDb, freshUuid);
  assert.strictEqual(sim.cacheApi, freshUuid);
});
