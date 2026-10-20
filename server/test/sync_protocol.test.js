// Socket sync protocol, end to end against the REAL handlers (socketHandlers.js + GameManager)
// over a real Socket.IO server. Identity comes from the handshake `auth`, as in the client.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import crypto from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

import authRoutes from '../routes/auth.js';
import quizzesRoutes from '../routes/quizzes.js';
import uploadsRoutes from '../routes/uploads.js';
import { ADMIN_CREDENTIALS } from '../config.js';
import { GameManager, RECONNECT_GRACE_MS } from '../gameManager.js';
import { registerSocketHandlers } from '../socketHandlers.js';
import { initStorage, saveQuiz, deleteQuiz } from '../storage.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();

const QUIZ_ID = `sync_protocol_${process.pid}`;
const QUIZ = {
  id: QUIZ_ID,
  title: 'Sync Protocol Quiz',
  questions: [
    {
      id: 'q1', type: 'puzzle', title: 'Order', timeLimit: 20, points: 1000,
      options: ['a', 'b', 'c', 'd'].map((x, i) => ({ id: `p${x}`, text: x.toUpperCase(), isCorrect: true, order: i })),
    },
    {
      id: 'q2', type: 'quiz', title: 'Pick', timeLimit: 20, points: 1000,
      options: [
        { id: 'o1', text: 'One', isCorrect: true },
        { id: 'o2', text: 'Two', isCorrect: false },
        { id: 'o3', text: 'Three', isCorrect: false },
        { id: 'o4', text: 'Four', isCorrect: false },
      ],
    },
  ],
};
const SOLVED = { order: ['pa', 'pb', 'pc', 'pd'] };

let httpServer;
let io;
let gm;
let baseUrl;
const clients = new Set();

before(async () => {
  initStorage();
  saveQuiz(structuredClone(QUIZ));

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/quizzes', quizzesRoutes);
  app.use('/api/uploads', uploadsRoutes);

  httpServer = http.createServer(app);
  io = new Server(httpServer);
  gm = new GameManager(io);
  registerSocketHandlers(io, gm);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  gm.destroy(); // first: later disconnects then find no game and schedule no timers
  for (const c of clients) c.disconnect();
  await new Promise((resolve) => io.close(() => resolve()));
  if (httpServer.listening) await new Promise((resolve) => httpServer.close(() => resolve()));
  deleteQuiz(QUIZ_ID);
});

// A client with a per-socket event log, so events that arrive back-to-back are never missed
function client(name, auth) {
  const s = ioClient(baseUrl, {
    forceNew: true,
    transports: ['websocket'],
    auth,
    reconnectionDelay: 50,
    reconnectionDelayMax: 100,
  });
  s.name = name;
  s.log = [];
  s.cursor = {};
  s.onAny((ev, data) => s.log.push({ ev, data }));
  s.count = (ev) => s.log.filter((e) => e.ev === ev).length;
  s.all = (ev) => s.log.filter((e) => e.ev === ev).map((e) => e.data);
  clients.add(s);
  return s;
}

// Next not-yet-consumed matching event, including one that already arrived
function waitFor(s, ev, { ms = 4000, where = () => true } = {}) {
  return new Promise((resolve, reject) => {
    const take = () => {
      const list = s.log.filter((e) => e.ev === ev);
      for (let i = s.cursor[ev] ?? 0; i < list.length; i++) {
        if (where(list[i].data)) {
          s.cursor[ev] = i + 1;
          return list[i];
        }
      }
      return null;
    };
    const hit = take();
    if (hit) return resolve(hit.data);
    const onEvent = () => {
      const found = take();
      if (found) {
        clearTimeout(timer);
        s.off(ev, onEvent);
        resolve(found.data);
      }
    };
    const timer = setTimeout(() => {
      s.off(ev, onEvent);
      reject(new Error(`${s.name}: timed out waiting for ${ev}`));
    }, ms);
    s.on(ev, onEvent);
  });
}

