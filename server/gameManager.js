import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { getQuizById, saveGameSnapshot } from './storage.js';
import { calculateQuestionScore, calculateStreakBonus, shuffleArray } from './scoring.js';
import { generateGameReport } from './reportsManager.js';
import { recordGameResult, updatePlayerIdentity } from './playerProfiles.js';

const AVATARS = ['🦊', '🐼', '🦁', '🐯', '🐨', '🐵', '🦄', '🚀', '⚡', '🌟', '🐬', '🦉'];

export class GameManager {
  constructor(io) {
    this.io = io;
    this.games = new Map(); // pin -> gameState
    this.gamesById = new Map(); // gameId -> pin
    this.socketToGame = new Map(); // socket.id -> { pin, role, userUuid }
    this.timers = new Map(); // pin -> Set of timerIds

    // Periodic cleanup of stale games (runs every 10 minutes)
    this.cleanupInterval = setInterval(() => {
      this.pruneOldGames();
    }, 10 * 60 * 1000);
    if (this.cleanupInterval?.unref) {
      this.cleanupInterval.unref();
    }
  }

  // Track a timer handle associated with a game PIN
  addGameTimer(pin, timerId) {
    if (!this.timers.has(pin)) {
      this.timers.set(pin, new Set());
    }
    const entry = this.timers.get(pin);
    if (entry instanceof Set) {
      entry.add(timerId);
    } else {
      const set = new Set([entry, timerId]);
      this.timers.set(pin, set);
    }
    return timerId;
  }

  // Clear all pending timers for a game PIN
  clearGameTimer(pin) {
    if (this.timers.has(pin)) {
      const entry = this.timers.get(pin);
      if (entry instanceof Set || Array.isArray(entry)) {
        for (const t of entry) {
          clearTimeout(t);
        }
      } else {
        clearTimeout(entry);
      }
      this.timers.delete(pin);
    }
  }

