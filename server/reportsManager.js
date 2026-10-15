import fs from 'fs';
import path from 'path';
import { REPORTS_DIR } from './config.js';
import { calculateQuestionScore } from './scoring.js';

function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

function getReportPath(reportId) {
  return path.join(REPORTS_DIR, `${reportId}.json`);
}

/**
 * Compiles and persists an exhaustive, permanent game report.
 */
export function generateGameReport(game) {
  if (!game || !game.gameId) return null;

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
  const rankedPlayers = Array.from(game.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, idx) => ({
      rank: idx + 1,
      userUuid: p.userUuid,
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score,
      streak: p.streak,
    }));

  const podium = {
    first: rankedPlayers[0] || null,
    second: rankedPlayers[1] || null,
    third: rankedPlayers[2] || null,
  };

  // 2. Question-by-question analytics
  const questions = game.quiz?.questions || [];
  const questionAnalytics = [];

  let minAccuracyRate = 101;
  let toughestQuestionInfo = null;

  const playerCorrectTimes = new Map(); // userUuid -> array of correct responseTimeMs

  questions.forEach((q, idx) => {
    const questionAnswers = game.answers.get(idx) || new Map();
    const submissions = [];

    let correctCount = 0;
    let partialCount = 0;
    let wrongCount = 0;
    let totalResponseTimeMs = 0;
    let fastestSolver = null;
    let fastestTimeMs = Infinity;

    const voteDistribution = {};
    if (Array.isArray(q.options)) {
      q.options.forEach((opt) => {
        voteDistribution[opt.id] = 0;
      });
    }

    const wordSubmissions = {};

    for (const [userUuid, record] of questionAnswers.entries()) {
      const player = game.players.get(userUuid);
      const nickname = player ? player.nickname : 'Player';
      const avatar = player ? player.avatar : '👤';

      const responseTimeMs = record.responseTimeMs || 0;
      totalResponseTimeMs += responseTimeMs;

      // Check results for this player
      const scoreResult = calculateQuestionScore(q, record.answerPayload, responseTimeMs);
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
        const selected = Array.isArray(record.answerPayload?.selected)
          ? record.answerPayload.selected
          : [record.answerPayload?.selected];
        selected.forEach((optId) => {
          if (voteDistribution[optId] !== undefined) {
            voteDistribution[optId]++;
          }
        });
      } else if (q.type === 'word_guess') {
        const text =
          record.answerPayload?.text ||
          (Array.isArray(record.answerPayload?.answers) ? record.answerPayload.answers.join(', ') : '');
        if (text) {
          wordSubmissions[text] = (wordSubmissions[text] || 0) + 1;
        }
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
      title: q.title,
      type: q.type,
      timeLimit: q.timeLimit || game.questionTimeLimit || 20,
      points: q.points ?? 1000,
      totalSubmissions,
      correctCount,
      partialCount,
      wrongCount,
      accuracyRate,
      averageResponseTimeMs,
      fastestSolver,
      submissions,
      voteDistribution,
      wordSubmissions: Object.keys(wordSubmissions).length > 0 ? wordSubmissions : undefined,
    });
  });

  // 3. Speed champion calculation
  let speedChampion = null;
  let bestAvgCorrectTime = Infinity;

  for (const [userUuid, data] of playerCorrectTimes.entries()) {
    if (data.times.length > 0) {
      const avg = Math.round(data.times.reduce((a, b) => a + b, 0) / data.times.length);
      if (avg < bestAvgCorrectTime) {
        bestAvgCorrectTime = avg;
        speedChampion = {
          userUuid,
          nickname: data.nickname,
          averageResponseTimeMs: avg,
        };
      }
    }
  }

  const report = {
    reportId: game.gameId,
    gameId: game.gameId,
    pin: game.pin,
    quizId: game.quizId,
    quizTitle: game.quiz?.title || 'BetelQuiz',
    startedAt,
    finishedAt,
    durationSeconds,
    totalPlayers: rankedPlayers.length,
    totalQuestions: questions.length,
    podium,
    leaderboard: rankedPlayers,
    questionAnalytics,
    toughestQuestion: toughestQuestionInfo,
    speedChampion,
  };

  const filePath = getReportPath(game.gameId);
  const tempPath = `${filePath}.tmp_${Date.now()}`;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(report, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
    console.log(`Game report generated and saved: ${game.gameId} (${game.pin})`);
    return report;
  } catch (err) {
    console.error(`Failed to save report for ${game.gameId}:`, err);
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
    return null;
  }
}

/**
 * Lists all game reports with overview summaries.
 */
export function listGameReports() {
  if (!fs.existsSync(REPORTS_DIR)) return [];

  try {
    const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.json'));
    const list = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(REPORTS_DIR, file), 'utf-8');
        const report = JSON.parse(content);
        list.push({
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
        });
      } catch (err) {
        console.error(`Error reading report file ${file}:`, err);
      }
    }

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
  } catch (err) {
    console.error(`Error deleting report ${reportId}:`, err);
  }
  return false;
}

/**
 * Converts a game report into a downloadable spreadsheet CSV.
 */
export function exportReportToCsv(reportId) {
  const report = getGameReport(reportId);
  if (!report) return null;

  const lines = [];

  // 1. Overview Header
  lines.push(`"BetelQuiz Game Report - ${report.quizTitle}"`);
  lines.push(`"Game PIN","${report.pin}","Game ID","${report.gameId}"`);
  lines.push(`"Played At","${report.finishedAt}","Duration (seconds)","${report.durationSeconds}"`);
  lines.push(`"Total Players","${report.totalPlayers}","Total Questions","${report.totalQuestions}"`);
  lines.push('');

  // 2. Final Leaderboard
  lines.push('"--- FINAL LEADERBOARD ---"');
  lines.push('"Rank","Nickname","Score","Streak","User UUID"');
  (report.leaderboard || []).forEach((p) => {
    lines.push(`"${p.rank}","${(p.nickname || '').replace(/"/g, '""')}","${p.score}","${p.streak}","${p.userUuid}"`);
  });
  lines.push('');

  // 3. Question Analytics
  lines.push('"--- QUESTION PERFORMANCE ---"');
  lines.push(
    '"Question #","Question Title","Type","Accuracy (%)","Correct Count","Partial Count","Wrong Count","Avg Response Time (ms)"'
  );
  (report.questionAnalytics || []).forEach((q) => {
    lines.push(
      `"${q.questionIndex}","${(q.title || '').replace(/"/g, '""')}","${q.type}","${q.accuracyRate}%","${q.correctCount}","${q.partialCount}","${q.wrongCount}","${q.averageResponseTimeMs}"`
    );
  });

  return lines.join('\n');
}