// Resolves true if `ev` arrives within ms, false otherwise
const arrives = (s, ev, ms) => waitFor(s, ev, { ms }).then(() => true, () => false);
const ack = (s, ev, data, ms = 3000) => s.timeout(ms).emitWithAck(ev, data);
// Network drop: the client reconnects by itself with the same auth
const dropNetwork = (s) => s.io.engine.close();
const close = (s) => {
  s.disconnect();
  clients.delete(s);
};

async function newGame() {
  const game = gm.createGame(QUIZ_ID);
  const host = client('host', { role: 'host', pin: game.pin, hostSecret: game.hostSecret });
  await waitFor(host, 'host_game_data');
  return { game, pin: game.pin, host };
}

async function joinPlayer(pin, nickname, userUuid = uuid()) {
  const p = client(nickname, { role: 'player', userUuid });
  await waitFor(p, 'not_joined');
  p.uuid = userUuid;
  p.emit('player_join', { pin, nickname, avatar: '🦊' });
  await waitFor(p, 'join_success');
  p.auth.pin = pin; // what the client does after join_success, so reconnects resume this game
  return p;
}

// Start the game and skip the 6 s Get Ready countdown
async function startQuestion(host, pin) {
  host.emit('host_start_game');
  await waitFor(host, 'game_state_changed', { where: (d) => d.state === 'GET_READY' });
  host.emit('host_next', { fromState: 'GET_READY', questionIndex: 0 });
  return waitFor(host, 'question_active');
}

async function hostStep(host, fromState, questionIndex, expectEvent) {
  const landed = waitFor(host, expectEvent);
  host.emit('host_next', { fromState, questionIndex });
  return landed;
}

const optionIds = (payload) => payload.question.options.map((o) => o.id);

test('full game lifecycle: join, answer, reveal, scoreboard, final question goes straight to PODIUM', async () => {
  const { game, pin, host } = await newGame();
  const alice = await joinPlayer(pin, 'Alice');
  const bob = await joinPlayer(pin, 'Bob');
  await waitFor(host, 'players_updated', { where: (d) => d.count === 2 });

  const hostQ1 = await startQuestion(host, pin);
  assert.equal(hostQ1.questionIndex, 0);
  assert.equal(hostQ1.totalPlayers, 2);
  const [aQ1, bQ1] = await Promise.all([waitFor(alice, 'question_active'), waitFor(bob, 'question_active')]);
  assert.equal(aQ1.alreadyAnswered, false);
  assert.deepEqual(optionIds(aQ1), optionIds(bQ1)); // one shuffle per question for everyone

  assert.deepEqual(await ack(alice, 'player_submit_answer', { questionIndex: 0, answer: SOLVED }), { success: true });
  const count = await waitFor(host, 'answer_count_updated');
  assert.deepEqual(count, { answersReceived: 1, totalPlayers: 2 });
  assert.equal((await ack(bob, 'player_submit_answer', { questionIndex: 0, answer: { order: ['pd', 'pc', 'pb', 'pa'] } })).success, true);

  // Everyone answered: automatic reveal
  const reveal = await waitFor(host, 'question_reveal');
  assert.equal(reveal.totalAnswers, 2);
  assert.equal(reveal.puzzleStats.correct, 1);
  const [aFb, bFb] = await Promise.all([waitFor(alice, 'player_feedback'), waitFor(bob, 'player_feedback')]);
  assert.equal(aFb.isCorrect, true);
  assert.ok(aFb.pointsEarned > 0);
  assert.equal(bFb.isCorrect, false);
  assert.equal(bFb.pointsEarned, 0);

  const board = await hostStep(host, 'QUESTION_REVEAL', 0, 'scoreboard_update');
  assert.deepEqual(board.leaderboard.map((p) => p.nickname), ['Alice', 'Bob']);
  assert.equal((await waitFor(alice, 'player_standing')).rank, 1);

  const ready = await hostStep(host, 'SCOREBOARD', 0, 'game_state_changed');
  assert.equal(ready.state, 'GET_READY');
  assert.equal(ready.questionIndex, 1);
  assert.equal('settings' in ready, false);

  await hostStep(host, 'GET_READY', 1, 'question_active');
  await waitFor(alice, 'question_active', { where: (d) => d.questionIndex === 1 });
  await ack(alice, 'player_submit_answer', { questionIndex: 1, answer: { selected: ['o1'] } });
  await ack(bob, 'player_submit_answer', { questionIndex: 1, answer: { selected: ['o2'] } });
  await waitFor(host, 'question_reveal');

  // Final question: Next on the reveal goes to the podium, never the scoreboard
  const scoreboardsBefore = host.count('scoreboard_update');
  const podium = await hostStep(host, 'QUESTION_REVEAL', 1, 'podium_update');
  assert.equal(podium.state, 'PODIUM');
  assert.equal(podium.first.nickname, 'Alice');
  assert.equal(podium.totalPlayers, 2);
  assert.equal(host.count('scoreboard_update'), scoreboardsBefore);
  const [aFinal, bFinal] = await Promise.all([waitFor(alice, 'final_results'), waitFor(bob, 'final_results')]);
  assert.equal(aFinal.isWinner, true);
  assert.equal(bFinal.rank, 2);
  assert.equal(game.state, 'PODIUM');

  // Joining a finished game as a new player is refused; a member reconnecting gets their result
  const late = client('late', { role: 'player', userUuid: uuid() });
  await waitFor(late, 'not_joined');
  late.emit('player_join', { pin, nickname: 'Late' });
  assert.match((await waitFor(late, 'join_error')).error, /already ended/);
  const aliceAgain = client('alice-again', { role: 'player', userUuid: alice.uuid, pin });
  await waitFor(aliceAgain, 'join_success');
  assert.equal((await waitFor(aliceAgain, 'final_results')).isWinner, true);
});

