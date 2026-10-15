import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from '../config.js';
import { requireAdmin } from './auth.js';

const router = express.Router();

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 30);
    const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    cb(null, `${cleanName}_${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (req, file, cb) => {
    const allowedExts = /^\.(jpe?g|png|gif|webp)$/i;
    const allowedMimes = /^image\/(jpeg|png|gif|webp)$/i;
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    if (allowedExts.test(ext) && allowedMimes.test(mime)) {
      return cb(null, true);
    }
    cb(new Error('Only image files (JPG, PNG, GIF, WebP) are allowed! SVG uploads are prohibited.'));
  },
});

router.post('/', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Image upload failed' });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded' });
      }

      const fileUrl = `/uploads/${req.file.filename}`;
      res.json({
        success: true,
        url: fileUrl,
        filename: req.file.filename,
        size: req.file.size,
      });
    } catch (innerErr) {
      res.status(500).json({ error: innerErr.message || 'Image upload failed' });
    }
  });
});

export default router;
