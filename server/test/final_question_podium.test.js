import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO } from 'socket.io-client';

import { GameManager } from '../gameManager.js';
import { initStorage, saveQuiz, deleteQuiz } from '../storage.js';

test('Final question transitions directly from QUESTION_REVEAL to PODIUM without SCOREBOARD', async () => {
  initStorage();

  const finalQuiz = {
    id: 'quiz_single_question',
    title: 'Single Question Quiz',
    theme: 'standard',
    questions: [
      {
        id: 'q_only',
        type: 'quiz',
        title: 'Only Question',
        timeLimit: 20,
        points: 1000,
        options: [
          { id: 'opt_1', text: 'Option A', isCorrect: true },
          { id: 'opt_2', text: 'Option B', isCorrect: false },
        ],
      },
    ],
  };
  saveQuiz(finalQuiz);

  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server);
  const gameManager = new GameManager(io);

  io.on('connection', (socket) => {
    socket.on('host_next', (data) => {
      gameManager.handleHostNext(data.pin);
    });
    socket.on('player_join', (data) => {
      const result = gameManager.joinPlayer(data.pin, data.nickname, data.userUuid, socket.id);
      if (result.success) {
        socket.join(result.pin);
        socket.emit('join_success', result);
      }
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://localhost:${port}`;

  const hostSocket = ClientIO(url);
  const playerSocket = ClientIO(url);
  await Promise.all([
    new Promise((res) => hostSocket.on('connect', res)),
    new Promise((res) => playerSocket.on('connect', res)),
  ]);

  try {
    const game = await gameManager.createGame('quiz_single_question', hostSocket.id);
    const pin = game.pin;

    // Player joins
    const joinPromise = new Promise((resolve) => playerSocket.on('join_success', resolve));
    playerSocket.emit('player_join', { pin, nickname: 'Runner1', userUuid: 'sess_1' });
    await joinPromise;

    // Transition through valid state lifecycle to QUESTION_REVEAL for final question
    game.currentQuestionIndex = 0;
    gameManager.setState(game, 'GET_READY');
    gameManager.setState(game, 'QUESTION_ACTIVE');
    gameManager.transitionToQuestionReveal(game);
    assert.strictEqual(game.state, 'QUESTION_REVEAL');

    let scoreboardReceived = false;
    hostSocket.on('scoreboard_update', () => {
      scoreboardReceived = true;
    });

    const podiumPromise = new Promise((resolve) => {
      hostSocket.on('podium_update', resolve);
    });
    const finalResultsPromise = new Promise((resolve) => {
      playerSocket.on('final_results', resolve);
    });

    // Host clicks next from QUESTION_REVEAL on final question
    hostSocket.emit('host_next', { pin });

    const podiumData = await podiumPromise;
    const finalResults = await finalResultsPromise;

    // Must transition directly to PODIUM
    assert.strictEqual(podiumData.state, 'PODIUM');
    assert.strictEqual(finalResults.isWinner, true);
    // SCOREBOARD MUST NEVER HAVE BEEN EMITTED!
    assert.strictEqual(scoreboardReceived, false);
    assert.strictEqual(game.state, 'PODIUM');
  } finally {
    hostSocket.disconnect();
    playerSocket.disconnect();
    io.close();
    await new Promise((resolve) => server.close(resolve));
    deleteQuiz('quiz_single_question');
  }
});