test('randomized answers keep each option colorIndex on the question and on the reveal', async () => {
  const { pin, host } = await newGame();
  const p = await joinPlayer(pin, 'Rand');
  host.emit('host_update_settings', { settings: { randomizeAnswers: true } });
  assert.equal((await waitFor(host, 'settings_updated')).randomizeAnswers, true);
  assert.equal((await waitFor(p, 'settings_updated')).randomizeAnswers, true);

  await startQuestion(host, pin);
  await waitFor(p, 'question_active'); // Q1 is the puzzle
  await ack(p, 'player_submit_answer', { questionIndex: 0, answer: SOLVED });
  await waitFor(host, 'question_reveal');
  await hostStep(host, 'QUESTION_REVEAL', 0, 'scoreboard_update');
  await hostStep(host, 'SCOREBOARD', 0, 'game_state_changed');
  const hostQ2 = await hostStep(host, 'GET_READY', 1, 'question_active');
  const playerQ2 = await waitFor(p, 'question_active', { where: (d) => d.questionIndex === 1 });

  const colorOf = { o1: 0, o2: 1, o3: 2, o4: 3 };
  for (const o of hostQ2.question.options) assert.equal(o.colorIndex, colorOf[o.id]);
  assert.deepEqual(optionIds(playerQ2), optionIds(hostQ2));

  await ack(p, 'player_submit_answer', { questionIndex: 1, answer: { selected: ['o1'] } });
  const feedback = await waitFor(p, 'player_feedback', { where: (d) => d.questionType === 'quiz' });
  assert.deepEqual(feedback.options.map((o) => o.id), optionIds(hostQ2));
  for (const o of feedback.options) assert.equal(o.colorIndex, colorOf[o.id]);
  assert.equal(feedback.isCorrect, true);
});

