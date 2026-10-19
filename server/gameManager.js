import { v4 as uuidv4 } from 'uuid';
import { getQuizById, normalizePuzzleOrder } from './storage.js';
import { isValidId } from './fsUtils.js';
import {
  calculateQuestionScore,
  calculateStreakBonus,
  shuffleArray,
  normalizeSelected,
  extractWordInputs,
  normalizeString,
} from './scoring.js';
import { generateGameReport } from './reportsManager.js';
import { recordGameResult, cleanAvatar } from './playerProfiles.js';
import { toPublicPlayer, rankPlayers } from './ranking.js';
import { GameLogger } from './gameLogger.js';

const TRANSITIONS = {
  LOBBY: ['GET_READY'],
  GET_READY: ['QUESTION_ACTIVE', 'PODIUM'],
  QUESTION_ACTIVE: ['QUESTION_REVEAL', 'PODIUM'],
  QUESTION_REVEAL: ['SCOREBOARD', 'PODIUM'],
  SCOREBOARD: ['GET_READY', 'PODIUM'],
  PODIUM: [],
};

export function prepareQuiz(quiz) {
  if (!quiz) return null;
  const questions = (quiz.questions || []).map((q) => {
    let question = { ...q };
    if (['quiz', 'true_false', 'yes_no', 'picture_reveal'].includes(question.type) && Array.isArray(question.options)) {
      question.options = question.options
        .filter((opt) => Boolean(opt && opt.text && opt.text.trim() !== ''))
        .map((opt, idx) => ({
          ...opt,
          colorIndex: opt.colorIndex ?? idx,
        }));
    }
    return normalizePuzzleOrder({
      ...question,
      timeLimit: question.timeLimit ?? quiz.defaultTimeLimit ?? 20,
      points: question.points ?? quiz.defaultPoints ?? 1000,
    });
  });
  return { ...quiz, questions };
}

export class GameManager {
  constructor(io) {
    this.io = io;
    this.games = new Map(); // pin -> gameState
    this.gamesById = new Map(); // gameId -> pin
    this.socketToGame = new Map(); // socket.id -> { pin, role, userUuid }
    this.timers = new Map(); // pin -> Set of timer handles

    // Periodic cleanup of stale games (runs every 10 minutes)
    this.cleanupInterval = setInterval(() => {
      this.pruneOldGames();
    }, 10 * 60 * 1000);
    if (this.cleanupInterval?.unref) {
      this.cleanupInterval.unref();
    }
  }

  setState(game, next) {
    if (!TRANSITIONS[game.state]?.includes(next)) {
      game.logger?.warn('INVALID_TRANSITION', `Attempted invalid transition from ${game.state} to ${next}`);
      return false;
    }
    const fromState = game.state;
    this.clearGameTimer(game.pin);
    game.prevState = game.state;
    game.state = next;
    game.lastStateTransitionTime = Date.now();
    game.logger?.stateTransition(fromState, next, {
      questionIndex: game.currentQuestionIndex,
      playersCount: game.players?.size ?? 0,
    });
    return true;
  }

  addGameTimer(pin, timerId) {
    const set = this.timers.get(pin) ?? this.timers.set(pin, new Set()).get(pin);
    set.add(timerId);
    return timerId;
  }

  clearGameTimer(pin) {
    this.timers.get(pin)?.forEach(clearTimeout);
    this.timers.delete(pin);
  }

  deleteGame(pin) {
    const game = this.games.get(pin);
    if (!game) return false;

    game.logger?.info('GAME_ENDED', `Game session ${pin} removed from active memory`);
    this.clearGameTimer(pin);
    this.games.delete(pin);
    if (game.gameId) {
      this.gamesById.delete(game.gameId);
    }

    for (const [socketId, info] of this.socketToGame.entries()) {
      if (info.pin === pin) {
        this.socketToGame.delete(socketId);
      }
    }
    return true;
  }

  // Prune games idle past 2 hours, or finished games past 30 minutes
  pruneOldGames() {
    const now = Date.now();
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;

    for (const [pin, game] of this.games.entries()) {
      const idleTime = now - (game.lastStateTransitionTime || 0);
      const isPodiumExpired =
        game.state === 'PODIUM' && game.podiumReachedAt && now - game.podiumReachedAt > THIRTY_MINUTES_MS;

      if (idleTime > TWO_HOURS_MS || isPodiumExpired) {
        this.io.to(pin).emit('player_kicked', { reason: 'This game has ended' });
        this.deleteGame(pin);
      }
    }
  }

  checkHostCooldown(game) {
    const now = Date.now();
    if (game.lastHostTransitionTime && now - game.lastHostTransitionTime < 1000) {
      return false;
    }
    return true;
  }

  generatePin() {
    let attempts = 0;
    const maxAttempts = 1000;
    while (attempts < maxAttempts) {
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      if (!this.games.has(pin)) {
        return pin;
      }
      attempts++;
    }

    for (let p = 100000; p <= 999999; p++) {
      const pinStr = p.toString();
      if (!this.games.has(pinStr)) {
        return pinStr;
      }
    }

    throw new Error('No available game PINs. All PINs are currently in use.');
  }

