import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { PROFILES_DIR, REPORTS_DIR } from '../config.js';
import { calculateQuestionScore, levenshteinDistance, normalizeString } from '../scoring.js';

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
import { parseKahootCsv, exportToKahootCsv, parseBetelQuizJson, exportToBetelQuizJson } from '../quizBridge.js';
import { getPlayerProfile, updatePlayerIdentity, recordGameResult, getAllPlayersAnalytics } from '../playerProfiles.js';
import { generateGameReport, listGameReports, getGameReport, exportReportToCsv } from '../reportsManager.js';

test('Levenshtein distance and string normalization', () => {
  assert.strictEqual(levenshteinDistance('kitten', 'sitting'), 3);
  assert.strictEqual(levenshteinDistance('antigravity', 'antigravity'), 0);
  assert.strictEqual(levenshteinDistance('kahoot', 'kahooot'), 1);

  assert.strictEqual(normalizeString('  Café  '), 'cafe');
  assert.strictEqual(normalizeString('Éléphant', true), 'Elephant');
});

test('Word Guess scoring - exact and fuzzy matching with configurable score %', () => {
  const question = {
    type: 'word_guess',
    points: 1000,
    timeLimit: 20,
    acceptedAnswers: ['Alexander the Great', 'Alexander'],
    allowMultipleAnswers: false,
    fuzzyMatching: true,
    fuzzyScorePercentage: 80,
  };

  // Exact match - instant response (responseTimeMs: 0 => 1000 pts)
  const exactRes = calculateQuestionScore(question, { text: 'alexander the great' }, 0);
  assert.strictEqual(exactRes.isCorrect, true);
  assert.strictEqual(exactRes.isExact, true);
  assert.strictEqual(exactRes.points, 1000);

  // Exact match on alternate accepted answer
  const altRes = calculateQuestionScore(question, { text: 'alexander' }, 0);
  assert.strictEqual(altRes.isCorrect, true);
  assert.strictEqual(altRes.isExact, true);

  // Fuzzy match with small typo (e.g. "alexandar")
  const fuzzyRes = calculateQuestionScore(question, { text: 'alexandar' }, 0);
  assert.strictEqual(fuzzyRes.isCorrect, true);
  assert.strictEqual(fuzzyRes.isExact, false);
  assert.strictEqual(fuzzyRes.isPartial, true);
  // 80% of 1000 = 800 pts
  assert.strictEqual(fuzzyRes.points, 800);

  // Wrong answer
  const wrongRes = calculateQuestionScore(question, { text: 'Napoleon' }, 0);
  assert.strictEqual(wrongRes.isCorrect, false);
  assert.strictEqual(wrongRes.points, 0);
});

test('Word Guess scoring - multiple answers allowed', () => {
  const multiQuestion = {
    type: 'word_guess',
    points: 1000,
    timeLimit: 20,
    acceptedAnswers: ['Mercury', 'Venus', 'Earth', 'Mars'],
    allowMultipleAnswers: true,
  };

  // Submitting 2 correct answers out of 4 with instant response
  const res = calculateQuestionScore(multiQuestion, { answers: ['mercury', 'venus'] }, 0);
  assert.strictEqual(res.isCorrect, true);
  assert.strictEqual(res.isPartial, true);
  // Accuracy = 2/4 = 0.5 => 500 pts
  assert.strictEqual(res.points, 500);
});

test('Picture Reveal scoring - behaves with time-scaled points', () => {
  const picQuestion = {
    type: 'picture_reveal',
    points: 1000,
    timeLimit: 20,
    tileLevel: 'medium',
    options: [
      { id: 'opt-1', text: 'Mona Lisa', isCorrect: true },
      { id: 'opt-2', text: 'Starry Night', isCorrect: false },
    ],
  };

  // Instant correct answer (0ms => 1000 pts)
  const instantRes = calculateQuestionScore(picQuestion, { selected: 'opt-1' }, 0);
  assert.strictEqual(instantRes.isCorrect, true);
  assert.strictEqual(instantRes.points, 1000);

  // Halfway answer (10s of 20s => deduction 500 * (1 - 0.5) = 250, points = 750)
  const halfwayRes = calculateQuestionScore(picQuestion, { selected: 'opt-1' }, 10000);
  assert.strictEqual(halfwayRes.isCorrect, true);
  assert.strictEqual(halfwayRes.points, 750);
});

