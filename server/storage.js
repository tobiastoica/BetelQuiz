import fs from 'fs';
import path from 'path';
import { DATA_DIR, QUIZZES_DIR, UPLOADS_DIR, PROFILES_DIR, REPORTS_DIR } from './config.js';
import { isValidId, writeJsonAtomic, readJsonDir } from './fsUtils.js';

export function normalizePuzzleOrder(q) {
  if (!q || q.type !== 'puzzle') return q;
  const sorted = (q.options || [])
    .map((o, i) => ({ ...o, order: o.order ?? i }))
    .sort((a, b) => a.order - b.order);
  return { ...q, options: sorted.map((o, i) => ({ ...o, order: i })) };
}

// Ensure directories exist
export function initStorage() {
  [DATA_DIR, QUIZZES_DIR, UPLOADS_DIR, PROFILES_DIR, REPORTS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Create default sample quiz if none exists
  const quizzes = listQuizzes();
  if (quizzes.length === 0) {
    createSampleQuiz();
  }
}

export function listQuizzes() {
  try {
    const rawQuizzes = readJsonDir(QUIZZES_DIR);
    const list = rawQuizzes.map((parsed) => ({
      id: parsed.id,
      title: parsed.title,
      description: parsed.description || '',
      coverImage: parsed.coverImage || '',
      theme: parsed.theme || 'spring',
      defaultTimeLimit: parsed.defaultTimeLimit ?? 20,
      defaultPoints: parsed.defaultPoints ?? 1000,
      questionCount: Array.isArray(parsed.questions) ? parsed.questions.length : 0,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    }));
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch (err) {
    console.error('Error listing quizzes:', err);
    return [];
  }
}

export function getQuizById(id) {
  try {
    if (!isValidId(id)) return null;
    const filePath = path.join(QUIZZES_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed) {
      if (parsed.defaultTimeLimit === undefined) parsed.defaultTimeLimit = 20;
      if (parsed.defaultPoints === undefined) parsed.defaultPoints = 1000;
      if (!parsed.theme) parsed.theme = 'spring';
    }
    if (Array.isArray(parsed?.questions)) {
      parsed.questions = parsed.questions.map(normalizePuzzleOrder);
    }
    return parsed;
  } catch (err) {
    console.error(`Error getting quiz ${id}:`, err);
    return null;
  }
}

export function saveQuiz(quiz) {
  try {
    if (!quiz || !isValidId(quiz.id)) {
      throw new Error('Quiz must have a valid alphanumeric id');
    }
    quiz.updatedAt = new Date().toISOString();
    if (!quiz.createdAt) {
      quiz.createdAt = quiz.updatedAt;
    }
    quiz.defaultTimeLimit = quiz.defaultTimeLimit ?? 20;
    quiz.defaultPoints = quiz.defaultPoints ?? 1000;
    quiz.theme = quiz.theme || 'spring';
    if (Array.isArray(quiz.questions)) {
      quiz.questions = quiz.questions.map((q) => {
        let question = { ...q };
        if (['quiz', 'true_false', 'yes_no', 'picture_reveal'].includes(question.type) && Array.isArray(question.options)) {
          question.options = question.options.filter((opt) => Boolean(opt && opt.text && opt.text.trim() !== ''));
        }
        return normalizePuzzleOrder(question);
      });
    }
    const filePath = path.join(QUIZZES_DIR, `${quiz.id}.json`);
    writeJsonAtomic(filePath, quiz);
    return quiz;
  } catch (err) {
    console.error('Error saving quiz:', err);
    throw err;
  }
}

export function deleteQuiz(id) {
  try {
    if (!isValidId(id)) return false;
    const filePath = path.join(QUIZZES_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Error deleting quiz ${id}:`, err);
    throw err;
  }
}

export function createSampleQuiz() {
  const sampleQuiz = {
    id: 'sample-master-quiz',
    title: 'BetelQuiz Master Showcase',
    description: 'Showcasing all question types, image media, multi-select, puzzle ranking, and number guessing!',
    coverImage: '',
    theme: 'spring',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [
      {
        id: 'q1',
        type: 'quiz',
        title: 'Which planet is known as the Red Planet?',
        timeLimit: 20,
        points: 1000,
        theme: 'spring',
        isMultiSelect: false,
        options: [
          { id: 'opt_1', text: 'Mars', isCorrect: true },
          { id: 'opt_2', text: 'Venus', isCorrect: false },
          { id: 'opt_3', text: 'Jupiter', isCorrect: false },
          { id: 'opt_4', text: 'Saturn', isCorrect: false },
        ],
      },
      {
        id: 'q2',
        type: 'quiz',
        title: 'Select ALL the prime numbers below:',
        timeLimit: 20,
        points: 1500,
        theme: 'summer',
        isMultiSelect: true,
        options: [
          { id: 'opt_1', text: '2', isCorrect: true },
          { id: 'opt_2', text: '7', isCorrect: true },
          { id: 'opt_3', text: '9', isCorrect: false },
          { id: 'opt_4', text: '13', isCorrect: true },
          { id: 'opt_5', text: '15', isCorrect: false },
          { id: 'opt_6', text: '19', isCorrect: true },
        ],
      },
      {
        id: 'q3',
        type: 'true_false',
        title: 'The Great Wall of China is visible from the Moon with the naked eye.',
        timeLimit: 15,
        points: 1000,
        theme: 'autumn',
        options: [
          { id: 'tf_true', text: 'True', isCorrect: false },
          { id: 'tf_false', text: 'False', isCorrect: true },
        ],
      },
      {
        id: 'q4',
        type: 'yes_no',
        title: 'Can octopuses taste with their arms?',
        timeLimit: 15,
        points: 1000,
        theme: 'winter',
        options: [
          { id: 'yn_yes', text: 'Yes', isCorrect: true },
          { id: 'yn_no', text: 'No', isCorrect: false },
        ],
      },
      {
        id: 'q5',
        type: 'puzzle',
        title: 'Rank these events in chronological order (earliest first):',
        timeLimit: 30,
        points: 2000,
        theme: 'dark',
        options: [
          { id: 'puz_1', text: 'Invention of the Printing Press (1440)', isCorrect: true, order: 0 },
          { id: 'puz_3', text: 'Declaration of Independence (1776)', isCorrect: true, order: 1 },
          { id: 'puz_2', text: 'First Moon Landing (1969)', isCorrect: true, order: 2 },
          { id: 'puz_4', text: 'Launch of the World Wide Web (1991)', isCorrect: true, order: 3 },
        ],
      },
      {
        id: 'q6',
        type: 'number_guess',
        title: 'What year was the original Kahoot platform launched?',
        timeLimit: 25,
        points: 1200,
        theme: 'spring',
        numberTarget: 2013,
        numberMin: 1990,
        numberMax: 2030,
        options: [],
      },
    ],
  };

  saveQuiz(sampleQuiz);
  console.log('Sample quiz created: sample-master-quiz');
}
