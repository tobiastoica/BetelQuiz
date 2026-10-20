import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPlayers } from '../ranking.js';
import { extractWordInputs, normalizeSelected } from '../scoring.js';

test('Phase 1 Requirement 6: extractWordInputs normalizes diacritics, lowercase, and whitespace', () => {
  // Single string with diacritics and excess whitespace
  const res1 = extractWordInputs('  Cöol  Dîacritics  ');
  assert.deepEqual(res1, ['cool diacritics']);

  // Array of strings
  const res2 = extractWordInputs(['  TÉST  ', '  WhîteSpâce  ']);
  assert.deepEqual(res2, ['test', 'whitespace']);

  // Payload object with answers / words / text
  const res3 = extractWordInputs({ words: ['  Álêxàndér  ', 'THÉ   GRÉAT'] });
  assert.deepEqual(res3, ['alexander', 'the great']);

  const res4 = extractWordInputs({ text: '  ÉlépHant  ' });
  assert.deepEqual(res4, ['elephant']);

  // Empty or invalid inputs
  assert.deepEqual(extractWordInputs(null), []);
  assert.deepEqual(extractWordInputs(undefined), []);
  assert.deepEqual(extractWordInputs('   '), []);
});

test('Phase 1 Requirement 7: normalizeSelected standardizes option IDs across payload shapes', () => {
  // Array payload
  assert.deepEqual(normalizeSelected({ selected: ['opt_1', 'opt_2'] }), ['opt_1', 'opt_2']);

  // Single string property
  assert.deepEqual(normalizeSelected({ selected: 'opt_1' }), ['opt_1']);

  // Raw string / number
  assert.deepEqual(normalizeSelected('opt_1'), ['opt_1']);
  assert.deepEqual(normalizeSelected(123), ['123']);

  // Deduplication
  assert.deepEqual(normalizeSelected({ selected: ['opt_1', 'opt_1', 'opt_2'] }), ['opt_1', 'opt_2']);

  // Empty / null inputs
  assert.deepEqual(normalizeSelected(null), []);
  assert.deepEqual(normalizeSelected({ selected: [] }), []);
  assert.deepEqual(normalizeSelected({ selected: null }), []);
});

test('Phase 1 Requirement 8: rankPlayers strictly enforces Map container', () => {
  const map = new Map();
  map.set('u1', { userUuid: 'u1', nickname: 'Alpha', score: 1200, streak: 3, connected: true });
  map.set('u2', { userUuid: 'u2', nickname: 'Beta', score: 2400, streak: 5, connected: true });

  const ranked = rankPlayers(map);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].nickname, 'Beta');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].nickname, 'Alpha');
  assert.equal(ranked[1].rank, 2);

  // Non-Map containers strictly return empty array
  assert.deepEqual(rankPlayers([{ nickname: 'Alice', score: 500 }]), []);
  assert.deepEqual(rankPlayers({ u1: { nickname: 'Alice', score: 500 } }), []);
  assert.deepEqual(rankPlayers(null), []);
  assert.deepEqual(rankPlayers(undefined), []);
  assert.deepEqual(rankPlayers('invalid'), []);
});
