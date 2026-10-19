import fs from 'fs';
import path from 'path';
import { REPORTS_DIR } from './config.js';
import { calculateQuestionScore, normalizeSelected, extractWordInputs, normalizeString } from './scoring.js';
import { isValidId, writeJsonAtomic, readJsonDir } from './fsUtils.js';
import { csvCell, csvRow } from './csv.js';
import { rankPlayers } from './ranking.js';

function getReportPath(reportId) {
  return path.join(REPORTS_DIR, `${reportId}.json`);
}

/**
 * Compiles and persists an exhaustive, permanent game report.
 */
export function generateGameReport(game) {
  if (!game || !game.gameId || !isValidId(game.gameId)) return null;

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const finishedAt = new Date().toISOString();
  const startedAt = game.createdAt || finishedAt;
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  );

  // 1. Leaderboard & Podium compilation
  const rankedPlayers = rankPlayers(game.players);

  const podium = {
    first: rankedPlayers[0] || null,
    second: rankedPlayers[1] || null,
    third: rankedPlayers[2] || null,
  };

  // 2. Question-by-question analytics
  const isGetReady = game.state === 'GET_READY' || game.prevState === 'GET_READY';
  const allQuestions = game.quiz?.questions || [];
  const playedCount =
    game.currentQuestionIndex !== undefined && game.currentQuestionIndex !== null && game.currentQuestionIndex >= 0
      ? isGetReady
        ? Math.max(0, game.currentQuestionIndex)
        : game.currentQuestionIndex + 1
      : (game.currentQuestionIndex === -1 ? 0 : allQuestions.length);
  const questions = allQuestions.slice(0, playedCount);
  const questionAnalytics = [];

  let minAccuracyRate = 101;
  let toughestQuestionInfo = null;

  const playerCorrectTimes = new Map(); // userUuid -> array of correct responseTimeMs

  questions.forEach((q, idx) => {
    const questionAnswers = game.answers.get(idx) || new Map();
    const submissions = [];

    const voteDistribution = {};
    (q.options || []).forEach((opt) => {
      voteDistribution[opt.id] = 0;
    });

    const wordSubmissions = {};
    let correctCount = 0;
    let partialCount = 0;
    let wrongCount = 0;
    let totalResponseTimeMs = 0;
    let fastestTimeMs = Infinity;
    let fastestSolver = null;

    for (const [userUuid, record] of questionAnswers.entries()) {
      const player = game.players?.get?.(userUuid);
      const nickname = player ? player.nickname : 'Player';
      const avatar = player ? player.avatar : '👤';

      const responseTimeMs = record.responseTimeMs || 0;
      totalResponseTimeMs += responseTimeMs;

      // Reuse precomputed scoreResult or fallback
      const scoreResult = record.scoreResult ?? calculateQuestionScore(q, record.answerPayload, responseTimeMs);
      const isCorrect = Boolean(scoreResult?.isCorrect);
      const isPartial = Boolean(scoreResult?.isPartial);
      const pointsEarned = scoreResult?.points ?? 0;

      if (isCorrect && !isPartial) {
        correctCount++;
        if (responseTimeMs < fastestTimeMs) {
          fastestTimeMs = responseTimeMs;
          fastestSolver = { userUuid, nickname, responseTimeMs };
        }
        if (!playerCorrectTimes.has(userUuid)) {
          playerCorrectTimes.set(userUuid, { nickname, times: [] });
        }
        playerCorrectTimes.get(userUuid).times.push(responseTimeMs);
      } else if (isCorrect && isPartial) {
        partialCount++;
      } else {
        wrongCount++;
      }

      // Tally choices / words
      if (q.type === 'quiz' || q.type === 'true_false' || q.type === 'yes_no' || q.type === 'picture_reveal') {
        const selected = normalizeSelected(record.answerPayload);
        selected.forEach((optId) => {
          if (voteDistribution[optId] !== undefined) {
            voteDistribution[optId]++;
          }
        });
      } else if (q.type === 'word_guess') {
        const words = extractWordInputs(record.answerPayload);
        words.forEach((w) => {
          const key = normalizeString(w, Boolean(q.caseSensitive));
          if (key) {
            wordSubmissions[key] = (wordSubmissions[key] || 0) + 1;
          }
        });
      }

      submissions.push({
        userUuid,
        nickname,
        avatar,
        answerPayload: record.answerPayload,
        responseTimeMs,
        pointsEarned,
        isCorrect,
        isPartial,
      });
    }

    const totalSubmissions = submissions.length;
    const accuracyRate =
      totalSubmissions > 0
        ? Math.round(((correctCount + partialCount * 0.5) / totalSubmissions) * 100)
        : 0;

    const averageResponseTimeMs =
      totalSubmissions > 0 ? Math.round(totalResponseTimeMs / totalSubmissions) : 0;

    // Track toughest question
    if (totalSubmissions > 0 && accuracyRate < minAccuracyRate) {
      minAccuracyRate = accuracyRate;
      toughestQuestionInfo = {
        questionIndex: idx + 1,
        title: q.title,
        accuracyRate,
      };
    }

    questionAnalytics.push({
      questionIndex: idx + 1,
      questionId: q.id,
      title: q.title,
      type: q.type,
      timeLimit: q.timeLimit,
      points: q.points,
      totalSubmissions,
      correctCount,
      partialCount,
      wrongCount,
      accuracyRate,
      averageResponseTimeMs,
      fastestSolver,
      voteDistribution,
      wordSubmissions,
      numberTarget: q.numberTarget,
      numberMin: q.numberMin,
      numberMax: q.numberMax,
      acceptedAnswers: q.acceptedAnswers,
      submissions,
    });
  });

  // 3. Overall Speed Champion across game
  let speedChampion = null;
  let bestAvgTime = Infinity;

  for (const [userUuid, data] of playerCorrectTimes.entries()) {
    if (data.times.length > 0) {
      const avg = Math.round(data.times.reduce((a, b) => a + b, 0) / data.times.length);
      if (avg < bestAvgTime) {
        bestAvgTime = avg;
        speedChampion = {
          userUuid,
          nickname: data.nickname,
          averageResponseTimeMs: avg,
          correctAnswersCount: data.times.length,
        };
      }
    }
  }

  // 4. Overall Accuracy
  const totalQuestions = questions.length;
  const overallAccuracy =
    questionAnalytics.length > 0
      ? Math.round(
          questionAnalytics.reduce((acc, q) => acc + q.accuracyRate, 0) / questionAnalytics.length
        )
      : 0;

  const report = {
    reportId: game.gameId,
    gameId: game.gameId,
    pin: game.pin,
    quizId: game.quiz?.id || 'unknown',
    quizTitle: game.quiz?.title || 'Untitled Quiz',
    startedAt,
    finishedAt,
    durationSeconds,
    totalPlayers: game.players instanceof Map ? game.players.size : rankedPlayers.length,
    totalQuestions,
    overallAccuracy,
    podium,
    leaderboard: rankedPlayers,
    toughestQuestion: toughestQuestionInfo,
    speedChampion,
    questionAnalytics,
  };

  const filePath = getReportPath(game.gameId);
  try {
    writeJsonAtomic(filePath, report);
    console.log(`Game report generated and saved: ${game.gameId} (${game.pin})`);
    return report;
  } catch (err) {
    console.error(`Failed to save report for ${game.gameId}:`, err);
    return null;
  }
}

