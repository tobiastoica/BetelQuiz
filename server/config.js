import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.argv.some(
    (arg) => typeof arg === 'string' && (arg.includes('test') || arg === '--test')
  );

function requiredEnv(name, fallback) {
  const value = process.env[name] || (isTestEnv ? fallback : undefined);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const QUIZZES_DIR = path.join(DATA_DIR, 'quizzes');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const PROFILES_DIR =
  process.env.PROFILES_DIR ||
  (isTestEnv ? path.join(DATA_DIR, 'test_profiles') : path.join(DATA_DIR, 'profiles'));
export const REPORTS_DIR =
  process.env.REPORTS_DIR ||
  (isTestEnv ? path.join(DATA_DIR, 'test_reports') : path.join(DATA_DIR, 'reports'));
export const GAME_LOGS_DIR =
  process.env.GAME_LOGS_DIR ||
  (isTestEnv ? path.join(DATA_DIR, 'test_game_logs') : path.join(DATA_DIR, 'game_logs'));
export const CLIENT_DIST_DIR = path.join(ROOT_DIR, 'client', 'dist');

export const PORT = process.env.PORT || 3000;
export const JWT_SECRET = requiredEnv('JWT_SECRET', 'test-only-secret');

export const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: requiredEnv('ADMIN_PASSWORD', 'test-only-password')
};
