import express from 'express';
import jwt from 'jsonwebtoken';
import { ADMIN_CREDENTIALS, JWT_SECRET } from '../config.js';

const router = express.Router();

export function isAdmin(req) {
  const token = req.cookies?.token || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return false;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.username === ADMIN_CREDENTIALS.username;
  } catch (err) {
    return false;
  }
}

export function requireAdmin(req, res, next) {
  const token = req.cookies?.token || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. Admin login required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.username === ADMIN_CREDENTIALS.username) {
      req.user = decoded;
      return next();
    }
  } catch (err) {
    // invalid token
  }

  return res.status(401).json({ error: 'Invalid or expired session' });
}

// Admin login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (
    username === ADMIN_CREDENTIALS.username &&
    password === ADMIN_CREDENTIALS.password
  ) {
    const token = jwt.sign(
      { username: ADMIN_CREDENTIALS.username, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure: false, // works locally and over cloudflare tunnel
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
  const token = req.cookies?.token || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.json({ authenticated: false });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.username === ADMIN_CREDENTIALS.username) {
      return res.json({
        authenticated: true,
        user: { username: decoded.username, role: 'admin' },
      });
    }
  } catch (err) {
    // expired or invalid
  }

  return res.json({ authenticated: false });
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

export default router;