test('Kahoot CSV Bridge - parse and export', () => {
  const sampleKahootCsv = `Question,1 - Answer,2 - Answer,3 - Answer,4 - Answer,Time (sec),Correct answer(s)
"What is the capital of France?","Paris","London","Berlin","Madrid",20,1
"Is water wet?","Yes","No",,,10,1`;

  const parsed = parseKahootCsv(sampleKahootCsv, 'Imported Test Quiz');
  assert.strictEqual(parsed.title, 'Imported Test Quiz');
  assert.strictEqual(parsed.questions.length, 2);

  const q1 = parsed.questions[0];
  assert.strictEqual(q1.title, 'What is the capital of France?');
  assert.strictEqual(q1.timeLimit, 20);
  assert.strictEqual(q1.options.length, 4);
  assert.strictEqual(q1.options[0].text, 'Paris');
  assert.strictEqual(q1.options[0].isCorrect, true);

  const q2 = parsed.questions[1];
  assert.strictEqual(q2.type, 'yes_no');
  assert.strictEqual(q2.options[0].text, 'Yes');
  assert.strictEqual(q2.options[0].isCorrect, true);

  // Export to Kahoot CSV
  const exportedCsv = exportToKahootCsv(parsed);
  assert.ok(exportedCsv.includes('What is the capital of France?'));
  assert.ok(exportedCsv.includes('Paris'));
});

test('Kahoot CSV Bridge - preserves 1-based column indices when intermediate columns are empty', () => {
  // Option 1 is "Cat", Option 2 is empty, Option 3 is "Dog", Option 4 is empty.
  // Correct answer is "3" (which corresponds to "Dog").
  const shiftedCsv = `Question,1 - Answer,2 - Answer,3 - Answer,4 - Answer,Time (sec),Correct answer(s)
"Choose the dog","Cat",,"Dog",,20,3`;

  const parsed = parseKahootCsv(shiftedCsv, 'Column Shift Quiz');
  assert.strictEqual(parsed.questions.length, 1);
  const q = parsed.questions[0];
  assert.strictEqual(q.options.length, 2);
  assert.strictEqual(q.options[0].text, 'Cat');
  assert.strictEqual(q.options[0].isCorrect, false);
  assert.strictEqual(q.options[1].text, 'Dog');
  assert.strictEqual(q.options[1].isCorrect, true);
});

test('BetelQuiz JSON Bridge - export and parse', () => {
  const fullQuiz = {
    id: 'quiz-full-test',
    title: 'Full BetelQuiz Test',
    description: 'Testing export and import',
    theme: 'space',
    questions: [
      {
        id: 'q1',
        type: 'word_guess',
        title: 'Guess the element',
        acceptedAnswers: ['Gold', 'Au'],
        allowMultipleAnswers: false,
        fuzzyMatching: true,
        fuzzyScorePercentage: 75,
      },
      {
        id: 'q2',
        type: 'picture_reveal',
        title: 'Identify the landmark',
        image: '/uploads/eiffel.jpg',
        tileLevel: 'big',
        options: [
          { id: 'o1', text: 'Eiffel Tower', isCorrect: true },
          { id: 'o2', text: 'Colosseum', isCorrect: false },
        ],
      },
    ],
  };

  const jsonStr = exportToBetelQuizJson(fullQuiz);
  const imported = parseBetelQuizJson(jsonStr);
  assert.strictEqual(imported.title, 'Full BetelQuiz Test');
  assert.strictEqual(imported.questions.length, 2);
  assert.strictEqual(imported.questions[0].type, 'word_guess');
  assert.strictEqual(imported.questions[1].type, 'picture_reveal');
  assert.strictEqual(imported.questions[1].tileLevel, 'big');
});

test('Player Profile - identity and career stats persistence', () => {
  const testUuid = `test-user-${Date.now()}`;

  // Initial fetch returns fresh template
  const initial = getPlayerProfile(testUuid);
  assert.strictEqual(initial.userUuid, testUuid);
  assert.strictEqual(initial.gamesPlayed, 0);

  // Update identity
  const updatedIdentity = updatePlayerIdentity(testUuid, { nickname: 'SpeedyFox', avatar: '🦊' });
  assert.strictEqual(updatedIdentity.nickname, 'SpeedyFox');
  assert.strictEqual(updatedIdentity.avatar, '🦊');

  // Record 1st place victory
  const afterGame1 = recordGameResult(testUuid, {
    gamePin: '123456',
    gameId: 'game-1',
    quizTitle: 'Champions Cup',
    score: 8500,
    rank: 1,
    totalPlayers: 5,
    streak: 6,
    accuracy: 90,
    nickname: 'SpeedyFox',
    avatar: '🦊',
  });

  assert.strictEqual(afterGame1.gamesPlayed, 1);
  assert.strictEqual(afterGame1.wins, 1);
  assert.strictEqual(afterGame1.podiums, 1);
  assert.strictEqual(afterGame1.totalScore, 8500);
  assert.strictEqual(afterGame1.highestStreak, 6);
  assert.strictEqual(afterGame1.recentGames.length, 1);

  // Record 2nd place game
  const afterGame2 = recordGameResult(testUuid, {
    gamePin: '654321',
    gameId: 'game-2',
    quizTitle: 'Science Bowl',
    score: 6000,
    rank: 2,
    totalPlayers: 10,
    streak: 4,
    accuracy: 80,
  });

  assert.strictEqual(afterGame2.gamesPlayed, 2);
  assert.strictEqual(afterGame2.wins, 1);
  assert.strictEqual(afterGame2.podiums, 2);
  assert.strictEqual(afterGame2.totalScore, 14500);
  assert.strictEqual(afterGame2.recentGames.length, 2);
});

