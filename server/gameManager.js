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
  cleanAnswer,
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

// A player whose connection dropped this recently still counts as present when deciding whether
// "everyone answered", so a short network blip does not end the question before they reconnect.
export const RECONNECT_GRACE_MS = 5000;

// How long the Get Ready screen shows before the question starts
export const GET_READY_MS = 6000;

// Socket.IO rooms. Every socket bound to a game is in the game room (`pin`) plus its role room,
// so all tabs/devices of the same host or player receive the same events.
export const hostRoom = (pin) => `${pin}:host`;
export const playerRoom = (pin, userUuid) => `${pin}:player:${userUuid}`;

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

// Puzzle options are shown shuffled, but never already in the solved order.
function shufflePuzzle(options) {
  if (options.length < 2) return options;
  const isSolved = (list) => list.every((o, i) => o.order === i);
  let shuffled = shuffleArray(options);
  for (let i = 0; i < 10 && isSolved(shuffled); i++) {
    shuffled = shuffleArray(options);
  }
  return shuffled;
}

export class GameManager {
  constructor(io) {
    this.io = io;
    this.games = new Map(); // pin -> gameState
    this.gamesById = new Map(); // gameId -> pin
    this.timers = new Map(); // pin -> Set of timer handles

    // Periodic cleanup of stale games (runs every 10 minutes)
    this.cleanupInterval = setInterval(() => {
      this.pruneOldGames();
    }, 10 * 60 * 1000);
    this.cleanupInterval.unref();
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
    this.gamesById.delete(game.gameId);
    return true;
  }

  // Tells every connected host and player that the game is gone, then unbinds their sockets.
  closeGame(game, reason) {
    this.io.to(game.pin).emit('game_closed', { reason });
    this.deleteGame(game.pin);
    for (const socket of this.socketsIn(game.pin)) {
      this.detach(socket);
    }
  }