  createGame(quizId) {
    const rawQuiz = getQuizById(quizId);
    if (!rawQuiz) {
      throw new Error('Quiz not found');
    }
    const quiz = prepareQuiz(rawQuiz);

    const pin = this.generatePin();
    const gameId = uuidv4();
    const hostSecret = uuidv4();

    const game = {
      pin,
      gameId,
      hostSecret,
      quizId,
      quiz,
      hostSocketId: null,
      state: 'LOBBY',
      currentQuestionIndex: -1,
      questionStartTime: 0,
      questionTimeLimit: 20,
      lastStateTransitionTime: Date.now(),
      lastHostTransitionTime: 0,
      resultsRecorded: false,
      players: new Map(), // userUuid -> Player
      answers: new Map(), // questionIndex -> Map(userUuid, AnswerRecord)
      settings: {
        randomizeAnswers: false,
        randomizeQuestions: false,
        showQuestionsOnPlayerScreens: true,
        lockGame: false,
      },
      currentQuestionOptions: null,
      createdAt: new Date().toISOString(),
    };

    game.logger = new GameLogger(game);
    game.logger.info('GAME_INIT', `Game session initialized for "${quiz.title || 'Quiz'}" with PIN ${pin}`, {
      pin,
      gameId,
      totalQuestions: quiz.questions?.length ?? 0,
    });

    this.games.set(pin, game);
    this.gamesById.set(gameId, pin);
    return game;
  }

  getGameByPin(pin) {
    return this.games.get(pin) || null;
  }

  getGameById(gameId) {
    const pin = this.gamesById.get(gameId);
    return pin ? this.games.get(pin) || null : null;
  }

  getGameByPinOrId(pinOrId) {
    if (!pinOrId) return null;
    return this.getGameByPin(pinOrId) || this.getGameById(pinOrId);
  }

  updateSettings(pinOrId, newSettings) {
    const game = this.getGameByPinOrId(pinOrId);
    if (!game) return false;

    const SETTING_KEYS = [
      'randomizeAnswers',
      'randomizeQuestions',
      'showQuestionsOnPlayerScreens',
      'lockGame',
    ];
    for (const key of SETTING_KEYS) {
      if (key in newSettings) {
        game.settings[key] = Boolean(newSettings[key]);
      }
    }

    game.logger?.settingsUpdated(game.settings);
    this.io.to(game.pin).emit('settings_updated', game.settings);
    return true;
  }

  cleanNickname(game, raw, selfUuid) {
    const name = (raw || '').trim().slice(0, 20);
    const taken =
      Boolean(name) &&
      [...game.players.values()].some(
        (p) => p.userUuid !== selfUuid && p.nickname.toLowerCase() === name.toLowerCase()
      );
    return { name, taken };
  }

  joinPlayer(pinOrId, nickname, userUuid, socketId, avatar) {
    const game = this.getGameByPinOrId(pinOrId);
    if (!game) {
      return { success: false, error: 'Game not found. Please check your PIN.' };
    }

    if (!userUuid || !isValidId(userUuid)) {
      game.logger?.warn('JOIN_FAILED', 'User UUID required to join game', { userUuid, socketId });
      return { success: false, error: 'User UUID required to join game' };
    }

    if (game.state === 'PODIUM' && !game.players.has(userUuid)) {
      game.logger?.warn('JOIN_FAILED', 'Cannot join ended game in PODIUM state', { userUuid, nickname, socketId });
      return { success: false, error: 'This game has already ended.' };
    }

    // Reconnecting player
    if (game.players.has(userUuid)) {
      const player = game.players.get(userUuid);

      // Clean up old socket mapping without kicking the player
      if (player.socketId && player.socketId !== socketId) {
        this.socketToGame.delete(player.socketId);
      }

      player.socketId = socketId;
      player.connected = true;

      // In LOBBY, allow updating nickname / avatar
      if (game.state === 'LOBBY') {
        const { name, taken } = this.cleanNickname(game, nickname, userUuid);
        if (name && !taken) {
          player.nickname = name;
        }
        const validAvatar = cleanAvatar(avatar);
        if (validAvatar) {
          player.avatar = validAvatar;
        }
      }

      this.socketToGame.set(socketId, { pin: game.pin, role: 'player', userUuid });
      this.notifyHostPlayersUpdate(game);
      game.logger?.playerConnected(player, true, socketId);

      return {
        success: true,
        isReconnect: true,
        pin: game.pin,
        gameId: game.gameId,
        gameState: game.state,
        currentQuestionIndex: game.currentQuestionIndex,
        totalQuestions: game.quiz?.questions?.length || 0,
        settings: game.settings,
        player: toPublicPlayer(player),
      };
    }

    // New join
    if (game.settings.lockGame) {
      game.logger?.warn('JOIN_FAILED', 'Game locked by host to new players', { userUuid, nickname, socketId });
      return { success: false, error: 'This game is locked by the host.' };
    }

    const { name: cleanName, taken } = this.cleanNickname(game, nickname, userUuid);
    if (!cleanName) {
      game.logger?.warn('JOIN_FAILED', 'Invalid nickname provided', { userUuid, nickname, socketId });
      return { success: false, error: 'Please enter a valid nickname.' };
    }
    if (taken) {
      game.logger?.warn('JOIN_FAILED', `Nickname "${cleanName}" already taken in game`, { userUuid, socketId });
      return { success: false, error: 'That nickname is already taken in this game.' };
    }

    const validAvatar = cleanAvatar(avatar) || '🦊';

    const player = {
      userUuid,
      nickname: cleanName,
      avatar: validAvatar,
      score: 0,
      streak: 0,
      connected: true,
      socketId,
    };

    game.players.set(userUuid, player);
    this.socketToGame.set(socketId, { pin: game.pin, role: 'player', userUuid });
    this.notifyHostPlayersUpdate(game);
    game.logger?.playerConnected(player, false, socketId);

    return {
      success: true,
      isReconnect: false,
      pin: game.pin,
      gameId: game.gameId,
      gameState: game.state,
      settings: game.settings,
      player: toPublicPlayer(player),
    };
  }

