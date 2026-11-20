import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { startCron } from './jobs/index.js';
import { get } from './db/index.js';

migrate();
const app = createApp();
const tasks = startCron();
const server = app.listen(config.port, () => {
  console.log(`School ERP API listening on http://localhost:${config.port}`);
  if (!get("SELECT 1 x FROM users WHERE role = 'admin' LIMIT 1")) console.log('No admin account yet. Run:  npm run seed   (demo data)  or  npm run seed -- --minimal');
});
const stop = () => { tasks.forEach((t) => t.stop()); server.close(() => process.exit(0)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