  // Explicitly delete a game and clean up timers and socket mappings
  deleteGame(pin) {
    const game = this.games.get(pin);
    if (!game) return false;

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

  // Prune games older than 2 hours or games that reached PODIUM over 30 minutes ago
  pruneOldGames() {
    const now = Date.now();
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;

    for (const [pin, game] of this.games.entries()) {
      const createdTime = game.createdAt ? new Date(game.createdAt).getTime() : now;
      const isPast2Hours = now - createdTime > TWO_HOURS_MS;
      const isPodiumExpired =
        game.state === 'PODIUM' && game.podiumReachedAt && now - game.podiumReachedAt > THIRTY_MINUTES_MS;

      if (isPast2Hours || isPodiumExpired) {
        this.deleteGame(pin);
      }
    }
  }

  // Check cooldown between host-triggered state transitions (1000ms guard)
  checkHostCooldown(game) {
    const now = Date.now();
    if (game.lastHostTransitionTime && now - game.lastHostTransitionTime < 1000) {
      return false;
    }
    return true;
  }

  // Generate unique 6-digit numeric PIN without infinite looping
  generatePin() {
    this.pruneOldGames();
    let attempts = 0;
    const maxAttempts = 1000;
    while (attempts < maxAttempts) {
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      if (!this.games.has(pin)) {
        return pin;
      }
      attempts++;
    }

    // Fallback: systematic search through 6-digit space
    for (let p = 100000; p <= 999999; p++) {
      const pinStr = p.toString();
      if (!this.games.has(pinStr)) {
        return pinStr;
      }
    }

    throw new Error('No available game PINs. All PINs are currently in use.');
  }

  async createGame(quizId, hostSocketId, customHostUrl = '') {
    const quiz = getQuizById(quizId);
    if (!quiz) {
      throw new Error('Quiz not found');
    }

    const pin = this.generatePin();
    const gameId = uuidv4();
    const hostSecret = uuidv4();

    // Clean up any previous game hosted by this hostSocketId
    const existingHostInfo = this.socketToGame.get(hostSocketId);
    if (existingHostInfo && existingHostInfo.role === 'host') {
      const prevGame = this.games.get(existingHostInfo.pin);
      if (prevGame && prevGame.state !== 'PODIUM') {
        this.endGame(prevGame.pin);
      }
    }

    // Generate QR Code for players to join instantly
    // Default join URL with game_id
    const joinPath = `/play?game_id=${pin}`;
    let qrCodeDataUrl = '';
    try {
      qrCodeDataUrl = await QRCode.toDataURL(joinPath);
    } catch (err) {
      console.error('Failed to generate QR code:', err);
    }

    const game = {
      pin,
      gameId,
      hostSecret,
      quizId,
      quiz,
      hostSocketId,
      qrCodeDataUrl,
      state: 'LOBBY', // 'LOBBY' | 'GET_READY' | 'QUESTION_ACTIVE' | 'QUESTION_REVEAL' | 'SCOREBOARD' | 'PODIUM'
      currentQuestionIndex: -1,
      questionStartTime: 0,
      questionTimeLimit: 20,
      lastStateTransitionTime: Date.now(),
      lastHostTransitionTime: 0,
      players: new Map(), // userUuid -> Player
      answers: new Map(), // questionIndex -> Map(userUuid, AnswerData)
      settings: {
        randomizeAnswers: false,
        randomizeQuestions: false,
        showQuestionsOnPlayerScreens: true,
        lockGame: false,
      },
      currentQuestionOptions: null,
      createdAt: new Date().toISOString(),
    };

    this.games.set(pin, game);
    this.gamesById.set(gameId, pin);
    this.socketToGame.set(hostSocketId, { pin, role: 'host', hostSecret });

    saveGameSnapshot(gameId, this.serializeGame(game));
    return game;
  }

  getGameByPin(pin) {
    return this.games.get(pin) || null;
  }

  getGameById(gameId) {
    const pin = this.gamesById.get(gameId);
    if (pin) return this.games.get(pin) || null;
    return null;
  }

  getGameByPinOrId(pinOrId) {
    if (!pinOrId) return null;
    const clean = String(pinOrId).trim().replace(/^(game_id=|gameId=)/i, '');
    return this.games.get(clean) || this.getGameById(clean) || null;
  }

  updateSettings(pin, newSettings = {}) {
    const game = this.getGameByPinOrId(pin);
    if (!game) return false;
    game.settings = { ...game.settings, ...newSettings };
    if (game.hostSocketId) {
      this.io.to(game.hostSocketId).emit('settings_updated', game.settings);
    }
    this.io.to(game.pin).emit('settings_updated', game.settings);
    return true;
  }

  serializeGame(game) {
    const playersList = Array.from(game.players.values()).map((p) => ({
      userUuid: p.userUuid,
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score,
      streak: p.streak,
      connected: p.connected,
    }));

    return {
      pin: game.pin,
      gameId: game.gameId,
      quizId: game.quizId,
      quizTitle: game.quiz.title,
      totalQuestions: game.quiz.questions.length,
      state: game.state,
      currentQuestionIndex: game.currentQuestionIndex,
      playersCount: playersList.length,
      players: playersList,
    };
  }

  // Check if a socket ID is currently live and connected
  isSocketAlive(socketId) {
    if (!socketId) return false;
    const s = this.io.sockets?.sockets?.get(socketId);
    return Boolean(s && s.connected);
  }

  // Get active ongoing game session for a userUuid (across all active games)
  getActiveSessionForUser(userUuid) {
    if (!userUuid) return null;
    const sortedGames = Array.from(this.games.values()).sort(
      (a, b) => (b.lastStateTransitionTime || 0) - (a.lastStateTransitionTime || 0)
    );
    for (const game of sortedGames) {
      if (game.state !== 'PODIUM') {
        const player = game.players.get(userUuid);
        if (player) {
          return {
            pin: game.pin,
            gameId: game.gameId,
            gameState: game.state,
            quizTitle: game.quiz?.title,
            player: {
              userUuid: player.userUuid,
              nickname: player.nickname,
              avatar: player.avatar,
              score: player.score,
              streak: player.streak,
            },
          };
        }
      }
    }
    return null;
  }

  // Join or resume player session using persistent userUuid
  joinPlayer(pin, nickname, requestedUserUuid, socketId, requestedAvatar) {
    const game = this.getGameByPinOrId(pin);
    if (!game) {
      return { success: false, error: 'Game not found with this PIN or Game ID' };
    }

    const cleanName = (nickname || '').trim();
    let userUuid = requestedUserUuid;
    let player = null;

    // 1. Reconnect by explicit userUuid if already registered in this game
    if (userUuid && game.players.has(userUuid)) {
      player = game.players.get(userUuid);
      console.log(`Reconnected player "${player.nickname}" using userUuid: ${userUuid}`);
    }
    // 2. Fallback: match by disconnected nickname if no userUuid was provided
    else if (!userUuid && cleanName) {
      const match = Array.from(game.players.values()).find(
        (p) => p.nickname.trim().toLowerCase() === cleanName.toLowerCase()
      );
      if (match) {
        const isLive = match.connected && this.isSocketAlive(match.socketId);
        if (!isLive) {
          player = match;
          userUuid = match.userUuid;
          console.log(`Resumed disconnected player "${player.nickname}" (userUuid: ${userUuid})`);
        }
      }
    }

    if (player) {
      // Reconnecting / resuming player session!
      player.socketId = socketId;
      player.connected = true;
      if (cleanName && (!player.nickname || game.state === 'LOBBY')) {
        player.nickname = cleanName;
      }
      if (requestedAvatar) {
        player.avatar = requestedAvatar;
      }
      userUuid = player.userUuid || userUuid;
    } else {
      // New player attempting to join
      if (game.settings?.lockGame) {
        return { success: false, error: 'This game is currently locked by the host' };
      }

      if (game.state !== 'LOBBY') {
        return { success: false, error: 'Game already in progress' };
      }

      userUuid = userUuid || uuidv4();

      // Verify nickname uniqueness among other players in this game
      if (cleanName) {
        const nameConflict = Array.from(game.players.values()).find(
          (p) => p.userUuid !== userUuid && p.nickname.trim().toLowerCase() === cleanName.toLowerCase()
        );
        if (nameConflict) {
          return { success: false, error: 'Nickname is already in use by an active player' };
        }
      }

      const finalName = cleanName.slice(0, 20) || `Player ${game.players.size + 1}`;
      const avatar = requestedAvatar || AVATARS[Math.floor(Math.random() * AVATARS.length)];

      player = {
        userUuid,
        socketId,
        nickname: finalName,
        avatar,
        score: 0,
        streak: 0,
        connected: true,
        joinedAt: Date.now(),
      };
      game.players.set(userUuid, player);
    }

    this.socketToGame.set(socketId, { pin: game.pin, role: 'player', userUuid });

    // Sync persistent player profile identity
    try {
      updatePlayerIdentity(userUuid, { nickname: player.nickname, avatar: player.avatar });
    } catch (e) {
      // Non-critical
    }

    // Notify host of updated player list
    this.notifyHostPlayersUpdate(game);

    // Save snapshot
    saveGameSnapshot(game.gameId, this.serializeGame(game));

    return {
      success: true,
      pin: game.pin,
      gameId: game.gameId,
      userUuid,
      player: {
        userUuid: player.userUuid,
        nickname: player.nickname,
        avatar: player.avatar,
        score: player.score,
        streak: player.streak,
      },
      gameState: game.state,
      settings: game.settings,
      quizTitle: game.quiz.title,
    };
  }

  // Update player avatar emoji
  updatePlayerAvatar(pin, userUuid, avatar) {
    const game = this.getGameByPinOrId(pin);
    if (!game) return false;

    const player = game.players.get(userUuid);
    if (player && avatar) {
      player.avatar = avatar;
      try {
        updatePlayerIdentity(userUuid, { avatar });
      } catch (e) {
        // Non-critical
      }
      this.notifyHostPlayersUpdate(game);
      saveGameSnapshot(game.gameId, this.serializeGame(game));
      return true;
    }
    return false;
  }

  // Kick player (by host)
  kickPlayer(pin, userUuid) {
    const game = this.games.get(pin);
    if (!game) return false;

    const player = game.players.get(userUuid);
    if (player) {
      if (player.socketId) {
        this.io.to(player.socketId).emit('player_kicked', { reason: 'Host removed you from game' });
        this.socketToGame.delete(player.socketId);
        try {
          this.io.sockets?.sockets?.get(player.socketId)?.leave(game.pin);
        } catch (e) {}
      }
      game.players.delete(userUuid);
      this.notifyHostPlayersUpdate(game);
      saveGameSnapshot(game.gameId, this.serializeGame(game));
      return true;
    }
    return false;
  }

  notifyHostPlayersUpdate(game) {
    if (!game.hostSocketId) return;
    const playersList = Array.from(game.players.values()).map((p) => ({
      userUuid: p.userUuid,
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score,
      streak: p.streak,
      connected: p.connected,
    }));

    this.io.to(game.hostSocketId).emit('players_updated', {
      count: playersList.length,
      players: playersList,
    });
  }

  // Start game by host
  startGame(pin) {
    const game = this.getGameByPinOrId(pin);
    if (!game) return false;
    if (game.quiz.questions.length === 0) return false;

    if (game.settings?.randomizeQuestions) {
      game.quiz.questions = shuffleArray(game.quiz.questions);
    }

    game.currentQuestionIndex = 0;
    this.transitionToGetReady(game);
    return true;
  }

  // End game early and go straight to podium
  endGame(pin) {
    const game = this.getGameByPinOrId(pin);
    if (!game) return false;
    this.transitionToPodium(game);
    return true;
  }

  // Transition to GET_READY screen
  transitionToGetReady(game) {
    this.clearGameTimer(game.pin);
    game.state = 'GET_READY';
    game.lastStateTransitionTime = Date.now();

    const question = game.quiz.questions[game.currentQuestionIndex];
    const questionInfo = {
      index: game.currentQuestionIndex + 1,
      total: game.quiz.questions.length,
      type: question.type,
      title: question.title,
      theme: question.theme || game.quiz.theme || 'spring',
    };

    // Broadcast state to host and all players
    this.io.to(game.pin).emit('game_state_changed', {
      state: 'GET_READY',
      questionIndex: game.currentQuestionIndex,
      questionInfo,
      settings: game.settings,
    });

    saveGameSnapshot(game.gameId, this.serializeGame(game));

    // Automatically transition to QUESTION_ACTIVE after 4 seconds
    const timerId = setTimeout(() => {
      this.transitionToQuestionActive(game);
    }, 4000);
    this.addGameTimer(game.pin, timerId);
  }

  // Transition to QUESTION_ACTIVE screen
  transitionToQuestionActive(game) {
    this.clearGameTimer(game.pin);
    game.state = 'QUESTION_ACTIVE';
    game.questionStartTime = Date.now();
    game.lastStateTransitionTime = Date.now();

    const question = game.quiz.questions[game.currentQuestionIndex];
    game.questionTimeLimit = question.timeLimit ?? game.quiz?.defaultTimeLimit ?? 20;

    // Reset answers map for current question
    if (!game.answers.has(game.currentQuestionIndex)) {
      game.answers.set(game.currentQuestionIndex, new Map());
    }

    // Determine option ordering for this question
    let activeOptions = (question.options || []).map((o, idx) => ({
      id: o.id,
      text: o.text,
      order: o.order ?? idx,
      isCorrect: o.isCorrect,
    }));

    // Randomize option order if setting is enabled (applies to quiz and picture_reveal)
    if (game.settings?.randomizeAnswers && (question.type === 'quiz' || question.type === 'picture_reveal')) {
      activeOptions = shuffleArray(activeOptions);
    }

    // Set colorIndex matching the exact visual slot index on screen!
    activeOptions = activeOptions.map((o, idx) => ({
      ...o,
      colorIndex: idx,
    }));

    // Store activeOptions on game session so question reveal uses identical ordering and colors
    game.currentQuestionOptions = activeOptions;

    // Host payload: includes full question data (with options text, images, etc.)
    const hostPayload = {
      state: 'QUESTION_ACTIVE',
      questionIndex: game.currentQuestionIndex,
      totalQuestions: game.quiz.questions.length,
      questionStartTime: game.questionStartTime,
      question: {
        id: question.id,
        type: question.type,
        title: question.title,
        timeLimit: game.questionTimeLimit,
        points: question.points ?? game.quiz?.defaultPoints ?? 1000,
        image: question.image,
        theme: question.theme || game.quiz?.theme || 'spring',
        backgroundImage: question.backgroundImage || game.quiz?.backgroundImage,
        isMultiSelect: question.isMultiSelect,
        options: activeOptions.map((o, idx) => ({
          id: o.id,
          text: o.text,
          order: o.order ?? idx,
          colorIndex: o.colorIndex ?? idx,
        })),
        numberMin: question.numberMin,
        numberMax: question.numberMax,
        tileLevel: question.tileLevel || 'medium',
        allowMultipleAnswers: question.allowMultipleAnswers,
        fuzzyMatching: question.fuzzyMatching,
        fuzzyScorePercentage: question.fuzzyScorePercentage,
        caseSensitive: question.caseSensitive,
        acceptedAnswers: question.acceptedAnswers,
      },
      answersReceived: 0,
      totalPlayers: game.players.size,
    };

    // Send host payload
    if (game.hostSocketId) {
      this.io.to(game.hostSocketId).emit('question_active', hostPayload);
    }

    // Base player options
    const basePlayerOptions = activeOptions.map((o, idx) => ({
      id: o.id,
      text: o.text,
      order: o.order ?? idx,
      colorIndex: o.colorIndex ?? idx,
    }));

    const shuffleOptions = (arr) => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };

    // Issue 20: Broadcast personalized permutation per player for puzzle questions
    for (const player of game.players.values()) {
      if (!player.socketId) continue;

      let playerOptions = basePlayerOptions;
      if (question.type === 'puzzle') {
        playerOptions = shuffleOptions(basePlayerOptions);
        if (playerOptions.length > 1) {
          let attempts = 0;
          const isSorted = (opts) => opts.every((o, i) => i === 0 || (o.order ?? 0) >= (opts[i - 1].order ?? 0));
          while (isSorted(playerOptions) && attempts < 5) {
            playerOptions = shuffleOptions(basePlayerOptions);
            attempts++;
          }
        }
      }

      const playerPayload = {
        state: 'QUESTION_ACTIVE',
        questionIndex: game.currentQuestionIndex,
        totalQuestions: game.quiz.questions.length,
        settings: {
          showQuestionsOnPlayerScreens: Boolean(game.settings?.showQuestionsOnPlayerScreens),
        },
        question: {
          id: question.id,
          type: question.type,
          title: question.title,
          timeLimit: game.questionTimeLimit,
          points: question.points ?? game.quiz?.defaultPoints ?? 1000,
          image: question.image,
          theme: question.theme || game.quiz?.theme || 'spring',
          backgroundImage: question.backgroundImage || game.quiz?.backgroundImage,
          isMultiSelect: question.isMultiSelect,
          options: playerOptions,
          numberMin: question.numberMin ?? 0,
          numberMax: question.numberMax ?? 100,
          tileLevel: question.tileLevel || 'medium',
          allowMultipleAnswers: question.allowMultipleAnswers,
          fuzzyMatching: question.fuzzyMatching,
        },
      };

      this.io.to(player.socketId).emit('question_active', playerPayload);
    }

    // Set countdown timeout
    const timerId = setTimeout(() => {
      this.transitionToQuestionReveal(game);
    }, game.questionTimeLimit * 1000);
    this.addGameTimer(game.pin, timerId);
  }

