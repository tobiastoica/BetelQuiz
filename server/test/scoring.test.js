import test from 'node:test';
import assert from 'node:assert';
import { calculateQuestionScore, calculateStreakBonus } from '../scoring.js';

test('Streak bonus calculation', () => {
  assert.strictEqual(calculateStreakBonus(0), 0);
  assert.strictEqual(calculateStreakBonus(1), 0);
  assert.strictEqual(calculateStreakBonus(2), 100);
  assert.strictEqual(calculateStreakBonus(3), 200);
  assert.strictEqual(calculateStreakBonus(4), 300);
  assert.strictEqual(calculateStreakBonus(5), 500);
  assert.strictEqual(calculateStreakBonus(8), 500);
});

test('Quiz question scoring - single select correct instant response', () => {
  const question = {
    type: 'quiz',
    points: 1000,
    timeLimit: 20,
    isMultiSelect: false,
    options: [
      { id: 'opt_1', text: 'Mars', isCorrect: true },
      { id: 'opt_2', text: 'Venus', isCorrect: false },
    ],
  };

  // Answered instantly (0ms)
  const resultInstant = calculateQuestionScore(question, { selected: 'opt_1' }, 0);
  assert.strictEqual(resultInstant.isCorrect, true);
  assert.strictEqual(resultInstant.points, 1000);

  // Answered halfway through (10000ms out of 20000ms)
  const resultMid = calculateQuestionScore(question, { selected: 'opt_1' }, 10000);
  assert.strictEqual(resultMid.isCorrect, true);
  // Speed multiplier = 1 - 0.5/2 = 0.75 => 750 points
  assert.strictEqual(resultMid.points, 750);

  // Incorrect answer
  const resultWrong = calculateQuestionScore(question, { selected: 'opt_2' }, 2000);
  assert.strictEqual(resultWrong.isCorrect, false);
  assert.strictEqual(resultWrong.points, 0);
});

test('Quiz question scoring - multi-select awards fractions for partial correct', () => {
  const question = {
    type: 'quiz',
    points: 1500,
    timeLimit: 20,
    isMultiSelect: true,
    options: [
      { id: 'opt_1', text: '2', isCorrect: true },
      { id: 'opt_2', text: '7', isCorrect: true },
      { id: 'opt_3', text: '9', isCorrect: false },
    ],
  };

  // Exactly correct (2 out of 2)
  const resultAll = calculateQuestionScore(question, { selected: ['opt_1', 'opt_2'] }, 0);
  assert.strictEqual(resultAll.isCorrect, true);
  assert.strictEqual(resultAll.isPartial, false);
  assert.strictEqual(resultAll.points, 1500);

  // Partial (1 out of 2 correct picked, no wrong picked) => 50% fraction awarded!
  const resultPartial = calculateQuestionScore(question, { selected: ['opt_1'] }, 0);
  assert.strictEqual(resultPartial.isCorrect, true);
  assert.strictEqual(resultPartial.isPartial, true);
  assert.strictEqual(resultPartial.points, 750); // 1500 * (1/2) = 750

  // Wrong included (picked opt_1 and opt_3) => 0 points!
  const resultWrong = calculateQuestionScore(question, { selected: ['opt_1', 'opt_3'] }, 0);
  assert.strictEqual(resultWrong.isCorrect, false);
  assert.strictEqual(resultWrong.points, 0);
});

test('Puzzle ranking scoring', () => {
  const question = {
    type: 'puzzle',
    points: 2000,
    timeLimit: 30,
    options: [
      { id: 'p1', text: 'A', order: 0 },
      { id: 'p2', text: 'B', order: 1 },
      { id: 'p3', text: 'C', order: 2 },
      { id: 'p4', text: 'D', order: 3 },
    ],
  };

  // 100% correct order
  const resultFull = calculateQuestionScore(question, { order: ['p1', 'p2', 'p3', 'p4'] }, 0);
  assert.strictEqual(resultFull.isCorrect, true);
  assert.strictEqual(resultFull.points, 2000);

  // Partial match (2 out of 4)
  const resultPartial = calculateQuestionScore(question, { order: ['p1', 'p2', 'p4', 'p3'] }, 0);
  assert.strictEqual(resultPartial.isCorrect, true);
  assert.strictEqual(resultPartial.isPartial, true);
  assert.strictEqual(resultPartial.accuracy, 0.5);
  assert.strictEqual(resultPartial.points, 500); // 2000 * 0.5 * 0.5

  // 0 match
  const resultNone = calculateQuestionScore(question, { order: ['p4', 'p3', 'p2', 'p1'] }, 0);
  assert.strictEqual(resultNone.points, 0);
});

