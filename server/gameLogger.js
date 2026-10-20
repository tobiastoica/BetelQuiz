import fs from 'fs';
import path from 'path';
import { GAME_LOGS_DIR } from './config.js';

function sanitizeName(str) {
  return (str || 'Quiz')
    .replace(/[\\/:*?"<>|]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function formatTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${MM}-${dd}_${hh}-${mm}-${ss}`;
}

export class GameLogger {
  constructor(game) {
    this.gamePin = game.pin;
    this.gameId = game.gameId;
    this.quizTitle = game.quiz?.title || 'Unknown Quiz';
    this.quizId = game.quizId;
    this.createdAt = new Date();

    const cleanTitle = sanitizeName(this.quizTitle);
    const timeStr = formatTimestamp(this.createdAt);
    this.fileName = `${cleanTitle}_${timeStr}_pin${this.gamePin}.log`;
    this.filePath = path.join(GAME_LOGS_DIR, this.fileName);

    try {
      fs.mkdirSync(GAME_LOGS_DIR, { recursive: true });

      const header = [
        '================================================================================',
        'BETELQUIZ GAME SESSION LOG',
        `Quiz Title:       ${this.quizTitle}`,
        `Quiz ID:          ${this.quizId || 'N/A'}`,
        `Game PIN:         ${this.gamePin}`,
        `Game ID:          ${this.gameId}`,
        `Total Questions:  ${game.quiz?.questions?.length ?? 0}`,
        `Start Timestamp:  ${this.createdAt.toISOString()}`,
        `Log File:         ${this.fileName}`,
        '================================================================================\n',
      ].join('\n');

      fs.writeFileSync(this.filePath, header, 'utf-8');
    } catch (err) {
      console.error(`Failed to initialize game log file ${this.filePath}:`, err);
    }
  }

  append(level, eventType, message, details = null) {
    const ts = new Date().toISOString();
    let line = `[${ts}] [${level.toUpperCase()}] [${eventType}] ${message}`;

    if (details !== null && details !== undefined) {
      try {
        const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
        line += ` | Details: ${detailsStr}`;
      } catch (err) {
        line += ` | Details: [Unstringifiable: ${err.message}]`;
      }
    }
    line += '\n';

    try {
      fs.appendFileSync(this.filePath, line, 'utf-8');
    } catch (err) {
      console.error(`Failed to append to game log ${this.filePath}:`, err);
    }
  }

  info(eventType, message, details) {
    this.append('INFO', eventType, message, details);
  }

  warn(eventType, message, details) {
    this.append('WARN', eventType, message, details);
  }

  error(eventType, message, details) {
    this.append('ERROR', eventType, message, details);
  }

  exception(context, err, details = {}) {
    const errorDetails = {
      errorMessage: err?.message || String(err),
      stack: err?.stack || undefined,
      ...details,
    };
    this.append('ERROR', 'EXCEPTION', `Exception in ${context}: ${err?.message || err}`, errorDetails);
  }

  unusualRequest(eventType, socketId, details) {
    this.append('WARN', 'UNUSUAL_REQUEST', `Unusual or fallback request: ${eventType} from socket ${socketId}`, details);
  }

  fallbackTriggered(context, details) {
    this.append('WARN', 'FALLBACK_TRIGGERED', `Fallback triggered in ${context}`, details);
  }

  stateTransition(fromState, toState, details = {}) {
    this.append('INFO', 'STATE_TRANSITION', `Game state changed: ${fromState} -> ${toState}`, details);
  }

  playerConnected(player, isReconnect, socketId) {
    const action = isReconnect ? 'reconnected' : 'joined';
    this.append('INFO', 'PLAYER_CONNECT', `Player "${player.nickname}" (${player.userUuid}) ${action} via socket ${socketId}`, {
      nickname: player.nickname,
      userUuid: player.userUuid,
      avatar: player.avatar,
      isReconnect,
      socketId,
    });
  }

  playerDisconnected(player, socketId, reason) {
    this.append('INFO', 'PLAYER_DISCONNECT', `Player "${player?.nickname || 'Unknown'}" (${player?.userUuid || 'Unknown'}) disconnected from socket ${socketId}`, {
      nickname: player?.nickname,
      userUuid: player?.userUuid,
      socketId,
      reason: reason || 'transport close',
    });
  }

  playerKicked(userUuid, nickname, reason) {
    this.append('WARN', 'PLAYER_KICKED', `Player "${nickname || userUuid}" (${userUuid}) was kicked. Reason: ${reason || 'N/A'}`);
  }

  avatarUpdated(userUuid, nickname, newAvatar) {
    this.append('INFO', 'AVATAR_UPDATED', `Player "${nickname || userUuid}" (${userUuid}) changed avatar to ${newAvatar}`);
  }

  answerSubmitted(player, questionIndex, answerPayload, scoreResult, responseTimeMs) {
    const isCorrect = scoreResult?.isCorrect;
    const isPartial = scoreResult?.isPartial;
    const points = scoreResult?.points ?? 0;
    const status = isCorrect ? (isPartial ? 'PARTIALLY_CORRECT' : 'CORRECT') : 'INCORRECT';

    this.append('INFO', 'ANSWER_SUBMITTED', `Player "${player.nickname}" (${player.userUuid}) answered Q#${questionIndex + 1} (${responseTimeMs}ms) -> ${status} (+${points} pts)`, {
      userUuid: player.userUuid,
      nickname: player.nickname,
      questionIndex,
      responseTimeMs,
      payload: answerPayload,
      points,
      newTotalScore: player.score,
      streak: player.streak,
      scoreResult,
    });
  }

  settingsUpdated(newSettings, updatedBy = 'host') {
    this.append('INFO', 'SETTINGS_UPDATED', `Settings updated by ${updatedBy}`, newSettings);
  }

  gameEnded(summary = {}) {
    const footer = [
      '\n================================================================================',
      `GAME SESSION CONCLUDED: ${new Date().toISOString()}`,
      `Total Final Players:   ${summary.totalPlayers ?? 0}`,
      `Total Questions:       ${summary.totalQuestions ?? 0}`,
      `Podium:                ${summary.podium ? JSON.stringify(summary.podium) : 'N/A'}`,
      '================================================================================\n',
    ].join('\n');

    try {
      fs.appendFileSync(this.filePath, footer, 'utf-8');
    } catch (err) {
      console.error(`Failed to append game footer ${this.filePath}:`, err);
    }
  }
}
