import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO } from 'socket.io-client';

import { GameManager } from '../gameManager.js';
import { initStorage, saveQuiz, deleteQuiz } from '../storage.js';

test('Player session resumption when disconnected vs active nickname conflict', async () => {
  initStorage();

  const testQuiz = {
    id: 'quiz_resume_test',
    title: 'Resume Test Quiz',
    theme: 'standard',
    questions: [
      {
        id: 'q1',
        type: 'quiz',
        title: 'Q1',
        timeLimit: 20,
        points: 1000,
        options: [
          { id: 'opt_1', text: 'Yes', isCorrect: true },
          { id: 'opt_2', text: 'No', isCorrect: false },
        ],
      },
    ],
  };
  saveQuiz(testQuiz);

  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server);
  const gameManager = new GameManager(io);

  io.on('connection', (socket) => {
    socket.on('player_join', (data) => {
      const result = gameManager.joinPlayer(data.pin, data.nickname, data.userUuid, socket.id);
      if (result.success) {
        socket.emit('join_success', result);
      } else {
        socket.emit('join_error', result);
      }
    });

    socket.on('disconnect', () => {
      gameManager.handleDisconnect(socket.id);
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://localhost:${port}`;

  let client1;
  let client2;

  try {
    // Host creates game
    const game = await gameManager.createGame('quiz_resume_test', 'host_socket');
    const pin = game.pin;

    // 1. Client 1 connects with nickname "Alice"
    client1 = ClientIO(url);
    await new Promise((resolve) => client1.on('connect', resolve));

    const join1Promise = new Promise((resolve) => client1.once('join_success', resolve));
    client1.emit('player_join', { pin, nickname: 'Alice', userUuid: 'uuid_alice_1' });
    const join1 = await join1Promise;
    assert.strictEqual(join1.player.nickname, 'Alice');
    assert.strictEqual(game.players.size, 1);

    // 2. Client 2 tries to connect with "Alice" while Client 1 IS ACTIVELY CONNECTED
    client2 = ClientIO(url);
    await new Promise((resolve) => client2.on('connect', resolve));

    const conflictPromise = new Promise((resolve) => client2.once('join_error', resolve));
    client2.emit('player_join', { pin, nickname: 'Alice', userUuid: 'uuid_diff' });
    const conflict = await conflictPromise;
    assert.match(conflict.error, /already in use by an active player/i);
    assert.strictEqual(game.players.size, 1);

    // 3. Client 1 disconnects (e.g. browser tab closed, network drop)
    client1.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 4. Now Client 2 (or re-opened tab) connects with nickname "Alice"
    const resumePromise = new Promise((resolve) => client2.once('join_success', resolve));
    client2.emit('player_join', { pin, nickname: 'Alice' });
    const resumed = await resumePromise;
    assert.strictEqual(resumed.success, true);
    assert.strictEqual(resumed.player.nickname, 'Alice');
    // It should have resumed the EXACT SAME userUuid!
    assert.strictEqual(resumed.userUuid, 'uuid_alice_1');
    assert.strictEqual(game.players.size, 1);
  } finally {
    if (client1) client1.disconnect();
    if (client2) client2.disconnect();
    io.close();
    await new Promise((resolve) => server.close(resolve));
    deleteQuiz('quiz_resume_test');
  }
});