test('reconnect mid-question replays the question once, with the same puzzle order and the time still running', async () => {
  const { pin, host } = await newGame();
  const a = await joinPlayer(pin, 'Ann');
  await joinPlayer(pin, 'Ben');
  await startQuestion(host, pin);
  const first = await waitFor(a, 'question_active');
  const before = a.count('question_active');

  dropNetwork(a);
  const rejoined = await waitFor(a, 'join_success');
  assert.equal(rejoined.pin, pin);
  const replay = await waitFor(a, 'question_active');
  await sleep(200);
  assert.equal(a.count('question_active'), before + 1, 'exactly one replay');
  assert.deepEqual(optionIds(replay), optionIds(first));
  assert.equal(replay.questionIndex, 0);
  assert.ok(replay.remainingTimeMs < first.remainingTimeMs && replay.remainingTimeMs > 0);
  for (const key of ['questionStartTime', 'endsAt', 'remainingSeconds']) assert.equal(key in replay, false);

  // The host sees the player back (events on another socket: wait, don't read the latest)
  await waitFor(host, 'players_updated', { where: (d) => d.players.length === 2 && d.players.every((p) => p.connected) });

  // Answering after the reconnect works (the player's screens are told), and a resend is idempotent
  assert.deepEqual(await ack(a, 'player_submit_answer', { questionIndex: 0, answer: SOLVED }), { success: true });
  assert.equal((await waitFor(a, 'question_active')).alreadyAnswered, true);
  assert.deepEqual(await ack(a, 'player_submit_answer', { questionIndex: 0, answer: SOLVED }), { success: true, duplicate: true });
  dropNetwork(a);
  const afterAnswer = await waitFor(a, 'question_active');
  assert.equal(afterAnswer.alreadyAnswered, true);
});

test('an answer sent while offline is delivered after the automatic reconnect', async () => {
  const { pin, host } = await newGame();
  const p = await joinPlayer(pin, 'Lea');
  await joinPlayer(pin, 'Max');
  await startQuestion(host, pin);
  await waitFor(p, 'question_active');
  dropNetwork(p);
  const res = await ack(p, 'player_submit_answer', { questionIndex: 0, answer: SOLVED }, 5000);
  assert.equal(res.success, true);
  const count = await waitFor(host, 'answer_count_updated');
  assert.equal(count.answersReceived, 1);
});

test('two tabs of one player both receive per-player events; disconnected only when the last tab closes', async () => {
  const { pin, host } = await newGame();
  const tab1 = await joinPlayer(pin, 'Cat');
  const tab2 = client('Cat-tab2', { role: 'player', userUuid: tab1.uuid, pin });
  await waitFor(tab2, 'join_success');
  await startQuestion(host, pin);
  await Promise.all([waitFor(tab1, 'question_active'), waitFor(tab2, 'question_active')]);

  assert.deepEqual(await ack(tab2, 'player_submit_answer', { questionIndex: 0, answer: SOLVED }), { success: true });
  // Both tabs switch to "answer submitted", not only the one that answered
  const [u1, u2] = await Promise.all([waitFor(tab1, 'question_active'), waitFor(tab2, 'question_active')]);
  assert.equal(u1.alreadyAnswered && u2.alreadyAnswered, true);
  assert.deepEqual(await ack(tab1, 'player_submit_answer', { questionIndex: 0, answer: SOLVED }), { success: true, duplicate: true });
  const [f1, f2] = await Promise.all([waitFor(tab1, 'player_feedback'), waitFor(tab2, 'player_feedback')]);
  assert.equal(f1.isCorrect, true);
  assert.deepEqual(f1, f2);
  assert.equal((await waitFor(host, 'question_reveal')).totalAnswers, 1);

  await hostStep(host, 'QUESTION_REVEAL', 0, 'scoreboard_update');
  await Promise.all([waitFor(tab1, 'player_standing'), waitFor(tab2, 'player_standing')]);

  const updates = host.count('players_updated');
  close(tab2);
  await sleep(200);
  assert.equal(host.count('players_updated'), updates, 'one tab closing changes nothing for the host');
  assert.equal(gm.getGameByPin(pin).players.get(tab1.uuid).connected, true);
  close(tab1);
  const gone = await waitFor(host, 'players_updated', { where: (d) => d.players.every((p) => !p.connected) });
  assert.equal(gone.players[0].connected, false);
});

test('a late answer for the previous question is rejected and the real one accepted', async () => {
  const { pin, host } = await newGame();
  const p = await joinPlayer(pin, 'Dan');
  await joinPlayer(pin, 'Eve');
  await startQuestion(host, pin);
  await waitFor(p, 'question_active');
  await hostStep(host, 'QUESTION_ACTIVE', 0, 'question_reveal');
  await hostStep(host, 'QUESTION_REVEAL', 0, 'scoreboard_update');
  await hostStep(host, 'SCOREBOARD', 0, 'game_state_changed');
  await hostStep(host, 'GET_READY', 1, 'question_active');
  await waitFor(p, 'question_active', { where: (d) => d.questionIndex === 1 });

  const lateAnswer = await ack(p, 'player_submit_answer', { questionIndex: 0, answer: SOLVED });
  assert.equal(lateAnswer.success, false);
  const real = await ack(p, 'player_submit_answer', { questionIndex: 1, answer: { selected: ['o1'] } });
  assert.deepEqual(real, { success: true });
});

