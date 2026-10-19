import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { rankPlayers, toPublicPlayer } from '../ranking.js';
import { generateGameReport } from '../reportsManager.js';
import { GameManager, prepareQuiz } from '../gameManager.js';
import { calculateQuestionScore } from '../scoring.js';
import { parseKahootCsv } from '../quizBridge.js';
import { isValidId, readJsonDir } from '../fsUtils.js';

test('Bug 1: rankPlayers strictly expects Map container', () => {
  // Test 1: Map input
  const map = new Map();
  map.set('u1', { userUuid: 'u1', nickname: 'Alice', avatar: '🦊', score: 100, streak: 2, connected: true });
  map.set('u2', { userUuid: 'u2', nickname: 'Bob', avatar: '🐼', score: 500, streak: 5, connected: false });
  map.set('u3', { userUuid: 'u3', nickname: 'Charlie', avatar: '🦁', score: undefined, streak: 0 });

  const rankedFromMap = rankPlayers(map);
  assert.equal(rankedFromMap.length, 3);
  assert.equal(rankedFromMap[0].nickname, 'Bob');
  assert.equal(rankedFromMap[0].score, 500);
  assert.equal(rankedFromMap[0].rank, 1);
  assert.equal(rankedFromMap[1].nickname, 'Alice');
  assert.equal(rankedFromMap[1].score, 100);
  assert.equal(rankedFromMap[1].rank, 2);
  assert.equal(rankedFromMap[2].nickname, 'Charlie');
  assert.equal(rankedFromMap[2].score, 0);
  assert.equal(rankedFromMap[2].rank, 3);

  // Test 2: Non-Map inputs safely return empty array per requirement 8
  assert.deepEqual(rankPlayers(map.values()), []);
  assert.deepEqual(rankPlayers([]), []);
  assert.deepEqual(rankPlayers(null), []);
  assert.deepEqual(rankPlayers(undefined), []);
});

test('Bug 2 & 5: Unplayed questions sliced and totalQuestions adjusted on early termination in GET_READY', () => {
  const mockQuiz = {
    id: 'quiz-1',
    title: 'Test Quiz',
    questions: [
      { id: 'q1', type: 'quiz', title: 'Q1', options: [{ id: 'o1', text: 'A', isCorrect: true }] },
      { id: 'q2', type: 'quiz', title: 'Q2', options: [{ id: 'o1', text: 'B', isCorrect: true }] },
      { id: 'q3', type: 'quiz', title: 'Q3', options: [{ id: 'o1', text: 'C', isCorrect: true }] },
      { id: 'q4', type: 'quiz', title: 'Q4', options: [{ id: 'o1', text: 'D', isCorrect: true }] },
    ],
  };

  // Terminated in GET_READY at index 2 (questions 0 and 1 played, question 2 upcoming)
  const mockGameGetReady = {
    gameId: 'game-gr',
    pin: '123456',
    state: 'PODIUM',
    prevState: 'GET_READY',
    currentQuestionIndex: 2,
    quiz: mockQuiz,
    players: new Map([
      ['u1', { userUuid: 'u1', nickname: 'Alice', score: 100, streak: 1, connected: true }],
    ]),
    answers: new Map([
      [0, new Map([['u1', { answerPayload: 'o1', responseTimeMs: 1000 }]])],
      [1, new Map([['u1', { answerPayload: 'o1', responseTimeMs: 1200 }]])],
    ]),
  };

  const report = generateGameReport(mockGameGetReady);
  assert.equal(report.totalQuestions, 2);
  assert.equal(report.questionAnalytics.length, 2);
  assert.equal(report.questionAnalytics[0].questionId, 'q1');
  assert.equal(report.questionAnalytics[1].questionId, 'q2');

  // Terminated in GET_READY at index 0 (0 questions played)
  const mockGameZero = {
    gameId: 'game-gr-0',
    pin: '123457',
    state: 'PODIUM',
    prevState: 'GET_READY',
    currentQuestionIndex: 0,
    quiz: mockQuiz,
    players: new Map(),
    answers: new Map(),
  };
  const reportZero = generateGameReport(mockGameZero);
  assert.equal(reportZero.totalQuestions, 0);
  assert.equal(reportZero.questionAnalytics.length, 0);
});

test('Bug 3: Active question answers scored on early transitionToPodium', () => {
  const mockIo = {
    to: () => ({ emit: () => {} }),
    sockets: { sockets: new Map() },
  };
  const gm = new GameManager(mockIo);

  const game = {
    pin: '999999',
    gameId: 'test-g3',
    state: 'QUESTION_ACTIVE',
    currentQuestionIndex: 0,
    quiz: {
      id: 'quiz-g3',
      title: 'Scoring Quiz',
      questions: [
        {
          id: 'q1',
          type: 'quiz',
          title: 'Q1',
          points: 1000,
          timeLimit: 20,
          options: [
            { id: 'opt_correct', text: 'Correct', isCorrect: true },
            { id: 'opt_wrong', text: 'Wrong', isCorrect: false },
          ],
        },
      ],
    },
    players: new Map([
      ['p1', { userUuid: 'p1', nickname: 'Alice', score: 0, streak: 0, connected: true, socketId: 's1' }],
    ]),
    answers: new Map([
      [0, new Map([['p1', { answerPayload: { selected: 'opt_correct' }, responseTimeMs: 2000 }]])],
    ]),
    settings: {},
  };
  gm.games.set(game.pin, game);

  gm.transitionToPodium(game);
  assert.equal(game.state, 'PODIUM');
  const alice = game.players.get('p1');
  assert.ok(alice.score > 0, `Expected Alice score to be > 0, got ${alice.score}`);
  assert.equal(alice.streak, 1);
});

