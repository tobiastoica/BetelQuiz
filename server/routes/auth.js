import express from 'express';
import jwt from 'jsonwebtoken';
import { createHash, timingSafeEqual } from 'crypto';
import { ADMIN_CREDENTIALS, JWT_SECRET } from '../config.js';

const router = express.Router();

const digest = (s) => createHash('sha256').update(String(s ?? '')).digest();
const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));

export function getAdmin(req) {
  const token = req.cookies?.token || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.username === ADMIN_CREDENTIALS.username ? decoded : null;
  } catch {
    return null;
  }
}

export const isAdmin = (req) => Boolean(getAdmin(req));

export function requireAdmin(req, res, next) {
  req.user = getAdmin(req);
  return req.user ? next() : res.status(401).json({ error: 'Unauthorized. Admin login required.' });
}

// In-memory rate limiting for login: max 10 attempts per 15 min per IP
const loginAttempts = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (now > record.resetTime) {
      loginAttempts.delete(ip);
    }
  }
}, 15 * 60 * 1000).unref();

function loginRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 10;

  const record = loginAttempts.get(ip) || { count: 0, resetTime: now + windowMs };
  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + windowMs;
  }

  if (record.count >= maxAttempts) {
    const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
    return res.status(429).json({ error: `Too many login attempts. Please try again in ${retryAfterSec} seconds.` });
  }

  record.count++;
  loginAttempts.set(ip, record);
  next();
}

// Admin login
router.post('/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};

  // Timing-safe constant-time comparison
  const isValid =
    safeEqual(username, ADMIN_CREDENTIALS.username) &
    safeEqual(password, ADMIN_CREDENTIALS.password);

  if (isValid) {
    const token = jwt.sign(
      { username: ADMIN_CREDENTIALS.username, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure: req.secure, // true if HTTPS/tunnel, false if plain local HTTP
    });

    return res.json({
      success: true,
      token,
      user: { username: ADMIN_CREDENTIALS.username, role: 'admin' },
    });
  }

  return res.status(401).json({ error: 'Invalid username or password' });
});

// Check current session
router.get('/me', (req, res) => {
  const admin = getAdmin(req);
  res.json(
    admin
      ? { authenticated: true, user: { username: admin.username, role: 'admin' } }
      : { authenticated: false }
  );
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

export default router;