  // Player submits answer
  submitAnswer(pin, playerUuid, answerPayload) {
    const game = this.games.get(pin);
    if (!game || game.state !== 'QUESTION_ACTIVE') {
      return { success: false, error: 'Cannot submit answer right now' };
    }

    // Issue 3: Verify that player actually belongs to this game
    if (!playerUuid || !game.players.has(playerUuid)) {
      return { success: false, error: 'Player session not found in this game' };
    }

    const questionAnswers = game.answers.get(game.currentQuestionIndex);
    if (!questionAnswers) return { success: false };

    // Check if already answered
    if (questionAnswers.has(playerUuid)) {
      return { success: false, error: 'Answer already submitted' };
    }

    const responseTimeMs = Date.now() - game.questionStartTime;
    const record = {
      userUuid: playerUuid,
      answerPayload,
      responseTimeMs,
      submittedAt: Date.now(),
    };

    questionAnswers.set(playerUuid, record);

    // Notify host of answers count
    const answersCount = questionAnswers.size;
    if (game.hostSocketId) {
      this.io.to(game.hostSocketId).emit('answer_count_updated', {
        answersReceived: answersCount,
        totalPlayers: game.players.size,
      });
    }

    // Ensure the submitting player is marked connected
    const submittingPlayer = game.players.get(playerUuid);
    if (submittingPlayer) {
      submittingPlayer.connected = true;
    }

    // Check if all players have submitted:
    // A player is active if they are marked connected OR their socket is currently alive
    const isPlayerActive = (p) => p.connected || this.isSocketAlive(p.socketId);
    const activePlayers = Array.from(game.players.values()).filter(isPlayerActive);

    const allRegisteredAnswered = game.players.size > 0 && answersCount >= game.players.size;
    const allActiveAnswered = activePlayers.length > 0 && answersCount >= activePlayers.length;

    if (allRegisteredAnswered || allActiveAnswered) {
      // Issue 2: Cancel pending countdown and track early reveal timer in this.timers
      this.clearGameTimer(game.pin);
      const earlyRevealTimer = setTimeout(() => {
        if (game.state === 'QUESTION_ACTIVE') {
          this.transitionToQuestionReveal(game);
        }
      }, 500);
      this.addGameTimer(game.pin, earlyRevealTimer);
    }

    return { success: true };
  }

