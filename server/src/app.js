import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { get } from './db/index.js';
import { authenticate, errorHandler } from './middleware/auth.js';
import auth from './routes/auth.js';
import users from './routes/users.js';
import students from './routes/students.js';
import academic from './routes/academic.js';
import attendance from './routes/attendance.js';
import exams from './routes/exams.js';
import fees from './routes/fees.js';
import finance from './routes/finance.js';
import reports from './routes/reports.js';
import requests from './routes/requests.js';
import comms from './routes/comms.js';
import transport from './routes/transport.js';
import hr from './routes/hr.js';
import system from './routes/system.js';
import dashboard from './routes/dashboard.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.corsOrigin, credentials: false }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_q, res) => res.json({ ok: true, time: new Date().toISOString(), db: !!get('SELECT 1 x') }));

  app.use('/api/auth', auth);
  app.use('/api/users', users);
  app.use('/api/students', students);
  app.use('/api', academic);          // classes, subjects, periods, timetable
  app.use('/api/attendance', attendance);
  app.use('/api', exams);             // exams, marks, results, papers
  app.use('/api/fees', fees);
  app.use('/api/finance', finance);
  app.use('/api/reports', reports);
  app.use('/api', requests);          // leaves, change-requests
  app.use('/api', comms);             // announcements, diary, tickets, community, notifications
  app.use('/api/transport', transport);
  app.use('/api/hr', hr);
  app.use('/api/dashboard', dashboard);
  app.use('/api/system', system);

  app.use('/api', (_q, res) => res.status(404).json({ error: 'Endpoint not found' }));

  // Serve the built React app from the same port when available (production)
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist));
    app.get('*', (_q, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
