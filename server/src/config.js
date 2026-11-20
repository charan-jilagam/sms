import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Load server/.env (real environment variables always win)
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* no .env file - fine */ }
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
  jwtExpiresIn: env.JWT_EXPIRES_IN || env.JWT_EXPIRE || '12h',
  dbPath: env.DB_PATH ? (env.DB_PATH === ':memory:' ? ':memory:' : path.resolve(root, env.DB_PATH)) : path.join(root, 'data', 'school.db'),
  uploadDir: path.resolve(root, env.UPLOAD_DIR || 'uploads'),
  backupDir: path.resolve(root, env.BACKUP_DIR || 'data/backups'),
  corsOrigin: (env.CORS_ORIGIN || env.FRONTEND_URL || 'http://localhost:5173').split(',').map((s) => s.trim()),
  paymentProvider: env.PAYMENT_PROVIDER || (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? 'razorpay' : 'mock'),
  razorpay: { keyId: env.RAZORPAY_KEY_ID || '', keySecret: env.RAZORPAY_KEY_SECRET || '' },
  brevoApiKey: env.BREVO_API_KEY || '',
  emailFrom: env.EMAIL_FROM || env.EMAIL_USER || '',
  textbee: { apiKey: env.TEXTBEE_API_KEY || '', deviceId: env.TEXTBEE_DEVICE_ID || '' },
  smsCountryCode: env.SMS_DEFAULT_COUNTRY_CODE || '+91',
  enableCron: env.ENABLE_CRON === '1',            // scheduler is OFF unless ENABLE_CRON=1
  clientDist: path.resolve(root, '..', 'client', 'dist'),
};