test('host_next with a stale fromState is ignored; a double click advances one screen', async () => {
  const { pin, host } = await newGame();
  const p = await joinPlayer(pin, 'Fay');
  await startQuestion(host, pin);

  // A Skip meant for Get Ready, arriving after the question started
  host.emit('host_next', { fromState: 'GET_READY', questionIndex: 0 });
  assert.equal(await arrives(host, 'question_reveal', 400), false);

  await ack(p, 'player_submit_answer', { questionIndex: 0, answer: SOLVED });
  await waitFor(host, 'question_reveal');
  host.emit('host_next', { fromState: 'QUESTION_REVEAL', questionIndex: 0 });
  host.emit('host_next', { fromState: 'QUESTION_REVEAL', questionIndex: 0 });
  await sleep(400);
  assert.equal(host.count('scoreboard_update'), 1);
  assert.equal(host.all('game_state_changed').filter((d) => d.state === 'GET_READY').length, 1, 'only the first Get Ready');
});

test('two host tabs both receive host events, and either can drive the game', async () => {
  const { game, pin, host } = await newGame();
  const host2 = client('host2', { role: 'host', pin: game.gameId, hostSecret: game.hostSecret }); // gameId works as well as the PIN
  assert.equal((await waitFor(host2, 'host_game_data')).pin, pin);
  const p = await joinPlayer(pin, 'Hal');
  await Promise.all([waitFor(host, 'players_updated'), waitFor(host2, 'players_updated')]);

  host2.emit('host_start_game');
  await Promise.all([
    waitFor(host, 'game_state_changed', { where: (d) => d.state === 'GET_READY' }),
    waitFor(host2, 'game_state_changed', { where: (d) => d.state === 'GET_READY' }),
  ]);
  host.emit('host_next', { fromState: 'GET_READY', questionIndex: 0 });
  await Promise.all([waitFor(host, 'question_active'), waitFor(host2, 'question_active'), waitFor(p, 'question_active')]);
  await ack(p, 'player_submit_answer', { questionIndex: 0, answer: SOLVED });
  await Promise.all([waitFor(host, 'answer_count_updated'), waitFor(host2, 'answer_count_updated')]);
});

test('host refresh replays the running question with answersReceived; a wrong secret is refused', async () => {
  const { game, pin, host } = await newGame();
  const p = await joinPlayer(pin, 'Ida');
  await joinPlayer(pin, 'Jon');
  await startQuestion(host, pin);
  await waitFor(p, 'question_active');
  await ack(p, 'player_submit_answer', { questionIndex: 0, answer: SOLVED });
  close(host);

  const fresh = client('host-refresh', { role: 'host', pin, hostSecret: game.hostSecret });
  const base = await waitFor(fresh, 'host_game_data');
  assert.equal(base.state, 'QUESTION_ACTIVE');
  assert.equal(base.currentQuestionIndex, 0);
  assert.equal(base.players.length, 2);
  const q = await waitFor(fresh, 'question_active');
  assert.equal(q.answersReceived, 1);
  assert.equal(q.totalPlayers, 2);
  assert.ok(q.remainingTimeMs > 0 && q.remainingTimeMs < 20000);
  assert.deepEqual(optionIds(q), ['pa', 'pb', 'pc', 'pd']); // the host shows the stored order

  const bad = client('host-bad', { role: 'host', pin, hostSecret: 'nope' });
  assert.match((await waitFor(bad, 'host_error')).error, /unauthorized/i);
  bad.emit('host_next', { fromState: 'QUESTION_ACTIVE', questionIndex: 0 });
  const unknown = client('host-unknown', { role: 'host', pin: '000001', hostSecret: game.hostSecret });
  assert.match((await waitFor(unknown, 'host_error')).error, /not found/i);
  assert.equal(await arrives(fresh, 'question_reveal', 300), false);
});

