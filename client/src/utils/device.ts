import { v4 as uuidv4 } from 'uuid';

const COOKIE_NAME = 'betelquiz_user_uuid';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readCookie(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]).trim() : '';
  return UUID_REGEX.test(value) ? value : null;
}

// This browser's player id. The server issues the cookie with the page; if it is missing (e.g. the Vite
// dev server served the page) one is created here. Resolved once, synchronously, so it never changes
// while the page is open, and the REST profile endpoints see the same id through the cookie.
function resolveDeviceUuid(): string {
  const existing = readCookie();
  if (existing) return existing;
  const fresh = uuidv4();
  document.cookie = `${COOKIE_NAME}=${fresh}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  return fresh;
}

export const deviceUuid = resolveDeviceUuid();