test('Reports Manager - report creation, listing, retrieval, and CSV export', () => {
  const mockGame = {
    gameId: `game-report-test-${Date.now()}`,
    pin: '998877',
    quiz: {
      id: 'quiz-test-1',
      title: 'Report Test Quiz',
      questions: [
        {
          id: 'q1',
          type: 'quiz',
          title: 'What is 2+2?',
          timeLimit: 20,
          points: 1000,
          options: [
            { id: 'opt-a', text: '4', isCorrect: true },
            { id: 'opt-b', text: '5', isCorrect: false },
          ],
        },
      ],
    },
    settings: { randomizeQuestions: false },
    createdAt: new Date().toISOString(),
    players: new Map([
      [
        'player-1',
        {
          userUuid: 'player-1',
          nickname: 'Alice',
          avatar: '🐼',
          score: 1000,
          streak: 1,
        },
      ],
      [
        'player-2',
        {
          userUuid: 'player-2',
          nickname: 'Bob',
          avatar: '🦁',
          score: 0,
          streak: 0,
        },
      ],
    ]),
    answers: new Map([
      [
        0,
        new Map([
          [
            'player-1',
            {
              userUuid: 'player-1',
              answerPayload: { selected: 'opt-a' },
              responseTimeMs: 2500,
              submittedAt: Date.now(),
            },
          ],
          [
            'player-2',
            {
              userUuid: 'player-2',
              answerPayload: { selected: 'opt-b' },
              responseTimeMs: 4000,
              submittedAt: Date.now(),
            },
          ],
        ]),
      ],
    ]),
  };

  const report = generateGameReport(mockGame);
  assert.ok(report);
  assert.strictEqual(report.gameId, mockGame.gameId);
  assert.strictEqual(report.quizTitle, 'Report Test Quiz');
  assert.strictEqual(report.totalPlayers, 2);
  assert.strictEqual(report.podium.first.nickname, 'Alice');
  assert.strictEqual(report.questionAnalytics.length, 1);
  assert.strictEqual(report.questionAnalytics[0].correctCount, 1);
  assert.strictEqual(report.questionAnalytics[0].accuracyRate, 50);

  // Retrieve report
  const fetched = getGameReport(report.reportId);
  assert.ok(fetched);
  assert.strictEqual(fetched.reportId, report.reportId);

  // List reports
  const list = listGameReports();
  assert.ok(list.length > 0);
  assert.ok(list.some((r) => r.reportId === report.reportId));

  // Export CSV
  const csvData = exportReportToCsv(report.reportId);
  assert.ok(csvData);
  assert.ok(csvData.includes('FINAL LEADERBOARD'));
  assert.ok(csvData.includes('Alice'));
});

test('Player Analytics - getAllPlayersAnalytics aggregates nicknames over time, podiums, and average score', () => {
  const pUuid = `player-analytics-test-${Date.now()}`;
  updatePlayerIdentity(pUuid, { nickname: 'RookieNick', avatar: '🐱' });

  // Game 1: 1st place with RookieNick
  recordGameResult(pUuid, {
    pin: '111111',
    gameId: 'g1',
    quizTitle: 'Quiz 1',
    score: 1000,
    rank: 1,
    nickname: 'RookieNick',
  });

  // Game 2: 2nd place with ProNick (nickname changed)
  recordGameResult(pUuid, {
    pin: '222222',
    gameId: 'g2',
    quizTitle: 'Quiz 2',
    score: 800,
    rank: 2,
    nickname: 'ProNick',
  });

  const allPlayers = getAllPlayersAnalytics();
  assert.ok(Array.isArray(allPlayers));
  const found = allPlayers.find((p) => p.userUuid === pUuid);
  assert.ok(found);
  assert.strictEqual(found.currentNickname, 'ProNick');
  assert.strictEqual(found.firstPlaceCount, 1);
  assert.strictEqual(found.secondPlaceCount, 1);
  assert.strictEqual(found.thirdPlaceCount, 0);
  assert.strictEqual(found.gamesPlayed, 2);
  assert.strictEqual(found.totalScore, 1800);
  assert.strictEqual(found.averageScore, 900);
  assert.ok(found.nicknames.includes('RookieNick'));
  assert.ok(found.nicknames.includes('ProNick'));
});