test('a socket that never joined cannot answer or drive the host', async () => {
  const { pin, host } = await newGame();
  const victim = await joinPlayer(pin, 'Kim');
  await startQuestion(host, pin);
  await waitFor(victim, 'question_active');

  const intruder = client('intruder', {});
  await new Promise((resolve) => intruder.once('connect', resolve));
  const res = await ack(intruder, 'player_submit_answer', { pin, userUuid: victim.uuid, questionIndex: 0, answer: SOLVED });
  assert.equal(res.success, false);
  intruder.emit('host_next', { fromState: 'QUESTION_ACTIVE', questionIndex: 0 });
  intruder.emit('host_end_game');
  assert.equal(await arrives(host, 'question_reveal', 400), false);
  assert.equal(gm.getGameByPin(pin).state, 'QUESTION_ACTIVE');
  assert.equal(gm.getGameByPin(pin).answers.get(0).size, 0);

  // A player socket cannot act as host either
  victim.emit('host_next', { fromState: 'QUESTION_ACTIVE', questionIndex: 0 });
  assert.equal(await arrives(host, 'question_reveal', 300), false);
});

test('kick reaches every tab of the player, and they get no further game events', async () => {
  const { game, pin, host } = await newGame();
  const t1 = await joinPlayer(pin, 'Ned');
  const t2 = client('Ned-tab2', { role: 'player', userUuid: t1.uuid, pin });
  await waitFor(t2, 'join_success');
  host.emit('host_kick_player', { userUuid: t1.uuid });
  await Promise.all([waitFor(t1, 'player_kicked'), waitFor(t2, 'player_kicked')]);
  await waitFor(host, 'players_updated', { where: (d) => d.count === 0 });
  assert.equal(game.players.has(t1.uuid), false);

  host.emit('host_start_game');
  await waitFor(host, 'game_state_changed', { where: (d) => d.state === 'GET_READY' });
  await sleep(200);
  // 1 = the lobby replay on join; nothing from the started game
  assert.equal(t1.count('game_state_changed'), 1);
  assert.equal(t2.count('game_state_changed'), 1);
  assert.equal((await ack(t1, 'player_submit_answer', { questionIndex: 0, answer: SOLVED })).success, false);
});

test('closing a lobby game emits game_closed to players and host; a reconnect then reports it gone', async () => {
  const { pin, host } = await newGame();
  const p = await joinPlayer(pin, 'Ola');
  host.emit('host_end_game'); // in the lobby this closes the game
  const [toPlayer, toHost] = await Promise.all([waitFor(p, 'game_closed'), waitFor(host, 'game_closed')]);
  assert.ok(toPlayer.reason);
  assert.equal(toPlayer.reason, toHost.reason);
  assert.equal(gm.getGameByPin(pin), null);

  dropNetwork(p);
  assert.deepEqual(await waitFor(p, 'not_joined'), { gameFound: false });
  dropNetwork(host);
  assert.match((await waitFor(host, 'host_error')).error, /not found/i);
});

test('not_joined.gameFound distinguishes an unknown PIN from a non-member; only the PIN resumes a member', async () => {
  const { pin } = await newGame();
  const p = await joinPlayer(pin, 'Pat');

  // Without a PIN nothing is resumed, so a page without ?pin always shows the PIN screen
  const viaNoPin = client('Pat-nopin', { role: 'player', userUuid: p.uuid });
  assert.deepEqual(await waitFor(viaNoPin, 'not_joined'), { gameFound: false });
  const viaPin = client('Pat-pin', { role: 'player', userUuid: p.uuid, pin });
  assert.equal((await waitFor(viaPin, 'join_success')).pin, pin);
  assert.deepEqual(await waitFor(viaPin, 'game_state_changed'), { state: 'LOBBY' });

  const stranger = client('stranger', { role: 'player', userUuid: uuid(), pin });
  assert.deepEqual(await waitFor(stranger, 'not_joined'), { gameFound: true });
  const missing = client('missing', { role: 'player', userUuid: uuid(), pin: '000001' });
  assert.deepEqual(await waitFor(missing, 'not_joined'), { gameFound: false });
  const fresh = client('fresh', { role: 'player', userUuid: uuid() });
  assert.deepEqual(await waitFor(fresh, 'not_joined'), { gameFound: false });
});

