import express, { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { logger } from './logger';
import { talkAgent } from './agent';
import { sendTalkMessage } from './talk/client';
import { verifyTalkSignature } from './talk/verify';
import { downloadTalkImage } from './talk/files';
import { extractImageFromContent, renderMessageText, TalkWebhook } from './talk/types';

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

    // "Create" = regular chat message, "Activity" = file share posted to the room
    const isMessageHook = hook.type === 'Create' || hook.type === 'Activity';
    if (!isMessageHook || !hook.object || !hook.target || !hook.actor) {
        if (hook.type !== 'Join' && hook.type !== 'Leave') {
            logger.info(`ℹ️ Ignored webhook (type=${hook.type}, object.name=${hook.object?.name})`);
        }
        return;
    }

    // Skip system messages — only regular chat messages carry name "message"
    if (hook.object.name !== 'message') {
        logger.info(`ℹ️ Ignored system/object message (object.name=${hook.object.name})`);
        return;
    }

    // Skip messages authored by bots (including our own replies)
    if (hook.actor.type === 'Application' || hook.actor.id.startsWith('bots/')) return;

    const roomToken = hook.target.id;
    const actorId = hook.actor.id;
    const actorName = hook.actor.name || undefined;
    const messageId = hook.object.id;
    const imageParam = extractImageFromContent(hook.object.content);
    let text = renderMessageText(hook.object.content);
    if (!text && !imageParam) {
        logger.warn(`⚠️ Could not render message text from content: ${String(hook.object.content).substring(0, 200)}`);
        return;
    }

    // Images ALWAYS require an @Ami mention — so random screenshots in the room
    // don't trigger analysis; only messages explicitly addressed to Ami do.
    const isMentioned = /@ami\b/i.test(text);
    if (imageParam) {
        if (!isMentioned) {
            logger.info(`🖼️ Image "${imageParam.name}" from ${actorName || actorId} has no @Ami mention — ignoring.`);
            return;
        }
        // Strip the mention so the AI sees the actual request/caption
        text = text.replace(/@ami\b\s*/gi, '').trim();
    } else {
        // Text-only messages follow the configured mention gate
        if (config.talkRequireMention && !isMentioned) return;
        // Strip a leading @Ami mention so the AI sees the actual request
        text = text.replace(/^@ami\s*/i, '').trim() || 'Hello!';
    }

    logger.info(`📨 Room ${roomToken} | ${actorName || actorId}: "${text.substring(0, 80)}"${imageParam ? ` 📸 [${imageParam.name}]` : ''}`);

    try {
        let image;
        if (imageParam) {
            image = await downloadTalkImage(imageParam);
            if (!image) {
                await sendTalkMessage(roomToken, `⚠️ Sorry ${actorName || ''}, I couldn't download "${imageParam.name}" so I can't analyze it. Try re-sharing the image.`, messageId);
                return;
            }
        }
        const reply = await talkAgent.handleMessage(roomToken, actorId, actorName || '', text, image);
        await sendTalkMessage(roomToken, reply, messageId);
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