test('Bug 6: getPlayerResumeEvents returns game_state_changed when in QUESTION_REVEAL without prior feedback', () => {
  const gm = new GameManager({ to: () => ({ emit: () => {} }) });
  const game = {
    state: 'QUESTION_REVEAL',
    lastPlayerResults: new Map(),
  };

  const events = gm.getPlayerResumeEvents(game, 'unseen_player');
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'game_state_changed');
  assert.deepEqual(events[0][1], { state: 'QUESTION_REVEAL' });
});

test('Bug 8: kickPlayer in QUESTION_ACTIVE triggers scheduleReveal when remaining players answered', () => {
  let scheduledMs = null;
  const mockIo = {
    to: () => ({ emit: () => {} }),
    sockets: { sockets: new Map() },
  };
  const gm = new GameManager(mockIo);
  gm.scheduleReveal = (game, ms) => {
    scheduledMs = ms;
  };

  const game = {
    pin: '888888',
    state: 'QUESTION_ACTIVE',
    currentQuestionIndex: 0,
    players: new Map([
      ['p1', { userUuid: 'p1', nickname: 'Alice', connected: true, socketId: 's1' }],
      ['p2', { userUuid: 'p2', nickname: 'AFK', connected: true, socketId: 's2' }],
    ]),
    answers: new Map([
      [0, new Map([['p1', { answerPayload: 'opt1' }]])],
    ]),
  };
  gm.games.set(game.pin, game);
  gm.socketToGame.set('s2', { pin: game.pin, role: 'player', userUuid: 'p2' });

  // P1 answered, P2 did not. Kicking P2 should immediately schedule reveal
  const kicked = gm.kickPlayer(game.pin, 'p2');
  assert.equal(kicked, true);
  assert.equal(game.players.has('p2'), false);
  assert.equal(scheduledMs, 500);
});

test('Bug 9: handleDisconnect deletes socket from socketToGame', () => {
  const gm = new GameManager({ to: () => ({ emit: () => {} }) });
  const socketId = 'sock_123';
  gm.socketToGame.set(socketId, { pin: '111222', role: 'player', userUuid: 'u1' });
  const game = {
    pin: '111222',
    players: new Map([['u1', { userUuid: 'u1', socketId, connected: true }]]),
    state: 'LOBBY',
  };
  gm.games.set('111222', game);

  assert.equal(gm.socketToGame.has(socketId), true);
  gm.handleDisconnect(socketId);
  assert.equal(gm.socketToGame.has(socketId), false);
});

test('Edge cases: kickPlayer in LOBBY does not trigger scheduleReveal', () => {
  let scheduledMs = null;
  const gm = new GameManager({ to: () => ({ emit: () => {} }) });
  gm.scheduleReveal = (game, ms) => {
    scheduledMs = ms;
  };

  const game = {
    pin: '777777',
    state: 'LOBBY',
    players: new Map([
      ['p1', { userUuid: 'p1', nickname: 'Alice', connected: true }],
    ]),
  };
  gm.games.set(game.pin, game);

  const kicked = gm.kickPlayer(game.pin, 'p1');
  assert.equal(kicked, true);
  assert.equal(scheduledMs, null);
});

test('Edge cases: transitionToPodium from SCOREBOARD does not double-score', () => {
  const gm = new GameManager({ to: () => ({ emit: () => {} }) });
  const game = {
    pin: '555555',
    gameId: 'test-sb',
    state: 'SCOREBOARD',
    currentQuestionIndex: 0,
    quiz: {
      id: 'quiz-sb',
      title: 'SB Quiz',
      questions: [{ id: 'q1', type: 'quiz', title: 'Q1', points: 1000 }],
    },
    players: new Map([
      ['p1', { userUuid: 'p1', nickname: 'Alice', score: 950, streak: 1, connected: true }],
    ]),
    answers: new Map(),
    settings: {},
  };
  gm.games.set(game.pin, game);

  gm.transitionToPodium(game);
  assert.equal(game.state, 'PODIUM');
  // Score should remain 950, not altered
  assert.equal(game.players.get('p1').score, 950);
});

test('Bug 1 Extended: rankPlayers rejects non-Map plain Object and null entries', () => {
  const obj = {
    u1: { userUuid: 'u1', nickname: 'Alice', score: 100 },
    u2: { userUuid: 'u2', nickname: 'Bob', score: 400 },
  };
  assert.deepEqual(rankPlayers(obj), []);
  assert.deepEqual(rankPlayers([null, { userUuid: 'u1', nickname: 'Alice', score: 50 }, undefined]), []);

  // toPublicPlayer with null
  const pubNull = toPublicPlayer(null);
  assert.equal(pubNull.score, 0);
  assert.equal(pubNull.streak, 0);
  assert.equal(pubNull.connected, false);
});

test('Bug 2 Extended: generateGameReport handles undefined currentQuestionIndex and Map players', () => {
  const mockQuiz = {
    id: 'quiz-ext',
    title: 'Ext Quiz',
    questions: [
      { id: 'q1', type: 'quiz', title: 'Q1', options: [{ id: 'o1', text: 'A', isCorrect: true }] },
    ],
  };

  const gameWithMapPlayers = {
    gameId: 'game-arr',
    pin: '222333',
    quiz: mockQuiz,
    players: new Map([
      ['p1', { userUuid: 'p1', nickname: 'ArrPlayer', score: 500, streak: 1, connected: true }],
    ]),
    answers: new Map([
      [0, new Map([['p1', { answerPayload: 'o1', responseTimeMs: 1000 }]])],
    ]),
  };

  const report = generateGameReport(gameWithMapPlayers);
  assert.ok(report);
  assert.equal(report.totalPlayers, 1);
  assert.equal(report.totalQuestions, 1);
  assert.equal(report.questionAnalytics.length, 1);
  assert.equal(report.questionAnalytics[0].correctCount, 1);
});