test('joining by gameId, lock game, nickname conflicts and lobby renames', async () => {
  const { game, pin, host } = await newGame();
  const alice = client('alice', { role: 'player', userUuid: uuid() });
  await waitFor(alice, 'not_joined');
  alice.emit('player_join', { pin: game.gameId, nickname: 'Alice' }); // join by gameId
  const joined = await waitFor(alice, 'join_success');
  assert.equal(joined.pin, pin);
  assert.equal(joined.player.nickname, 'Alice');

  // Same nickname (any case) from someone else is refused while Alice is in the game
  const other = client('other', { role: 'player', userUuid: uuid() });
  await waitFor(other, 'not_joined');
  other.emit('player_join', { pin, nickname: 'alice' });
  assert.match((await waitFor(other, 'join_error')).error, /already taken/);
  other.emit('player_join', { pin, nickname: '   ' });
  assert.match((await waitFor(other, 'join_error')).error, /valid nickname/);

  // Alice can rename herself in the lobby, but not onto a taken name
  other.emit('player_join', { pin, nickname: 'Bob' });
  await waitFor(other, 'join_success');
  alice.emit('player_join', { pin, nickname: 'Alicia' });
  assert.equal((await waitFor(alice, 'join_success')).player.nickname, 'Alicia');
  alice.emit('player_join', { pin, nickname: 'BOB' });
  assert.equal((await waitFor(alice, 'join_success')).player.nickname, 'Alicia');

  // Lock: new players are refused, members still get back in
  host.emit('host_update_settings', { settings: { lockGame: true } });
  await waitFor(host, 'settings_updated');
  const blocked = client('blocked', { role: 'player', userUuid: uuid() });
  await waitFor(blocked, 'not_joined');
  blocked.emit('player_join', { pin, nickname: 'Carol' });
  assert.match((await waitFor(blocked, 'join_error')).error, /locked/);
  const aliceTab = client('alice-tab', { role: 'player', userUuid: alice.auth.userUuid, pin });
  assert.equal((await waitFor(aliceTab, 'join_success')).player.nickname, 'Alicia');
  assert.equal(game.players.size, 2);
});

test('early end game during a question goes to PODIUM with the answers so far scored', async () => {
  const { pin, host } = await newGame();
  const p = await joinPlayer(pin, 'Champ');
  await joinPlayer(pin, 'Idle');
  await startQuestion(host, pin);
  await waitFor(p, 'question_active');
  await ack(p, 'player_submit_answer', { questionIndex: 0, answer: SOLVED });
  host.emit('host_end_game');
  const podium = await waitFor(host, 'podium_update');
  assert.equal(podium.first.nickname, 'Champ');
  assert.ok(podium.first.score > 0);
  const final = await waitFor(p, 'final_results');
  assert.equal(final.isWinner, true);
  assert.ok(final.totalScore > 0);
});

test('late joiner during a question lands on the running question', async () => {
  const { pin, host } = await newGame();
  await joinPlayer(pin, 'Sam');
  await startQuestion(host, pin);
  const late = await joinPlayer(pin, 'Late');
  const q = await waitFor(late, 'question_active');
  assert.equal(q.questionIndex, 0);
  assert.equal(q.alreadyAnswered, false);
  assert.ok(q.remainingTimeMs > 0);
  assert.equal((await ack(late, 'player_submit_answer', { questionIndex: 0, answer: SOLVED })).success, true);
});

test('a malformed answer is refused or cleaned, and the reveal still happens', async () => {
  const { pin, host } = await newGame();
  const p = await joinPlayer(pin, 'Mal');
  await startQuestion(host, pin);
  await waitFor(p, 'question_active');

  // Objects that cannot be turned into strings used to make scoring throw inside the reveal timer
  const junk = { toString: 1 };
  assert.deepEqual(await ack(p, 'player_submit_answer', { questionIndex: 0, answer: junk }), { success: false, error: 'Invalid answer' });
  assert.deepEqual(await ack(p, 'player_submit_answer', { questionIndex: 0, answer: { order: [junk, 'pa'] } }), { success: true });
  assert.equal((await waitFor(host, 'question_reveal')).totalAnswers, 1);
  await waitFor(p, 'player_feedback');
});

