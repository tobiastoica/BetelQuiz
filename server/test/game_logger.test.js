import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { GameManager } from '../gameManager.js';
import { GameLogger } from '../gameLogger.js';
import { saveQuiz, deleteQuiz } from '../storage.js';
import { GAME_LOGS_DIR } from '../config.js';

test('GameLogger: creates dedicated log file with quiz name, timestamp and pin', async () => {
  const dummyQuiz = {
    id: 'quiz-log-1',
    title: 'Test Session Quiz 2026',
    questions: [
      {
        id: 'q1',
        text: 'Sample Q1',
        type: 'quiz',
        timeLimit: 20,
        options: [
          { text: 'A', isCorrect: true },
          { text: 'B', isCorrect: false },
        ],
      },
    ],
  };

  const game = {
    pin: '778899',
    gameId: 'game-uuid-test-1',
    quiz: dummyQuiz,
    quizId: dummyQuiz.id,
  };

  const logger = new GameLogger(game);
  assert.ok(logger.filePath, 'Logger should have filePath');
  assert.ok(fs.existsSync(logger.filePath), 'Dedicated log file must exist on disk');

  // Check file naming format: <Title>_<Timestamp>_pin<PIN>.log
  assert.ok(logger.fileName.startsWith('Test_Session_Quiz_2026_'), 'File name must start with sanitized title');
  assert.ok(logger.fileName.endsWith('_pin778899.log'), 'File name must end with pin');

  // Verify header contents
  const initialContent = fs.readFileSync(logger.filePath, 'utf-8');
  assert.match(initialContent, /BETELQUIZ GAME SESSION LOG/);
  assert.match(initialContent, /Quiz Title:\s+Test Session Quiz 2026/);
  assert.match(initialContent, /Game PIN:\s+778899/);
  assert.match(initialContent, /Total Questions:\s+1/);
});

test('GameLogger: logs player connect, disconnect, avatar updates, answers and unusual requests', async () => {
  const dummyQuiz = {
    id: 'quiz-log-2',
    title: 'Daniel - Capitolul 1',
    questions: [
      {
        id: 'q1',
        text: 'What was Daniel\'s name?',
        type: 'quiz',
        timeLimit: 20,
        options: [
          { text: 'Beltesatar', isCorrect: true },
          { text: 'Nebucadnetar', isCorrect: false },
        ],
      },
    ],
  };

  const game = {
    pin: '123999',
    gameId: 'game-uuid-test-2',
    quiz: dummyQuiz,
    quizId: dummyQuiz.id,
  };

  const logger = new GameLogger(game);

  // Player connects
  const player = {
    userUuid: 'user-log-u1',
    nickname: 'Maria',
    avatar: '🌟',
    score: 0,
    streak: 0,
  };
  logger.playerConnected(player, false, 'socket-m1');

  // Player updates avatar
  logger.avatarUpdated(player.userUuid, player.nickname, '🚀');

  // Unusual request: sync
  logger.unusualRequest('PLAYER_REQUEST_SYNC', 'socket-m1', {
    userUuid: player.userUuid,
    nickname: player.nickname,
    gameState: 'QUESTION_ACTIVE',
    currentQuestionIndex: 0,
  });

  // Fallback triggered
  logger.fallbackTriggered('avatar_picker', { usedFallback: '🦊' });

  // Answer submitted
  const scoreResult = {
    isCorrect: true,
    isPartial: false,
    points: 950,
  };
  player.score = 950;
  player.streak = 1;
  logger.answerSubmitted(player, 0, { selectedOptions: [0] }, scoreResult, 1200);

  // Exception
  logger.exception('test_context', new Error('Simulated socket failure'), { socketId: 'socket-m1' });

  // Player disconnects
  logger.playerDisconnected(player, 'socket-m1', 'client network timeout');

  // Game ended
  logger.gameEnded({
    totalPlayers: 1,
    totalQuestions: 1,
    podium: [{ rank: 1, nickname: 'Maria', score: 950 }],
  });

  const content = fs.readFileSync(logger.filePath, 'utf-8');
  assert.match(content, /\[PLAYER_CONNECT\] Player "Maria" \(user-log-u1\) joined via socket socket-m1/);
  assert.match(content, /\[AVATAR_UPDATED\] Player "Maria" \(user-log-u1\) changed avatar to 🚀/);
  assert.match(content, /\[UNUSUAL_REQUEST\] Unusual or fallback request: PLAYER_REQUEST_SYNC from socket socket-m1/);
  assert.match(content, /\[FALLBACK_TRIGGERED\] Fallback triggered in avatar_picker/);
  assert.match(content, /\[ANSWER_SUBMITTED\] Player "Maria" \(user-log-u1\) answered Q#1 \(1200ms\) -> CORRECT \(\+950 pts\)/);
  assert.match(content, /\[EXCEPTION\] Exception in test_context: Simulated socket failure/);
  assert.match(content, /\[PLAYER_DISCONNECT\] Player "Maria" \(user-log-u1\) disconnected from socket socket-m1/);
  assert.match(content, /GAME SESSION CONCLUDED/);
  assert.match(content, /Total Final Players:\s+1/);
});

test('GameManager: automatically creates game.logger and records live session transitions', async () => {
  const ioMock = {
    to: () => ({ emit: () => {} }),
    emit: () => {},
  };
  const gm = new GameManager(ioMock);

  const testQuiz = {
    id: 'quiz_gm_log',
    title: 'Live Engine Log Test',
    questions: [
      {
        id: 'q1',
        text: 'Live question 1',
        type: 'quiz',
        timeLimit: 10,
        options: [
          { text: 'Correct A', isCorrect: true },
          { text: 'Incorrect B', isCorrect: false },
        ],
      },
    ],
  };

  saveQuiz(testQuiz);
  try {
    const game = gm.createGame(testQuiz.id);
    assert.ok(game.logger, 'Game should have logger attached on creation');
    assert.ok(fs.existsSync(game.logger.filePath), 'Log file should be created immediately on createGame');

  // Join a player
  const joinResult = gm.joinPlayer(game.pin, 'Tester', 'user-test-uuid', 'sock-test-1', '🦊');
  assert.ok(joinResult.success);

  // Start game (transitions LOBBY -> GET_READY, questionIndex 0)
  const started = gm.startGame(game.pin);
  assert.ok(started);

  // Transition to QUESTION_ACTIVE
  gm.transitionToQuestionActive(game);

  // Submit answer
  const answerRes = gm.submitAnswer(game.pin, 'user-test-uuid', {
    selectedOptions: [0],
  });
  assert.ok(answerRes.success);

  // Transition to reveal
  gm.transitionToQuestionReveal(game);

  // End game
  gm.endGame(game.pin);

  const logContent = fs.readFileSync(game.logger.filePath, 'utf-8');
  assert.match(logContent, /Live_Engine_Log_Test/);
  assert.match(logContent, /\[PLAYER_CONNECT\] Player "Tester"/);
  assert.match(logContent, /\[STATE_TRANSITION\] Game state changed: LOBBY -> GET_READY/);
  assert.match(logContent, /\[STATE_TRANSITION\] Game state changed: GET_READY -> QUESTION_ACTIVE/);
  assert.match(logContent, /\[ANSWER_SUBMITTED\] Player "Tester"/);
  assert.match(logContent, /\[STATE_TRANSITION\] Game state changed: QUESTION_ACTIVE -> QUESTION_REVEAL/);
  assert.match(logContent, /GAME SESSION CONCLUDED/);
  } finally {
    deleteQuiz(testQuiz.id);
  }
});