  bindSocketToUser(pinOrId, userUuid, newSocket) {
    const game = this.getGameByPinOrId(pinOrId);
    if (!game || !userUuid || !newSocket) return null;

    const player = game.players.get(userUuid);
    if (!player) return null;

    // Drop old session for this user if it had a different socket
    if (player.socketId && player.socketId !== newSocket.id) {
      game.logger?.unusualRequest('SESSION_REBIND', newSocket.id, {
        userUuid,
        playerNickname: player.nickname,
        oldSocketId: player.socketId,
        newSocketId: newSocket.id,
      });
      const oldSocket = this.io.sockets?.sockets?.get(player.socketId);
      if (oldSocket) {
        try {
          oldSocket.leave(game.pin);
        } catch (err) {
          game.logger?.exception('bindSocketToUser_leaveOldSocket', err, { oldSocketId: player.socketId });
          console.error(`Error removing old socket ${player.socketId} from room:`, err);
        }
      }
      this.socketToGame.delete(player.socketId);
    }

    // Bind to the new active websocket session
    player.socketId = newSocket.id;
    player.connected = true;
    try {
      newSocket.join(game.pin);
    } catch (err) {
      game.logger?.exception('bindSocketToUser_joinNewSocket', err, { newSocketId: newSocket.id });
      console.error(`Error joining room ${game.pin} for new socket ${newSocket.id}:`, err);
    }

    const sessionInfo = { pin: game.pin, role: 'player', userUuid };
    this.socketToGame.set(newSocket.id, sessionInfo);
    return sessionInfo;
  }

  updatePlayerAvatar(pinOrId, userUuid, avatar) {
    const game = this.getGameByPinOrId(pinOrId);
    if (!game) return false;
    const player = game.players.get(userUuid);
    const validAvatar = cleanAvatar(avatar);
    if (player && validAvatar) {
      player.avatar = validAvatar;
      this.notifyHostPlayersUpdate(game);
      game.logger?.avatarUpdated(userUuid, player.nickname, validAvatar);
      return true;
    }
    return false;
  }

  kickPlayer(pinOrId, userUuid) {
    const game = this.getGameByPinOrId(pinOrId);
    if (!game) return false;

    const player = game.players.get(userUuid);
    if (player) {
      if (player.socketId) {
        this.io.to(player.socketId).emit('player_kicked', { reason: 'Host removed you from game' });
        this.socketToGame.delete(player.socketId);
        try {
          this.io.sockets?.sockets?.get(player.socketId)?.leave(game.pin);
        } catch (e) {
          console.warn('Could not leave room on kicked player socket:', e.message);
        }
      }
      game.players.delete(userUuid);
      this.notifyHostPlayersUpdate(game);
      game.logger?.playerKicked(userUuid, player.nickname, 'Host removed you from game');
      if (game.state === 'QUESTION_ACTIVE' && this.allActivePlayersAnswered(game)) {
        this.scheduleReveal(game, 500);
      }
      return true;
    }
    return false;
  }

  notifyHostPlayersUpdate(game) {
    if (!game.hostSocketId) return;
    const playersList = Array.from(game.players.values()).map(toPublicPlayer);
    this.io.to(game.hostSocketId).emit('players_updated', {
      count: playersList.length,
      players: playersList,
    });
  }

  isActive(p) {
    return p.connected || this.isSocketAlive(p.socketId);
  }

  isSocketAlive(socketId) {
    if (!socketId) return false;
    return Boolean(this.io.sockets?.sockets?.get(socketId)?.connected);
  }

  allActivePlayersAnswered(game) {
    const answers = game.answers.get(game.currentQuestionIndex);
    if (!answers) return false;
    const everyone = [...game.players.values()];
    const active = everyone.filter((p) => this.isActive(p));
    const pool = active.length > 0 ? active : everyone;
    return pool.length > 0 && pool.every((p) => answers.has(p.userUuid));
  }

  scheduleReveal(game, delayMs = 500) {
    this.clearGameTimer(game.pin);
    const timer = setTimeout(() => {
      if (game.state === 'QUESTION_ACTIVE') {
        this.transitionToQuestionReveal(game);
      }
    }, delayMs);
    this.addGameTimer(game.pin, timer);
  }

  currentQuestion(game) {
    return game?.quiz?.questions?.[game.currentQuestionIndex] ?? null;
  }

  questionView(game, audience, options = game.currentQuestionOptions) {
    const q = this.currentQuestion(game);
    if (!q) return null;

    const toOptionView = (o, idx) => ({
      id: o.id,
      text: o.text,
      colorIndex: o.colorIndex ?? idx,
    });

    const view = {
      id: q.id,
      type: q.type,
      title: q.title,
      image: q.image,
      timeLimit: q.timeLimit,
      points: q.points,
      theme: q.theme || game.quiz?.theme || 'spring',
      backgroundImage: q.backgroundImage || game.quiz?.backgroundImage,
      isMultiSelect: Boolean(q.isMultiSelect),
      numberMin: q.numberMin ?? 0,
      numberMax: q.numberMax ?? 100,
      tileLevel: q.tileLevel || 'medium',
      allowMultipleAnswers: Boolean(q.allowMultipleAnswers),
      fuzzyMatching: q.fuzzyMatching !== false,
      options: (options || []).map(toOptionView),
    };

    return audience === 'host'
      ? {
          ...view,
          acceptedAnswers: q.acceptedAnswers || [],
          caseSensitive: Boolean(q.caseSensitive),
          fuzzyScorePercentage: q.fuzzyScorePercentage ?? 80,
          numberTarget: q.numberTarget,
        }
      : view;
  }

