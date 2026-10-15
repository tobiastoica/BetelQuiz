import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

import { PORT, UPLOADS_DIR, CLIENT_DIST_DIR } from './config.js';
import { initStorage } from './storage.js';
import { GameManager } from './gameManager.js';

import authRoutes from './routes/auth.js';
import quizzesRoutes from './routes/quizzes.js';
import uploadsRoutes from './routes/uploads.js';
import reportsRoutes from './routes/reports.js';
import { getPlayerProfile, updatePlayerIdentity } from './playerProfiles.js';
import { shuffleArray } from './scoring.js';

// Initialize storage folders
initStorage();

const app = express();
const server = http.createServer(app);

// Allow CORS from Vite dev server or Cloudflare tunnel domain
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

const gameManager = new GameManager(io);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(cookieParser());

// Persistent user/device UUID cookie middleware (10 years expiry)
app.use((req, res, next) => {
  let userUuid = req.cookies?.betelquiz_user_uuid;
  if (!userUuid) {
    userUuid = uuidv4();
    res.cookie('betelquiz_user_uuid', userUuid, {
      maxAge: 10 * 365 * 24 * 60 * 60 * 1000, // 10 years
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  }
  req.userUuid = userUuid;
  next();
});

// Endpoint to check if current device/user has an ongoing active game
app.get('/api/player/active-game', (req, res) => {
  const userUuid = req.query.userUuid || req.userUuid || req.cookies?.betelquiz_user_uuid;
  if (!userUuid) {
    return res.json({ hasActiveGame: false });
  }

  const active = gameManager.getActiveSessionForUser(userUuid);
  if (active) {
    return res.json({
      hasActiveGame: true,
      pin: active.pin,
      gameId: active.gameId,
      player: active.player,
      gameState: active.gameState,
      quizTitle: active.quizTitle,
    });
  }

  return res.json({ hasActiveGame: false });
});

// Static uploads serving
app.use('/uploads', express.static(UPLOADS_DIR));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/quizzes', quizzesRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/reports', reportsRoutes);

// Player profile endpoints
app.get('/api/player/profile', (req, res) => {
  const userUuid = req.query.userUuid || req.userUuid || req.cookies?.betelquiz_user_uuid;
  if (!userUuid) {
    return res.status(400).json({ error: 'Missing userUuid' });
  }
  const profile = getPlayerProfile(userUuid);
  res.json({ success: true, profile });
});

app.put('/api/player/profile', (req, res) => {
  const userUuid = req.body?.userUuid || req.userUuid || req.cookies?.betelquiz_user_uuid;
  const { nickname, avatar } = req.body || {};
  if (!userUuid) {
    return res.status(400).json({ error: 'Missing userUuid' });
  }
  const profile = updatePlayerIdentity(userUuid, { nickname, avatar });
  res.json({ success: true, profile });
});

// Helper endpoint to check server status and game info
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Endpoint to verify game PIN / Game ID before player enters nickname
app.get('/api/games/:pinOrId/status', (req, res) => {
  const { pinOrId } = req.params;
  const game = gameManager.getGameByPinOrId(pinOrId);
  if (!game) {
    return res.status(404).json({ exists: false, error: 'We could not find a game with this PIN.' });
  }
  if (game.settings?.lockGame) {
    return res.status(403).json({ exists: true, locked: true, error: 'This game is locked by the host.' });
  }
  return res.json({
    exists: true,
    pin: game.pin,
    gameId: game.gameId,
    state: game.state,
    quizTitle: game.quiz?.title,
  });
});

// Real-time Socket.IO communication
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Host creates game
  socket.on('host_create_game', async (data) => {
    try {
      const { quizId } = data || {};
      const game = await gameManager.createGame(quizId, socket.id);
      socket.join(game.pin);

      socket.emit('game_created', {
        success: true,
        pin: game.pin,
        gameId: game.gameId,
        hostSecret: game.hostSecret,
        quizTitle: game.quiz.title,
        totalQuestions: game.quiz.questions.length,
        qrCodeDataUrl: game.qrCodeDataUrl,
        state: game.state,
        settings: game.settings,
      });

      console.log(`Game created with PIN: ${game.pin} for quiz: ${game.quiz.title}`);
    } catch (err) {
      console.error('Error creating game:', err);
      socket.emit('game_error', { error: err.message || 'Failed to create game' });
    }
  });

  // Helper to verify authorized host
  const isAuthorizedHost = (socket, pin, hostSecret) => {
    const game = gameManager.getGameByPinOrId(pin);
    if (!game) return false;
    const socketInfo = gameManager.socketToGame.get(socket.id);
    if (socketInfo && socketInfo.role === 'host' && socketInfo.pin === game.pin) {
      return true;
    }
    if (hostSecret && game.hostSecret && hostSecret === game.hostSecret) {
      return true;
    }
    if (game.hostSocketId === socket.id) {
      return true;
    }
    return false;
  };

  // Host joins/reconnects to game room
  socket.on('host_join', (data) => {
    const { pin, hostSecret } = data || {};
    const game = gameManager.getGameByPinOrId(pin);
    if (game) {
      if (game.hostSecret && hostSecret !== game.hostSecret) {
        socket.emit('host_error', { error: 'Unauthorized host session' });
        return;
      }
      game.hostSocketId = socket.id;
      socket.join(game.pin);
      gameManager.socketToGame.set(socket.id, { pin: game.pin, role: 'host', hostSecret: game.hostSecret });
      const hostData = gameManager.getHostStateData(game.pin);
      socket.emit('host_game_data', {
        ...(hostData || {}),
        hostSecret: game.hostSecret,
      });
      console.log(`Host joined game PIN: ${game.pin}`);
    }
  });

  // Host updates game settings
  socket.on('host_update_settings', (data) => {
    const { pin, settings, hostSecret } = data || {};
    if (!isAuthorizedHost(socket, pin, hostSecret)) return;
    gameManager.updateSettings(pin, settings);
  });

  // Host starts game
  socket.on('host_start_game', (data) => {
    const { pin, hostSecret } = data || {};
    if (!isAuthorizedHost(socket, pin, hostSecret)) return;
    const success = gameManager.startGame(pin);
    if (!success) {
      socket.emit('game_error', { error: 'Could not start game' });
    }
  });

  // Host ends game immediately and awards podium
  socket.on('host_end_game', (data) => {
    const { pin, hostSecret } = data || {};
    if (!isAuthorizedHost(socket, pin, hostSecret)) return;
    gameManager.endGame(pin);
  });

  // Host kicks player
  socket.on('host_kick_player', (data) => {
    const { pin, userUuid, hostSecret } = data || {};
    if (!isAuthorizedHost(socket, pin, hostSecret)) return;
    gameManager.kickPlayer(pin, userUuid);
  });

  // Host clicks next
  socket.on('host_next', (data) => {
    const { pin, hostSecret } = data || {};
    if (!isAuthorizedHost(socket, pin, hostSecret)) return;
    gameManager.handleHostNext(pin);
  });

  // Host skips question
  socket.on('host_skip', (data) => {
    const { pin, hostSecret } = data || {};
    if (!isAuthorizedHost(socket, pin, hostSecret)) return;
    gameManager.skipQuestion(pin);
  });

  // Host skips directly to next question
  socket.on('host_skip_to_next', (data) => {
    const { pin, hostSecret } = data || {};
    if (!isAuthorizedHost(socket, pin, hostSecret)) return;
    gameManager.skipToNextQuestion(pin);
  });

  // Player joins game
  socket.on('player_join', (data) => {
    const { pin, nickname, userUuid, avatar } = data || {};
    const result = gameManager.joinPlayer(pin, nickname, userUuid, socket.id, avatar);

    if (result.success) {
      socket.join(result.pin);
      socket.emit('join_success', result);
      console.log(`Player ${result.player.nickname} joined game ${result.pin}`);

      // If game is in progress and player reconnected, send current game state
      const game = gameManager.getGameByPin(result.pin);
      if (game) {
        if (game.state === 'QUESTION_ACTIVE') {
          const question = game.quiz.questions[game.currentQuestionIndex];
          const answersForQuestion = game.answers.get(game.currentQuestionIndex);
          const alreadyAnswered = answersForQuestion
            ? answersForQuestion.has(result.userUuid)
            : false;

          let playerOptions = (game.currentQuestionOptions || question.options || []).map((o, idx) => ({
            id: o.id,
            text: o.text,
            order: o.order ?? idx,
            colorIndex: o.colorIndex ?? idx,
          }));

          if (question.type === 'puzzle') {
            playerOptions = shuffleArray(playerOptions);
          }

          const now = Date.now();
          const elapsedMs = Math.max(0, now - (game.questionStartTime || now));
          const totalDurationMs = (game.questionTimeLimit || 20) * 1000;
          const remainingTimeMs = Math.max(0, totalDurationMs - elapsedMs);
          const remainingSeconds = Math.ceil(remainingTimeMs / 1000);

          socket.emit('question_active', {
            state: 'QUESTION_ACTIVE',
            questionIndex: game.currentQuestionIndex,
            totalQuestions: game.quiz.questions.length,
            alreadyAnswered,
            remainingTimeMs,
            remainingSeconds,
            questionStartTime: game.questionStartTime,
            settings: {
              showQuestionsOnPlayerScreens: Boolean(game.settings?.showQuestionsOnPlayerScreens),
            },
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
              options: playerOptions,
              numberMin: question.numberMin ?? 0,
              numberMax: question.numberMax ?? 100,
            },
          });
        } else if (game.state === 'GET_READY') {
          const question = game.quiz.questions[game.currentQuestionIndex];
          socket.emit('game_state_changed', {
            state: 'GET_READY',
            questionIndex: game.currentQuestionIndex,
            settings: {
              showQuestionsOnPlayerScreens: Boolean(game.settings?.showQuestionsOnPlayerScreens),
            },
            questionInfo: {
              index: game.currentQuestionIndex + 1,
              total: game.quiz.questions.length,
              type: question?.type,
              title: question?.title,
              theme: question?.theme || game.quiz.theme || 'spring',
            },
          });
        } else if (game.state === 'QUESTION_REVEAL') {
          const playerResult = game.lastPlayerResults
            ? game.lastPlayerResults.get(result.userUuid)
            : null;
          if (playerResult) {
            socket.emit('player_feedback', playerResult);
          }
        } else if (game.state === 'SCOREBOARD') {
          const sorted = Array.from(game.players.values()).sort((a, b) => b.score - a.score);
          const rank = sorted.findIndex((p) => p.userUuid === result.userUuid) + 1;
          socket.emit('player_standing', {
            rank: rank || 1,
            score: result.player.score,
            pointsBehindLeader: Math.max(0, (sorted[0]?.score || 0) - result.player.score),
            leaderName: sorted[0]?.nickname || '',
            isOnLeaderboard: (rank || 1) <= 5,
          });
        } else if (game.state === 'PODIUM') {
          const sorted = Array.from(game.players.values()).sort((a, b) => b.score - a.score);
          const rank = sorted.findIndex((p) => p.userUuid === result.userUuid) + 1;
          socket.emit('final_results', {
            rank: rank || 1,
            totalScore: result.player.score,
            firstPlace: sorted[0],
            isWinner: rank === 1,
            isPodium: rank <= 3,
          });
        }
      }
    } else {
      socket.emit('join_error', { error: result.error || 'Failed to join game' });
    }
  });

  // Player submits answer
  socket.on('player_submit_answer', (data) => {
    const { pin, userUuid, answerPayload } = data || {};
    const result = gameManager.submitAnswer(pin, userUuid, answerPayload);
    socket.emit('answer_submitted_ack', result);
  });

  // Player updates custom avatar emoji
  socket.on('player_update_avatar', (data) => {
    const { pin, userUuid, avatar } = data || {};
    const success = gameManager.updatePlayerAvatar(pin, userUuid, avatar);
    if (success) {
      socket.emit('player_avatar_updated', { avatar });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    gameManager.handleDisconnect(socket.id);
  });
});

// Production: serve built client assets if available
if (fs.existsSync(CLIENT_DIST_DIR)) {
  app.use(express.static(CLIENT_DIST_DIR));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` BetelQuiz Server running on http://localhost:${PORT}`);
  console.log(`===============================================`);
});
