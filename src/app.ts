import express, { NextFunction, Request, Response } from 'express';
import { config } from './config/config.service';
import { logger } from './core/logger';
import { registerTalkWebhook } from './controllers/talk-webhook.controller';
import { registerHealth } from './controllers/health.controller';

const app = express();

// Capture the RAW body so HMAC signature verification sees the exact bytes
// Nextcloud signed (re-serialized JSON would break the hash).
app.use(express.json({
    limit: '2mb',
    verify: (req: any, _res, buf) => { req.rawBody = buf; }
}));

app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`);
    next();
});

registerTalkWebhook(app);
registerHealth(app);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

export { app };
