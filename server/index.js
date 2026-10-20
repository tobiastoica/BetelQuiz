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
import { registerSocketHandlers } from './socketHandlers.js';

import authRoutes, { requireAdmin } from './routes/auth.js';
import quizzesRoutes from './routes/quizzes.js';
import uploadsRoutes from './routes/uploads.js';
import reportsRoutes from './routes/reports.js';
import { getPlayerProfile, updatePlayerIdentity } from './playerProfiles.js';
import { isValidId } from './fsUtils.js';

// Initialize storage folders
initStorage();

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

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
app.use('/api/quizzes/import', express.json({ limit: '30mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Persistent user/device UUID cookie middleware (10 years expiry)
app.use((req, res, next) => {
  let userUuid = req.cookies?.betelquiz_user_uuid;
  if (!userUuid || !isValidId(userUuid)) {
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

// Static uploads serving
app.use('/uploads', express.static(UPLOADS_DIR));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/quizzes', quizzesRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/reports', reportsRoutes);

// Player profile endpoints (identified securely via cookie)
app.get('/api/player/profile', (req, res) => {
  const userUuid = req.userUuid;
  if (!userUuid) {
    return res.status(400).json({ error: 'Missing userUuid' });
  }
  const profile = getPlayerProfile(userUuid);
  res.json({ success: true, profile });
});

app.put('/api/player/profile', (req, res) => {
  const userUuid = req.userUuid;
  const { nickname, avatar } = req.body || {};
  if (!userUuid) {
    return res.status(400).json({ error: 'Missing userUuid' });
  }
  const profile = updatePlayerIdentity(userUuid, nickname, avatar);
  res.json({ success: true, profile });
});

// Admin REST endpoint to create game
app.post('/api/games', requireAdmin, (req, res) => {
  try {
    const { quizId, showQuestionsOnPlayerScreens } = req.body || {};
    const game = gameManager.createGame(quizId, { showQuestionsOnPlayerScreens });
    res.json({
      success: true,
      pin: game.pin,
      gameId: game.gameId,
      hostSecret: game.hostSecret,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create game' });
  }
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
  return res.json({
    exists: true,
    locked: Boolean(game.settings?.lockGame),
    isMember: game.players.has(req.userUuid),
    pin: game.pin,
    gameId: game.gameId,
    state: game.state,
    quizTitle: game.quiz?.title,
  });
});

// Real-time Socket.IO communication
registerSocketHandlers(io, gameManager);

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

export { app, server, gameManager };
