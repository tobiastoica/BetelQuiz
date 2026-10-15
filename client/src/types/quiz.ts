export type QuestionType =
  | 'quiz'
  | 'true_false'
  | 'yes_no'
  | 'puzzle'
  | 'number_guess'
  | 'word_guess'
  | 'picture_reveal';

export type TileLevel = 'small' | 'medium' | 'big';

export interface AnswerOption {
  id: string;
  text: string;
  isCorrect: boolean;
  order?: number; // for puzzle
}

export interface Question {
  id: string;
  type: QuestionType;
  title: string;
  timeLimit: number; // in seconds
  points: number; // 0 to 2000
  image?: string;
  backgroundImage?: string;
  theme?: string;
  isMultiSelect?: boolean;
  options: AnswerOption[];
  numberTarget?: number;
  numberMin?: number;
  numberMax?: number;
  // Fill-in-the-blank / Word guess
  acceptedAnswers?: string[];
  allowMultipleAnswers?: boolean;
  caseSensitive?: boolean;
  fuzzyMatching?: boolean;
  fuzzyScorePercentage?: number; // e.g. 80 for 80% points on minor typo
  // Picture reveal
  tileLevel?: TileLevel; // small: 3x3 (9 tiles), medium: 4x4 (16 tiles), big: 6x6 (36 tiles)
}

export interface Quiz {
  id: string;
  title: string;
  description?: string;
  coverImage?: string;
  theme?: string;
  backgroundImage?: string;
  defaultTimeLimit?: number;
  defaultPoints?: number;
  createdAt: string;
  updatedAt: string;
  questions: Question[];
}

export interface Player {
  userUuid: string;
  nickname: string;
  avatar: string;
  score: number;
  streak: number;
  connected?: boolean;
}

export type GameState =
  | 'LOBBY'
  | 'GET_READY'
  | 'QUESTION_ACTIVE'
  | 'QUESTION_REVEAL'
  | 'SCOREBOARD'
  | 'PODIUM';

export interface LeaderboardEntry {
  rank: number;
  userUuid: string;
  nickname: string;
  avatar: string;
  score: number;
  streak: number;
}

export interface RecentGameRecord {
  gameId: string;
  pin: string;
  quizTitle: string;
  rank: number;
  score: number;
  totalPlayers: number;
  accuracy?: number;
  playedAt: string;
}

export interface PlayerProfile {
  userUuid: string;
  nickname: string;
  avatar: string;
  gamesPlayed: number;
  wins: number; // 1st place finishes
  podiums: number; // 1st, 2nd, or 3rd place finishes
  totalScore: number;
  highestStreak: number;
  correctAnswersCount: number;
  totalAnswersCount: number;
  accuracyPercentage: number;
  recentGames: RecentGameRecord[];
}

export interface QuestionSubmission {
  userUuid: string;
  nickname: string;
  avatar: string;
  answerPayload: any;
  responseTimeMs: number;
  pointsEarned: number;
  isCorrect: boolean;
  isPartial?: boolean;
}

export interface QuestionAnalytics {
  questionIndex: number;
  title: string;
  type: QuestionType;
  timeLimit: number;
  points: number;
  totalSubmissions: number;
  correctCount: number;
  partialCount: number;
  wrongCount: number;
  accuracyRate: number; // 0 to 100%
  averageResponseTimeMs: number;
  isToughestQuestion?: boolean;
  fastestSolver?: {
    userUuid: string;
    nickname: string;
    responseTimeMs: number;
  } | null;
  submissions: QuestionSubmission[];
  voteDistribution?: Record<string, number>;
  puzzleStats?: { correct: number; partial: number; wrong: number; total: number } | null;
  wordSubmissions?: Record<string, number>;
}

export interface GameReport {
  reportId: string;
  gameId: string;
  pin: string;
  quizId: string;
  quizTitle: string;
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
  totalPlayers: number;
  totalQuestions: number;
  podium: {
    first?: LeaderboardEntry | null;
    second?: LeaderboardEntry | null;
    third?: LeaderboardEntry | null;
  };
  leaderboard: LeaderboardEntry[];
  questionAnalytics: QuestionAnalytics[];
  toughestQuestion?: {
    questionIndex: number;
    title: string;
    accuracyRate: number;
  } | null;
  speedChampion?: {
    userUuid: string;
    nickname: string;
    averageResponseTimeMs: number;
  } | null;
}

export interface PlayerAnalyticsSummary {
  userUuid: string;
  currentNickname: string;
  avatar: string;
  nicknames: string[];
  gamesPlayed: number;
  totalScore: number;
  averageScore: number;
  firstPlaceCount: number;
  secondPlaceCount: number;
  thirdPlaceCount: number;
  highestStreak: number;
  accuracyPercentage: number;
  lastPlayedAt: string | null;
}
