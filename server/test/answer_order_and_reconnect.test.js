import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO } from 'socket.io-client';
import { GameManager } from '../gameManager.js';
import { initStorage, saveQuiz, deleteQuiz } from '../storage.js';

test('Bug 1: Shuffled option order with colorIndex is preserved on client reveal', async () => {
  initStorage();
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server);
  const gm = new GameManager(io);

  const testQuiz = {
    id: 'quiz_shuffle_test',
    title: 'Shuffle Test Quiz',
    questions: [
      {
        id: 'q1',
        type: 'quiz',
        title: 'Shuffled Question',
        timeLimit: 10,
        options: [
          { id: 'opt_1', text: 'Option 1', isCorrect: false },
          { id: 'opt_2', text: 'Option 2', isCorrect: true },
          { id: 'opt_3', text: 'Option 3', isCorrect: false },
          { id: 'opt_4', text: 'Option 4', isCorrect: false },
        ],
      },
    ],
  };
  saveQuiz(testQuiz);

  io.on('connection', (socket) => {
    socket.on('player_join', (data) => {
      const res = gm.joinPlayer(data.pin, data.nickname, data.userUuid, socket.id);
      socket.emit('join_success', res);
    });
    socket.on('player_submit_answer', (data) => {
      const res = gm.submitAnswer(data.pin, data.userUuid, data.answerPayload);
      socket.emit('answer_submitted_ack', res);
    });
  });

  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const url = `http://localhost:${port}`;

  const hostSocket = ClientIO(url);
  const playerSocket = ClientIO(url);
  await Promise.all([
    new Promise((res) => hostSocket.on('connect', res)),
    new Promise((res) => playerSocket.on('connect', res)),
  ]);

  try {
    const game = await gm.createGame('quiz_shuffle_test', hostSocket.id);
    game.settings.randomizeAnswers = true;

    // Player joins
    const joinPromise = new Promise((res) => playerSocket.on('join_success', res));
    playerSocket.emit('player_join', { pin: game.pin, nickname: 'Alice', userUuid: 'uuid_alice' });
    await joinPromise;

    // Transition to QUESTION_ACTIVE
    const activePromise = new Promise((res) => playerSocket.on('question_active', res));
    game.currentQuestionIndex = 0;
    gm.transitionToQuestionActive(game);
    const activePayload = await activePromise;

    // Verify options are shuffled and have colorIndex
    assert.strictEqual(activePayload.question.options.length, 4);
    assert.ok(game.currentQuestionOptions);
    assert.strictEqual(game.currentQuestionOptions.length, 4);

    // Player submits answer
    const feedbackPromise = new Promise((res) => playerSocket.on('player_feedback', res));
    playerSocket.emit('player_submit_answer', {
      pin: game.pin,
      userUuid: 'uuid_alice',
      answerPayload: { selected: 'opt_2' },
    });

    const feedback = await feedbackPromise;
    // Verify that feedback.options matches the exact active shuffled options and has colorIndex!
    assert.strictEqual(feedback.options.length, 4);
    assert.strictEqual(feedback.options[0].id, game.currentQuestionOptions[0].id);
    assert.strictEqual(feedback.options[1].id, game.currentQuestionOptions[1].id);
    assert.strictEqual(feedback.options[2].id, game.currentQuestionOptions[2].id);
    assert.strictEqual(feedback.options[3].id, game.currentQuestionOptions[3].id);
    assert.strictEqual(feedback.options[0].colorIndex, 0);
  } finally {
    hostSocket.disconnect();
    playerSocket.disconnect();
    io.close();
    await new Promise((res) => server.close(res));
    deleteQuiz('quiz_shuffle_test');
  }
});

test('Bug 2: Stale socket disconnect does not mark active player as disconnected and early reveal does not hang', async () => {
  initStorage();
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server);
  const gm = new GameManager(io);

  const testQuiz = {
    id: 'quiz_hang_test',
    title: 'Hang Test Quiz',
    questions: [
      {
        id: 'q1',
        type: 'quiz',
        title: 'Single Player Question',
        timeLimit: 20,
        options: [
          { id: 'opt_1', text: 'Option 1', isCorrect: true },
          { id: 'opt_2', text: 'Option 2', isCorrect: false },
        ],
      },
    ],
  };
  saveQuiz(testQuiz);

  io.on('connection', (socket) => {
    socket.on('player_join', (data) => {
      const res = gm.joinPlayer(data.pin, data.nickname, data.userUuid, socket.id);
      socket.emit('join_success', res);
    });
    socket.on('player_submit_answer', (data) => {
      const res = gm.submitAnswer(data.pin, data.userUuid, data.answerPayload);
      socket.emit('answer_submitted_ack', res);
    });
    socket.on('disconnect', () => {
      gm.handleDisconnect(socket.id);
    });
  });

  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const url = `http://localhost:${port}`;

  const hostSocket = ClientIO(url);
  const playerSocket1 = ClientIO(url);
  await Promise.all([
    new Promise((res) => hostSocket.on('connect', res)),
    new Promise((res) => playerSocket1.on('connect', res)),
  ]);

  try {
    const game = await gm.createGame('quiz_hang_test', hostSocket.id);

    // 1. Player joins on Socket 1
    const join1Promise = new Promise((res) => playerSocket1.on('join_success', res));
    playerSocket1.emit('player_join', { pin: game.pin, nickname: 'Bob', userUuid: 'uuid_bob' });
    await join1Promise;

    // 2. Player reconnects on Socket 2 (simulating tab refresh / QR scan)
    const playerSocket2 = ClientIO(url);
    await new Promise((res) => playerSocket2.on('connect', res));
    const join2Promise = new Promise((res) => playerSocket2.on('join_success', res));
    playerSocket2.emit('player_join', { pin: game.pin, nickname: 'Bob_Renamed', userUuid: 'uuid_bob' });
    await join2Promise;

    // Verify player is attached to socket 2
    const bobPlayer = game.players.get('uuid_bob');
    assert.strictEqual(bobPlayer.socketId, playerSocket2.id);
    assert.strictEqual(bobPlayer.nickname, 'Bob_Renamed');

    // 3. Socket 1 disconnects (e.g. background tab closed)
    playerSocket1.disconnect();
    await new Promise((res) => setTimeout(res, 50));

    // Stale socket 1 disconnect must NOT mark active player on socket 2 as disconnected!
    assert.strictEqual(bobPlayer.connected, true, 'Active player on socket 2 must remain connected');

    // 4. Start question
    game.currentQuestionIndex = 0;
    gm.transitionToQuestionActive(game);
    assert.strictEqual(game.state, 'QUESTION_ACTIVE');

    // 5. Submit answer on active Socket 2
    const ackPromise = new Promise((res) => playerSocket2.on('answer_submitted_ack', res));
    playerSocket2.emit('player_submit_answer', {
      pin: game.pin,
      userUuid: 'uuid_bob',
      answerPayload: { selected: 'opt_1' },
    });
    const ack = await ackPromise;
    assert.strictEqual(ack.success, true);

    // 6. Early reveal timer must fire in ~500ms instead of hanging for 20s!
    await new Promise((res) => setTimeout(res, 600));
    assert.strictEqual(game.state, 'QUESTION_REVEAL', 'Must immediately transition to reveal without hanging');

    playerSocket2.disconnect();
  } finally {
    hostSocket.disconnect();
    io.close();
    await new Promise((res) => server.close(res));
    deleteQuiz('quiz_hang_test');
  }
});
