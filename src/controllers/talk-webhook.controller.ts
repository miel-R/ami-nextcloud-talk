import express from 'express';
import { config } from '../config/config.service';
import { logger } from '../core/logger';
import { talkAgent } from '../services/talk.service';
import { sendTalkMessage } from '../services/talk/talk-client.service';
import { verifyTalkSignature } from '../services/talk/talk-verify.service';
import { downloadTalkImage } from '../services/talk/talk-files.service';
import { extractImageFromContent, renderMessageText, TalkWebhook } from '../models/webhook.model';
import { fromActor } from '../models/user.model';
import { ImageData } from '../models/message.model';

type WebhookRequest = express.Request & { rawBody?: Buffer };

export function registerTalkWebhook(app: express.Express): void {
    app.post(config.talkWebhookPath, async (req: WebhookRequest, res: express.Response) => {
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
        const roomName = hook.target.name;
        const actorId = hook.actor.id;
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
                logger.info(`🖼️ Image "${imageParam.name}" from ${hook.actor.name || actorId} has no @Ami mention — ignoring.`);
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

        const user = fromActor(hook.actor);
        logger.info(`📨 Room ${roomToken} | ${user.displayName || actorId}: "${text.substring(0, 80)}"${imageParam ? ` 📸 [${imageParam.name}]` : ''}`);

        try {
            let image: ImageData | undefined;
            if (imageParam) {
                image = await downloadTalkImage(imageParam) || undefined;
                if (!image) {
                    await sendTalkMessage(roomToken, `⚠️ Sorry ${user.displayName || ''}, I couldn't download "${imageParam.name}" so I can't analyze it. Try re-sharing the image.`, messageId);
                    return;
                }
            }
            const reply = await talkAgent.handleMessage(roomToken, roomName, actorId, user, text, image);
            await sendTalkMessage(roomToken, reply, messageId);
        } catch (error) {
            logger.error('Error handling webhook:', error);
        }
    });
}
