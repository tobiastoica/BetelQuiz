import fs from 'fs';
import path from 'path';
import { PROFILES_DIR } from './config.js';
import { isValidId, writeJsonAtomic, readJsonDir } from './fsUtils.js';

function getProfilePath(userUuid) {
  return path.join(PROFILES_DIR, `${userUuid}.json`);
}

export const cleanAvatar = (a) =>
  typeof a === 'string' && a.length > 0 && a.length <= 16 ? a : null;

/**
 * Retrieves player profile by userUuid.
 * Returns default empty profile if none exists.
 */
export function getPlayerProfile(userUuid) {
  if (!userUuid || !isValidId(userUuid)) {
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
  if (!profile || !profile.userUuid || !isValidId(profile.userUuid)) {
    return false;
  }

  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }

  const filePath = getProfilePath(profile.userUuid);
  profile.updatedAt = new Date().toISOString();

  try {
    writeJsonAtomic(filePath, profile);
    return true;
  } catch (err) {
    console.error(`Error saving profile for ${profile.userUuid}:`, err);
    return false;
  }
}

/**
 * Updates a player profile with the outcome of a finished game.
 */
export function recordGameResult(userUuid, gameStats) {
  if (!userUuid || !isValidId(userUuid)) return null;

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
    const cleanNick = nickname.trim().slice(0, 20);
    profile.nickname = cleanNick;
    if (!profile.nicknameHistory.includes(cleanNick)) {
      profile.nicknameHistory.push(cleanNick);
    }
  }
  const validAvatar = cleanAvatar(avatar);
  if (validAvatar) profile.avatar = validAvatar;

  profile.gamesPlayed += 1;

  if (rank === 1) {
    profile.firstPlaceCount = (profile.firstPlaceCount || 0) + 1;
  } else if (rank === 2) {
    profile.secondPlaceCount = (profile.secondPlaceCount || 0) + 1;
  } else if (rank === 3) {
    profile.thirdPlaceCount = (profile.thirdPlaceCount || 0) + 1;
  }

  profile.wins = profile.firstPlaceCount || 0;
  profile.podiums =
    (profile.firstPlaceCount || 0) +
    (profile.secondPlaceCount || 0) +
    (profile.thirdPlaceCount || 0);

  profile.totalScore = (profile.totalScore || 0) + score;

  if (streak > (profile.highestStreak || 0)) {
    profile.highestStreak = streak;
  }

  profile.correctAnswersCount = (profile.correctAnswersCount || 0) + correctCount;
  profile.totalAnswersCount = (profile.totalAnswersCount || 0) + totalQuestions;

  if (profile.totalAnswersCount > 0) {
    profile.accuracyPercentage = Math.round(
      (profile.correctAnswersCount / profile.totalAnswersCount) * 100
    );
  }

  if (!Array.isArray(profile.recentGames)) {
    profile.recentGames = [];
  }

  profile.recentGames.unshift({
    gameId: gameId || effectivePin,
    pin: effectivePin,
    quizTitle,
    rank,
    totalPlayers,
    score,
    streak,
    correctCount,
    totalQuestions,
    accuracy: totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0,
    playedAt,
  });

  if (profile.recentGames.length > 20) {
    profile.recentGames = profile.recentGames.slice(0, 20);
  }

  savePlayerProfile(profile);
  return profile;
}

/**
 * Updates player identity (nickname or avatar) before/during games.
 */
export function updatePlayerIdentity(userUuid, nicknameOrObj, maybeAvatar) {
  if (!userUuid || !isValidId(userUuid)) return null;

  let nickname = nicknameOrObj;
  let avatar = maybeAvatar;
  if (nicknameOrObj && typeof nicknameOrObj === 'object') {
    nickname = nicknameOrObj.nickname;
    avatar = nicknameOrObj.avatar ?? maybeAvatar;
  }

  const profile = getPlayerProfile(userUuid);
  if (!profile) return null;

  let changed = false;

  if (typeof nickname === 'string') {
    const clean = nickname.trim().slice(0, 20);
    if (clean && clean !== profile.nickname) {
      profile.nickname = clean;
      if (!Array.isArray(profile.nicknameHistory)) {
        profile.nicknameHistory = [];
      }
      if (!profile.nicknameHistory.includes(clean)) {
        profile.nicknameHistory.push(clean);
      }
      changed = true;
    }
  }

  const validAvatar = cleanAvatar(avatar);
  if (validAvatar && validAvatar !== profile.avatar) {
    profile.avatar = validAvatar;
    changed = true;
  }

  if (changed) {
    savePlayerProfile(profile);
  }
  return profile;
}

/**
 * Aggregates all players across persistent profiles.
 */
export function getAllPlayersAnalytics() {
  const rawProfiles = readJsonDir(PROFILES_DIR);

  const result = rawProfiles
    .filter((p) => p && p.userUuid)
    .map((p) => {
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
      const avgScore = gamesCount > 0 ? Math.round(totalScore / gamesCount) : totalScore;
      const firsts = Number(p.firstPlaceCount ?? p.wins) || 0;
      const seconds = Number(p.secondPlaceCount) || 0;
      const thirds = Number(p.thirdPlaceCount) || 0;

      return {
        userUuid: p.userUuid,
        currentNickname: p.nickname || 'Player',
        avatar: p.avatar || '🦊',
        nicknames: nicks.size > 0 ? Array.from(nicks) : [p.nickname || 'Player'],
        gamesPlayed: gamesCount,
        totalScore,
        averageScore: avgScore,
        firstPlaceCount: firsts,
        secondPlaceCount: seconds,
        thirdPlaceCount: thirds,
        highestStreak: Number(p.highestStreak) || 0,
        accuracyPercentage: Number(p.accuracyPercentage) || 0,
        lastPlayedAt: p.recentGames?.[0]?.playedAt || p.updatedAt || null,
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