  // Prune games idle past 2 hours, or finished games past 30 minutes
  pruneOldGames() {
    const now = Date.now();
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;

    for (const game of [...this.games.values()]) {
      const idleTime = now - (game.lastStateTransitionTime || 0);
      const isPodiumExpired =
        game.state === 'PODIUM' && game.podiumReachedAt && now - game.podiumReachedAt > THIRTY_MINUTES_MS;

      if (idleTime > TWO_HOURS_MS || isPodiumExpired) {
        this.closeGame(game, 'This game has ended');
      }
    }
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

  // showQuestionsOnPlayerScreens is the host's remembered choice from their previous game
  createGame(quizId, { showQuestionsOnPlayerScreens = true } = {}) {
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
      state: 'LOBBY',
      currentQuestionIndex: -1,
      questionStartTime: 0,
      questionTimeLimit: 20,
      lastStateTransitionTime: Date.now(),
      resultsRecorded: false,
      players: new Map(), // userUuid -> Player
      answers: new Map(), // questionIndex -> Map(userUuid, AnswerRecord)
      settings: {
        randomizeAnswers: false,
        randomizeQuestions: false,
        showQuestionsOnPlayerScreens: showQuestionsOnPlayerScreens !== false,
        lockGame: false,
      },
      currentQuestionOptions: null, // option order shown on the host screen
      playerQuestionOptions: null, // option order sent to every player (puzzles shuffled once per question)
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

  updateSettings(game, newSettings) {
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

  // Validates a join and adds/updates the player. Binding a socket to the player is attachPlayer's job.
  joinPlayer(pinOrId, nickname, userUuid, avatar) {
    const game = this.getGameByPinOrId(pinOrId);
    if (!game) {
      return { success: false, error: 'Game not found. Please check your PIN.' };
    }

    if (!userUuid || !isValidId(userUuid)) {
      game.logger?.warn('JOIN_FAILED', 'User UUID required to join game', { userUuid });
      return { success: false, error: 'User UUID required to join game' };
    }

    // Returning player: may rename / change avatar while still in the lobby
    const existing = game.players.get(userUuid);
    if (existing) {
      if (game.state === 'LOBBY') {
        const { name, taken } = this.cleanNickname(game, nickname, userUuid);
        if (name && !taken) {
          existing.nickname = name;
        }
        const validAvatar = cleanAvatar(avatar);
        if (validAvatar) {
          existing.avatar = validAvatar;
        }
      }
      return { success: true, isReconnect: true, game, player: existing };
    }

    if (game.state === 'PODIUM') {
      game.logger?.warn('JOIN_FAILED', 'Cannot join ended game in PODIUM state', { userUuid, nickname });
      return { success: false, error: 'This game has already ended.' };
    }

    if (game.settings.lockGame) {
      game.logger?.warn('JOIN_FAILED', 'Game locked by host to new players', { userUuid, nickname });
      return { success: false, error: 'This game is locked by the host.' };
    }

    const { name: cleanName, taken } = this.cleanNickname(game, nickname, userUuid);
    if (!cleanName) {
      game.logger?.warn('JOIN_FAILED', 'Invalid nickname provided', { userUuid, nickname });
      return { success: false, error: 'Please enter a valid nickname.' };
    }
    if (taken) {
      game.logger?.warn('JOIN_FAILED', `Nickname "${cleanName}" already taken in game`, { userUuid });
      return { success: false, error: 'That nickname is already taken in this game.' };
    }

    const player = {
      userUuid,
      nickname: cleanName,
      avatar: cleanAvatar(avatar) || '🦊',
      score: 0,
      streak: 0,
      connected: false, // set by attachPlayer
    };
    game.players.set(userUuid, player);
    return { success: true, isReconnect: false, game, player };
  }

  socketsIn(room) {
    const ids = this.io.sockets.adapter.rooms.get(room) ?? [];
    return [...ids].map((id) => this.io.sockets.sockets.get(id)).filter(Boolean);
  }

  // Recomputes a player's connected flag from the sockets in their room; returns true if it changed.
  syncConnected(game, player) {
    const connected = (this.io.sockets.adapter.rooms.get(playerRoom(game.pin, player.userUuid))?.size ?? 0) > 0;
    if (player.connected === connected) return false;
    player.connected = connected;
    player.disconnectedAt = connected ? null : Date.now();
    return true;
  }

  isPresent(player) {
    return player.connected || Date.now() - player.disconnectedAt < RECONNECT_GRACE_MS;
  }

  // Binds a socket to a player and replays the current game state to it.
  attachPlayer(socket, game, userUuid, isReconnect) {
    // Re-joining the same player (e.g. a lobby rename) must not flash them as disconnected
    if (socket.data.pin !== game.pin || socket.data.userUuid !== userUuid) {
      this.detach(socket);
    }
    socket.data = { pin: game.pin, role: 'player', userUuid };
    socket.join([game.pin, playerRoom(game.pin, userUuid)]);

    const player = game.players.get(userUuid);
    this.syncConnected(game, player);
    game.logger?.playerConnected(player, isReconnect, socket.id);
    this.notifyHostPlayersUpdate(game);

    socket.emit('join_success', {
      pin: game.pin,
      gameId: game.gameId,
      settings: game.settings,
      player: toPublicPlayer(player),
    });
    for (const [event, payload] of this.getPlayerResumeEvents(game, userUuid)) {
      socket.emit(event, payload);
    }
  }

  // Binds a freshly connected socket to the host of a game and replays the current game state to it.
  attachHost(socket, game) {
    socket.data = { pin: game.pin, role: 'host' };
    socket.join([game.pin, hostRoom(game.pin)]);
    game.logger?.info('HOST_CONNECT', `Host joined/reconnected via socket ${socket.id}`, { socketId: socket.id });

    socket.emit('host_game_data', {
      pin: game.pin,
      gameId: game.gameId,
      quizTitle: game.quiz.title,
      totalQuestions: game.quiz.questions.length,
      state: game.state,
      currentQuestionIndex: game.currentQuestionIndex,
      settings: game.settings,
      players: Array.from(game.players.values()).map(toPublicPlayer),
    });
    for (const [event, payload] of this.getHostResumeEvents(game)) {
      socket.emit(event, payload);
    }
  }

  // Unbinds a socket from its game (rebinding, kick, game closed).
  detach(socket) {
    const { pin, role, userUuid } = socket.data;
    if (!pin) return;
    socket.leave(pin);
    socket.leave(role === 'host' ? hostRoom(pin) : playerRoom(pin, userUuid));
    socket.data = {};
    if (role === 'player') {
      this.onPlayerSocketGone(this.games.get(pin), userUuid, socket.id);
    }
  }

  handleDisconnect(socket) {
    const { pin, role } = socket.data;
    if (role === 'host') {
      this.games.get(pin)?.logger?.info('HOST_DISCONNECT', `Host socket ${socket.id} disconnected from game PIN ${pin}`);
    }
    this.detach(socket);
  }

  // A player is disconnected only once none of their sockets (tabs/devices) are left.
  onPlayerSocketGone(game, userUuid, socketId) {
    const player = game?.players.get(userUuid);
    if (!player || !this.syncConnected(game, player)) return;
    game.logger?.playerDisconnected(player, socketId, 'WebSocket disconnected');
    this.notifyHostPlayersUpdate(game);
    this.revealIfAllAnswered(game);
  }

  updatePlayerAvatar(game, userUuid, avatar) {
    const player = game.players.get(userUuid);
    const validAvatar = cleanAvatar(avatar);
    if (player && validAvatar) {
      player.avatar = validAvatar;
      this.notifyHostPlayersUpdate(game);
      this.io.to(playerRoom(game.pin, userUuid)).emit('player_avatar_updated', { avatar: validAvatar });
      game.logger?.avatarUpdated(userUuid, player.nickname, validAvatar);
      return true;
    }
    return false;
  }

  kickPlayer(game, userUuid) {
    const player = game.players.get(userUuid);
    if (!player) return false;

    const room = playerRoom(game.pin, userUuid);
    this.io.to(room).emit('player_kicked', { reason: 'Host removed you from game' });
    game.players.delete(userUuid);
    for (const socket of this.socketsIn(room)) {
      this.detach(socket);
    }
    this.notifyHostPlayersUpdate(game);
    game.logger?.playerKicked(userUuid, player.nickname, 'Host removed you from game');
    if (game.state === 'QUESTION_ACTIVE') {
      // Their answer leaves with them (counts, reveal, and a fresh start if they join again)
      game.answers.get(game.currentQuestionIndex).delete(userUuid);
      this.notifyHostAnswerCount(game);
      this.revealIfAllAnswered(game);
    }
    return true;
  }

  notifyHostPlayersUpdate(game) {
    const playersList = Array.from(game.players.values()).map(toPublicPlayer);
    this.io.to(hostRoom(game.pin)).emit('players_updated', {
      count: playersList.length,
      players: playersList,
    });
  }

  notifyHostAnswerCount(game) {
    this.io.to(hostRoom(game.pin)).emit('answer_count_updated', {
      answersReceived: game.answers.get(game.currentQuestionIndex).size,
      totalPlayers: game.players.size,
    });
  }

  emitToPlayers(game, event, payloadFor) {
    for (const userUuid of game.players.keys()) {
      this.io.to(playerRoom(game.pin, userUuid)).emit(event, payloadFor(userUuid));
    }
  }

  // Reveals early once every player who is here has answered (if nobody is here, once everyone has).
  // A player whose connection dropped less than RECONNECT_GRACE_MS ago is still waited for, and the
  // check runs again when that grace period ends.
  revealIfAllAnswered(game) {
    if (game.state !== 'QUESTION_ACTIVE') return;
    const answers = game.answers.get(game.currentQuestionIndex);
    const everyone = [...game.players.values()];
    const present = everyone.filter((p) => this.isPresent(p));
    const waiting = (present.length > 0 ? present : everyone).filter((p) => !answers.has(p.userUuid));

    if (everyone.length > 0 && waiting.length === 0) {
      this.scheduleReveal(game, 500);
    } else if (present.length > 0 && waiting.every((p) => !p.connected)) {
      const firstGraceEnd = Math.min(...waiting.map((p) => p.disconnectedAt + RECONNECT_GRACE_MS));
      this.addGameTimer(game.pin, setTimeout(() => this.revealIfAllAnswered(game), firstGraceEnd - Date.now()));
    }
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

  // Theme and background of the current question. Every host screen payload carries them, so a
  // refreshed or second host tab looks the same as the one that saw the whole game.
  lookOf(game) {
    const q = this.currentQuestion(game);
    return {
      theme: q?.theme || game.quiz?.theme || 'spring',
      backgroundImage: q?.backgroundImage || game.quiz?.backgroundImage,
    };
  }

  questionView(game, audience, options) {
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
      ...this.lookOf(game),
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

  // Clients count down from remainingTimeMs on their own clock, so device clock skew does not matter.
  activePayload(game, audience) {
    const answers = game.answers.get(game.currentQuestionIndex);
    const isHost = audience === 'host';

    return {
      state: 'QUESTION_ACTIVE',
      questionIndex: game.currentQuestionIndex,
      totalQuestions: game.quiz?.questions?.length || 0,
      remainingTimeMs: Math.max(0, game.questionStartTime + game.questionTimeLimit * 1000 - Date.now()),
      question: this.questionView(game, audience, isHost ? game.currentQuestionOptions : game.playerQuestionOptions),
      ...(isHost && {
        answersReceived: answers?.size ?? 0,
        totalPlayers: game.players.size,
      }),
    };
  }

  playerActivePayload(game, userUuid) {
    return {
      ...this.activePayload(game, 'player'),
      alreadyAnswered: Boolean(game.answers.get(game.currentQuestionIndex)?.has(userUuid)),
    };
  }

  getReadyPayload(game) {
    const q = this.currentQuestion(game);
    return {
      state: 'GET_READY',
      questionIndex: game.currentQuestionIndex,
      remainingTimeMs: Math.max(0, game.lastStateTransitionTime + GET_READY_MS - Date.now()),
      questionInfo: {
        index: game.currentQuestionIndex + 1,
        total: game.quiz?.questions?.length || 0,
        type: q?.type || 'quiz',
        title: q?.title,
        ...this.lookOf(game),
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

  // The events a player would have received for the current state, replayed on (re)join.
  getPlayerResumeEvents(game, userUuid) {
    switch (game.state) {
      case 'LOBBY':
        return [['game_state_changed', { state: 'LOBBY' }]];
      case 'GET_READY':
        return [['game_state_changed', this.getReadyPayload(game)]];
      case 'QUESTION_ACTIVE':
        return [['question_active', this.playerActivePayload(game, userUuid)]];
      case 'QUESTION_REVEAL': {
        const r = game.lastPlayerResults?.get(userUuid);
        return r ? [['player_feedback', r]] : [['game_state_changed', { state: 'QUESTION_REVEAL' }]];
      }
      case 'SCOREBOARD':
        return [['player_standing', this.standingFor(game, userUuid)]];
      case 'PODIUM':
        return [['final_results', this.finalResultFor(game, userUuid)]];
    }
  }

  // The events a host screen would have received for the current state, replayed on (re)join.
  getHostResumeEvents(game) {
    switch (game.state) {
      case 'GET_READY':
        return [['game_state_changed', this.getReadyPayload(game)]];
      case 'QUESTION_ACTIVE':
        return [['question_active', this.activePayload(game, 'host')]];
      case 'QUESTION_REVEAL':
        return [['question_reveal', game.lastRevealPayload]];
      case 'SCOREBOARD':
        return [['scoreboard_update', game.lastScoreboardPayload]];
      case 'PODIUM':
        return [['podium_update', game.lastPodiumPayload]];
      default:
        return [];
    }
  }

  startGame(game) {
    if (game.state !== 'LOBBY' || !game.quiz?.questions?.length) {
      game.logger?.warn('START_GAME_FAILED', `Could not start game in state ${game.state}`);
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

  endGame(game) {
    if (game.state === 'PODIUM') return false;
    game.logger?.warn('HOST_ACTION', 'Host ended game', { state: game.state });
    if (game.state === 'LOBBY') {
      this.closeGame(game, 'The host closed this game');
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
    }, GET_READY_MS);
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
    game.playerQuestionOptions = question.type === 'puzzle' ? shufflePuzzle(activeOptions) : activeOptions;
    game.questionStartTime = Date.now();
    game.questionTimeLimit = question.timeLimit || 20;
    game.answers.set(game.currentQuestionIndex, new Map());

    game.logger?.info('QUESTION_STARTED', `Timer started: ${game.questionTimeLimit}s for Q#${game.currentQuestionIndex + 1}`, {
      questionId: question.id,
      optionsCount: activeOptions.length,
      startedAt: new Date(game.questionStartTime).toISOString(),
    });

    this.io.to(hostRoom(game.pin)).emit('question_active', this.activePayload(game, 'host'));
    // Players never receive isCorrect/order; puzzle options are shuffled
    this.emitToPlayers(game, 'question_active', (userUuid) => this.playerActivePayload(game, userUuid));

    const timer = setTimeout(() => {
      if (game.state === 'QUESTION_ACTIVE') {
        this.transitionToQuestionReveal(game);
      }
    }, game.questionTimeLimit * 1000);
    this.addGameTimer(game.pin, timer);
  }

  // questionIndex is the question the player answered; anything else (a late or replayed answer) is rejected.
  submitAnswer(game, userUuid, questionIndex, rawAnswer) {
    if (game.state !== 'QUESTION_ACTIVE' || questionIndex !== game.currentQuestionIndex) {
      game.logger?.warn('ANSWER_REJECTED', `Answer for Q#${Number(questionIndex) + 1} rejected in state ${game.state} (current Q#${game.currentQuestionIndex + 1})`, { userUuid, payload: rawAnswer });
      return { success: false, error: 'This question has already ended' };
    }

    const player = game.players.get(userUuid);
    if (!player) {
      game.logger?.warn('ANSWER_REJECTED', 'Player session not found in this game', { userUuid, payload: rawAnswer });
      return { success: false, error: 'Player session not found in this game' };
    }

    const answerPayload = cleanAnswer(rawAnswer);
    if (answerPayload === null) {
      game.logger?.warn('ANSWER_REJECTED', 'Answer has no usable value', { userUuid, payload: rawAnswer });
      return { success: false, error: 'Invalid answer' };
    }

    // Idempotent submission: a resent answer is acknowledged without changing the first one
    const questionAnswers = game.answers.get(game.currentQuestionIndex);
    if (questionAnswers.has(userUuid)) {
      return { success: true, duplicate: true };
    }

    const responseTimeMs = Date.now() - game.questionStartTime;
    questionAnswers.set(userUuid, {
      userUuid,
      answerPayload,
      responseTimeMs,
      submittedAt: Date.now(),
      scoreResult: null,
    });

    this.notifyHostAnswerCount(game);
    // Every tab of this player switches to "answer submitted"
    this.io.to(playerRoom(game.pin, userUuid)).emit('question_active', this.playerActivePayload(game, userUuid));

    game.logger?.info('ANSWER_RECEIVED', `Player "${player.nickname}" (${userUuid}) submitted answer in ${responseTimeMs}ms`, {
      questionIndex: game.currentQuestionIndex,
      responseTimeMs,
      payload: answerPayload,
      answersCount: questionAnswers.size,
      totalPlayers: game.players.size,
    });

    this.revealIfAllAnswered(game);
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
        ...this.lookOf(game),
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
    game.lastPlayerResults = playerResults;

    this.io.to(hostRoom(game.pin)).emit('question_reveal', hostRevealPayload);
    this.emitToPlayers(game, 'player_feedback', (userUuid) => playerResults.get(userUuid));
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
      ...this.lookOf(game),
    };

    game.lastScoreboardPayload = scoreboardPayload;

    this.io.to(hostRoom(game.pin)).emit('scoreboard_update', scoreboardPayload);
    this.emitToPlayers(game, 'player_standing', (userUuid) => this.standingFor(game, userUuid));
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
      ...this.lookOf(game),
    };

    game.lastPodiumPayload = podiumData;

    this.io.to(hostRoom(game.pin)).emit('podium_update', podiumData);
    // Players only get their own placing (no other players' userUuids)
    this.emitToPlayers(game, 'final_results', (userUuid) => this.finalResultFor(game, userUuid));

    this.recordResults(game);
  }

  // fromState/questionIndex are what the host screen showed when Next/Skip was pressed. If the game has
  // moved on since (timer, everyone answered, another host tab), the click is stale and ignored.
  handleHostNext(game, fromState, questionIndex) {
    if (game.state !== fromState || game.currentQuestionIndex !== questionIndex) return false;

    const isLast = game.currentQuestionIndex + 1 >= (game.quiz?.questions?.length || 0);
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
    game.logger?.info('HOST_ACTION', `Host clicked Next / Skip in state ${game.state}`, {
      questionIndex: game.currentQuestionIndex,
      isLast,
    });
    step();
    return true;
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    for (const pin of this.games.keys()) {
      this.clearGameTimer(pin);
    }
    this.games.clear();
    this.gamesById.clear();
  }
}
