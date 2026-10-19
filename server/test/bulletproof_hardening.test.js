import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO } from 'socket.io-client';
import cookieParser from 'cookie-parser';

import authRoutes from '../routes/auth.js';
import quizzesRoutes from '../routes/quizzes.js';
import uploadsRoutes from '../routes/uploads.js';
import { GameManager } from '../gameManager.js';
import { initStorage, saveQuiz, deleteQuiz } from '../storage.js';
import { calculateQuestionScore } from '../scoring.js';

function createHardenedTestServer() {
  initStorage();
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, { cors: { origin: '*' } });
  const gameManager = new GameManager(io);

  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/quizzes', quizzesRoutes);
  app.use('/api/uploads', uploadsRoutes);

  const isAuthorizedHost = (socket, pin, hostSecret) => {
    const game = gameManager.getGameByPinOrId(pin);
    if (!game) return false;
    const socketInfo = gameManager.socketToGame.get(socket.id);
    if (socketInfo && socketInfo.role === 'host' && socketInfo.pin === game.pin) {
      return true;
    }
    if (hostSecret && game.hostSecret && hostSecret === game.hostSecret) {
      return true;
    }
    if (game.hostSocketId === socket.id) {
      return true;
    }
    return false;
  };

  io.on('connection', (socket) => {
    socket.on('host_create_game', async (data) => {
      try {
        const game = await gameManager.createGame(data.quizId, socket.id);
        socket.join(game.pin);
        socket.emit('game_created', {
          success: true,
          pin: game.pin,
          gameId: game.gameId,
          hostSecret: game.hostSecret,
          quizTitle: game.quiz.title,
          totalQuestions: game.quiz.questions.length,
          state: game.state,
          settings: game.settings,
        });
      } catch (err) {
        socket.emit('game_error', { error: err.message });
      }
    });

    socket.on('host_join', (data) => {
      const { pin, hostSecret } = data || {};
      const game = gameManager.getGameByPinOrId(pin);
      if (game) {
        if (game.hostSecret && hostSecret !== game.hostSecret) {
          socket.emit('host_error', { error: 'Unauthorized host session' });
          return;
        }
        game.hostSocketId = socket.id;
        socket.join(game.pin);
        gameManager.socketToGame.set(socket.id, { pin: game.pin, role: 'host', hostSecret: game.hostSecret });
        const hostData = gameManager.getHostStateData(game.pin);
        socket.emit('host_game_data', {
          ...(hostData || {}),
          hostSecret: game.hostSecret,
        });
      }
    });

    socket.on('host_start_game', (data) => {
      const { pin, hostSecret } = data || {};
      if (!isAuthorizedHost(socket, pin, hostSecret)) return;
      gameManager.startGame(pin);
    });

    socket.on('host_next', (data) => {
      const { pin, hostSecret } = data || {};
      if (!isAuthorizedHost(socket, pin, hostSecret)) return;
      gameManager.handleHostNext(pin);
    });

    socket.on('player_join', (data) => {
      const result = gameManager.joinPlayer(data.pin, data.nickname, data.userUuid, socket.id);
      if (result.success) {
        socket.join(result.pin);
        socket.emit('join_success', result);
      } else {
        socket.emit('join_error', result);
      }
    });

    socket.on('player_submit_answer', (data) => {
      const result = gameManager.submitAnswer(data.pin, data.userUuid, data.answerPayload);
      socket.emit('answer_submitted_ack', result);
    });

    socket.on('disconnect', () => {
      gameManager.handleDisconnect(socket.id);
    });
  });

  return { app, server, io, gameManager };
}

