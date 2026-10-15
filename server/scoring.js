// Scoring engine for KahootV2

export function levenshteinDistance(a, b) {
  const strA = typeof a === 'string' ? a : (a ? String(a) : '');
  const strB = typeof b === 'string' ? b : (b ? String(b) : '');
  if (strA === strB) return 0;
  if (!strA.length) return strB.length;
  if (!strB.length) return strA.length;
  const aVal = strA;
  const bVal = strB;

  const row = [];
  for (let j = 0; j <= strB.length; j++) {
    row[j] = j;
  }

  for (let i = 1; i <= strA.length; i++) {
    let prev = i;
    for (let j = 1; j <= strB.length; j++) {
      let val;
      if (strA[i - 1] === strB[j - 1]) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[strB.length] = prev;
  }

  return row[strB.length];
}

export function normalizeString(str, caseSensitive = false) {
  if (typeof str !== 'string') return '';
  let s = str.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!caseSensitive) {
    s = s.toLowerCase();
  }
  return s.replace(/\s+/g, ' ');
}

export function calculateStreakBonus(streak) {
  if (streak >= 5) return 500;
  if (streak === 4) return 300;
  if (streak === 3) return 200;
  if (streak === 2) return 100;
  return 0;
}

export function shuffleArray(arr) {
  if (!Array.isArray(arr)) return [];
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function calculateQuestionScore(question, answerPayload, responseTimeMs) {
  const maxPoints = typeof question?.points === 'number' && !isNaN(question.points) ? question.points : 1000;
  if (maxPoints <= 0) {
    return { points: 0, isCorrect: false, isPartial: false, accuracy: 0, timeScore: 0 };
  }

  const rawLimit = typeof question?.timeLimit === 'number' && !isNaN(question.timeLimit) && question.timeLimit > 0
    ? question.timeLimit
    : 20;
  const timeLimitMs = Math.max(1000, rawLimit * 1000);

  const safeResponseTimeMs = typeof responseTimeMs === 'number' && !isNaN(responseTimeMs)
    ? Math.max(0, responseTimeMs)
    : 0;

  // Remaining time ratio between 0 and 1 (1 = answered immediately, 0 = answered in last ms)
  const remainingTimeRatio = Math.max(0, Math.min(1, 1 - (safeResponseTimeMs / timeLimitMs)));

  // Time-scaled points:
  // For 1000 pts: scales linearly from 1000 down to 500 (total - 500)
  // For 2000 pts: scales linearly from 2000 down to 1500 (total - 500)
  // Halfway (15 of 30s) for 1000 -> 750, for 2000 -> 1750
  const deduction = maxPoints >= 1000 ? 500 : Math.round(maxPoints * 0.5);
  const minTimeScore = Math.max(0, maxPoints - deduction);
  const rawTimeScore = Math.round(minTimeScore + remainingTimeRatio * deduction);
  const timeScore = isNaN(rawTimeScore) ? 0 : Math.max(0, rawTimeScore);

  switch (question?.type) {
    case 'picture_reveal':
    case 'quiz':
    case 'true_false':
    case 'yes_no': {
      const correctOptionIds = (question.options || [])
        .filter((opt) => opt.isCorrect)
        .map((opt) => opt.id);

      const isMulti = Boolean(question.isMultiSelect);
      const selectedIds = Array.isArray(answerPayload?.selected)
        ? answerPayload.selected
        : answerPayload?.selected
        ? [answerPayload.selected]
        : [];

      const correctSet = new Set(correctOptionIds);
      const userSet = new Set(selectedIds);

      // Single-select mode: if player picked a single option and it is present in correctOptionIds, award full points
      if (!isMulti) {
        if (selectedIds.length === 1 && correctSet.has(selectedIds[0])) {
          return {
            points: timeScore,
            isCorrect: true,
            isPartial: false,
            accuracy: 1,
            timeScore,
            correctOptionIds,
            selectedOptionIds: selectedIds,
          };
        }
        return {
          points: 0,
          isCorrect: false,
          isPartial: false,
          accuracy: 0,
          timeScore,
          correctOptionIds,
          selectedOptionIds: selectedIds,
        };
      }

      // Multi-select mode
      const allCorrectChosen = correctOptionIds.every((id) => userSet.has(id));
      const noWrongChosen = selectedIds.every((id) => correctSet.has(id));
      const correctChosenCount = selectedIds.filter((id) => correctSet.has(id)).length;
      const totalCorrect = correctOptionIds.length;

      // 1. Fully correct
      if (allCorrectChosen && noWrongChosen && totalCorrect > 0) {
        return {
          points: timeScore,
          isCorrect: true,
          isPartial: false,
          accuracy: 1,
          timeScore,
          correctOptionIds,
          selectedOptionIds: selectedIds,
        };
      }

      // 2. Multi-select: Partially correct if picked ONLY correct options, but not all of them
      if (noWrongChosen && correctChosenCount > 0 && totalCorrect > 0) {
        const accuracy = correctChosenCount / totalCorrect;
        const points = Math.round(timeScore * accuracy);
        return {
          points,
          isCorrect: true,
          isPartial: true,
          accuracy,
          timeScore,
          correctOptionIds,
          selectedOptionIds: selectedIds,
        };
      }

      // 3. Any incorrect chosen, or none chosen
      return {
        points: 0,
        isCorrect: false,
        isPartial: false,
        accuracy: 0,
        timeScore,
        correctOptionIds,
        selectedOptionIds: selectedIds,
      };
    }

    case 'puzzle': {
      // answerPayload.order is array of option IDs in user's sequence
      const userOrder = Array.isArray(answerPayload?.order) ? answerPayload.order : [];
      const sortedCorrectOptions = [...(question.options || [])].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      );
      const correctOrder = sortedCorrectOptions.map((opt) => opt.id);
      const correctIdSet = new Set(correctOrder);
      const uniqueUserIds = new Set(userOrder);

      // Validate userOrder contains unique IDs and that all IDs belong to correctOrder
      if (
        correctOrder.length === 0 ||
        userOrder.length !== correctOrder.length ||
        uniqueUserIds.size !== correctOrder.length ||
        !userOrder.every((id) => correctIdSet.has(id))
      ) {
        return { points: 0, isCorrect: false, isPartial: false, accuracy: 0, timeScore };
      }

      let matches = 0;
      for (let i = 0; i < correctOrder.length; i++) {
        if (userOrder[i] === correctOrder[i]) {
          matches++;
        }
      }

      const matchRatio = matches / correctOrder.length;
      if (matchRatio === 1) {
        return { points: timeScore, isCorrect: true, isPartial: false, accuracy: 1, timeScore };
      } else if (matchRatio > 0) {
        const points = Math.round(timeScore * 0.5 * matchRatio);
        return { points, isCorrect: true, isPartial: true, accuracy: matchRatio, timeScore };
      }
      return { points: 0, isCorrect: false, isPartial: false, accuracy: 0, timeScore };
    }

    case 'number_guess': {
      const rawMin = Number(question.numberMin ?? 0);
      const rawMax = Number(question.numberMax ?? 100);
      const trueMin = Math.min(rawMin, rawMax);
      const trueMax = Math.max(rawMin, rawMax);
      const rawTarget = Number(question.numberTarget ?? Math.round((trueMin + trueMax) / 2));
      const target = Math.max(trueMin, Math.min(trueMax, rawTarget));
      const rawGuess = Number(answerPayload?.number);

      if (isNaN(rawGuess)) {
        return { points: 0, isCorrect: false, isPartial: false, accuracy: 0, timeScore };
      }

      // Clamp guess to [trueMin, trueMax] range
      const guess = Math.max(trueMin, Math.min(trueMax, rawGuess));

      // 1. Exact match receives full time-scaled points
      if (guess === target) {
        return {
          points: timeScore,
          isCorrect: true,
          isExact: true,
          isPartial: false,
          accuracy: 1,
          timeScore,
          target,
          guess,
        };
      }

      // 2. Off-target: scale points as a fraction of timeScore based on distance to the respective boundary
      let accuracy = 0;
      if (guess < target) {
        const lowerBoundDistance = target - trueMin;
        if (lowerBoundDistance > 0) {
          const error = target - guess;
          accuracy = Math.max(0, 1 - error / lowerBoundDistance);
        }
      } else {
        // guess > target
        const upperBoundDistance = trueMax - target;
        if (upperBoundDistance > 0) {
          const error = guess - target;
          accuracy = Math.max(0, 1 - error / upperBoundDistance);
        }
      }

      const points = Math.max(0, Math.min(timeScore, Math.round(timeScore * accuracy)));

      return {
        points,
        isCorrect: points > 0,
        isExact: false,
        isPartial: points > 0,
        accuracy,
        timeScore,
        target,
        guess,
      };
    }

    case 'word_guess': {
      const caseSensitive = Boolean(question.caseSensitive);
      const allowMultiple = Boolean(question.allowMultipleAnswers);
      const fuzzyEnabled = question.fuzzyMatching !== false;
      const fuzzyScorePercentage =
        typeof question.fuzzyScorePercentage === 'number'
          ? Math.max(0, Math.min(100, question.fuzzyScorePercentage))
          : 80;

      const rawAccepted = Array.isArray(question.acceptedAnswers)
        ? question.acceptedAnswers
        : typeof question.acceptedAnswers === 'string'
        ? question.acceptedAnswers
            .split(/[,;\n]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      const normalizedAccepted = rawAccepted.map((ans) => normalizeString(ans, caseSensitive));

      if (normalizedAccepted.length === 0) {
        return { points: 0, isCorrect: false, isPartial: false, accuracy: 0, timeScore };
      }

      // Extract user input(s)
      let userInputs = [];
      if (Array.isArray(answerPayload?.answers)) {
        userInputs = answerPayload.answers;
      } else if (Array.isArray(answerPayload?.selected)) {
        userInputs = answerPayload.selected;
      } else if (typeof answerPayload?.text === 'string') {
        userInputs = [answerPayload.text];
      } else if (typeof answerPayload?.selected === 'string') {
        userInputs = [answerPayload.selected];
      }

      const normalizedUserInputs = userInputs
        .map((ans) => normalizeString(ans, caseSensitive))
        .filter(Boolean);

      if (normalizedUserInputs.length === 0) {
        return { points: 0, isCorrect: false, isPartial: false, accuracy: 0, timeScore };
      }

      // Check single answer match against accepted answers
      const evaluateWord = (userWord) => {
        // 1. Exact match
        for (const accepted of normalizedAccepted) {
          if (userWord === accepted) {
            return { match: 'exact', distance: 0, similarity: 1, matchedAccepted: accepted };
          }
        }

        // 2. Fuzzy match
        if (fuzzyEnabled) {
          let bestMatch = null;
          let bestDistance = Infinity;
          let bestSimilarity = 0;

          for (const accepted of normalizedAccepted) {
            const dist = levenshteinDistance(userWord, accepted);
            const maxLen = Math.max(userWord.length, accepted.length);
            const similarity = maxLen > 0 ? 1 - dist / maxLen : 0;

            // Allow 1 typo for 4-7 chars, 2 typos for 8+ chars, or similarity >= 0.8
            const isFuzzyAllowed =
              (maxLen >= 4 && maxLen <= 7 && dist <= 1) ||
              (maxLen >= 8 && dist <= 2) ||
              similarity >= 0.8;

            if (isFuzzyAllowed && dist < bestDistance) {
              bestDistance = dist;
              bestSimilarity = similarity;
              bestMatch = accepted;
            }
          }

          if (bestMatch) {
            return {
              match: 'fuzzy',
              distance: bestDistance,
              similarity: bestSimilarity,
              matchedAccepted: bestMatch,
            };
          }
        }

        return { match: 'none', distance: Infinity, similarity: 0 };
      };

      if (!allowMultiple) {
        const evaluation = evaluateWord(normalizedUserInputs[0]);
        if (evaluation.match === 'exact') {
          return {
            points: timeScore,
            isCorrect: true,
            isExact: true,
            isPartial: false,
            accuracy: 1,
            timeScore,
            userInput: normalizedUserInputs[0],
            matchedAccepted: evaluation.matchedAccepted,
          };
        } else if (evaluation.match === 'fuzzy') {
          const points = Math.round(timeScore * (fuzzyScorePercentage / 100));
          return {
            points,
            isCorrect: true,
            isExact: false,
            isPartial: true,
            accuracy: evaluation.similarity,
            timeScore,
            userInput: normalizedUserInputs[0],
            matchedAccepted: evaluation.matchedAccepted,
          };
        }
        return {
          points: 0,
          isCorrect: false,
          isExact: false,
          isPartial: false,
          accuracy: 0,
          timeScore,
          userInput: normalizedUserInputs[0],
        };
      }

      // Multi-word answer mode
      let correctMatches = 0;
      let partialMatches = 0;
      const matchedSet = new Set();

      for (const input of normalizedUserInputs) {
        const evalRes = evaluateWord(input);
        if (evalRes.match === 'exact' && !matchedSet.has(evalRes.matchedAccepted)) {
          correctMatches++;
          matchedSet.add(evalRes.matchedAccepted);
        } else if (evalRes.match === 'fuzzy' && !matchedSet.has(evalRes.matchedAccepted)) {
          partialMatches++;
          matchedSet.add(evalRes.matchedAccepted);
        }
      }

      const totalTarget = normalizedAccepted.length;
      const effectiveAccuracy = Math.min(
        1,
        (correctMatches + partialMatches * (fuzzyScorePercentage / 100)) / totalTarget
      );
      const points = Math.round(timeScore * effectiveAccuracy);
      const isCorrect = points > 0;
      const isPartial = points < timeScore && points > 0;

      return {
        points,
        isCorrect,
        isExact: points === timeScore,
        isPartial,
        accuracy: effectiveAccuracy,
        timeScore,
        userInputs: normalizedUserInputs,
      };
    }

    default:
      return { points: 0, isCorrect: false, isPartial: false, accuracy: 0, timeScore };
  }
}