// Both cases wait out RECONNECT_GRACE_MS; run them side by side so the wait is paid once
describe('reconnect grace', { concurrency: true }, () => {
  test('a player who drops while the others answered: reveal only after the grace', async () => {
    const { pin, host } = await newGame();
    const a = await joinPlayer(pin, 'Quin');
    const b = await joinPlayer(pin, 'Rae');
    await startQuestion(host, pin);
    await waitFor(a, 'question_active');
    await ack(a, 'player_submit_answer', { questionIndex: 0, answer: SOLVED });
    const droppedAt = Date.now();
    close(b);
    await waitFor(host, 'players_updated', { where: (d) => d.players.some((p) => !p.connected) });

    assert.equal(await arrives(host, 'question_reveal', RECONNECT_GRACE_MS - 1000), false, 'no reveal during the grace');
    await waitFor(host, 'question_reveal', { ms: 3000 });
    assert.ok(Date.now() - droppedAt >= RECONNECT_GRACE_MS, `revealed after ${Date.now() - droppedAt} ms`);
  });

  test('a player who drops and reconnects within the grace keeps the question open and can answer', async () => {
    const { pin, host } = await newGame();
    const a = await joinPlayer(pin, 'Uma');
    const b = await joinPlayer(pin, 'Vic');
    await startQuestion(host, pin);
    await waitFor(b, 'question_active');
    await ack(a, 'player_submit_answer', { questionIndex: 0, answer: SOLVED });
    dropNetwork(b);
    await waitFor(b, 'question_active'); // back within ~100 ms, replayed

    assert.equal(await arrives(host, 'question_reveal', RECONNECT_GRACE_MS + 500), false, 'question stays open past the grace');
    assert.deepEqual(await ack(b, 'player_submit_answer', { questionIndex: 0, answer: SOLVED }), { success: true });
    await waitFor(host, 'question_reveal', { ms: 2000 });
  });

  test('a player who drops just before the question starts is waited for only until their grace ends', async () => {
    const { pin, host } = await newGame();
    const a = await joinPlayer(pin, 'Wes');
    const b = await joinPlayer(pin, 'Xan');
    host.emit('host_start_game');
    await waitFor(host, 'game_state_changed', { where: (d) => d.state === 'GET_READY' });
    const droppedAt = Date.now();
    close(b);
    await waitFor(host, 'players_updated', { where: (d) => d.players.some((p) => !p.connected) });
    host.emit('host_next', { fromState: 'GET_READY', questionIndex: 0 });
    await waitFor(a, 'question_active');
    await ack(a, 'player_submit_answer', { questionIndex: 0, answer: SOLVED });

    await waitFor(host, 'question_reveal', { ms: RECONNECT_GRACE_MS + 2000 });
    const elapsed = Date.now() - droppedAt;
    assert.ok(elapsed >= RECONNECT_GRACE_MS && elapsed < RECONNECT_GRACE_MS + 1500, `revealed after ${elapsed} ms`);
  });
});

test('HTTP: admin login, public quiz hides answers, path traversal and unauthenticated upload are refused', async () => {
  const bad = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_CREDENTIALS.username, password: 'wrong-password' }),
  });
  assert.equal(bad.status, 401);
  const good = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN_CREDENTIALS),
  });
  assert.equal(good.status, 200);
  assert.ok((await good.json()).token);

  const quizRes = await fetch(`${baseUrl}/api/quizzes/${QUIZ_ID}`);
  assert.equal(quizRes.status, 200);
  const { quiz } = await quizRes.json();
  for (const q of quiz.questions) {
    for (const o of q.options) {
      assert.equal(o.isCorrect, undefined);
      assert.equal(o.order, undefined);
    }
  }

  assert.equal((await fetch(`${baseUrl}/api/quizzes/..%2F..%2Fpackage.json`)).status, 404);
  const upload = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(upload.status, 401);
});