test('Bug 8 Extended: kickPlayer in QUESTION_ACTIVE when remaining players NOT answered does not trigger scheduleReveal', () => {
  let scheduledMs = null;
  const gm = new GameManager({ to: () => ({ emit: () => {} }) });
  gm.scheduleReveal = (game, ms) => {
    scheduledMs = ms;
  };

  const game = {
    pin: '444555',
    state: 'QUESTION_ACTIVE',
    currentQuestionIndex: 0,
    players: new Map([
      ['p1', { userUuid: 'p1', nickname: 'Alice', connected: true, socketId: 's1' }],
      ['p2', { userUuid: 'p2', nickname: 'Bob', connected: true, socketId: 's2' }],
      ['p3', { userUuid: 'p3', nickname: 'AFK', connected: true, socketId: 's3' }],
    ]),
    answers: new Map([
      [0, new Map([['p1', { answerPayload: 'opt1' }]])],
    ]),
  };
  gm.games.set(game.pin, game);

  // Alice answered, Bob and AFK have not. Kicking AFK leaves Bob who has not answered yet
  const kicked = gm.kickPlayer(game.pin, 'p3');
  assert.equal(kicked, true);
  assert.equal(scheduledMs, null);
});

// ============================================================================
// Cycle 2 Audit Fixes Tests
// ============================================================================

test('Cycle 2 Bug 1: word_guess multi-word mode does not penalize players on case-insensitive duplicate targets', () => {
  // Case 1: Array with duplicate answers in different casing and blank entry
  const questionWithDups = {
    type: 'word_guess',
    points: 1000,
    timeLimit: 20,
    allowMultipleAnswers: true,
    acceptedAnswers: ['Paris', 'paris', 'PARIS', 'Rome', 'rome', '   '],
    caseSensitive: false,
    fuzzyMatching: false,
  };

  // Player enters the 2 distinct targets: 'Paris' and 'Rome'
  const resultAllDistinct = calculateQuestionScore(
    questionWithDups,
    { words: ['paris', 'rome'] },
    0 // instant response
  );

  assert.equal(resultAllDistinct.isCorrect, true);
  assert.equal(resultAllDistinct.isExact, true);
  assert.equal(resultAllDistinct.accuracy, 1);
  assert.equal(resultAllDistinct.points, 1000);

  // Partial answer: only 1 out of 2 distinct answers entered
  const resultPartial = calculateQuestionScore(
    questionWithDups,
    { words: ['paris'] },
    0
  );
  assert.equal(resultPartial.isCorrect, true);
  assert.equal(resultPartial.isExact, false);
  assert.equal(resultPartial.isPartial, true);
  assert.equal(resultPartial.accuracy, 0.5);
  assert.equal(resultPartial.points, 500);

  // Case 2: String with comma/newline separated duplicates
  const questionWithStringDups = {
    type: 'word_guess',
    points: 800,
    timeLimit: 20,
    allowMultipleAnswers: true,
    acceptedAnswers: 'Mercury, mercury, Venus\nvenus, Mars',
    caseSensitive: false,
    fuzzyMatching: false,
  };

  const resultThree = calculateQuestionScore(
    questionWithStringDups,
    { words: ['mercury', 'venus', 'mars'] },
    0
  );
  assert.equal(resultThree.isExact, true);
  assert.equal(resultThree.accuracy, 1);
  assert.equal(resultThree.points, 800);
});

test('Cycle 2 Bug 2: parseKahootCsv dynamically locates header row across leading banner and instruction rows', () => {
  // CSV with 2 leading non-header rows (banner title, author / instructions)
  const csvWithLeadingBanner = [
    'BetelQuiz Export Template,,,,,',
    'Instructions: Do not modify structure of columns,,,,,',
    'Question,Answer 1,Answer 2,Answer 3,Answer 4,Time limit (sec),Correct answer(s)',
    'What is the speed of light?,300000 km/s,150000 km/s,500000 km/s,1000 km/s,30,1',
    'Which planet is known as the Red Planet?,Mars,Jupiter,Saturn,Venus,20,1',
  ].join('\n');

  const quiz = parseKahootCsv(csvWithLeadingBanner, 'Banner Test Quiz');
  assert.equal(quiz.title, 'Banner Test Quiz');
  // Must NOT include the header as a question! Exactly 2 questions.
  assert.equal(quiz.questions.length, 2);
  assert.equal(quiz.questions[0].title, 'What is the speed of light?');
  assert.equal(quiz.questions[0].options.length, 4);
  assert.equal(quiz.questions[0].options[0].text, '300000 km/s');
  assert.equal(quiz.questions[0].options[0].isCorrect, true);
  assert.equal(quiz.questions[1].title, 'Which planet is known as the Red Planet?');
  assert.equal(quiz.questions[1].options[0].text, 'Mars');
  assert.equal(quiz.questions[1].options[0].isCorrect, true);

  // Standard CSV with header on row 0 still works cleanly
  const standardCsv = [
    'Question,Answer 1,Answer 2,Time limit,Correct answer(s)',
    'Is water wet?,Yes,No,10,1',
  ].join('\n');
  const quizStandard = parseKahootCsv(standardCsv);
  assert.equal(quizStandard.questions.length, 1);
  assert.equal(quizStandard.questions[0].title, 'Is water wet?');
});

