import { app } from './app';
import { config } from './config';
import { logger } from './logger';

if (!config.talkServerUrl || !config.talkSecret) {
    logger.warn('⚠️ TALK_SERVER_URL / TALK_SECRET not fully configured — the bot will run but cannot sign replies until you register it in Nextcloud (see README).');
}

const server = app.listen(config.port, () => {
    logger.success(`🚀 ${config.companyName} Help Desk — Ami for Nextcloud Talk`);
    logger.success(`📍 Webhook endpoint: http://localhost:${config.port}${config.talkWebhookPath}`);
    logger.success(`🌐 Talk server: ${config.talkServerUrl || '(not configured)'}`);
});

process.on('SIGTERM', () => {
    logger.info('🛑 Shutting down gracefully...');
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    logger.info('🛑 Shutting down gracefully...');
    server.close(() => process.exit(0));
});
