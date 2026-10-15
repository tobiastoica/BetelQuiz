import fs from 'fs';
import path from 'path';
import { PROFILES_DIR, REPORTS_DIR } from './config.js';

function isValidUuid(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

function getProfilePath(userUuid) {
  return path.join(PROFILES_DIR, `${userUuid}.json`);
}

/**
 * Retrieves player profile by userUuid.
 * Returns default empty profile if none exists.
 */
export function getPlayerProfile(userUuid) {
  if (!userUuid || !isValidUuid(userUuid)) {
    return null;
  }

  const filePath = getProfilePath(userUuid);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed.nicknameHistory)) {
        parsed.nicknameHistory = parsed.nickname ? [parsed.nickname] : [];
      }
      return parsed;
    }
  } catch (err) {
    console.error(`Error reading profile for ${userUuid}:`, err);
  }

  return {
    userUuid,
    nickname: '',
    avatar: '🦊',
    nicknameHistory: [],
    gamesPlayed: 0,
    wins: 0,
    firstPlaceCount: 0,
    secondPlaceCount: 0,
    thirdPlaceCount: 0,
    podiums: 0,
    totalScore: 0,
    highestStreak: 0,
    correctAnswersCount: 0,
    totalAnswersCount: 0,
    accuracyPercentage: 0,
    recentGames: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Saves a player profile to disk atomically.
 */
export function savePlayerProfile(profile) {
  if (!profile || !profile.userUuid || !isValidUuid(profile.userUuid)) {
    return false;
  }

  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }

  const filePath = getProfilePath(profile.userUuid);
  const tempPath = `${filePath}.tmp_${Date.now()}`;
  profile.updatedAt = new Date().toISOString();

  try {
    fs.writeFileSync(tempPath, JSON.stringify(profile, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err) {
    console.error(`Error saving profile for ${profile.userUuid}:`, err);
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
    return false;
  }
}

/**
 * Updates a player profile with the outcome of a finished game.
 */
export function recordGameResult(userUuid, gameStats) {
  if (!userUuid || !isValidUuid(userUuid)) return null;

  const profile = getPlayerProfile(userUuid);
  if (!profile) return null;

  const {
    pin,
    gamePin,
    gameId,
    quizTitle = 'Quiz',
    rank = 1,
    score = 0,
    streak = 0,
    correctCount = 0,
    totalQuestions = 0,
    totalPlayers = 1,
    nickname,
    avatar,
    playedAt = new Date().toISOString(),
  } = gameStats || {};
  const effectivePin = pin || gamePin || '';

  if (!Array.isArray(profile.nicknameHistory)) {
    profile.nicknameHistory = profile.nickname ? [profile.nickname] : [];
  }

  if (nickname) {
    const cleanNick = nickname.trim();
    profile.nickname = cleanNick;
    if (!profile.nicknameHistory.includes(cleanNick)) {
      profile.nicknameHistory.push(cleanNick);
    }
  }
  if (avatar) profile.avatar = avatar;

  profile.gamesPlayed += 1;

  if (rank === 1) {
    profile.firstPlaceCount = (profile.firstPlaceCount || 0) + 1;
  } else if (rank === 2) {
    profile.secondPlaceCount = (profile.secondPlaceCount || 0) + 1;
  } else if (rank === 3) {
    profile.thirdPlaceCount = (profile.thirdPlaceCount || 0) + 1;
  }

  profile.wins = profile.firstPlaceCount || (rank === 1 ? (profile.wins || 0) + 1 : (profile.wins || 0));
  profile.podiums = (profile.firstPlaceCount || 0) + (profile.secondPlaceCount || 0) + (profile.thirdPlaceCount || 0);

  profile.totalScore += Math.max(0, Number(score) || 0);
  profile.highestStreak = Math.max(profile.highestStreak, Number(streak) || 0);
  profile.correctAnswersCount += Math.max(0, Number(correctCount) || 0);
  profile.totalAnswersCount += Math.max(0, Number(totalQuestions) || 0);

  if (profile.totalAnswersCount > 0) {
    profile.accuracyPercentage = Math.round(
      (profile.correctAnswersCount / profile.totalAnswersCount) * 100
    );
  }

  const gameAccuracy = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const gameRecord = {
    gameId: gameId || `game_${Date.now()}`,
    pin: effectivePin,
    quizTitle,
    rank,
    score,
    totalPlayers,
    accuracy: gameAccuracy,
    playedAt,
  };

  profile.recentGames = [gameRecord, ...(profile.recentGames || [])].slice(0, 30);

  savePlayerProfile(profile);
  return profile;
}

/**
 * Updates player identity (nickname, avatar).
 */
export function updatePlayerIdentity(userUuid, { nickname, avatar }) {
  if (!userUuid || !isValidUuid(userUuid)) return null;
  const profile = getPlayerProfile(userUuid);
  if (!profile) return null;

  if (!Array.isArray(profile.nicknameHistory)) {
    profile.nicknameHistory = profile.nickname ? [profile.nickname] : [];
  }

  if (nickname) {
    const clean = nickname.trim();
    profile.nickname = clean;
    if (!profile.nicknameHistory.includes(clean)) {
      profile.nicknameHistory.push(clean);
    }
  }
  if (avatar) profile.avatar = avatar;

  savePlayerProfile(profile);
  return profile;
}

/**
 * Aggregates all players across persistent profiles and game reports.
 * Returns array of players with their ID, nicknames over time, average scores,
 * and 1st, 2nd, and 3rd place finishes.
 */
export function getAllPlayersAnalytics() {
  const playersMap = new Map();

  // 1. Load from all stored player profiles in PROFILES_DIR
  try {
    if (fs.existsSync(PROFILES_DIR)) {
      const files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(PROFILES_DIR, file), 'utf-8');
          const p = JSON.parse(raw);
          if (!p.userUuid) continue;

          const nicks = new Set();
          if (p.nickname) nicks.add(p.nickname);
          if (Array.isArray(p.nicknameHistory)) {
            p.nicknameHistory.forEach((n) => n && nicks.add(n));
          }
          if (Array.isArray(p.recentGames)) {
            p.recentGames.forEach((g) => {
              if (g.nickname) nicks.add(g.nickname);
            });
          }

          const gamesCount = Number(p.gamesPlayed) || (Array.isArray(p.recentGames) ? p.recentGames.length : 0);
          const totalScore = Number(p.totalScore) || 0;
          const avgScore = gamesCount > 0 ? Math.round(totalScore / gamesCount) : 0;

          // Compute podium placements from recentGames if firstPlaceCount was not explicitly serialized
          let firsts = Number(p.firstPlaceCount ?? p.wins) || 0;
          let seconds = Number(p.secondPlaceCount) || 0;
          let thirds = Number(p.thirdPlaceCount) || 0;

          if (seconds === 0 && thirds === 0 && Array.isArray(p.recentGames)) {
            for (const g of p.recentGames) {
              if (g.rank === 1 && firsts === 0) firsts += 1;
              if (g.rank === 2) seconds += 1;
              if (g.rank === 3) thirds += 1;
            }
          }

          playersMap.set(p.userUuid, {
            userUuid: p.userUuid,
            currentNickname: p.nickname || 'Player',
            avatar: p.avatar || '🦊',
            nicknames: Array.from(nicks),
            gamesPlayed: gamesCount,
            totalScore,
            averageScore: avgScore,
            firstPlaceCount: firsts,
            secondPlaceCount: seconds,
            thirdPlaceCount: thirds,
            highestStreak: Number(p.highestStreak) || 0,
            accuracyPercentage: Number(p.accuracyPercentage) || 0,
            lastPlayedAt: p.recentGames?.[0]?.playedAt || p.updatedAt || null,
          });
        } catch (err) {
          console.error(`Error reading profile file ${file}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Error scanning profiles directory:', err);
  }

  // 2. Scan all game reports in REPORTS_DIR to enrich history (ranks, nicknames over time, scores)
  try {
    if (fs.existsSync(REPORTS_DIR)) {
      const reportFiles = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.json'));
      for (const rFile of reportFiles) {
        try {
          const content = fs.readFileSync(path.join(REPORTS_DIR, rFile), 'utf-8');
          const report = JSON.parse(content);
          if (!report || !Array.isArray(report.leaderboard)) continue;

          for (const entry of report.leaderboard) {
            if (!entry.userUuid) continue;

            let player = playersMap.get(entry.userUuid);
            if (!player) {
              player = {
                userUuid: entry.userUuid,
                currentNickname: entry.nickname || 'Player',
                avatar: entry.avatar || '🦊',
                nicknames: [],
                gamesPlayed: 1,
                totalScore: Number(entry.score) || 0,
                averageScore: Number(entry.score) || 0,
                firstPlaceCount: entry.rank === 1 ? 1 : 0,
                secondPlaceCount: entry.rank === 2 ? 1 : 0,
                thirdPlaceCount: entry.rank === 3 ? 1 : 0,
                highestStreak: Number(entry.streak) || 0,
                accuracyPercentage: 0,
                lastPlayedAt: report.finishedAt || null,
              };
              playersMap.set(entry.userUuid, player);
            }

            // Record nickname if not already recorded
            if (entry.nickname && !player.nicknames.includes(entry.nickname)) {
              player.nicknames.push(entry.nickname);
            }
            if (entry.nickname && (!player.currentNickname || player.currentNickname === 'Player')) {
              player.currentNickname = entry.nickname;
            }
            if (entry.avatar && (!player.avatar || player.avatar === '🦊')) {
              player.avatar = entry.avatar;
            }

            // Sync 2nd and 3rd counts if player has 0
            if (player.secondPlaceCount === 0 && entry.rank === 2) {
              player.secondPlaceCount += 1;
            }
            if (player.thirdPlaceCount === 0 && entry.rank === 3) {
              player.thirdPlaceCount += 1;
            }

            if (!player.lastPlayedAt || new Date(report.finishedAt) > new Date(player.lastPlayedAt)) {
              player.lastPlayedAt = report.finishedAt;
            }
          }
        } catch (err) {
          console.error(`Error reading report file ${rFile}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Error scanning reports directory:', err);
  }

  // 3. Format result array and compute averages
  const result = Array.from(playersMap.values()).map((p) => {
    const avg = p.gamesPlayed > 0 ? Math.round(p.totalScore / p.gamesPlayed) : p.totalScore;
    return {
      ...p,
      averageScore: avg,
      nicknames: p.nicknames.length > 0 ? p.nicknames : [p.currentNickname],
    };
  });

  // Sort by 1st place wins desc, then average score desc
  return result.sort((a, b) => {
    if (b.firstPlaceCount !== a.firstPlaceCount) {
      return b.firstPlaceCount - a.firstPlaceCount;
    }
    return b.averageScore - a.averageScore;
  });
}
