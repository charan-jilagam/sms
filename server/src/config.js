import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 24)) {
  console.error('FATAL: set JWT_SECRET (24+ chars) in production');
  process.exit(1);
}

export const config = {
  root,
  isProd,
  port: Number(env.PORT || 4000),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-do-not-use-in-production',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
  dbPath: env.DB_PATH ? (env.DB_PATH === ':memory:' ? ':memory:' : path.resolve(root, env.DB_PATH)) : path.join(root, 'data', 'school.db'),
  uploadDir: path.resolve(root, env.UPLOAD_DIR || 'uploads'),
  backupDir: path.resolve(root, env.BACKUP_DIR || 'data/backups'),
  corsOrigin: (env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  paymentProvider: env.PAYMENT_PROVIDER || 'mock',
  enableCron: env.ENABLE_CRON !== '0',
  clientDist: path.resolve(root, '..', 'client', 'dist'),
};