  activePayload(game, audience, options) {
    const answers = game.answers.get(game.currentQuestionIndex);
    const timeLimitSec = game.questionTimeLimit || 20;
    const remainingTimeMs = Math.max(0, game.questionStartTime + timeLimitSec * 1000 - Date.now());

    return {
      state: 'QUESTION_ACTIVE',
      questionIndex: game.currentQuestionIndex,
      totalQuestions: game.quiz?.questions?.length || 0,
      questionStartTime: game.questionStartTime,
      endsAt: game.questionStartTime + timeLimitSec * 1000,
      remainingTimeMs,
      remainingSeconds: Math.ceil(remainingTimeMs / 1000),
      settings: {
        showQuestionsOnPlayerScreens: Boolean(game.settings?.showQuestionsOnPlayerScreens),
      },
      question: this.questionView(game, audience, options),
      ...(audience === 'host' && {
        answersReceived: answers?.size ?? 0,
        totalPlayers: game.players.size,
      }),
    };
  }

  playerOptions(game) {
    const opts = game.currentQuestionOptions || [];
    const q = this.currentQuestion(game);
    if (q?.type !== 'puzzle' || opts.length < 2) return opts;

    const isSolved = (list) => list.every((o, i) => o.order === i);
    let shuffled = shuffleArray(opts);
    for (let i = 0; i < 10 && isSolved(shuffled); i++) {
      shuffled = shuffleArray(opts);
    }
    return shuffled;
  }

  getReadyPayload(game) {
    const q = this.currentQuestion(game);
    return {
      state: 'GET_READY',
      questionIndex: game.currentQuestionIndex,
      settings: {
        showQuestionsOnPlayerScreens: Boolean(game.settings?.showQuestionsOnPlayerScreens),
      },
      questionInfo: {
        index: game.currentQuestionIndex + 1,
        total: game.quiz?.questions?.length || 0,
        type: q?.type || 'quiz',
        title: q?.title,
        theme: q?.theme || game.quiz?.theme || 'spring',
        isMultiSelect: Boolean(q?.isMultiSelect),
        points: q?.points !== undefined ? q.points : 1000,
        timeLimit: q?.timeLimit || 20,
      },
    };
  }

  standingFor(game, userUuid) {
    const ranked = rankPlayers(game.players);
    const me = ranked.find((p) => p.userUuid === userUuid);
    const leader = ranked[0] || null;
    const rank = me ? me.rank : ranked.length + 1;
    return {
      rank,
      totalPlayers: ranked.length,
      score: me ? me.score : 0,
      streak: me ? me.streak : 0,
      pointsBehindLeader: me && leader && leader.userUuid !== userUuid ? Math.max(0, leader.score - me.score) : 0,
      leaderName: leader && leader.userUuid !== userUuid ? leader.nickname : '',
      isOnLeaderboard: rank <= 5,
    };
  }

  finalResultFor(game, userUuid) {
    const ranked = rankPlayers(game.players);
    const me = ranked.find((p) => p.userUuid === userUuid);
    const rank = me ? me.rank : ranked.length + 1;
    return {
      rank,
      totalPlayers: ranked.length,
      totalScore: me ? me.score : 0,
      isWinner: rank === 1,
      isPodium: rank <= 3,
    };
  }

  getPlayerResumeEvents(game, userUuid) {
    switch (game.state) {
      case 'GET_READY':
        return [['game_state_changed', this.getReadyPayload(game)]];
      case 'QUESTION_ACTIVE':
        return [
          [
            'question_active',
            {
              ...this.activePayload(game, 'player', this.playerOptions(game)),
              alreadyAnswered: Boolean(game.answers.get(game.currentQuestionIndex)?.has(userUuid)),
            },
          ],
        ];
      case 'QUESTION_REVEAL': {
        const r = game.lastPlayerResults?.get(userUuid);
        return r ? [['player_feedback', r]] : [['game_state_changed', { state: 'QUESTION_REVEAL' }]];
      }
      case 'SCOREBOARD':
        return [['player_standing', this.standingFor(game, userUuid)]];
      case 'PODIUM':
        return [['final_results', this.finalResultFor(game, userUuid)]];
      default:
        return [];
    }
  }

  startGame(pin) {
    const game = this.getGameByPinOrId(pin);
    if (!game || game.state !== 'LOBBY' || !game.quiz?.questions?.length) {
      game?.logger?.warn('START_GAME_FAILED', `Could not start game in state ${game?.state || 'UNKNOWN'}`);
      return false;
    }

    game.logger?.info('HOST_ACTION', 'Host started the game', { totalPlayers: game.players.size });

    if (game.settings.randomizeQuestions) {
      game.quiz.questions = shuffleArray(game.quiz.questions);
      game.logger?.info('SETTINGS_APPLIED', 'Questions randomized');
    }

    game.currentQuestionIndex = 0;
    this.transitionToGetReady(game);
    return true;
  }

  endGame(pin) {
    const game = this.getGameByPinOrId(pin);
    if (!game || game.state === 'PODIUM') return false;
    game.logger?.warn('HOST_ACTION', 'Host ended game', { state: game.state });
    if (game.state === 'LOBBY') {
      this.io.to(game.pin).emit('player_kicked', { reason: 'The host closed this game' });
      this.deleteGame(game.pin);
      return true;
    }
    this.transitionToPodium(game);
    return true;
  }

