import { v4 as uuidv4 } from 'uuid';

/**
 * Robust RFC-4180 compliant CSV parser.
 * Supports quoted fields, escaped quotes (""), commas, and multi-line fields.
 */
export function parseCsv(text) {
  if (typeof text !== 'string') return [];

  // Strip UTF-8 BOM if present
  let cleanText = text;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  const rows = [];
  let currentRow = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentField += '"';
          i++;
        } else {
          // End of quoted field
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\r') {
        // Carriage return: skip if followed by \n
        if (nextChar === '\n') i++;
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  // Final field and row
  currentRow.push(currentField.trim());
  if (currentRow.some((f) => f.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Escapes a field for CSV output.
 */
export function escapeCsvField(val) {
  if (val === undefined || val === null) return '""';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Parses a Kahoot format CSV spreadsheet into a BetelQuiz Quiz object.
 */
export function parseKahootCsv(csvText, quizTitle = 'Imported Kahoot Quiz') {
  const rows = parseCsv(csvText);
  if (!rows || rows.length === 0) {
    throw new Error('CSV file is empty');
  }

  // Find header row or assume row 0
  let startIndex = 0;
  const firstRowLower = rows[0].map((c) => c.toLowerCase());
  if (
    firstRowLower.some((c) => c.includes('question') || c.includes('answer 1') || c.includes('time limit'))
  ) {
    startIndex = 1;
  }

  const questions = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;

    const questionTitle = row[0] || `Question ${questions.length + 1}`;
    const ans1 = row[1] || '';
    const ans2 = row[2] || '';
    const ans3 = row[3] || '';
    const ans4 = row[4] || '';
    const rawTimeLimit = row[5] || '20';
    const rawCorrect = row[6] || '1';

    const rawAnswers = [
      { colIndex: 1, text: ans1 },
      { colIndex: 2, text: ans2 },
      { colIndex: 3, text: ans3 },
      { colIndex: 4, text: ans4 },
    ].filter((item) => Boolean(item.text && item.text.trim()));

    if (rawAnswers.length < 2) {
      // Need at least 2 options
      continue;
    }

    // Parse correct answers indices (e.g. "1", "2", "1,2", "1, 3")
    const correctIndices = (String(rawCorrect).match(/\d+/g) || ['1']).map((n) => parseInt(n, 10));

    // Construct options
    const options = rawAnswers.map((item, idx) => ({
      id: `opt_${idx + 1}`,
      text: item.text.trim(),
      isCorrect: correctIndices.includes(item.colIndex),
    }));

    // Ensure at least one correct option exists
    if (!options.some((o) => o.isCorrect)) {
      options[0].isCorrect = true;
    }

    // Detect true/false or yes/no
    const isTrueFalse =
      options.length === 2 &&
      options.some((o) => /^(true|t)$/i.test(o.text)) &&
      options.some((o) => /^(false|f)$/i.test(o.text));

    const isYesNo =
      options.length === 2 &&
      options.some((o) => /^(yes|y|da)$/i.test(o.text)) &&
      options.some((o) => /^(no|n|nu)$/i.test(o.text));

    let questionType = 'quiz';
    if (isTrueFalse) questionType = 'true_false';
    else if (isYesNo) questionType = 'yes_no';

    const isMultiSelect = options.filter((o) => o.isCorrect).length > 1;

    let timeLimit = parseInt(rawTimeLimit, 10);
    if (isNaN(timeLimit) || timeLimit <= 0) timeLimit = 20;

    questions.push({
      id: uuidv4(),
      type: questionType,
      title: questionTitle.trim(),
      timeLimit,
      points: 1000,
      isMultiSelect,
      options,
    });
  }

  if (questions.length === 0) {
    throw new Error('No valid quiz questions found in the CSV file');
  }

  return {
    id: uuidv4(),
    title: quizTitle,
    description: `Imported from Kahoot spreadsheet (${questions.length} questions)`,
    coverImage: '',
    theme: 'spring',
    defaultTimeLimit: 20,
    defaultPoints: 1000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions,
  };
}

/**
 * Exports BetelQuiz questions to the official Kahoot spreadsheet CSV format.
 */
export function exportToKahootCsv(quiz) {
  if (!quiz || !Array.isArray(quiz.questions)) {
    throw new Error('Invalid quiz object');
  }

  const lines = [];

  // Kahoot official header
  lines.push(
    'Question,Answer 1,Answer 2,Answer 3,Answer 4,Time limit (sec),Correct answer(s)'
  );

  for (const q of quiz.questions) {
    // Supported Kahoot formats: quiz, true_false, yes_no, picture_reveal
    if (!['quiz', 'true_false', 'yes_no', 'picture_reveal'].includes(q.type)) {
      continue;
    }

    const options = Array.isArray(q.options) ? q.options : [];
    const ans1 = options[0]?.text || '';
    const ans2 = options[1]?.text || '';
    const ans3 = options[2]?.text || '';
    const ans4 = options[3]?.text || '';

    const correctIndices = [];
    options.forEach((opt, idx) => {
      if (opt.isCorrect && idx < 4) {
        correctIndices.push(idx + 1);
      }
    });

    const row = [
      escapeCsvField(q.title),
      escapeCsvField(ans1),
      escapeCsvField(ans2),
      escapeCsvField(ans3),
      escapeCsvField(ans4),
      escapeCsvField(q.timeLimit || 20),
      escapeCsvField(correctIndices.length > 0 ? correctIndices.join(',') : '1'),
    ];

    lines.push(row.join(','));
  }

  return lines.join('\n');
}

/**
 * Full-fidelity BetelQuiz JSON export string.
 */
export function exportToBetelQuizJson(quiz) {
  return JSON.stringify(quiz, null, 2);
}

/**
 * Parses and validates full-fidelity BetelQuiz JSON file.
 */
export function parseBetelQuizJson(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    if (!data.title || !Array.isArray(data.questions)) {
      throw new Error('Invalid BetelQuiz format: Missing title or questions');
    }
    // Re-assign fresh IDs to prevent collision if re-importing
    const freshId = uuidv4();
    return {
      ...data,
      id: freshId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(`Failed to parse BetelQuiz JSON: ${err.message}`);
  }
}
