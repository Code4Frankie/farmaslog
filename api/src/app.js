import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import authRoutes from './routes/auth.routes.js';
import verifyRoutes from './routes/verify.routes.js';
import farmerRoutes from './routes/farmer.routes.js';
import accessRoutes from './routes/access.routes.js';
import adminRoutes from './routes/admin.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import referenceRoutes from './routes/reference.routes.js';
import meRoutes from './routes/me.routes.js';
import staffRoutes from './routes/staff.routes.js';
import { openapi } from './docs/openapi.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render's proxy: use the real client IP for rate limits

  app.use(requestId);
  // Swagger UI needs inline scripts, so it is mounted before helmet's strict CSP.
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'FarmasLog-API' }));
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins.length ? env.corsOrigins : false }));

  if (!env.isTest) {
    // Log the path WITHOUT the query string: /v1/verify?phone=... must never reach HTTP logs.
    morgan.token('safe-path', (req) => (req.originalUrl || req.url).split('?')[0]);
    morgan.token('rid', (req) => req.id);
    app.use(morgan(':method :safe-path :status :res[content-length] - :response-time ms :rid'));
  }

  // Webhook first, with the raw body preserved for signature verification.
  app.use('/v1/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), webhookRoutes);
  app.use(express.json({ limit: '100kb' }));
  app.use(globalLimiter);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', (_req, res) => (mongoose.connection.readyState === 1 ? res.json({ status: 'ready' }) : res.status(503).json({ status: 'not_ready' })));

  app.use('/v1/auth', authRoutes);
  app.use('/v1/verify', verifyRoutes);
  app.use('/v1/reference', referenceRoutes);
  app.use('/v1/me', meRoutes);
  app.use('/v1/staff', staffRoutes);
  app.use('/v1/farmers', farmerRoutes);
  app.use('/v1', accessRoutes);
  app.use('/v1', adminRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
