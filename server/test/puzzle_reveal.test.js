import test from 'node:test';
import assert from 'node:assert';
import { GameManager, hostRoom, playerRoom, prepareQuiz } from '../gameManager.js';
import { createFakeIo } from './helpers/fakeIo.js';

test('Puzzle reveal statistics and order sorting', (t) => {
  const io = createFakeIo();
  const gm = new GameManager(io);
  t.after(() => gm.destroy());
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
    questionTimeLimit: 30,
    questionStartTime: Date.now(),
  };
  gm.games.set(pin, game);

  // Add 3 players while in LOBBY
  const r1 = gm.joinPlayer(pin, 'Alice', 'p1', '🦊');
  const r2 = gm.joinPlayer(pin, 'Bob', 'p2', '🐼');
  const r3 = gm.joinPlayer(pin, 'Charlie', 'p3', '🦁');
  assert.ok(r1.success, 'Alice joined');
  assert.ok(r2.success, 'Bob joined');
  assert.ok(r3.success, 'Charlie joined');

  // Question becomes active
  game.state = 'QUESTION_ACTIVE';

  // Alice gets 100% correct order: [opt_a, opt_b, opt_c, opt_d]
  assert.ok(gm.submitAnswer(game, 'p1', 0, { order: ['opt_a', 'opt_b', 'opt_c', 'opt_d'] }).success);

  // Bob gets partial: [opt_a, opt_c, opt_b, opt_d] (2 matches out of 4)
  assert.ok(gm.submitAnswer(game, 'p2', 0, { order: ['opt_a', 'opt_c', 'opt_b', 'opt_d'] }).success);

  // Charlie gets 0 matches / wrong: [opt_d, opt_c, opt_b, opt_a]
  assert.ok(gm.submitAnswer(game, 'p3', 0, { order: ['opt_d', 'opt_c', 'opt_b', 'opt_a'] }).success);

  gm.transitionToQuestionReveal(game);

  const [capturedPayload] = io.sent(hostRoom(pin), 'question_reveal');
  assert.ok(capturedPayload, 'Payload should be emitted');
  assert.strictEqual(capturedPayload.puzzleStats.correct, 1, 'Alice is full correct');
  assert.strictEqual(capturedPayload.puzzleStats.partial, 1, 'Bob is partial');
  assert.strictEqual(capturedPayload.puzzleStats.wrong, 1, 'Charlie is wrong');
  assert.strictEqual(capturedPayload.puzzleStats.total, 3, 'Total is 3 players');

  // Verify options are sorted in strictly correct order (order: 0, 1, 2, 3)
  const sortedOptionIds = capturedPayload.question.options.map((o) => o.id);
  assert.deepStrictEqual(sortedOptionIds, ['opt_a', 'opt_b', 'opt_c', 'opt_d']);

  // Each player gets their own feedback in their own room
  assert.strictEqual(io.sent(playerRoom(pin, 'p1'), 'player_feedback')[0].isCorrect, true);
  assert.strictEqual(io.sent(playerRoom(pin, 'p3'), 'player_feedback')[0].isCorrect, false);
});

test('Puzzle options are shuffled once per question: every player and every replay sees the same unsolved order', (t) => {
  const io = createFakeIo();
  const gm = new GameManager(io);
  t.after(() => gm.destroy());
  const pin = '223344';
  const game = {
    pin,
    gameId: 'g-puzzle-order',
    state: 'LOBBY',
    currentQuestionIndex: -1,
    quiz: prepareQuiz({
      title: 'Puzzle Order',
      questions: [
        {
          id: 'puz',
          type: 'puzzle',
          title: 'Order these',
          timeLimit: 30,
          options: ['a', 'b', 'c', 'd'].map((x, i) => ({ id: `p_${x}`, text: x.toUpperCase(), isCorrect: true, order: i })),
        },
      ],
    }),
    players: new Map(),
    answers: new Map(),
    settings: { randomizeAnswers: false, randomizeQuestions: false, lockGame: false },
  };
  gm.games.set(pin, game);
  const sockets = ['p1', 'p2'].map((uuid) => {
    const joined = gm.joinPlayer(pin, uuid, uuid, '🦊');
    const socket = io.createSocket(`s-${uuid}`);
    gm.attachPlayer(socket, joined.game, uuid, joined.isReconnect);
    return socket;
  });
  gm.startGame(game);
  gm.handleHostNext(game, 'GET_READY', 0);
  assert.strictEqual(game.state, 'QUESTION_ACTIVE');

  const ids = (payload) => payload.question.options.map((o) => o.id);
  const solved = ['p_a', 'p_b', 'p_c', 'p_d'];

  // The host shows the stored order; players get one shuffled, unsolved order
  const [hostPayload] = io.sent(hostRoom(pin), 'question_active');
  assert.deepStrictEqual(ids(hostPayload), solved);
  const playerOrder = game.playerQuestionOptions.map((o) => o.id);
  assert.notDeepStrictEqual(playerOrder, solved);
  for (const socket of sockets) {
    const [payload] = socket.events('question_active');
    assert.deepStrictEqual(ids(payload), playerOrder);
    // Players never see the solution or absolute timestamps
    for (const option of payload.question.options) {
      assert.strictEqual('order' in option, false);
      assert.strictEqual('isCorrect' in option, false);
    }
    assert.strictEqual(typeof payload.remainingTimeMs, 'number');
    assert.ok(payload.remainingTimeMs <= 30000 && payload.remainingTimeMs > 0);
    for (const key of ['questionStartTime', 'endsAt', 'remainingSeconds']) {
      assert.strictEqual(key in payload, false, `${key} must not be sent`);
    }
  }

  // A reconnect replays the same order
  const [[event, replay]] = gm.getPlayerResumeEvents(game, 'p1');
  assert.strictEqual(event, 'question_active');
  assert.deepStrictEqual(ids(replay), playerOrder);
  assert.strictEqual(replay.alreadyAnswered, false);
});

test('Custom avatar update', (t) => {
  const io = createFakeIo();
  const gm = new GameManager(io);
  t.after(() => gm.destroy());
  const pin = '445566';

  const game = {
    pin,
    gameId: 'g2',
    state: 'LOBBY',
    players: new Map(),
    settings: {},
    quiz: { questions: [] },
  };
  gm.games.set(pin, game);

  // Player joins with chosen avatar
  const joinRes = gm.joinPlayer(pin, 'Dino', 'p_dino', '🦖');
  assert.strictEqual(joinRes.player.avatar, '🦖');

  // Player customizes avatar in lobby
  const updated = gm.updatePlayerAvatar(game, 'p_dino', '🚀');
  assert.strictEqual(updated, true);
  assert.strictEqual(game.players.get('p_dino').avatar, '🚀');

  // Host was notified of the new avatar, and the player's own tabs were told
  const hostView = io.sent(hostRoom(pin), 'players_updated').at(-1);
  assert.ok(hostView, 'Host was notified of new avatar');
  assert.strictEqual(hostView.players.find((p) => p.userUuid === 'p_dino').avatar, '🚀');
  assert.deepStrictEqual(io.sent(playerRoom(pin, 'p_dino'), 'player_avatar_updated'), [{ avatar: '🚀' }]);

  // Invalid avatars are refused
  assert.strictEqual(gm.updatePlayerAvatar(game, 'p_dino', ''), false);
  assert.strictEqual(game.players.get('p_dino').avatar, '🚀');
});
