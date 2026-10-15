import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { listQuizzes, getQuizById, saveQuiz, deleteQuiz } from '../storage.js';
import { requireAdmin, isAdmin } from './auth.js';
import { parseKahootCsv, exportToKahootCsv, parseBetelQuizJson } from '../quizBridge.js';
import { shuffleArray } from '../scoring.js';

const router = express.Router();

// Public: List quizzes (or can be accessed by admin dashboard)
router.get('/', (req, res) => {
  const quizzes = listQuizzes();
  res.json({ success: true, quizzes });
});

// Public / Host: Get quiz details by ID
router.get('/:id', (req, res) => {
  const quiz = getQuizById(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz not found' });
  }

  // Admin requests receive the full quiz including answers for editing
  if (isAdmin(req)) {
    return res.json({ success: true, quiz });
  }

  // Non-admin requests: sanitize quiz questions so players cannot inspect answers ahead of time
  const sanitizedQuiz = {
    ...quiz,
    questions: Array.isArray(quiz.questions)
      ? quiz.questions.map((q) => {
          const sanitizedQ = { ...q };
          if (Array.isArray(sanitizedQ.options)) {
            sanitizedQ.options = sanitizedQ.options.map((opt) => {
              const sanitizedOpt = { ...opt };
              delete sanitizedOpt.isCorrect;
              if (sanitizedQ.type === 'puzzle') {
                delete sanitizedOpt.order;
              }
              return sanitizedOpt;
            });
            if (sanitizedQ.type === 'puzzle') {
              sanitizedQ.options = shuffleArray(sanitizedQ.options);
            }
          }
          if (sanitizedQ.type === 'word_guess') {
            delete sanitizedQ.acceptedAnswers;
          }
          if (sanitizedQ.type === 'number_guess') {
            delete sanitizedQ.numberTarget;
          }
          return sanitizedQ;
        })
      : [],
  };

  res.json({ success: true, quiz: sanitizedQuiz });
});

// Admin: Create new quiz
router.post('/', requireAdmin, (req, res) => {
  try {
    const quizData = req.body || {};
    const quiz = {
      id: quizData.id || uuidv4(),
      title: quizData.title || 'Untitled Quiz',
      description: quizData.description || '',
      coverImage: quizData.coverImage || '',
      theme: quizData.theme || 'spring',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: Array.isArray(quizData.questions) ? quizData.questions : [],
    };

    const saved = saveQuiz(quiz);
    res.json({ success: true, quiz: saved });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to save quiz' });
  }
});

// Admin: Update quiz
router.put('/:id', requireAdmin, (req, res) => {
  try {
    const existing = getQuizById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const updated = {
      ...existing,
      ...req.body,
      id: req.params.id, // prevent id mismatch
      updatedAt: new Date().toISOString(),
    };

    saveQuiz(updated);
    res.json({ success: true, quiz: updated });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update quiz' });
  }
});

// Admin: Duplicate quiz
router.post('/:id/duplicate', requireAdmin, (req, res) => {
  try {
    const existing = getQuizById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const duplicated = {
      ...existing,
      id: uuidv4(),
      title: `${existing.title} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: (existing.questions || []).map((q) => ({
        ...q,
        id: uuidv4(),
        options: Array.isArray(q.options)
          ? q.options.map((opt) => ({
              ...opt,
              id: uuidv4(),
            }))
          : [],
      })),
    };

    saveQuiz(duplicated);
    res.json({ success: true, quiz: duplicated });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to duplicate quiz' });
  }
});

// Admin: Delete quiz
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const deleted = deleteQuiz(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete quiz' });
  }
});

// Admin: Import Kahoot CSV
router.post('/import/kahoot', requireAdmin, (req, res) => {
  try {
    const { csvContent, title } = req.body || {};
    if (!csvContent) {
      return res.status(400).json({ error: 'Missing csvContent' });
    }

    const quiz = parseKahootCsv(csvContent, title || 'Imported Kahoot Quiz');
    saveQuiz(quiz);
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to parse Kahoot CSV' });
  }
});

// Admin: Import BetelQuiz JSON
router.post('/import/betelquiz', requireAdmin, (req, res) => {
  try {
    const { jsonContent } = req.body || {};
    if (!jsonContent) {
      return res.status(400).json({ error: 'Missing jsonContent' });
    }

    const quiz = parseBetelQuizJson(
      typeof jsonContent === 'string' ? jsonContent : JSON.stringify(jsonContent)
    );
    saveQuiz(quiz);
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to parse BetelQuiz JSON' });
  }
});

// Admin: Export to Kahoot CSV
router.get('/:id/export/kahoot', requireAdmin, (req, res) => {
  try {
    const quiz = getQuizById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const csvData = exportToKahootCsv(quiz);

    const safeTitle = (quiz.title || 'quiz').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kahoot_${safeTitle}.csv"`);
    res.send(csvData);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to export Kahoot CSV' });
  }
});

// Admin: Export to BetelQuiz JSON
router.get('/:id/export/betelquiz', requireAdmin, (req, res) => {
  try {
    const quiz = getQuizById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const safeTitle = (quiz.title || 'quiz').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="betelquiz_${safeTitle}.json"`);
    res.send(JSON.stringify(quiz, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to export BetelQuiz JSON' });
  }
});

export default router;
