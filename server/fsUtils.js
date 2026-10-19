import fs from 'fs';
import path from 'path';

export const isValidId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[\w-]+$/.test(id);

export function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true }); // no-op after successful rename
  }
}

export function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      return parsed && typeof parsed === 'object' ? [parsed] : [];
    } catch (err) {
      console.error(`Skipping unreadable ${f}:`, err.message);
      return [];
    }
  });
}
