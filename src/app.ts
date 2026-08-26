import express, { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { logger } from './logger';
import { talkAgent } from './agent';
import { sendTalkMessage } from './talk/client';
import { verifyTalkSignature } from './talk/verify';
import { renderMessageText, TalkWebhook } from './talk/types';

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

app.post(config.talkWebhookPath, async (req: Request & { rawBody?: Buffer }, res: Response) => {
    // Acknowledge immediately — replies are sent asynchronously to the room
    res.status(200).send();

    if (!verifyTalkSignature(req, config.talkSecret)) {
        logger.warn('🚫 Rejected webhook with invalid signature.');
        return;
    }

    const hook = req.body as TalkWebhook;

    // Only handle newly posted chat messages ("Create"); ignore reactions,
    // join/leave notifications and anything without the expected structure.
    if (!hook.object || !hook.target || !hook.actor) {
        logger.info(`ℹ️ Ignored webhook without actor/object/target (type=${hook.type})`);
        return;
    }
    if (hook.type !== 'Create') {
        logger.info(`ℹ️ Ignored non-message event (type=${hook.type}, object.name=${hook.object.name})`);
        return;
    }

    // Skip system messages — only regular chat messages carry name "message"
    if (hook.object.name !== 'message') {
        logger.info(`ℹ️ Ignored system/object message (object.name=${hook.object.name})`);
        return;
    }

    // Skip messages authored by bots (including our own replies)
    if (hook.actor.type === 'Application' || hook.actor.id.startsWith('bots/')) return;

    let text = renderMessageText(hook.object.content);
    if (!text) {
        logger.warn(`⚠️ Could not render message text from content: ${String(hook.object.content).substring(0, 200)}`);
        return;
    }

    // Optional mention gate: only answer when Ami is addressed (@Ami ...)
    if (config.talkRequireMention && !/@ami\b/i.test(text)) return;

    // Strip a leading @Ami mention so the AI sees the actual request
    text = text.replace(/^@ami\s*/i, '').trim() || 'Hello!';

    const roomToken = hook.target.id;
    const actorId = hook.actor.id;
    const actorName = hook.actor.name || undefined;

    logger.info(`📨 Room ${roomToken} | ${actorName || actorId}: "${text}"`);

    try {
        const reply = await talkAgent.handleMessage(roomToken, actorId, actorName || '', text);
        await sendTalkMessage(roomToken, reply);
    } catch (error) {
        logger.error('Error handling webhook:', error);
    }
});

app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        company: config.companyName,
        channel: 'nextcloud-talk',
        talkConfigured: Boolean(config.talkServerUrl && config.talkSecret),
        activeConversations: talkAgent.getActiveConversationCount(),
        timestamp: new Date().toISOString()
    });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

export { app };
