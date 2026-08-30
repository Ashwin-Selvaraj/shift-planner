import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './lib/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { configRouter } from './routes/config.js';
import { dashboardRouter } from './routes/dashboard.js';
import { employeeRouter } from './routes/employees.js';
import { holidayRouter } from './routes/holidays.js';
import { leaveRouter } from './routes/leaves.js';
import { auditRouter, notificationRouter } from './routes/misc.js';
import { reportRouter } from './routes/reports.js';
import { rosterRouter } from './routes/rosters.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin.split(',').map((value) => value.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (!env.isProduction) app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'shift-planner-api', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/employees', employeeRouter);
  app.use('/api/config', configRouter);
  app.use('/api/holidays', holidayRouter);
  app.use('/api/leaves', leaveRouter);
  app.use('/api/rosters', rosterRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/audit', auditRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
