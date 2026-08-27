import { app } from './app';
import { config } from './config/config.service';
import { logger } from './core/logger';
import { sessionStore } from './services/session.service';
import { sendTalkMessage } from './services/talk/talk-client.service';
import { SESSION_FAREWELL } from './features/agent/prompt';

if (!config.talkServerUrl || !config.talkSecret) {
    logger.warn('⚠️ TALK_SERVER_URL / TALK_SECRET not fully configured — the bot will run but cannot sign replies until you register it in Nextcloud (see README).');
}

// When an idle session is evicted, post a farewell back into the room so the
// user knows the conversation closed (mirrors the original Ami engine).
sessionStore.setExpireHandler(async (session) => {
    try {
        await sendTalkMessage(session.roomToken, SESSION_FAREWELL);
    } catch (error) {
        logger.error('Failed to post session farewell:', error);
    }
});

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