  transitionToGetReady(game) {
    if (!this.setState(game, 'GET_READY')) return;

    const payload = this.getReadyPayload(game);
    const q = this.currentQuestion(game);
    game.logger?.info('GET_READY_INIT', `Question #${game.currentQuestionIndex + 1}: "${q?.title || 'Untitled'}"`, {
      type: q?.type || 'quiz',
      timeLimit: q?.timeLimit || 20,
      points: q?.points ?? 1000,
      isMultiSelect: Boolean(q?.isMultiSelect),
    });

    this.io.to(game.pin).emit('game_state_changed', payload);

    const timer = setTimeout(() => {
      if (game.state === 'GET_READY') {
        this.transitionToQuestionActive(game);
      }
    }, 6000);
    this.addGameTimer(game.pin, timer);
  }

  transitionToQuestionActive(game) {
    if (!this.setState(game, 'QUESTION_ACTIVE')) return;

    const question = this.currentQuestion(game);
    if (!question) {
      game.logger?.error('QUESTION_ACTIVE_FAILED', 'Current question is missing or undefined');
      this.transitionToPodium(game);
      return;
    }

    let activeOptions = [...(question.options || [])];
    if (game.settings.randomizeAnswers && question.type === 'quiz') {
      activeOptions = shuffleArray(activeOptions);
      game.logger?.info('SETTINGS_APPLIED', `Answer options randomized for Q#${game.currentQuestionIndex + 1}`);
    }

    game.currentQuestionOptions = activeOptions;
    game.questionStartTime = Date.now();
    game.questionTimeLimit = question.timeLimit || 20;
    game.answers.set(game.currentQuestionIndex, new Map());

    game.logger?.info('QUESTION_STARTED', `Timer started: ${game.questionTimeLimit}s for Q#${game.currentQuestionIndex + 1}`, {
      questionId: question.id,
      optionsCount: activeOptions.length,
      startedAt: new Date(game.questionStartTime).toISOString(),
    });

    // Host payload
    if (game.hostSocketId) {
      this.io.to(game.hostSocketId).emit('question_active', this.activePayload(game, 'host', activeOptions));
    }

    // Player payloads: send sanitized options without order or isCorrect
    for (const player of game.players.values()) {
      if (!player.socketId) continue;
      const opts = this.playerOptions(game);
      const alreadyAnswered = Boolean(game.answers.get(game.currentQuestionIndex)?.has(player.userUuid));
      this.io.to(player.socketId).emit('question_active', {
        ...this.activePayload(game, 'player', opts),
        alreadyAnswered,
      });
    }

    const timer = setTimeout(() => {
      if (game.state === 'QUESTION_ACTIVE') {
        this.transitionToQuestionReveal(game);
      }
    }, game.questionTimeLimit * 1000);
    this.addGameTimer(game.pin, timer);
  }

  submitAnswer(pinOrId, userUuid, answerPayload) {
    const game = this.getGameByPinOrId(pinOrId);
    if (!game || game.state !== 'QUESTION_ACTIVE') {
      game?.logger?.warn('ANSWER_REJECTED', `Answer rejected: state is ${game?.state || 'UNKNOWN'}`, { userUuid, payload: answerPayload });
      return { success: false, error: 'Cannot submit answer right now' };
    }

    if (!userUuid || !game.players.has(userUuid)) {
      game.logger?.warn('ANSWER_REJECTED', 'Player session not found in this game', { userUuid, payload: answerPayload });
      return { success: false, error: 'Player session not found in this game' };
    }

    const questionAnswers = game.answers.get(game.currentQuestionIndex);
    if (!questionAnswers) {
      game.logger?.error('ANSWER_REJECTED', `No answer container for Q#${game.currentQuestionIndex + 1}`);
      return { success: false };
    }

    // Idempotent submission: duplicate returns success
    if (questionAnswers.has(userUuid)) {
      const player = game.players.get(userUuid);
      game.logger?.unusualRequest('DUPLICATE_ANSWER', player.socketId, { userUuid, nickname: player.nickname, payload: answerPayload });
      return { success: true, duplicate: true };
    }

    const responseTimeMs = Date.now() - game.questionStartTime;
    const record = {
      userUuid,
      answerPayload,
      responseTimeMs,
      submittedAt: Date.now(),
      scoreResult: null,
    };

    questionAnswers.set(userUuid, record);

    if (game.hostSocketId) {
      this.io.to(game.hostSocketId).emit('answer_count_updated', {
        answersReceived: questionAnswers.size,
        totalPlayers: game.players.size,
      });
    }

    const submittingPlayer = game.players.get(userUuid);
    if (submittingPlayer) {
      submittingPlayer.connected = true;
    }

    game.logger?.info('ANSWER_RECEIVED', `Player "${submittingPlayer?.nickname}" (${userUuid}) submitted answer in ${responseTimeMs}ms`, {
      questionIndex: game.currentQuestionIndex,
      responseTimeMs,
      payload: answerPayload,
      answersCount: questionAnswers.size,
      totalPlayers: game.players.size,
    });

    if (this.allActivePlayersAnswered(game)) {
      this.scheduleReveal(game, 500);
    }

    return { success: true };
  }

