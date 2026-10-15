import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.argv.some(
    (arg) => typeof arg === 'string' && (arg.includes('test') || arg === '--test')
  );

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const QUIZZES_DIR = path.join(DATA_DIR, 'quizzes');
export const GAMES_DIR = path.join(DATA_DIR, 'games');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const PROFILES_DIR =
  process.env.PROFILES_DIR ||
  (isTestEnv ? path.join(DATA_DIR, 'test_profiles') : path.join(DATA_DIR, 'profiles'));
export const REPORTS_DIR =
  process.env.REPORTS_DIR ||
  (isTestEnv ? path.join(DATA_DIR, 'test_reports') : path.join(DATA_DIR, 'reports'));
export const CLIENT_DIST_DIR = path.join(ROOT_DIR, 'client', 'dist');

export const PORT = process.env.PORT || 3000;
export const JWT_SECRET = process.env.JWT_SECRET || 'kahootv2-secure-tbsst-jwt-token-key-2026';

export const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'admin1235'
};
