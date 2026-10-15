import type { Quiz } from '../types/quiz';

const API_BASE = '/api';

export async function login(username: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`);
    return await res.json();
  } catch {
    return { authenticated: false };
  }
}

export async function logout() {
  const res = await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  return res.json();
}

export async function fetchQuizzes(): Promise<Quiz[]> {
  const res = await fetch(`${API_BASE}/quizzes`);
  const data = await res.json();
  return data.quizzes || [];
}

export async function fetchQuiz(id: string): Promise<Quiz | null> {
  const res = await fetch(`${API_BASE}/quizzes/${id}`);
  const data = await res.json();
  return data.quiz || null;
}

export async function createQuiz(quiz: Partial<Quiz>): Promise<Quiz> {
  const res = await fetch(`${API_BASE}/quizzes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quiz),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create quiz');
  return data.quiz;
}

export async function updateQuiz(id: string, quiz: Partial<Quiz>): Promise<Quiz> {
  const res = await fetch(`${API_BASE}/quizzes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quiz),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update quiz');
  return data.quiz;
}

export async function deleteQuiz(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/quizzes/${id}`, { method: 'DELETE' });
  const data = await res.json();
  return data.success;
}

export async function duplicateQuiz(id: string): Promise<Quiz> {
  const res = await fetch(`${API_BASE}/quizzes/${id}/duplicate`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to duplicate quiz');
  return data.quiz;
}

export async function uploadImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('image', file);

  const res = await fetch(`${API_BASE}/uploads`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to upload image');
  return data.url;
}

export async function checkActiveGame(userUuid: string): Promise<{
  hasActiveGame: boolean;
  pin?: string;
  gameId?: string;
  gameState?: string;
  quizTitle?: string;
  player?: {
    userUuid: string;
    nickname: string;
    avatar: string;
    score: number;
    streak: number;
  };
}> {
  try {
    const res = await fetch(`${API_BASE}/player/active-game?userUuid=${encodeURIComponent(userUuid)}`);
    if (!res.ok) return { hasActiveGame: false };
    return await res.json();
  } catch {
    return { hasActiveGame: false };
  }
}