test('Cycle 2 Bug 3: prepareQuiz strips empty options for choice questions without affecting puzzle items', () => {
  const rawQuiz = {
    id: 'quiz-opt-test',
    title: 'Option Pruning Quiz',
    defaultTimeLimit: 25,
    defaultPoints: 1200,
    questions: [
      {
        id: 'q1',
        type: 'quiz',
        title: 'Quiz Question With 2 Empty Options',
        options: [
          { id: 'opt_1', text: 'Real Option 1', isCorrect: true },
          { id: 'opt_2', text: 'Real Option 2', isCorrect: false },
          { id: 'opt_3', text: '', isCorrect: false },
          { id: 'opt_4', text: '   ', isCorrect: false },
        ],
      },
      {
        id: 'q2',
        type: 'true_false',
        title: 'True/False Question with blank slots',
        options: [
          { id: 'opt_1', text: 'True', isCorrect: true },
          { id: 'opt_2', text: 'False', isCorrect: false },
          { id: 'opt_3', text: '', isCorrect: false },
        ],
      },
      {
        id: 'q3',
        type: 'yes_no',
        title: 'Yes/No Question',
        options: [
          { id: 'opt_1', text: 'Yes', isCorrect: false },
          { id: 'opt_2', text: 'No', isCorrect: true },
          { id: 'opt_3', text: '   ', isCorrect: false },
        ],
      },
      {
        id: 'q4',
        type: 'picture_reveal',
        title: 'Picture Reveal Question',
        options: [
          { id: 'opt_1', text: 'Dog', isCorrect: true },
          { id: 'opt_2', text: 'Cat', isCorrect: false },
          { id: 'opt_3', text: '', isCorrect: false },
        ],
      },
      {
        id: 'q5',
        type: 'puzzle',
        title: 'Puzzle Question',
        options: [
          { id: 'p1', text: 'Step 1' },
          { id: 'p2', text: 'Step 2' },
          { id: 'p3', text: 'Step 3' },
        ],
      },
    ],
  };

  const prepared = prepareQuiz(rawQuiz);
  assert.ok(prepared);

  // q1 (quiz) has only 2 non-empty options
  assert.equal(prepared.questions[0].options.length, 2);
  assert.equal(prepared.questions[0].options[0].text, 'Real Option 1');
  assert.equal(prepared.questions[0].options[1].text, 'Real Option 2');

  // q2 (true_false) has only 2 options
  assert.equal(prepared.questions[1].options.length, 2);
  assert.equal(prepared.questions[1].options[0].text, 'True');
  assert.equal(prepared.questions[1].options[1].text, 'False');

  // q3 (yes_no) has only 2 options
  assert.equal(prepared.questions[2].options.length, 2);

  // q4 (picture_reveal) has only 2 options
  assert.equal(prepared.questions[3].options.length, 2);

  // q5 (puzzle) has all 3 options with order preserved
  assert.equal(prepared.questions[4].options.length, 3);
  assert.equal(prepared.questions[4].options[0].order, 0);
  assert.equal(prepared.questions[4].options[1].order, 1);
  assert.equal(prepared.questions[4].options[2].order, 2);

  // Defaults applied
  assert.equal(prepared.questions[0].timeLimit, 25);
  assert.equal(prepared.questions[0].points, 1200);
});

test('Cycle 2 Bug 4: applyQuestionScores and transitionToQuestionReveal guard against null currentQuestion', () => {
  const mockIo = {
    to: () => ({ emit: () => {} }),
    sockets: { sockets: new Map() },
  };
  const gm = new GameManager(mockIo);

  // Game with out-of-bounds currentQuestionIndex
  const gameOutOfBounds = {
    pin: '654321',
    gameId: 'game-oob',
    state: 'QUESTION_ACTIVE',
    currentQuestionIndex: 999, // Out of bounds -> this.currentQuestion returns undefined/null
    quiz: {
      id: 'quiz-empty',
      title: 'Empty/Short Quiz',
      questions: [],
    },
    players: new Map([
      ['u1', { userUuid: 'u1', nickname: 'Alice', score: 100, streak: 1 }],
    ]),
    answers: new Map(),
    settings: {},
  };
  gm.games.set(gameOutOfBounds.pin, gameOutOfBounds);

  // applyQuestionScores should not throw TypeError and return an empty map
  assert.doesNotThrow(() => {
    const results = gm.applyQuestionScores(gameOutOfBounds);
    assert.ok(results instanceof Map);
    assert.equal(results.size, 0);
  });

  // transitionToQuestionReveal when currentQuestion is null should transition to PODIUM without crashing
  const gameRevealNull = {
    pin: '654322',
    gameId: 'game-rev-null',
    state: 'QUESTION_ACTIVE',
    currentQuestionIndex: 5,
    quiz: {
      id: 'quiz-short',
      title: 'Short Quiz',
      questions: [{ id: 'q1', type: 'quiz', title: 'Q1' }],
    },
    players: new Map(),
    answers: new Map(),
    settings: {},
  };
  gm.games.set(gameRevealNull.pin, gameRevealNull);

  assert.doesNotThrow(() => {
    gm.transitionToQuestionReveal(gameRevealNull);
  });
  // Should have transitioned to PODIUM
  assert.equal(gameRevealNull.state, 'PODIUM');
});

