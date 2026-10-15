import test from 'node:test';
import assert from 'node:assert';
import { GameManager } from '../gameManager.js';

test('Puzzle reveal statistics and order sorting', (t) => {
  const mockIo = {
    to: () => ({ emit: () => {} }),
    emit: () => {},
  };
  const gm = new GameManager(mockIo);
  const pin = '112233';

  // Mock game
  const puzzleQuestion = {
    id: 'puz_q',
    type: 'puzzle',
    title: 'Rank these events',
    timeLimit: 30,
    points: 1000,
    options: [
      { id: 'opt_c', text: '1969 Moon Landing', order: 2 },
      { id: 'opt_a', text: '1440 Printing Press', order: 0 },
      { id: 'opt_d', text: '1991 WWW', order: 3 },
      { id: 'opt_b', text: '1776 Independence', order: 1 },
    ],
  };

  const game = {
    pin,
    gameId: 'g1',
    state: 'LOBBY',
    currentQuestionIndex: 0,
    quiz: { questions: [puzzleQuestion] },
    players: new Map(),
    answers: new Map([[0, new Map()]]),
    settings: {},
    hostSocketId: 'host_sock',
    questionTimeLimit: 30,
    questionStartTime: Date.now(),
  };
  gm.games.set(pin, game);

  // Add 3 players while in LOBBY
  const r1 = gm.joinPlayer(pin, 'Alice', 'p1', 's1', '🦊');
  const r2 = gm.joinPlayer(pin, 'Bob', 'p2', 's2', '🐼');
  const r3 = gm.joinPlayer(pin, 'Charlie', 'p3', 's3', '🦁');
  assert.ok(r1.success, 'Alice joined');
  assert.ok(r2.success, 'Bob joined');
  assert.ok(r3.success, 'Charlie joined');

  // Question becomes active
  game.state = 'QUESTION_ACTIVE';

  // Alice gets 100% correct order: [opt_a, opt_b, opt_c, opt_d]
  gm.submitAnswer(pin, 'p1', { order: ['opt_a', 'opt_b', 'opt_c', 'opt_d'] });

  // Bob gets partial: [opt_a, opt_c, opt_b, opt_d] (2 matches out of 4)
  gm.submitAnswer(pin, 'p2', { order: ['opt_a', 'opt_c', 'opt_b', 'opt_d'] });

  // Charlie gets 0 matches / wrong: [opt_d, opt_c, opt_b, opt_a]
  gm.submitAnswer(pin, 'p3', { order: ['opt_d', 'opt_c', 'opt_b', 'opt_a'] });

  // Capture reveal payload
  let capturedPayload = null;
  mockIo.to = (id) => ({
    emit: (event, payload) => {
      if (event === 'question_reveal') {
        capturedPayload = payload;
      }
    },
  });

  gm.transitionToQuestionReveal(game);

  assert.ok(capturedPayload, 'Payload should be emitted');
  assert.strictEqual(capturedPayload.puzzleStats.correct, 1, 'Alice is full correct');
  assert.strictEqual(capturedPayload.puzzleStats.partial, 1, 'Bob is partial');
  assert.strictEqual(capturedPayload.puzzleStats.wrong, 1, 'Charlie is wrong');
  assert.strictEqual(capturedPayload.puzzleStats.total, 3, 'Total is 3 players');

  // Verify options are sorted in strictly correct order (order: 0, 1, 2, 3)
  const sortedOptionIds = capturedPayload.question.options.map((o) => o.id);
  assert.deepStrictEqual(sortedOptionIds, ['opt_a', 'opt_b', 'opt_c', 'opt_d']);
});

test('Custom avatar update', (t) => {
  const mockIo = {
    to: () => ({ emit: () => {} }),
    emit: () => {},
  };
  const gm = new GameManager(mockIo);
  const pin = '445566';

  const game = {
    pin,
    gameId: 'g2',
    state: 'LOBBY',
    players: new Map(),
    settings: {},
    hostSocketId: 'host_sock',
    quiz: { questions: [] },
  };
  gm.games.set(pin, game);

  // Player joins with chosen avatar
  const joinRes = gm.joinPlayer(pin, 'Dino', 'p_dino', 's_dino', '🦖');
  assert.strictEqual(joinRes.player.avatar, '🦖');

  // Player customizes avatar in lobby
  let hostNotified = false;
  mockIo.to = () => ({
    emit: (event, payload) => {
      if (event === 'players_updated') {
        hostNotified = true;
        const player = payload.players.find((p) => p.userUuid === 'p_dino');
        assert.strictEqual(player.avatar, '🚀');
      }
    },
  });

  const updated = gm.updatePlayerAvatar(pin, 'p_dino', '🚀');
  assert.strictEqual(updated, true);
  assert.strictEqual(game.players.get('p_dino').avatar, '🚀');
  assert.strictEqual(hostNotified, true, 'Host was notified of new avatar');
});
