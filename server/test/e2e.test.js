import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO } from 'socket.io-client';
import cookieParser from 'cookie-parser';

import authRoutes from '../routes/auth.js';
import quizzesRoutes from '../routes/quizzes.js';
import { GameManager } from '../gameManager.js';
import { initStorage, getQuizById } from '../storage.js';

// Setup in-memory test server
function createTestServer() {
  initStorage();
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, { cors: { origin: '*' } });
  const gameManager = new GameManager(io);

  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/quizzes', quizzesRoutes);

  io.on('connection', (socket) => {
    socket.on('host_create_game', async (data) => {
      try {
        const game = await gameManager.createGame(data.quizId, socket.id);
        socket.join(game.pin);
        socket.emit('game_created', {
          success: true,
          pin: game.pin,
          gameId: game.gameId,
          totalQuestions: game.quiz.questions.length,
          qrCodeDataUrl: game.qrCodeDataUrl,
        });
      } catch (err) {
        socket.emit('game_error', { error: err.message });
      }
    });

    socket.on('host_start_game', (data) => {
      gameManager.startGame(data.pin);
    });

    socket.on('host_next', (data) => {
      gameManager.handleHostNext(data.pin);
    });

    socket.on('player_join', (data) => {
      const result = gameManager.joinPlayer(data.pin, data.nickname, data.userUuid, socket.id);
      if (result.success) {
        socket.join(result.pin);
        socket.emit('join_success', result);
      } else {
        socket.emit('join_error', { error: result.error });
      }
    });

    socket.on('player_submit_answer', (data) => {
      const result = gameManager.submitAnswer(data.pin, data.userUuid, data.answerPayload);
      socket.emit('answer_submitted_ack', result);
    });
  });

  return { app, server, io, gameManager };
}

test('E2E: Full Kahoot Gameplay Lifecycle and APIs', async (t) => {
  const { server, io, gameManager } = createTestServer();

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    console.log('1. Testing Admin Auth...');
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin1235' }),
    });
    const loginData = await loginRes.json();
    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginData.success, true);
    assert.ok(loginData.token);

    // Test Bad Login
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
    });
    assert.strictEqual(badLoginRes.status, 401);
    console.log('2. Admin Auth Passed!');

    // 2. Test Quizzes API
    const quizzesRes = await fetch(`${baseUrl}/api/quizzes`);
    const quizzesData = await quizzesRes.json();
    assert.strictEqual(quizzesRes.status, 200);
    assert.ok(quizzesData.quizzes.length >= 1);
    const sampleQuiz = quizzesData.quizzes.find((q) => q.id === 'sample-master-quiz') || quizzesData.quizzes[0];
    console.log('3. Quizzes API Passed!');

    // 3. Test Real-time Multiplayer Game
    console.log('4. Connecting test sockets...');
    const hostSocket = ClientIO(baseUrl);
    const player1Socket = ClientIO(baseUrl);
    const player2Socket = ClientIO(baseUrl);

    await Promise.all([
      new Promise((res) => hostSocket.on('connect', res)),
      new Promise((res) => player1Socket.on('connect', res)),
      new Promise((res) => player2Socket.on('connect', res)),
    ]);
    console.log('5. Sockets connected!');

    // Host creates game
    const gameCreatedPromise = new Promise((resolve) => {
      hostSocket.on('game_created', resolve);
    });
    hostSocket.emit('host_create_game', { quizId: sampleQuiz.id });
    const gameCreatedData = await gameCreatedPromise;
    assert.strictEqual(gameCreatedData.success, true);
    assert.ok(gameCreatedData.pin);
    const gamePin = gameCreatedData.pin;
    console.log('6. Game created with PIN:', gamePin);

    // Player 1 joins
    const p1JoinPromise = new Promise((resolve) => {
      player1Socket.on('join_success', resolve);
    });
    player1Socket.emit('player_join', { pin: gamePin, nickname: 'Alice', userUuid: 'p1_uuid' });
    const p1Data = await p1JoinPromise;
    assert.strictEqual(p1Data.player.nickname, 'Alice');
    assert.ok(p1Data.userUuid);

    // Player 2 joins
    const p2JoinPromise = new Promise((resolve) => {
      player2Socket.on('join_success', resolve);
    });
    player2Socket.emit('player_join', { pin: gamePin, nickname: 'Bob', userUuid: 'p2_uuid' });
    const p2Data = await p2JoinPromise;
    assert.strictEqual(p2Data.player.nickname, 'Bob');
    console.log('7. Players joined successfully!');

    // Host starts game
    const questionActivePromise = new Promise((resolve) => {
      player1Socket.on('question_active', resolve);
    });

    const game = gameManager.getGameByPin(gamePin);
    game.currentQuestionIndex = 0;
    gameManager.transitionToQuestionActive(game);
    const activeData = await questionActivePromise;
    assert.strictEqual(activeData.state, 'QUESTION_ACTIVE');
    assert.ok(activeData.question.options.length >= 2);
    console.log('8. Question active broadcasted!');

    // Alice answers correctly (opt_1 is Mars for sample quiz q1)
    const feedbackP1Promise = new Promise((resolve) => {
      player1Socket.on('player_feedback', resolve);
    });
    const feedbackP2Promise = new Promise((resolve) => {
      player2Socket.on('player_feedback', resolve);
    });

    console.log('9. Submitting answers...');
    player1Socket.emit('player_submit_answer', {
      pin: gamePin,
      userUuid: p1Data.userUuid,
      answerPayload: { selected: 'opt_1' },
    });

    // Bob answers incorrectly (opt_2 is Venus)
    player2Socket.emit('player_submit_answer', {
      pin: gamePin,
      userUuid: p2Data.userUuid,
      answerPayload: { selected: 'opt_2' },
    });

    console.log('10. Waiting for feedback...');
    const [fb1, fb2] = await Promise.all([feedbackP1Promise, feedbackP2Promise]);
    console.log('11. Feedback received:', { fb1, fb2 });
    assert.strictEqual(fb1.isCorrect, true);
    assert.ok(fb1.pointsEarned > 500);
    assert.strictEqual(fb1.streak, 1);

    assert.strictEqual(fb2.isCorrect, false);
    assert.strictEqual(fb2.pointsEarned, 0);

    // Host advances to scoreboard
    console.log('12. Host advancing to scoreboard...');
    const scoreboardPromise = new Promise((resolve) => {
      hostSocket.on('scoreboard_update', resolve);
    });
    hostSocket.emit('host_next', { pin: gamePin });
    const scoreboardData = await scoreboardPromise;
    console.log('13. Scoreboard received!');
    assert.strictEqual(scoreboardData.leaderboard[0].nickname, 'Alice');
    assert.strictEqual(scoreboardData.leaderboard[1].nickname, 'Bob');

    // Test player reconnection resilience
    const reconnectSocket = ClientIO(baseUrl);
    await new Promise((res) => reconnectSocket.on('connect', res));
    const reconnectPromise = new Promise((resolve) => {
      reconnectSocket.on('join_success', resolve);
    });
    reconnectSocket.emit('player_join', {
      pin: gamePin,
      nickname: 'Alice',
      userUuid: p1Data.userUuid,
    });
    const reconData = await reconnectPromise;
    assert.strictEqual(reconData.player.nickname, 'Alice');
    assert.strictEqual(reconData.player.score, fb1.pointsEarned);

    // Clean up
    gameManager.clearGameTimer(gamePin);
    hostSocket.disconnect();
    player1Socket.disconnect();
    player2Socket.disconnect();
    reconnectSocket.disconnect();
    io.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