/**
 * Lists all game reports with overview summaries.
 */
export function listGameReports() {
  try {
    const rawReports = readJsonDir(REPORTS_DIR);
    const list = rawReports.map((report) => ({
      reportId: report.reportId || report.gameId,
      gameId: report.gameId,
      pin: report.pin,
      quizId: report.quizId,
      quizTitle: report.quizTitle,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      durationSeconds: report.durationSeconds,
      totalPlayers: report.totalPlayers,
      totalQuestions: report.totalQuestions,
      winner: report.podium?.first
        ? {
            nickname: report.podium.first.nickname,
            avatar: report.podium.first.avatar,
            score: report.podium.first.score,
          }
        : null,
      toughestQuestion: report.toughestQuestion,
      speedChampion: report.speedChampion,
    }));

    return list.sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime());
  } catch (err) {
    console.error('Error listing game reports:', err);
    return [];
  }
}

/**
 * Retrieves a single complete game report.
 */
export function getGameReport(reportId) {
  if (!reportId || !isValidId(reportId)) return null;

  const filePath = getReportPath(reportId);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`Error reading report ${reportId}:`, err);
  }
  return null;
}

/**
 * Deletes a game report.
 */
export function deleteGameReport(reportId) {
  if (!reportId || !isValidId(reportId)) return false;

  const filePath = getReportPath(reportId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Error deleting report ${reportId}:`, err);
  }
  return false;
}

/**
 * Converts a game report into a downloadable spreadsheet CSV with formula neutralization.
 */
export function exportReportToCsv(reportId) {
  const report = getGameReport(reportId);
  if (!report) return null;

  const lines = [];

  // 1. Overview Header
  lines.push(csvRow([`BetelQuiz Game Report - ${report.quizTitle}`]));
  lines.push(csvRow(['Game PIN', report.pin, 'Game ID', report.gameId]));
  lines.push(csvRow(['Played At', report.finishedAt, 'Duration (seconds)', report.durationSeconds]));
  lines.push(csvRow(['Total Players', report.totalPlayers, 'Total Questions', report.totalQuestions]));
  lines.push('');

  // 2. Final Leaderboard
  lines.push(csvRow(['--- FINAL LEADERBOARD ---']));
  lines.push(csvRow(['Rank', 'Nickname', 'Score', 'Streak', 'User UUID']));
  (report.leaderboard || []).forEach((p) => {
    lines.push(csvRow([p.rank, p.nickname || '', p.score, p.streak, p.userUuid], { neutralizeFormulas: true }));
  });
  lines.push('');

  // 3. Question Analytics
  lines.push(csvRow(['--- QUESTION PERFORMANCE ---']));
  lines.push(
    csvRow([
      'Question #',
      'Question Title',
      'Type',
      'Accuracy (%)',
      'Correct Count',
      'Partial Count',
      'Wrong Count',
      'Avg Response Time (ms)',
    ])
  );
  (report.questionAnalytics || []).forEach((q) => {
    lines.push(
      csvRow([
        q.questionIndex,
        q.title || '',
        q.type,
        `${q.accuracyRate}%`,
        q.correctCount,
        q.partialCount,
        q.wrongCount,
        q.averageResponseTimeMs,
      ], { neutralizeFormulas: true })
    );
  });

  return lines.join('\n');
}