  applyQuestionScores(game) {
    const q = this.currentQuestion(game);
    const results = new Map();
    if (!q) return results;
    const answers = game.answers.get(game.currentQuestionIndex) ?? new Map();

    for (const [uuid, player] of game.players.entries()) {
      const record = answers.get(uuid);
      const scoreResult = record
        ? calculateQuestionScore(q, record.answerPayload, record.responseTimeMs)
        : { points: 0, isCorrect: false, isPartial: false, isExact: false, accuracy: 0, timeScore: 0 };

      if (record) {
        record.scoreResult = scoreResult;
      }

      const fullyCorrect = scoreResult.isCorrect && !scoreResult.isPartial;
      player.streak = fullyCorrect ? player.streak + 1 : scoreResult.isCorrect ? player.streak : 0;
      const streakBonus = fullyCorrect && q.points > 0 ? calculateStreakBonus(player.streak) : 0;
      const pointsEarned = scoreResult.points + streakBonus;
      player.score += pointsEarned;

      results.set(uuid, {
        scoreResult,
        pointsEarned,
      });

      if (record) {
        game.logger?.answerSubmitted(player, game.currentQuestionIndex, record.answerPayload, { ...scoreResult, points: pointsEarned }, record.responseTimeMs);
      } else {
        game.logger?.info('ANSWER_TIMEOUT', `Player "${player.nickname}" (${uuid}) timed out on Q#${game.currentQuestionIndex + 1} (0 points)`);
      }
    }
    return results;
  }