test('Cycle 2 Bug 5: Cookie validation rejects malformed or non-UUID tokens and issues valid UUID', () => {
  // Test isValidId function
  assert.equal(isValidId('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isValidId('valid_user_uuid-1234'), true);
  assert.equal(isValidId('../../../etc/passwd'), false);
  assert.equal(isValidId('user; injection="true"'), false);
  assert.equal(isValidId('malformed user uuid with spaces'), false);
  assert.equal(isValidId('{"cookie": "hack"}'), false);
  assert.equal(isValidId(''), false);
  assert.equal(isValidId(null), false);
  assert.equal(isValidId(undefined), false);
  assert.equal(isValidId(12345), false);

  // Test simulated cookie middleware behavior matching server/index.js:47-60
  function runCookieMiddleware(req, res) {
    let userUuid = req.cookies?.betelquiz_user_uuid;
    if (!userUuid || !isValidId(userUuid)) {
      userUuid = uuidv4();
      res.cookie('betelquiz_user_uuid', userUuid, {
        maxAge: 10 * 365 * 24 * 60 * 60 * 1000,
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
      });
    }
    req.userUuid = userUuid;
  }

  // Case 1: Valid existing UUID cookie
  const validReq = { cookies: { betelquiz_user_uuid: 'c72f7d6a-5437-4d69-a1b7-d1a1b15c9a4e' } };
  let cookieSet = null;
  const validRes = {
    cookie: (name, val, opts) => {
      cookieSet = { name, val, opts };
    },
  };
  runCookieMiddleware(validReq, validRes);
  assert.equal(validReq.userUuid, 'c72f7d6a-5437-4d69-a1b7-d1a1b15c9a4e');
  assert.equal(cookieSet, null); // No new cookie set

  // Case 2: Malformed cookie with directory traversal attack
  const malformedReq = { cookies: { betelquiz_user_uuid: '../../malicious/path' } };
  let malformedCookieSet = null;
  const malformedRes = {
    cookie: (name, val, opts) => {
      malformedCookieSet = { name, val, opts };
    },
  };
  runCookieMiddleware(malformedReq, malformedRes);
  assert.notEqual(malformedReq.userUuid, '../../malicious/path');
  assert.equal(isValidId(malformedReq.userUuid), true);
  assert.ok(malformedCookieSet);
  assert.equal(malformedCookieSet.name, 'betelquiz_user_uuid');
  assert.equal(malformedCookieSet.val, malformedReq.userUuid);
  assert.equal(malformedCookieSet.opts.sameSite, 'lax');

  // Case 3: Empty / missing cookie
  const emptyReq = { cookies: {} };
  let emptyCookieSet = null;
  const emptyRes = {
    cookie: (name, val, opts) => {
      emptyCookieSet = { name, val, opts };
    },
  };
  runCookieMiddleware(emptyReq, emptyRes);
  assert.ok(emptyReq.userUuid);
  assert.equal(isValidId(emptyReq.userUuid), true);
  assert.ok(emptyCookieSet);
});

test('Cycle 2 Edge Cases: Boundary conditions and robust error handling', () => {
  // Edge 1: word_guess where all accepted answers are identical casing variants
  const allDupQuestion = {
    type: 'word_guess',
    points: 1000,
    timeLimit: 20,
    allowMultipleAnswers: true,
    acceptedAnswers: ['Sample', 'sample', 'SAMPLE'],
    caseSensitive: false,
  };
  const resAllDup = calculateQuestionScore(allDupQuestion, { answers: ['sample'] }, 0);
  assert.equal(resAllDup.isExact, true);
  assert.equal(resAllDup.accuracy, 1);
  assert.equal(resAllDup.points, 1000);

  // Edge 2: prepareQuiz on null or empty quiz
  assert.equal(prepareQuiz(null), null);
  const emptyQuizPrepared = prepareQuiz({ questions: [] });
  assert.deepEqual(emptyQuizPrepared.questions, []);

  // Edge 3: prepareQuiz question with null options or no options
  const quizNoOpts = prepareQuiz({
    questions: [
      { id: 'q1', type: 'quiz', options: null },
      { id: 'q2', type: 'quiz' },
    ],
  });
  assert.equal(quizNoOpts.questions[0].options, null);
  assert.equal(quizNoOpts.questions[1].options, undefined);

  // Edge 4: parseKahootCsv with spaced headers and blank lines before header
  const csvSpacedHeader = [
    '   ',
    'Banner Header Row, , , ,',
    '   ',
    'Question , Answer 1 , Answer 2 , Time limit , Correct answer(s)',
    'Sky color?,Blue,Red,20,1',
  ].join('\n');
  const parsedSpaced = parseKahootCsv(csvSpacedHeader);
  assert.equal(parsedSpaced.questions.length, 1);
  assert.equal(parsedSpaced.questions[0].title, 'Sky color?');

  // Edge 5: isValidId edge cases
  assert.equal(isValidId('__proto__'), true); // \w allows underscore, safe identifier
  assert.equal(isValidId('<script>alert(1)</script>'), false);
  assert.equal(isValidId('user\nid'), false);
  assert.equal(isValidId('user\x00id'), false);
  assert.equal(isValidId('; DROP TABLE users;'), false);
  assert.equal(isValidId({}), false);
  assert.equal(isValidId([]), false);
  assert.equal(isValidId(true), false);
});

test('Cycle 2 Extended: Multi-column header detection with tricky banner title rows', () => {
  // Banner row specifically contains the word 'Question'
  const trickyCsv = [
    'Kahoot! Quiz Question Template - Official Version,,,,,,',
    'Instructions: Please do not modify the structure below,,,,,,',
    'Question,Answer 1,Answer 2,Answer 3,Answer 4,Time limit (sec),Correct answer(s)',
    'Capital of France?,Paris,London,Berlin,Rome,20,1',
    'Question,Answer 1,Answer 2,Answer 3,Answer 4,Time limit (sec),Correct answer(s)', // accidental repeated header
    'Largest ocean?,Pacific,Atlantic,Indian,Arctic,30,1',
  ].join('\n');

  const quiz = parseKahootCsv(trickyCsv, 'Tricky Header Quiz');
  assert.equal(quiz.title, 'Tricky Header Quiz');
  // Must have exactly 2 questions (the banner row and the repeated header row are ignored)
  assert.equal(quiz.questions.length, 2);
  assert.equal(quiz.questions[0].title, 'Capital of France?');
  assert.equal(quiz.questions[0].options[0].text, 'Paris');
  assert.equal(quiz.questions[0].options[0].isCorrect, true);
  assert.equal(quiz.questions[1].title, 'Largest ocean?');
  assert.equal(quiz.questions[1].options[0].text, 'Pacific');
  assert.equal(quiz.questions[1].options[0].isCorrect, true);
});

test('Cycle 2 Extended: getPlayerResumeEvents on PODIUM returns final_results cleanly', () => {
  const gm = new GameManager({ to: () => ({ emit: () => {} }) });
  const game = {
    state: 'PODIUM',
    players: new Map([
      ['p1', { userUuid: 'p1', nickname: 'Alice', score: 1000, streak: 3, connected: true }],
    ]),
  };

  const events = gm.getPlayerResumeEvents(game, 'p1');
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'final_results');
  assert.equal(events[0][1].rank, 1);
  assert.equal(events[0][1].totalScore, 1000);
});

test('Cycle 3: GameManager methods resolve interchangeably by 6-digit PIN and UUID gameId', () => {
  const mockIo = {
    to: () => ({ emit: () => {} }),
    sockets: { sockets: new Map() },
  };
  const gm = new GameManager(mockIo);
  const sampleQuiz = {
    id: 'quiz_cycle_3',
    title: 'Cycle 3 Quiz',
    questions: [
      {
        id: 'q1',
        type: 'quiz',
        title: 'Q1',
        timeLimit: 20,
        points: 1000,
        options: [
          { id: 'opt_1', text: 'Ans 1', isCorrect: true },
          { id: 'opt_2', text: 'Ans 2', isCorrect: false },
        ],
      },
    ],
  };

  const pin = '333444';
  const gameId = 'game-cycle-3-id';
  const game = {
    pin,
    gameId,
    hostSecret: 'secret_c3',
    quiz: sampleQuiz,
    quizId: sampleQuiz.id,
    state: 'LOBBY',
    currentQuestionIndex: -1,
    questionStartTime: 0,
    questionTimeLimit: 20,
    lastStateTransitionTime: Date.now(),
    lastHostTransitionTime: 0,
    resultsRecorded: false,
    players: new Map(),
    answers: new Map(),
    settings: { lockGame: false, showQuestionsOnPlayerScreens: true },
    currentQuestionOptions: null,
  };
  gm.games.set(pin, game);
  gm.gamesById.set(gameId, pin);

  // 1. joinPlayer with gameId instead of numeric PIN
  const joinResult = gm.joinPlayer(gameId, 'PlayerViaId', 'user_uuid_c3', 'sock_player_c3', '🦁');
  assert.equal(joinResult.success, true);
  assert.equal(joinResult.pin, pin);
  assert.equal(joinResult.gameId, gameId);
  // socketToGame must store canonical pin
  assert.equal(gm.socketToGame.get('sock_player_c3')?.pin, pin);

  // 2. updateSettings with gameId
  const settingsResult = gm.updateSettings(gameId, { lockGame: true });
  assert.equal(settingsResult, true);
  assert.equal(game.settings.lockGame, true);

  // 3. updatePlayerAvatar with gameId
  const avatarResult = gm.updatePlayerAvatar(gameId, 'user_uuid_c3', '🚀');
  assert.equal(avatarResult, true);
  assert.equal(game.players.get('user_uuid_c3').avatar, '🚀');

  // 4. handleHostNext with gameId (advance to GET_READY -> QUESTION_ACTIVE)
  gm.startGame(gameId); // LOBBY -> GET_READY
  assert.equal(game.state, 'GET_READY');
  const nextResult = gm.handleHostNext(gameId); // GET_READY -> QUESTION_ACTIVE
  assert.equal(nextResult, true);
  assert.equal(game.state, 'QUESTION_ACTIVE');

  // 5. submitAnswer with gameId
  const submitResult = gm.submitAnswer(gameId, 'user_uuid_c3', { selected: 'opt_1' });
  assert.equal(submitResult.success, true);
  assert.equal(game.answers.get(0)?.has('user_uuid_c3'), true);

  // 6. kickPlayer with gameId
  const kickResult = gm.kickPlayer(gameId, 'user_uuid_c3');
  assert.equal(kickResult, true);
  assert.equal(game.players.has('user_uuid_c3'), false);
});

test('Cycle 3: joinPlayer strictly forbids new joins to concluded PODIUM games', () => {
  const mockIo = {
    to: () => ({ emit: () => {} }),
    sockets: { sockets: new Map() },
  };
  const gm = new GameManager(mockIo);
  const pin = '444555';
  const gameId = 'game-cycle-3-podium';
  const game = {
    pin,
    gameId,
    state: 'PODIUM',
    players: new Map(),
    settings: { lockGame: false },
  };
  gm.games.set(pin, game);
  gm.gamesById.set(gameId, game);

  const res = gm.joinPlayer(game.pin, 'LatePlayer', 'late_uuid_123', 'sock_late');
  assert.equal(res.success, false);
  assert.equal(res.error, 'This game has already ended.');
  assert.equal(game.players.has('late_uuid_123'), false);
});

test('Cycle 3: generateGameReport rejects invalid or malformed gameId', () => {
  assert.equal(generateGameReport(null), null);
  assert.equal(generateGameReport({}), null);
  assert.equal(generateGameReport({ gameId: '' }), null);
  assert.equal(generateGameReport({ gameId: '../malicious_path' }), null);
  assert.equal(generateGameReport({ gameId: 'null\x00byte' }), null);
  assert.equal(generateGameReport({ gameId: 'valid-id-123' }) !== null, true);
});

test('Cycle 3: recordResults gracefully handles game with missing quiz metadata', () => {
  const mockIo = {
    to: () => ({ emit: () => {} }),
    sockets: { sockets: new Map() },
  };
  const gm = new GameManager(mockIo);
  const game = {
    pin: '999888',
    gameId: 'game_defensive_quiz',
    quiz: null, // missing quiz object
    players: new Map([
      ['p_safe', { userUuid: 'p_safe', nickname: 'SafePlayer', score: 500, streak: 1, connected: false }],
    ]),
    answers: new Map(),
    currentQuestionIndex: 0,
    resultsRecorded: false,
  };

  // Must not throw TypeError: Cannot read properties of undefined (reading 'title')
  assert.doesNotThrow(() => {
    gm.recordResults(game);
  });
  assert.equal(game.resultsRecorded, true);
});

test('Cycle 4: existing player reconnects to PODIUM game and receives final_results resume event', () => {
  const mockIo = {
    to: () => ({ emit: () => {} }),
    sockets: { sockets: new Map() },
  };
  const gm = new GameManager(mockIo);
  const pin = '555666';
  const gameId = 'game-cycle-4-podium';
  const playerUuid = 'player_podium_resume_1';
  const game = {
    pin,
    gameId,
    state: 'PODIUM',
    players: new Map([
      [playerUuid, { userUuid: playerUuid, nickname: 'PodiumChamp', score: 1500, streak: 3, connected: false, socketId: null, avatar: '👑' }],
    ]),
    settings: { lockGame: false },
  };
  gm.games.set(pin, game);
  gm.gamesById.set(gameId, pin);

  // 1. Existing player reconnects to PODIUM game
  const res = gm.joinPlayer(pin, 'PodiumChamp', playerUuid, 'sock_podium_reconnect', '👑');
  assert.equal(res.success, true);
  assert.equal(res.isReconnect, true);
  assert.equal(res.gameState, 'PODIUM');
  assert.equal(game.players.get(playerUuid).connected, true);
  assert.equal(game.players.get(playerUuid).socketId, 'sock_podium_reconnect');

  // 2. getPlayerResumeEvents returns final_results with rank and score
  const resumeEvents = gm.getPlayerResumeEvents(game, playerUuid);
  assert.equal(resumeEvents.length, 1);
  assert.equal(resumeEvents[0][0], 'final_results');
  assert.equal(resumeEvents[0][1].rank, 1);
  assert.equal(resumeEvents[0][1].totalScore, 1500);
  assert.equal(resumeEvents[0][1].isPodium, true);

  // 3. New player attempting to join same PODIUM game is still rejected
  const newPlayerRes = gm.joinPlayer(pin, 'BrandNewPlayer', 'brand_new_uuid_999', 'sock_new');
  assert.equal(newPlayerRes.success, false);
  assert.equal(newPlayerRes.error, 'This game has already ended.');
});

test('Cycle 5: readJsonDir safely ignores files containing null or primitive values without throwing', () => {
  const tmpDir = path.join(os.tmpdir(), `betelquiz_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(tmpDir, 'valid.json'), JSON.stringify({ id: 'valid_1', title: 'Valid Quiz' }));
    fs.writeFileSync(path.join(tmpDir, 'null.json'), 'null');
    fs.writeFileSync(path.join(tmpDir, 'primitive.json'), '12345');
    fs.writeFileSync(path.join(tmpDir, 'empty.json'), '');
    fs.writeFileSync(path.join(tmpDir, 'corrupt.json'), '{invalid json');

    const results = readJsonDir(tmpDir);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'valid_1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Cycle 6: handleHostNext and payload builders handle game with missing quiz metadata gracefully', () => {
  const mockIo = {
    to: () => ({ emit: () => {} }),
    sockets: { sockets: new Map() },
  };
  const gm = new GameManager(mockIo);
  const pin = '777888';
  const game = {
    pin,
    gameId: 'game_c6_defensive',
    state: 'GET_READY',
    currentQuestionIndex: 0,
    quiz: null, // missing quiz object
    players: new Map(),
    answers: new Map(),
    settings: { showQuestionsOnPlayerScreens: true },
    lastStateTransitionTime: Date.now(),
    lastHostTransitionTime: 0,
  };
  gm.games.set(pin, game);

  // 1. handleHostNext on GET_READY with quiz: null safely transitions to PODIUM without throwing TypeError
  const nextResult = gm.handleHostNext(pin);
  assert.equal(nextResult, true);
  assert.equal(game.state, 'PODIUM');

  // 2. getReadyPayload handles quiz: null
  const readyPayload = gm.getReadyPayload(game);
  assert.equal(readyPayload.questionInfo.total, 0);
  assert.equal(readyPayload.questionInfo.theme, 'spring');

  // 3. activePayload handles quiz: null (questionView returns null)
  const activePayload = gm.activePayload(game, 'player', []);
  assert.equal(activePayload.totalQuestions, 0);
  assert.equal(activePayload.question, null);
});

test('Cycle 7: getReadyPayload and getHostStateData output isMultiSelect and points for progressive Kahoot display', () => {
  const mockIo = {
    to: () => ({ emit: () => {} }),
    sockets: { sockets: new Map() },
  };
  const gm = new GameManager(mockIo);
  const pin = '888999';
  const game = {
    pin,
    gameId: 'game_c7_kahoot_reveal',
    state: 'GET_READY',
    currentQuestionIndex: 0,
    quiz: {
      id: 'quiz-c7',
      title: 'Progressive Reveal Quiz',
      questions: [
        {
          id: 'q1',
          type: 'quiz',
          title: 'Select multiple items',
          timeLimit: 30,
          points: 1500,
          isMultiSelect: true,
          options: [
            { id: 'opt1', text: 'Option A', isCorrect: true },
            { id: 'opt2', text: 'Option B', isCorrect: true },
          ],
        },
      ],
    },
    players: new Map(),
    answers: new Map(),
    settings: { showQuestionsOnPlayerScreens: true },
    lastStateTransitionTime: Date.now(),
    lastHostTransitionTime: 0,
  };
  gm.games.set(pin, game);

  // 1. Verify getReadyPayload
  const readyPayload = gm.getReadyPayload(game);
  assert.equal(readyPayload.state, 'GET_READY');
  assert.equal(readyPayload.questionInfo.isMultiSelect, true);
  assert.equal(readyPayload.questionInfo.points, 1500);
  assert.equal(readyPayload.questionInfo.type, 'quiz');

  // 2. Verify getHostStateData
  const hostData = gm.getHostStateData(pin);
  assert.equal(hostData.state, 'GET_READY');
  assert.equal(hostData.currentQuestion.isMultiSelect, true);
  assert.equal(hostData.currentQuestion.points, 1500);
  assert.equal(hostData.currentQuestion.timeLimit, 30);
});

test('Live Play Bug 1 Fix: Reconnecting socket does not emit player_kicked to same userUuid', () => {
  const kickedEvents = [];
  const mockIo = {
    to: (targetSocketId) => ({
      emit: (event, payload) => {
        if (event === 'player_kicked') {
          kickedEvents.push({ targetSocketId, payload });
        }
      },
    }),
    sockets: { sockets: new Map() },
  };
  const gm = new GameManager(mockIo);
  const pin = '999111';
  const game = {
    pin,
    gameId: 'game_reconnect_test',
    state: 'QUESTION_ACTIVE',
    players: new Map(),
    answers: new Map(),
    settings: {},
  };
  gm.games.set(pin, game);

  // Player joins initially
  const initialJoin = gm.joinPlayer(pin, 'Alice', 'user_uuid_alice', 'socket_old_1', '🐼');
  assert.equal(initialJoin.success, true);
  assert.equal(game.players.get('user_uuid_alice').socketId, 'socket_old_1');

  // Player reconnects from a new socket (e.g. mobile Safari wakes up or switches network)
  const reconnectJoin = gm.joinPlayer(pin, 'Alice', 'user_uuid_alice', 'socket_new_2', '🐼');
  assert.equal(reconnectJoin.success, true);
  assert.equal(reconnectJoin.isReconnect, true);
  assert.equal(game.players.get('user_uuid_alice').socketId, 'socket_new_2');

  // CRITICAL: Must NOT have emitted player_kicked!
  assert.equal(kickedEvents.length, 0);
  // Old socket mapping removed, new socket mapping registered
  assert.equal(gm.socketToGame.has('socket_old_1'), false);
  assert.equal(gm.socketToGame.get('socket_new_2')?.userUuid, 'user_uuid_alice');
});

test('Live Play Bug 2 Fix: prepareQuiz assigns deterministic immutable colorIndex preserved across shuffling and reveals', () => {
  const rawQuiz = {
    id: 'quiz_colors_test',
    title: 'Colors Test Quiz',
    questions: [
      {
        id: 'q1',
        type: 'quiz',
        title: 'Colors question',
        options: [
          { id: 'opt_a', text: 'Option A (red)' },
          { id: 'opt_b', text: 'Option B (blue)' },
          { id: 'opt_c', text: 'Option C (yellow)', isCorrect: true },
          { id: 'opt_d', text: 'Option D (green)' },
        ],
      },
    ],
  };

  const prepared = prepareQuiz(rawQuiz);
  const q = prepared.questions[0];
  assert.equal(q.options[0].colorIndex, 0);
  assert.equal(q.options[1].colorIndex, 1);
  assert.equal(q.options[2].colorIndex, 2);
  assert.equal(q.options[3].colorIndex, 3);

  // Verify that even if options are shuffled, each option retains its original colorIndex
  const shuffledOptions = [q.options[2], q.options[0], q.options[3], q.options[1]];
  assert.equal(shuffledOptions[0].id, 'opt_c');
  assert.equal(shuffledOptions[0].colorIndex, 2);
  assert.equal(shuffledOptions[1].id, 'opt_a');
  assert.equal(shuffledOptions[1].colorIndex, 0);
});

test('Live Play Bug 1 Fix: submitAnswer is idempotent and returns duplicate: true for already submitted answer', () => {
  const mockIo = { to: () => ({ emit: () => {} }) };
  const gm = new GameManager(mockIo);
  const pin = '999222';
  const game = {
    pin,
    gameId: 'game_idempotent_test',
    state: 'QUESTION_ACTIVE',
    currentQuestionIndex: 0,
    questionStartTime: Date.now() - 2000,
    questionTimeLimit: 30,
    quiz: {
      questions: [{ id: 'q1', type: 'quiz', points: 1000, timeLimit: 30 }],
    },
    players: new Map([
      ['user_1', { userUuid: 'user_1', nickname: 'Bob', connected: true, socketId: 'sock_1', score: 0, streak: 0 }],
    ]),
    answers: new Map([[0, new Map()]]),
    settings: {},
  };
  gm.games.set(pin, game);

  // First submission succeeds
  const res1 = gm.submitAnswer(pin, 'user_1', { selected: 'opt_a' });
  assert.equal(res1.success, true);
  assert.equal(res1.duplicate, undefined);

  // Second submission is accepted idempotently
  const res2 = gm.submitAnswer(pin, 'user_1', { selected: 'opt_a' });
  assert.equal(res2.success, true);
  assert.equal(res2.duplicate, true);
});

test('Live Play Bug 3 Fix: transitionToGetReady schedules 6000ms timer for 6-second progressive reveal', () => {
  let capturedDelay = null;
  const originalSetTimeout = global.setTimeout;
  const mockIo = { to: () => ({ emit: () => {} }) };
  const gm = new GameManager(mockIo);
  const pin = '888333';
  const game = {
    pin,
    gameId: 'game_getready_timer_test',
    state: 'LOBBY',
    currentQuestionIndex: 0,
    quiz: {
      questions: [
        { id: 'q1', type: 'quiz', title: 'Test Q', isMultiSelect: true, points: 2000, timeLimit: 20 },
      ],
    },
    players: new Map(),
    settings: {},
    timers: new Set(),
  };
  gm.games.set(pin, game);

  // Hook setTimeout to verify 6000ms delay
  const prevSetTimeout = global.setTimeout;
  try {
    global.setTimeout = (fn, delay) => {
      capturedDelay = delay;
      return 12345;
    };
    gm.transitionToGetReady(game);
    assert.equal(capturedDelay, 6000);
    assert.equal(game.state, 'GET_READY');

    const payload = gm.getReadyPayload(game);
    assert.equal(payload.questionInfo.type, 'quiz');
    assert.equal(payload.questionInfo.isMultiSelect, true);
    assert.equal(payload.questionInfo.points, 2000);
  } finally {
    global.setTimeout = prevSetTimeout;
  }
});