test('Number guess side-dependent boundary scaling matching user example', () => {
  const question = {
    type: 'number_guess',
    points: 1000,
    timeLimit: 30,
    numberTarget: 20,
    numberMin: 0,
    numberMax: 100,
  };

  // 1. Instant answer (timeScore = 1000)
  // Exact target: 20 => 1000 points (full)
  const resultExact = calculateQuestionScore(question, { number: 20 }, 0);
  assert.strictEqual(resultExact.isCorrect, true);
  assert.strictEqual(resultExact.isExact, true);
  assert.strictEqual(resultExact.points, 1000);

  // Guess 10: lower side (boundary distance = 20 - 0 = 20). Error = 10 => 50% points = 500
  const resultLower = calculateQuestionScore(question, { number: 10 }, 0);
  assert.strictEqual(resultLower.isCorrect, true);
  assert.strictEqual(resultLower.isPartial, true);
  assert.strictEqual(resultLower.points, 500);

  // Guess 30: upper side (boundary distance = 100 - 20 = 80). Error = 10 => 87.5% points = 875
  const resultUpper = calculateQuestionScore(question, { number: 30 }, 0);
  assert.strictEqual(resultUpper.isCorrect, true);
  assert.strictEqual(resultUpper.isPartial, true);
  assert.strictEqual(resultUpper.points, 875);

  // Boundary hits: guess 0 => 0 points, guess 100 => 0 points
  const resultZero = calculateQuestionScore(question, { number: 0 }, 0);
  assert.strictEqual(resultZero.points, 0);

  const resultHundred = calculateQuestionScore(question, { number: 100 }, 0);
  assert.strictEqual(resultHundred.points, 0);

  // 2. Answered at 15s remaining (timeScore = 750)
  // Guess 10: 750 * 0.5 = 375 points
  const resultMidTime = calculateQuestionScore(question, { number: 10 }, 15000);
  assert.strictEqual(resultMidTime.points, 375);
});

test('Time-scaled scoring and multi-choice partial fraction matching exact prompt', () => {
  // 1. 1000 pts question with 30s limit
  const q1000 = {
    type: 'quiz',
    points: 1000,
    timeLimit: 30,
    isMultiSelect: false,
    options: [
      { id: 'a', text: 'A', isCorrect: true },
      { id: 'b', text: 'B', isCorrect: false },
    ],
  };

  // Halfway (15s remaining of 30s): 750 points
  const res1000Half = calculateQuestionScore(q1000, { selected: 'a' }, 15000);
  assert.strictEqual(res1000Half.points, 750);

  // Last second (30000ms elapsed): 500 points
  const res1000Last = calculateQuestionScore(q1000, { selected: 'a' }, 30000);
  assert.strictEqual(res1000Last.points, 500);

  // 2. 2000 pts question with 30s limit and multiple choice (2 correct answers)
  const q2000 = {
    type: 'quiz',
    points: 2000,
    timeLimit: 30,
    isMultiSelect: true,
    options: [
      { id: 'opt_1', text: 'Correct 1', isCorrect: true },
      { id: 'opt_2', text: 'Correct 2', isCorrect: true },
      { id: 'opt_3', text: 'Wrong', isCorrect: false },
    ],
  };

  // Answered at 15s remaining, user guessed 1 out of 2 correct answers:
  // Max score at 15s = 1750. Divided by 2 = 875!
  const res2000HalfPick = calculateQuestionScore(q2000, { selected: ['opt_1'] }, 15000);
  assert.strictEqual(res2000HalfPick.isCorrect, true);
  assert.strictEqual(res2000HalfPick.isPartial, true);
  assert.strictEqual(res2000HalfPick.points, 875);

  // Answered at 15s remaining, user guessed both correct answers: 1750
  const res2000FullPick = calculateQuestionScore(q2000, { selected: ['opt_1', 'opt_2'] }, 15000);
  assert.strictEqual(res2000FullPick.isCorrect, true);
  assert.strictEqual(res2000FullPick.isPartial, false);
  assert.strictEqual(res2000FullPick.points, 1750);
});

test('NaN Scoring Protection - handles invalid and boundary inputs gracefully', () => {
  const q = {
    type: 'quiz',
    points: 1000,
    timeLimit: 20,
    isMultiSelect: false,
    options: [{ id: 'opt_1', text: 'A', isCorrect: true }],
  };

  const resNanTime = calculateQuestionScore(q, { selected: 'opt_1' }, NaN);
  assert.strictEqual(Number.isNaN(resNanTime.points), false);
  assert.strictEqual(Number.isNaN(resNanTime.timeScore), false);
  assert.ok(resNanTime.points >= 500 && resNanTime.points <= 1000);

  const resUndefinedTime = calculateQuestionScore(q, { selected: 'opt_1' }, undefined);
  assert.strictEqual(Number.isNaN(resUndefinedTime.points), false);
  assert.ok(resUndefinedTime.points >= 500 && resUndefinedTime.points <= 1000);

  const resNegativeTime = calculateQuestionScore(q, { selected: 'opt_1' }, -500);
  assert.strictEqual(Number.isNaN(resNegativeTime.points), false);
  assert.strictEqual(resNegativeTime.points, 1000);

  const qZeroLimit = { ...q, timeLimit: 0 };
  const resZeroLimit = calculateQuestionScore(qZeroLimit, { selected: 'opt_1' }, 0);
  assert.strictEqual(Number.isNaN(resZeroLimit.points), false);
  assert.strictEqual(Number.isNaN(resZeroLimit.timeScore), false);

  const qNanLimit = { ...q, timeLimit: NaN };
  const resNanLimit = calculateQuestionScore(qNanLimit, { selected: 'opt_1' }, 0);
  assert.strictEqual(Number.isNaN(resNanLimit.points), false);
  assert.strictEqual(Number.isNaN(resNanLimit.timeScore), false);
});