  transitionToQuestionReveal(game) {
    if (!this.setState(game, 'QUESTION_REVEAL')) return;

    const question = this.currentQuestion(game);
    if (!question) {
      this.transitionToPodium(game);
      return;
    }
    const questionAnswers = game.answers.get(game.currentQuestionIndex) || new Map();
    const scoredResults = this.applyQuestionScores(game);

    const voteDistribution = {};
    (question.options || []).forEach((opt) => {
      voteDistribution[opt.id] = 0;
    });

    const playerResults = new Map();
    const correctOptionIds = (question.options || []).filter((opt) => opt.isCorrect).map((opt) => opt.id);
    const revealOptionViews = (game.currentQuestionOptions || question.options || []).map((o, idx) => ({
      id: o.id,
      text: o.text,
      isCorrect: Boolean(o.isCorrect),
      order: o.order ?? idx,
      colorIndex: o.colorIndex ?? idx,
    }));

    for (const [userUuid, player] of game.players.entries()) {
      const submission = questionAnswers.get(userUuid);
      const { scoreResult, pointsEarned } = scoredResults.get(userUuid);

      if (submission) {
        if (['quiz', 'true_false', 'yes_no', 'picture_reveal'].includes(question.type)) {
          const selected = normalizeSelected(submission.answerPayload);
          selected.forEach((id) => {
            if (voteDistribution[id] !== undefined) {
              voteDistribution[id]++;
            }
          });
        }
      }

      const userSelected = submission ? normalizeSelected(submission.answerPayload) : [];

      playerResults.set(userUuid, {
        isCorrect: scoreResult.isCorrect,
        isPartial: Boolean(scoreResult.isPartial),
        isExact: Boolean(scoreResult.isExact),
        pointsEarned,
        accuracy: scoreResult.accuracy,
        totalScore: player.score,
        streak: player.streak,
        questionType: question.type,
        isMultiSelect: Boolean(question.isMultiSelect),
        correctOptionIds,
        selectedOptionIds: userSelected,
        options: revealOptionViews,
        numberTarget: question.numberTarget,
        playerGuess: submission?.answerPayload?.number,
        userInput: scoreResult.userInput || submission?.answerPayload?.text || submission?.answerPayload?.answers,
        matchedAccepted: scoreResult.matchedAccepted,
        acceptedAnswers: question.acceptedAnswers || [],
      });
    }

    let puzzleStats = null;
    let revealOptions = revealOptionViews;

    if (question.type === 'puzzle') {
      puzzleStats = {
        correct: 0,
        partial: 0,
        wrong: 0,
        total: game.players.size,
      };

      for (const [userUuid] of game.players.entries()) {
        const res = playerResults.get(userUuid);
        if (res && res.isCorrect && !res.isPartial) puzzleStats.correct++;
        else if (res && res.isCorrect && res.isPartial) puzzleStats.partial++;
        else puzzleStats.wrong++;
      }

      revealOptions = [...(question.options || [])]
        .map((opt, originalIdx) => ({
          ...opt,
          order: opt.order ?? originalIdx,
          colorIndex: opt.colorIndex ?? originalIdx,
        }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    const numberGuesses = [];
    if (question.type === 'number_guess') {
      for (const [userUuid, player] of game.players.entries()) {
        const submission = questionAnswers.get(userUuid);
        if (submission && !isNaN(Number(submission.answerPayload?.number))) {
          const guessVal = Number(submission.answerPayload.number);
          const targetVal = Number(question.numberTarget ?? 0);
          numberGuesses.push({
            userUuid,
            nickname: player.nickname,
            avatar: player.avatar,
            guess: guessVal,
            distance: Math.abs(guessVal - targetVal),
          });
        }
      }
      numberGuesses.sort((a, b) => a.distance - b.distance);
    }

    const wordSubmissions = {};
    if (question.type === 'word_guess') {
      for (const [userUuid] of game.players.entries()) {
        const submission = questionAnswers.get(userUuid);
        if (submission) {
          const words = extractWordInputs(submission.answerPayload);
          words.forEach((w) => {
            const key = normalizeString(w, Boolean(question.caseSensitive));
            if (key) {
              wordSubmissions[key] = (wordSubmissions[key] || 0) + 1;
            }
          });
        }
      }
    }

    const hostRevealPayload = {
      state: 'QUESTION_REVEAL',
      questionIndex: game.currentQuestionIndex,
      question: {
        id: question.id,
        type: question.type,
        title: question.title,
        image: question.image,
        tileLevel: question.tileLevel || 'medium',
        theme: question.theme || game.quiz?.theme || 'spring',
        backgroundImage: question.backgroundImage || game.quiz?.backgroundImage,
        options: revealOptions,
        numberTarget: question.numberTarget,
        numberMin: question.numberMin ?? 0,
        numberMax: question.numberMax ?? 100,
        acceptedAnswers: question.acceptedAnswers || [],
        allowMultipleAnswers: question.allowMultipleAnswers,
        fuzzyMatching: question.fuzzyMatching,
        fuzzyScorePercentage: question.fuzzyScorePercentage,
      },
      voteDistribution,
      puzzleStats,
      numberGuesses,
      wordSubmissions,
      totalAnswers: questionAnswers.size,
    };

    game.lastRevealPayload = hostRevealPayload;

    if (game.hostSocketId) {
      this.io.to(game.hostSocketId).emit('question_reveal', hostRevealPayload);
    }

    for (const [userUuid, player] of game.players.entries()) {
      if (player.socketId) {
        const result = playerResults.get(userUuid);
        this.io.to(player.socketId).emit('player_feedback', result);
      }
    }

    game.lastPlayerResults = playerResults;
  }

  transitionToScoreboard(game) {
    if (!this.setState(game, 'SCOREBOARD')) return;

    const leaderboard = rankPlayers(game.players).slice(0, 5);
    game.logger?.info('SCOREBOARD_STATS', `Scoreboard for Q#${game.currentQuestionIndex + 1}`, {
      top5: leaderboard.map((p) => ({ rank: p.rank, nickname: p.nickname, score: p.score })),
    });

    const scoreboardPayload = {
      state: 'SCOREBOARD',
      questionIndex: game.currentQuestionIndex,
      totalQuestions: game.quiz.questions.length,
      leaderboard,
    };

    game.lastScoreboardPayload = scoreboardPayload;

    if (game.hostSocketId) {
      this.io.to(game.hostSocketId).emit('scoreboard_update', scoreboardPayload);
    }

    for (const [userUuid, player] of game.players.entries()) {
      if (player.socketId) {
        this.io.to(player.socketId).emit('player_standing', this.standingFor(game, userUuid));
      }
    }
  }

  recordResults(game) {
    if (game.resultsRecorded) return;
    game.resultsRecorded = true;

    try {
      generateGameReport(game);
    } catch (err) {
      console.error('Failed to generate game report:', err);
    }

    try {
      const isGetReady = game.state === 'GET_READY' || game.prevState === 'GET_READY';
      const quizLength = game.quiz?.questions?.length || 0;
      const totalQuestions =
        game.currentQuestionIndex !== undefined && game.currentQuestionIndex !== null && game.currentQuestionIndex >= 0
          ? Math.min(quizLength, isGetReady ? Math.max(0, game.currentQuestionIndex) : game.currentQuestionIndex + 1)
          : (game.currentQuestionIndex === -1 ? 0 : quizLength);
      const rankedPlayers = rankPlayers(game.players);

      for (const [userUuid, player] of game.players.entries()) {
        const myRankInfo = rankedPlayers.find((r) => r.userUuid === userUuid);
        const rank = myRankInfo ? myRankInfo.rank : rankedPlayers.length;

        let correctCount = 0;
        for (let qIdx = 0; qIdx < totalQuestions; qIdx++) {
          const qAnswers = game.answers.get(qIdx);
          const sub = qAnswers ? qAnswers.get(userUuid) : null;
          if (sub) {
            const isCorrect = sub.scoreResult?.isCorrect ?? calculateQuestionScore(game.quiz.questions[qIdx], sub.answerPayload, sub.responseTimeMs).isCorrect;
            if (isCorrect) correctCount++;
          }
        }
        const accuracy = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

        recordGameResult(userUuid, {
          pin: game.pin,
          gamePin: game.pin,
          gameId: game.gameId,
          quizTitle: game.quiz?.title || 'Quiz',
          score: player.score,
          rank,
          totalPlayers: rankedPlayers.length,
          streak: player.streak,
          correctCount,
          totalQuestions,
          accuracy,
          nickname: player.nickname,
          avatar: player.avatar,
        });
      }
    } catch (err) {
      console.error('Failed to update player profiles:', err);
    }
  }

  transitionToPodium(game) {
    const wasActive = game.state === 'QUESTION_ACTIVE';
    if (!this.setState(game, 'PODIUM')) return;
    if (wasActive) {
      this.applyQuestionScores(game);
    }
    game.podiumReachedAt = Date.now();

    const rankedPlayers = rankPlayers(game.players);
    const podiumRanks = rankedPlayers.slice(0, 3).map((p) => ({ rank: p.rank, nickname: p.nickname, score: p.score }));
    game.logger?.gameEnded({
      totalPlayers: rankedPlayers.length,
      totalQuestions: game.quiz?.questions?.length || 0,
      podium: podiumRanks,
    });

    const podiumData = {
      state: 'PODIUM',
      first: rankedPlayers[0] || null,
      second: rankedPlayers[1] || null,
      third: rankedPlayers[2] || null,
      runnersUp: rankedPlayers.slice(3, 10),
      totalPlayers: rankedPlayers.length,
    };

    game.lastPodiumPayload = podiumData;

    if (game.hostSocketId) {
      this.io.to(game.hostSocketId).emit('podium_update', podiumData);
    }

    // Notify all players of final podium celebration (strip firstPlace to prevent userUuid leakage)
    for (const player of game.players.values()) {
      if (player.socketId) {
        this.io.to(player.socketId).emit('final_results', this.finalResultFor(game, player.userUuid));
      }
    }

    this.recordResults(game);
  }

  handleHostNext(pinOrId) {
    const game = this.getGameByPinOrId(pinOrId);
    if (!game || !this.checkHostCooldown(game)) return false;

    const isLast = game.currentQuestionIndex + 1 >= (game.quiz?.questions?.length || 0);
    game.logger?.info('HOST_ACTION', `Host clicked Next / Skip in state ${game.state}`, {
      questionIndex: game.currentQuestionIndex,
      isLast,
    });

    const step = {
      GET_READY: () => this.transitionToQuestionActive(game),
      QUESTION_ACTIVE: () => this.transitionToQuestionReveal(game),
      QUESTION_REVEAL: () => (isLast ? this.transitionToPodium(game) : this.transitionToScoreboard(game)),
      SCOREBOARD: () => {
        game.currentQuestionIndex++;
        this.transitionToGetReady(game);
      },
    }[game.state];

    if (!step) return false;
    game.lastHostTransitionTime = Date.now();
    step();
    return true;
  }

  handleDisconnect(socketId) {
    const info = this.socketToGame.get(socketId);
    if (!info) return;

    this.socketToGame.delete(socketId);

    const game = this.games.get(info.pin);
    if (!game) return;

    if (info.role === 'host') {
      console.log(`Host disconnected from game PIN ${info.pin}`);
      game.logger?.info('HOST_DISCONNECT', `Host socket ${socketId} disconnected from game PIN ${info.pin}`);
    } else if (info.role === 'player') {
      const player = game.players.get(info.userUuid);
      if (player && player.socketId === socketId) {
        player.connected = false;
        console.log(`Player ${player.nickname} disconnected from game PIN ${info.pin}`);
        game.logger?.playerDisconnected(player, socketId, 'WebSocket disconnected');
        this.notifyHostPlayersUpdate(game);

        if (game.state === 'QUESTION_ACTIVE' && this.allActivePlayersAnswered(game)) {
          this.scheduleReveal(game, 500);
        }
      }
    }
  }

  getActiveSessionForUser(userUuid) {
    if (!userUuid) return null;
    for (const game of this.games.values()) {
      if (game.state === 'PODIUM') continue;
      const player = game.players.get(userUuid);
      if (player) {
        return {
          pin: game.pin,
          gameId: game.gameId,
          gameState: game.state,
          quizTitle: game.quiz?.title,
          player: toPublicPlayer(player),
        };
      }
    }
    return null;
  }

  getHostStateData(pinOrId) {
    const game = this.getGameByPinOrId(pinOrId);
    if (!game) return null;

    const baseData = {
      success: true,
      pin: game.pin,
      gameId: game.gameId,
      quizTitle: game.quiz?.title,
      totalQuestions: game.quiz?.questions?.length || 0,
      state: game.state,
      settings: game.settings,
      players: Array.from(game.players.values()).map(toPublicPlayer),
      currentQuestionIndex: game.currentQuestionIndex,
    };

    if (game.state === 'GET_READY') {
      const q = this.currentQuestion(game);
      if (q) {
        baseData.currentQuestion = {
          id: q.id,
          title: q.title,
          type: q.type,
          timeLimit: q.timeLimit,
          points: q.points !== undefined ? q.points : 1000,
          isMultiSelect: Boolean(q.isMultiSelect),
          image: q.image,
          index: game.currentQuestionIndex + 1,
          total: game.quiz.questions.length,
          options: (q.options || []).map((o, idx) => ({
            id: o.id,
            text: o.text,
            colorIndex: o.colorIndex ?? idx,
          })),
        };
      }
    } else if (game.state === 'QUESTION_ACTIVE') {
      const activePayload = this.activePayload(game, 'host', game.currentQuestionOptions);
      baseData.activeQuestionData = activePayload;
      baseData.currentQuestion = activePayload?.question;
      baseData.questionStartTime = game.questionStartTime;
      baseData.timeLimit = game.questionTimeLimit;
      baseData.remainingTimeMs = activePayload?.remainingTimeMs;
      baseData.remainingSeconds = activePayload?.remainingSeconds;
      baseData.answersCount = activePayload?.answersReceived || 0;
    } else if (game.state === 'QUESTION_REVEAL') {
      baseData.revealData = game.lastRevealPayload || null;
      if (game.lastRevealPayload) {
        baseData.revealQuestion = game.lastRevealPayload.question;
        baseData.currentQuestion = game.lastRevealPayload.question;
        baseData.voteDistribution = game.lastRevealPayload.voteDistribution;
        baseData.puzzleStats = game.lastRevealPayload.puzzleStats;
        baseData.numberGuesses = game.lastRevealPayload.numberGuesses;
        baseData.wordSubmissions = game.lastRevealPayload.wordSubmissions || {};
        baseData.totalAnswers = game.lastRevealPayload.totalAnswers;
      }
    } else if (game.state === 'SCOREBOARD') {
      baseData.scoreboardData = game.lastScoreboardPayload || null;
      if (game.lastScoreboardPayload) {
        baseData.leaderboard = game.lastScoreboardPayload.leaderboard;
      }
    } else if (game.state === 'PODIUM') {
      baseData.podiumData = game.lastPodiumPayload || null;
    }

    return baseData;
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const pin of this.games.keys()) {
      this.clearGameTimer(pin);
    }
    this.games.clear();
    this.gamesById.clear();
    this.socketToGame.clear();
  }
}