test('Bulletproof Hardening: Security, Concurrency, Reconnect, and Scoring', async (t) => {
  const testQuiz = {
    id: 'quiz_hardening_test',
    title: 'Hardening Verification Quiz',
    theme: 'spring',
    defaultTimeLimit: 20,
    questions: [
      {
        id: 'q1',
        type: 'quiz',
        title: 'Single select multiple correct valid answers',
        timeLimit: 20,
        points: 1000,
        isMultiSelect: false,
        options: [
          { id: 'opt_a', text: 'Option A (valid)', isCorrect: true },
          { id: 'opt_b', text: 'Option B (also valid)', isCorrect: true },
          { id: 'opt_c', text: 'Option C (wrong)', isCorrect: false },
        ],
      },
      {
        id: 'q2',
        type: 'puzzle',
        title: 'Puzzle ordering',
        timeLimit: 20,
        points: 1000,
        options: [
          { id: 'p1', text: 'First', isCorrect: true, order: 0 },
          { id: 'p2', text: 'Second', isCorrect: true, order: 1 },
          { id: 'p3', text: 'Third', isCorrect: true, order: 2 },
        ],
      },
      {
        id: 'q3',
        type: 'number_guess',
        title: 'Number guessing inverted min/max',
        timeLimit: 20,
        points: 1000,
        numberMin: 100, // inverted on purpose
        numberMax: 0,
        numberTarget: 50,
      },
    ],
  };
  saveQuiz(testQuiz);

  const { server, io, gameManager } = createHardenedTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  let hostClient;
  let playerClient;
  let attackerClient;

  try {
    // 1. Scoring Logic: Single-select with multiple correct options (Issue 8)
    const q1 = testQuiz.questions[0];
    const scoreOptA = calculateQuestionScore(q1, { selected: 'opt_a' }, 1000);
    const scoreOptB = calculateQuestionScore(q1, { selected: 'opt_b' }, 1000);
    const scoreOptC = calculateQuestionScore(q1, { selected: 'opt_c' }, 1000);
    assert.strictEqual(scoreOptA.isCorrect, true);
    assert.ok(scoreOptA.points > 0, 'Option A must award points');
    assert.strictEqual(scoreOptB.isCorrect, true);
    assert.ok(scoreOptB.points > 0, 'Option B must award points');
    assert.strictEqual(scoreOptC.isCorrect, false);
    assert.strictEqual(scoreOptC.points, 0);

    // 2. Scoring Logic: Puzzle duplicated items exploit (Issue 4.2)
    const q2 = testQuiz.questions[1];
    const duplicatePuzzleScore = calculateQuestionScore(q2, { order: ['p1', 'p1', 'p1'] }, 1000);
    assert.strictEqual(duplicatePuzzleScore.isCorrect, false);
    assert.strictEqual(duplicatePuzzleScore.points, 0, 'Duplicate puzzle entries must get 0 points');

    // 3. Scoring Logic: Number guess inverted boundaries (Issue 4.3)
    const q3 = testQuiz.questions[2];
    const exactGuessScore = calculateQuestionScore(q3, { number: 50 }, 1000);
    assert.strictEqual(exactGuessScore.isExact, true);
    assert.ok(exactGuessScore.points > 0, 'Exact guess on inverted bounds must normalize and award points');

    // 4. Security: Answers Leakage on GET /api/quizzes/:id for unauthenticated requests (Issue 6)
    const publicQuizRes = await fetch(`${baseUrl}/api/quizzes/quiz_hardening_test`);
    const publicQuizData = await publicQuizRes.json();
    assert.strictEqual(publicQuizRes.status, 200);
    assert.ok(publicQuizData.quiz);
    assert.strictEqual(publicQuizData.quiz.questions[0].options[0].isCorrect, undefined, 'isCorrect must be stripped');
    assert.strictEqual(publicQuizData.quiz.questions[2].numberTarget, undefined, 'numberTarget must be stripped');

    // 5. Security: Path Traversal in storage (Issue 2.4)
    const traversalRes = await fetch(`${baseUrl}/api/quizzes/..%2F..%2Fpackage.json`);
    assert.strictEqual(traversalRes.status, 404, 'Path traversal must be safely rejected');

    // 6. Security: Unauthenticated upload rejection (Issue 4 & 5)
    const uploadRes = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      body: 'fake-data',
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.strictEqual(uploadRes.status, 401, 'Uploads must require admin auth');

    // 7. Socket Flow: Host Game Creation and hostSecret generation (Issue 7)
    hostClient = ClientIO(baseUrl);
    await new Promise((res) => hostClient.on('connect', res));

    const gameCreatedPromise = new Promise((resolve) => hostClient.on('game_created', resolve));
    hostClient.emit('host_create_game', { quizId: 'quiz_hardening_test' });
    const gameCreated = await gameCreatedPromise;
    const pin = gameCreated.pin;
    const hostSecret = gameCreated.hostSecret;

    assert.ok(pin, 'Game PIN must exist');
    assert.ok(hostSecret, 'hostSecret must be generated and returned');

    // 8. Security: Attacker attempts unauthorized host_join with wrong secret (Issue 7)
    attackerClient = ClientIO(baseUrl);
    await new Promise((res) => attackerClient.on('connect', res));

    const attackerErrorPromise = new Promise((resolve) => attackerClient.on('host_error', resolve));
    attackerClient.emit('host_join', { pin, hostSecret: 'wrong-fake-secret' });
    const attackerError = await attackerErrorPromise;
    assert.match(attackerError.error, /unauthorized/i);

    // 9. Host Join with valid hostSecret receives complete host state (Issue 16)
    const hostDataPromise = new Promise((resolve) => hostClient.on('host_game_data', resolve));
    hostClient.emit('host_join', { pin, hostSecret });
    const hostData = await hostDataPromise;
    assert.strictEqual(hostData.pin, pin);
    assert.strictEqual(hostData.state, 'LOBBY');

    // 10. Player Joins Game
    playerClient = ClientIO(baseUrl);
    await new Promise((res) => playerClient.on('connect', res));

    const joinPromise = new Promise((resolve) => playerClient.on('join_success', resolve));
    playerClient.emit('player_join', { pin, nickname: 'HardenedPlayer', userUuid: 'valid_uuid_123' });
    const joinData = await joinPromise;
    assert.strictEqual(joinData.success, true);

    const game = gameManager.getGameByPin(pin);
    assert.ok(game);
    game.state = 'QUESTION_ACTIVE';
    game.currentQuestionIndex = 0;
    game.answers.set(0, new Map());

    // 11. Security: Ghost Session Answer Injection (Issue 3)
    const ghostPromise = new Promise((resolve) => attackerClient.on('answer_submitted_ack', resolve));
    attackerClient.emit('player_submit_answer', {
      pin,
      userUuid: 'fake_ghost_uuid_that_does_not_exist',
      answerPayload: { selected: 'opt_a' },
    });
    const ghostAck = await ghostPromise;
    assert.strictEqual(ghostAck.success, false);
    assert.match(ghostAck.error, /not found/i, 'Ghost session must be rejected');

    // 12. Host Advance Cooldown (Issue 1)
    // Simulate active transition
    game.lastHostTransitionTime = Date.now();
    const rapidAdvanceResult = gameManager.checkHostCooldown(game);
    assert.strictEqual(rapidAdvanceResult, false, 'Rapid host advance within 1000ms must be throttled');

    // 13. Disconnected Player Hang Relief (Issue 9)
    game.state = 'QUESTION_ACTIVE';
    game.currentQuestionIndex = 0;
    game.answers.set(0, new Map());
    // Player 1 has submitted
    gameManager.submitAnswer(pin, 'valid_uuid_123', { selected: 'opt_a' });
    // Player 2 is connected but hasn't submitted yet
    const player2SocketId = 'player_2_socket';
    game.players.set('player_2', {
      userUuid: 'player_2',
      nickname: 'Player2',
      connected: true,
      socketId: player2SocketId,
      score: 0,
      streak: 0,
    });
    gameManager.socketToGame.set(player2SocketId, { pin, role: 'player', userUuid: 'player_2' });
    // When Player 2 disconnects, server detects all remaining connected players have submitted
    gameManager.handleDisconnect(player2SocketId);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.strictEqual(game.state, 'QUESTION_REVEAL', 'Must immediately transition to reveal without hanging');
  } finally {
    if (hostClient) hostClient.disconnect();
    if (playerClient) playerClient.disconnect();
    if (attackerClient) attackerClient.disconnect();
    io.close();
    await new Promise((res) => server.close(res));
    deleteQuiz('quiz_hardening_test');
  }
});