  // Transition to QUESTION_REVEAL
  transitionToQuestionReveal(game) {
    this.clearGameTimer(game.pin);
    game.state = 'QUESTION_REVEAL';

    const question = game.quiz.questions[game.currentQuestionIndex];
    const questionAnswers = game.answers.get(game.currentQuestionIndex) || new Map();

    // Compile vote distribution & calculate individual scores
    const voteDistribution = {};
    (question.options || []).forEach((opt) => {
      voteDistribution[opt.id] = 0;
    });

    const playerResults = new Map();

    for (const [userUuid, player] of game.players.entries()) {
      const submission = questionAnswers.get(userUuid);
      let pointsEarned = 0;
      let isCorrect = false;
      let accuracy = 0;

      let scoreResult;
      if (submission) {
        // Tally vote distribution
        if (question.type === 'quiz' || question.type === 'true_false' || question.type === 'yes_no' || question.type === 'picture_reveal') {
          const selected = Array.isArray(submission.answerPayload?.selected)
            ? submission.answerPayload.selected
            : [submission.answerPayload?.selected];
          selected.forEach((id) => {
            if (voteDistribution[id] !== undefined) {
              voteDistribution[id]++;
            }
          });
        }

        scoreResult = calculateQuestionScore(question, submission.answerPayload, submission.responseTimeMs);
        pointsEarned = scoreResult.points;
        isCorrect = scoreResult.isCorrect;
        accuracy = scoreResult.accuracy;

        // In number guessing or partial quiz, don't break streak if partially correct, but only award streak bonus if not partial
        if (isCorrect && !scoreResult.isPartial) {
          player.streak += 1;
          const streakBonus = calculateStreakBonus(player.streak);
          pointsEarned += streakBonus;
        } else if (isCorrect && scoreResult.isPartial) {
          // Keep streak intact, but don't add full bonus
        } else {
          player.streak = 0;
        }

        player.score += pointsEarned;
      } else {
        // Didn't answer
        player.streak = 0;
        scoreResult = { points: 0, isCorrect: false, isPartial: false, isExact: false, accuracy: 0, timeScore: 0 };
      }

      const correctOptionIds = (question.options || [])
        .filter((opt) => opt.isCorrect)
        .map((opt) => opt.id);

      const userSelected = submission
        ? Array.isArray(submission.answerPayload?.selected)
          ? submission.answerPayload.selected
          : submission.answerPayload?.selected
          ? [submission.answerPayload.selected]
          : []
        : [];

      playerResults.set(userUuid, {
        isCorrect,
        isPartial: Boolean(scoreResult.isPartial),
        isExact: Boolean(scoreResult.isExact),
        pointsEarned,
        accuracy,
        totalScore: player.score,
        streak: player.streak,
        // Detailed feedback for player screen
        questionType: question.type,
        isMultiSelect: Boolean(question.isMultiSelect),
        correctOptionIds,
        selectedOptionIds: userSelected,
        options: (game.currentQuestionOptions || question.options || []).map((o, idx) => ({
          id: o.id,
          text: o.text,
          isCorrect: Boolean(o.isCorrect),
          order: o.order ?? idx,
          colorIndex: o.colorIndex ?? idx,
        })),
        numberTarget: question.numberTarget,
        playerGuess: submission?.answerPayload?.number,
        userInput: scoreResult.userInput || submission?.answerPayload?.text || submission?.answerPayload?.answers,
        matchedAccepted: scoreResult.matchedAccepted,
        acceptedAnswers: question.acceptedAnswers || [],
      });
    }

    // Puzzle statistics compilation
    let puzzleStats = null;
    let revealOptions = game.currentQuestionOptions || question.options || [];

    if (question.type === 'puzzle') {
      puzzleStats = {
        correct: 0,
        partial: 0,
        wrong: 0,
        total: game.players.size,
      };

      for (const [userUuid, player] of game.players.entries()) {
        const res = playerResults.get(userUuid);
        if (res && res.isCorrect && !res.isPartial) {
          puzzleStats.correct++;
        } else if (res && res.isCorrect && res.isPartial) {
          puzzleStats.partial++;
        } else {
          puzzleStats.wrong++;
        }
      }

      // Sort reveal options strictly in chronological / correct order (earliest first: 0, 1, 2, 3...)
      revealOptions = [...(question.options || [])]
        .map((opt, originalIdx) => ({
          ...opt,
          order: opt.order ?? originalIdx,
          colorIndex: opt.colorIndex ?? originalIdx,
        }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    // Number guessing compilation
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

    // Word guess compilation (for Word Cloud reveal on host)
    const wordSubmissions = {};
    if (question.type === 'word_guess') {
      for (const [userUuid, player] of game.players.entries()) {
        const submission = questionAnswers.get(userUuid);
        if (submission) {
          let words = [];
          if (Array.isArray(submission.answerPayload?.answers)) {
            words = submission.answerPayload.answers;
          } else if (Array.isArray(submission.answerPayload?.selected)) {
            words = submission.answerPayload.selected;
          } else if (typeof submission.answerPayload?.text === 'string') {
            words = [submission.answerPayload.text];
          } else if (typeof submission.answerPayload?.selected === 'string') {
            words = [submission.answerPayload.selected];
          }
          words.forEach((w) => {
            const trimmed = typeof w === 'string' ? w.trim() : '';
            if (trimmed) {
              wordSubmissions[trimmed] = (wordSubmissions[trimmed] || 0) + 1;
            }
          });
        }
      }
    }

    // Host reveal data
    const hostRevealPayload = {
      state: 'QUESTION_REVEAL',
      questionIndex: game.currentQuestionIndex,
      question: {
        id: question.id,
        type: question.type,
        title: question.title,
        image: question.image,
        tileLevel: question.tileLevel || 'medium',
        theme: question.theme || game.quiz.theme || 'spring',
        backgroundImage: question.backgroundImage || game.quiz.backgroundImage,
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

    game.lastStateTransitionTime = Date.now();
    game.lastRevealPayload = hostRevealPayload;

    if (game.hostSocketId) {
      this.io.to(game.hostSocketId).emit('question_reveal', hostRevealPayload);
    }

    // Send individual feedback to each player
    for (const [userUuid, player] of game.players.entries()) {
      if (player.socketId) {
        const result = playerResults.get(userUuid);
        this.io.to(player.socketId).emit('player_feedback', result);
      }
    }

    game.lastPlayerResults = playerResults;
    saveGameSnapshot(game.gameId, this.serializeGame(game));
  }

  // Host clicks Next / Skip (debounced with 1000ms cooldown)
  handleHostNext(pin) {
    const game = this.games.get(pin);
    if (!game) return false;

    // Issue 1: Guard against rapid consecutive advances / double clicks
    if (!this.checkHostCooldown(game)) {
      return false;
    }

    if (game.state === 'GET_READY') {
      this.clearGameTimer(game.pin);
      game.lastHostTransitionTime = Date.now();
      game.lastStateTransitionTime = Date.now();
      this.transitionToQuestionActive(game);
      return true;
    }

    if (game.state === 'QUESTION_ACTIVE') {
      this.clearGameTimer(game.pin);
      game.lastHostTransitionTime = Date.now();
      game.lastStateTransitionTime = Date.now();
      this.transitionToQuestionReveal(game);
      return true;
    }

    if (game.state === 'QUESTION_REVEAL') {
      game.lastHostTransitionTime = Date.now();
      game.lastStateTransitionTime = Date.now();
      const isFinalQuestion = game.currentQuestionIndex + 1 >= game.quiz.questions.length;
      if (isFinalQuestion) {
        this.transitionToPodium(game);
      } else {
        this.transitionToScoreboard(game);
      }
      return true;
    }

    if (game.state === 'SCOREBOARD') {
      game.lastHostTransitionTime = Date.now();
      game.lastStateTransitionTime = Date.now();
      if (game.currentQuestionIndex + 1 < game.quiz.questions.length) {
        // Next question
        game.currentQuestionIndex++;
        this.transitionToGetReady(game);
      } else {
        // Grand finale podium
        this.transitionToPodium(game);
      }
      return true;
    }

    return false;
  }

  // Host manually skips active question or countdown (debounced with 1000ms cooldown)
  skipQuestion(pin) {
    const game = this.games.get(pin);
    if (!game) return false;

    // Issue 1: Guard against rapid consecutive skips
    if (!this.checkHostCooldown(game)) {
      return false;
    }

    if (game.state === 'GET_READY') {
      this.clearGameTimer(game.pin);
      game.lastHostTransitionTime = Date.now();
      game.lastStateTransitionTime = Date.now();
      this.transitionToQuestionActive(game);
      return true;
    }

    if (game.state === 'QUESTION_ACTIVE') {
      this.clearGameTimer(game.pin);
      game.lastHostTransitionTime = Date.now();
      game.lastStateTransitionTime = Date.now();
      this.transitionToQuestionReveal(game);
      return true;
    }

    return this.handleHostNext(pin);
  }

  // Host forces skip directly to the next question (bypassing reveal if desired, debounced)
  skipToNextQuestion(pin) {
    const game = this.games.get(pin);
    if (!game) return false;

    // Issue 1: Guard against rapid consecutive skips
    if (!this.checkHostCooldown(game)) {
      return false;
    }

    this.clearGameTimer(game.pin);
    game.lastHostTransitionTime = Date.now();
    game.lastStateTransitionTime = Date.now();

    // If question was active, calculate scores for whoever already submitted
    if (game.state === 'QUESTION_ACTIVE' || game.state === 'GET_READY') {
      const question = game.quiz.questions[game.currentQuestionIndex];
      const questionAnswers = game.answers.get(game.currentQuestionIndex) || new Map();
      for (const [userUuid, player] of game.players.entries()) {
        const submission = questionAnswers.get(userUuid);
        if (submission) {
          const scoreResult = calculateQuestionScore(question, submission.answerPayload, submission.responseTimeMs);
          if (scoreResult.isCorrect && !scoreResult.isPartial) {
            player.streak += 1;
            player.score += scoreResult.points + calculateStreakBonus(player.streak);
          } else if (scoreResult.isCorrect && scoreResult.isPartial) {
            player.score += scoreResult.points;
          } else {
            player.streak = 0;
            player.score += scoreResult.points;
          }
        } else {
          player.streak = 0;
        }
      }
    }

    if (game.currentQuestionIndex + 1 < game.quiz.questions.length) {
      game.currentQuestionIndex++;
      this.transitionToGetReady(game);
    } else {
      this.transitionToPodium(game);
    }
    return true;
  }

  // Transition to SCOREBOARD
  transitionToScoreboard(game) {
    this.clearGameTimer(game.pin);
    game.state = 'SCOREBOARD';
    game.lastStateTransitionTime = Date.now();

    // Sort players by score descending
    const sortedPlayers = Array.from(game.players.values())
      .sort((a, b) => b.score - a.score)
      .map((p, idx) => ({
        rank: idx + 1,
        userUuid: p.userUuid,
        nickname: p.nickname,
        avatar: p.avatar,
        score: p.score,
        streak: p.streak,
      }));

    const top5 = sortedPlayers.slice(0, 5);
    const scoreboardPayload = {
      state: 'SCOREBOARD',
      questionIndex: game.currentQuestionIndex + 1,
      totalQuestions: game.quiz.questions.length,
      leaderboard: top5,
    };

    game.lastScoreboardPayload = scoreboardPayload;

    // Host scoreboard payload
    if (game.hostSocketId) {
      this.io.to(game.hostSocketId).emit('scoreboard_update', scoreboardPayload);
    }

    // Notify each player of their personal standing
    sortedPlayers.forEach((playerStanding) => {
      const player = game.players.get(playerStanding.userUuid);
      if (player && player.socketId) {
        const leaderScore = sortedPlayers[0]?.score || 0;
        this.io.to(player.socketId).emit('player_standing', {
          rank: playerStanding.rank,
          score: player.score,
          pointsBehindLeader: Math.max(0, leaderScore - player.score),
          leaderName: sortedPlayers[0]?.nickname || '',
          isOnLeaderboard: playerStanding.rank <= 5,
        });
      }
    });

    saveGameSnapshot(game.gameId, this.serializeGame(game));
  }

  // Transition to PODIUM (Final celebration)
  transitionToPodium(game) {
    this.clearGameTimer(game.pin);
    game.state = 'PODIUM';
    game.lastStateTransitionTime = Date.now();
    game.podiumReachedAt = Date.now();

    const rankedPlayers = Array.from(game.players.values())
      .sort((a, b) => b.score - a.score)
      .map((p, idx) => ({
        rank: idx + 1,
        userUuid: p.userUuid,
        nickname: p.nickname,
        avatar: p.avatar,
        score: p.score,
      }));

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

    // Notify all players of final podium celebration
    for (const player of game.players.values()) {
      if (player.socketId) {
        const myRankInfo = rankedPlayers.find((r) => r.userUuid === player.userUuid);
        this.io.to(player.socketId).emit('final_results', {
          rank: myRankInfo ? myRankInfo.rank : 0,
          totalScore: player.score,
          firstPlace: rankedPlayers[0],
          isWinner: myRankInfo ? myRankInfo.rank === 1 : false,
          isPodium: myRankInfo ? myRankInfo.rank <= 3 : false,
        });
      }
    }

    saveGameSnapshot(game.gameId, this.serializeGame(game));

    // Archive Game Report
    try {
      generateGameReport(game);
    } catch (err) {
      console.error('Failed to generate game report:', err);
    }

    // Update Player Profiles & Career Stats
    try {
      const totalQuestions = Math.min(
        game.quiz.questions.length,
        (game.currentQuestionIndex !== undefined ? game.currentQuestionIndex + 1 : game.quiz.questions.length)
      );
      for (const [userUuid, player] of game.players.entries()) {
        const myRankInfo = rankedPlayers.find((r) => r.userUuid === userUuid);
        const rank = myRankInfo ? myRankInfo.rank : rankedPlayers.length;

        let correctCount = 0;
        for (let qIdx = 0; qIdx < totalQuestions; qIdx++) {
          const qAnswers = game.answers.get(qIdx);
          const sub = qAnswers ? qAnswers.get(userUuid) : null;
          if (sub) {
            const q = game.quiz.questions[qIdx];
            const scoreRes = calculateQuestionScore(q, sub.answerPayload, sub.responseTimeMs);
            if (scoreRes.isCorrect) correctCount++;
          }
        }
        const accuracy = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

        recordGameResult(userUuid, {
          pin: game.pin,
          gamePin: game.pin,
          gameId: game.gameId,
          quizTitle: game.quiz.title,
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

  // Handle socket disconnect
  handleDisconnect(socketId) {
    const info = this.socketToGame.get(socketId);
    if (!info) return;

    const game = this.games.get(info.pin);
    if (!game) return;

    if (info.role === 'host') {
      console.log(`Host disconnected from game PIN ${info.pin}`);
      // Host may reconnect
    } else if (info.role === 'player') {
      const player = game.players.get(info.userUuid);
      // Only mark disconnected if the disconnecting socket is actually the player's current active socket
      if (player && player.socketId === socketId) {
        player.connected = false;
        console.log(`Player ${player.nickname} disconnected from game PIN ${info.pin}`);
        this.notifyHostPlayersUpdate(game);

        // Issue 9: If in QUESTION_ACTIVE and all remaining connected players have answered,
        // transition to reveal immediately without hanging
        if (game.state === 'QUESTION_ACTIVE') {
          const isPlayerActive = (p) => p.connected || this.isSocketAlive(p.socketId);
          const activePlayers = Array.from(game.players.values()).filter(isPlayerActive);
          const questionAnswers = game.answers.get(game.currentQuestionIndex);
          if (questionAnswers) {
            const allAnswered =
              (activePlayers.length > 0 && activePlayers.every((p) => questionAnswers.has(p.userUuid))) ||
              (game.players.size > 0 && questionAnswers.size >= game.players.size);
            if (allAnswered) {
              this.clearGameTimer(game.pin);
              this.transitionToQuestionReveal(game);
            }
          }
        }
      }
    }

    this.socketToGame.delete(socketId);
  }

  // Helper: Construct complete active question payload for host
  getHostActivePayload(game) {
    if (!game || game.currentQuestionIndex < 0) return null;
    const question = game.quiz?.questions?.[game.currentQuestionIndex];
    if (!question) return null;

    const now = Date.now();
    const elapsedMs = Math.max(0, now - (game.questionStartTime || now));
    const totalDurationMs = (game.questionTimeLimit || 20) * 1000;
    const remainingTimeMs = Math.max(0, totalDurationMs - elapsedMs);
    const remainingSeconds = Math.ceil(remainingTimeMs / 1000);

    const questionAnswers = game.answers.get(game.currentQuestionIndex) || new Map();
    const activeOptions = game.currentQuestionOptions || (question.options || []).map((o, idx) => ({
      id: o.id,
      text: o.text,
      order: o.order ?? idx,
      colorIndex: o.colorIndex ?? idx,
    }));

    return {
      state: 'QUESTION_ACTIVE',
      questionIndex: game.currentQuestionIndex,
      totalQuestions: game.quiz.questions.length,
      remainingTimeMs,
      remainingSeconds,
      questionStartTime: game.questionStartTime,
      answersReceived: questionAnswers.size,
      totalPlayers: game.players.size,
      question: {
        id: question.id,
        type: question.type,
        title: question.title,
        timeLimit: game.questionTimeLimit,
        remainingTimeMs,
        remainingSeconds,
        points: question.points ?? game.quiz?.defaultPoints ?? 1000,
        image: question.image,
        theme: question.theme || game.quiz?.theme || 'spring',
        backgroundImage: question.backgroundImage || game.quiz?.backgroundImage,
        isMultiSelect: question.isMultiSelect,
        options: activeOptions,
        numberMin: question.numberMin,
        numberMax: question.numberMax,
      },
    };
  }

  // Issue 16: Complete host state data for reconnection so host screen is never blank
  getHostStateData(pinOrId) {
    const game = this.getGameByPinOrId(pinOrId);
    if (!game) return null;

    const baseData = {
      success: true,
      pin: game.pin,
      gameId: game.gameId,
      quizTitle: game.quiz?.title,
      totalQuestions: game.quiz?.questions?.length || 0,
      qrCodeDataUrl: game.qrCodeDataUrl,
      state: game.state,
      settings: game.settings,
      players: Array.from(game.players.values()).map((p) => ({
        userUuid: p.userUuid,
        nickname: p.nickname,
        avatar: p.avatar,
        score: p.score,
        streak: p.streak,
        connected: p.connected,
      })),
      currentQuestionIndex: game.currentQuestionIndex,
    };

    if (game.state === 'GET_READY') {
      const q = game.quiz?.questions?.[game.currentQuestionIndex];
      if (q) {
        baseData.currentQuestion = {
          id: q.id,
          title: q.title,
          type: q.type,
          timeLimit: q.timeLimit,
          points: q.points,
          imageUrl: q.imageUrl,
          index: game.currentQuestionIndex + 1,
          total: game.quiz.questions.length,
          options: (q.options || []).map((o, idx) => ({
            id: o.id,
            text: o.text,
            order: o.order ?? idx,
            colorIndex: o.colorIndex ?? idx,
          })),
        };
      }
    } else if (game.state === 'QUESTION_ACTIVE') {
      const activePayload = this.getHostActivePayload(game);
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
