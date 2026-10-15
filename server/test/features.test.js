import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO } from 'socket.io-client';
import cookieParser from 'cookie-parser';

import { PROFILES_DIR, REPORTS_DIR } from '../config.js';
import authRoutes from '../routes/auth.js';
import quizzesRoutes from '../routes/quizzes.js';
import { GameManager } from '../gameManager.js';
import { initStorage, getQuizById } from '../storage.js';

after(() => {
  try {
    if (PROFILES_DIR.includes('test_profiles') && fs.existsSync(PROFILES_DIR)) {
      fs.rmSync(PROFILES_DIR, { recursive: true, force: true });
    }
    if (REPORTS_DIR.includes('test_reports') && fs.existsSync(REPORTS_DIR)) {
      fs.rmSync(REPORTS_DIR, { recursive: true, force: true });
    }
  } catch {}
});

function createServer() {
  initStorage();
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, { cors: { origin: '*' } });
  const gameManager = new GameManager(io);

  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/quizzes', quizzesRoutes);

  // Status check endpoint
  app.get('/api/games/:pinOrId/status', (req, res) => {
    const { pinOrId } = req.params;
    const game = gameManager.getGameByPinOrId(pinOrId);
    if (!game) {
      return res.status(404).json({ exists: false, error: 'Game not found' });
    }
    if (game.settings?.lockGame) {
      return res.status(403).json({ exists: true, locked: true, error: 'Locked' });
    }
    return res.json({
      exists: true,
      pin: game.pin,
      gameId: game.gameId,
      state: game.state,
      quizTitle: game.quiz?.title,
    });
  });

  io.on('connection', (socket) => {
    socket.on('host_create_game', async (data) => {
      try {
        const game = await gameManager.createGame(data.quizId, socket.id);
        socket.join(game.pin);
        socket.emit('game_created', {
          success: true,
          pin: game.pin,
          gameId: game.gameId,
          state: game.state,
          settings: game.settings,
        });
      } catch (err) {
        socket.emit('game_error', { error: err.message });
      }
    });

    socket.on('host_update_settings', (data) => {
      gameManager.updateSettings(data.pin, data.settings);
    });

    socket.on('host_start_game', (data) => {
      gameManager.startGame(data.pin);
    });

    socket.on('host_end_game', (data) => {
      gameManager.endGame(data.pin);
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

test('Feature: Randomize Answers Setting & Game Status API & Early End Game', async () => {
  const { server, io, gameManager } = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const hostSocket = ClientIO(baseUrl);
  const playerSocket = ClientIO(baseUrl);
  await new Promise((res) => hostSocket.on('connect', res));
  await new Promise((res) => playerSocket.on('connect', res));

  try {
    // 1. Create Game
    const gameCreatedPromise = new Promise((resolve) => {
      hostSocket.on('game_created', resolve);
    });
    hostSocket.emit('host_create_game', { quizId: 'sample-master-quiz' });
    const gameCreated = await gameCreatedPromise;
    const pin = gameCreated.pin;
    const gameId = gameCreated.gameId;
    assert.ok(pin);
    assert.ok(gameId);

    // 2. Verify Status Endpoint using PIN and Game ID
    const statusResPin = await fetch(`${baseUrl}/api/games/${pin}/status`);
    const statusDataPin = await statusResPin.json();
    assert.strictEqual(statusResPin.status, 200);
    assert.strictEqual(statusDataPin.exists, true);
    assert.strictEqual(statusDataPin.pin, pin);

    const statusResId = await fetch(`${baseUrl}/api/games/${gameId}/status`);
    const statusDataId = await statusResId.json();
    assert.strictEqual(statusResId.status, 200);
    assert.strictEqual(statusDataId.pin, pin);

    // 3. Update Settings (Enable randomizeAnswers)
    const settingsPromise = new Promise((resolve) => {
      hostSocket.on('settings_updated', resolve);
    });
    hostSocket.emit('host_update_settings', {
      pin,
      settings: { randomizeAnswers: true },
    });
    const updatedSettings = await settingsPromise;
    assert.strictEqual(updatedSettings.randomizeAnswers, true);

    // 4. Player Joins using gameId UUID
    const joinPromise = new Promise((resolve) => {
      playerSocket.on('join_success', resolve);
    });
    playerSocket.emit('player_join', {
      pin: gameId,
      nickname: 'ChampionAlex',
    });
    const joinData = await joinPromise;
    assert.strictEqual(joinData.success, true);
    assert.strictEqual(joinData.player.nickname, 'ChampionAlex');
    const userUuid = joinData.userUuid;

    // 5. Host Starts Game
    const activeQuestionPromise = new Promise((resolve) => {
      hostSocket.on('question_active', resolve);
    });
    hostSocket.emit('host_start_game', { pin });
    const hostActiveData = await activeQuestionPromise;
    assert.ok(hostActiveData.question);
    assert.ok(hostActiveData.question.options.length > 0);

    // 6. Test Early End Game -> Instant Podium
    const hostPodiumPromise = new Promise((resolve) => {
      hostSocket.on('podium_update', resolve);
    });
    const playerPodiumPromise = new Promise((resolve) => {
      playerSocket.on('final_results', resolve);
    });

    hostSocket.emit('host_end_game', { pin });

    const hostPodium = await hostPodiumPromise;
    const playerPodium = await playerPodiumPromise;

    assert.strictEqual(hostPodium.state, 'PODIUM');
    assert.strictEqual(hostPodium.first.nickname, 'ChampionAlex');
    assert.strictEqual(playerPodium.rank, 1);
    assert.strictEqual(playerPodium.isWinner, true);
  } finally {
    hostSocket.disconnect();
    playerSocket.disconnect();
    io.close();
    await new Promise((res) => server.close(res));
  }
});
