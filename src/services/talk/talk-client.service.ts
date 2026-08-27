import crypto from 'crypto';
import axios from 'axios';
import { config } from '../../config/config.service';
import { logger } from '../../core/logger';

/**
 * Sends a chat message back to a Nextcloud Talk room, acting as the bot.
 *
 * Endpoint: POST {server}/ocs/v2.php/apps/spreed/api/v1/bot/{roomToken}/message
 *
 * Auth (per https://nextcloud-talk.readthedocs.io/en/latest/bots/):
 * The X-Nextcloud-Talk-Bot-Signature header is HMAC-SHA256 over
 *   <X-Nextcloud-Talk-Bot-Random> + <the message text>
 * signed with the shared bot secret — NOT over the JSON body.
 * Talk matches our secret against the bots enabled in that room.
 *
 * @param replyTo optional message ID to reply in-thread to
 */
export async function sendTalkMessage(roomToken: string, text: string, replyTo?: string): Promise<void> {
    if (!config.talkServerUrl) {
        logger.error('TALK_SERVER_URL is not configured — cannot send reply.');
        return;
    }
    if (!config.talkSecret) {
        logger.error('TALK_SECRET is not configured — cannot sign the reply request.');
        return;
    }

    const url = `${config.talkServerUrl}/ocs/v2.php/apps/spreed/api/v1/bot/${roomToken}/message`;
    const payload: Record<string, unknown> = { message: text };
    if (replyTo) {
        const id = parseInt(replyTo, 10);
        if (!Number.isNaN(id)) payload.replyTo = id;
    }
    const body = JSON.stringify(payload);

    // Random must be at least 32 characters; signature covers random + message text
    const random = crypto.randomBytes(32).toString('hex');
    const signature = crypto.createHmac('sha256', config.talkSecret).update(random + text).digest('hex');

    try {
        await axios.post(url, body, {
            headers: {
                'Content-Type': 'application/json',
                'OCS-APIRequest': 'true',
                'Accept': 'application/json',
                'X-Nextcloud-Talk-Bot-Random': random,
                'X-Nextcloud-Talk-Bot-Signature': signature
            },
            timeout: 15000
        });
        logger.info(`📤 Reply posted to room ${roomToken}${replyTo ? ` (reply to #${replyTo})` : ''}: "${text.substring(0, 60)}..."`);
    } catch (error: any) {
        logger.error(`❌ Failed to post reply to room ${roomToken}:`, error.response?.status, JSON.stringify(error.response?.data) || error.message);
    }
}

/**
 * Enables the bot in a room using the admin account, so Ami can post there.
 * Endpoint: POST {server}/ocs/v2.php/apps/spreed/api/v1/bot/{roomToken}/{botId}
 * (Talk v1 bot-enable API, authed as the Nextcloud admin user.)
 */
export async function enableBotInRoom(roomToken: string, botId: string): Promise<void> {
    if (!config.talkServerUrl || !config.talkAdminUser || !config.talkAdminPassword) {
        throw new Error('admin creds not configured');
    }
    const url = `${config.talkServerUrl}/ocs/v2.php/apps/spreed/api/v1/bot/${roomToken}/${botId}`;
    try {
        await axios.post(url, {}, {
            auth: { username: config.talkAdminUser, password: config.talkAdminPassword },
            headers: { 'OCS-APIRequest': 'true', 'Accept': 'application/json' },
            timeout: 15000
        });
    } catch (error: any) {
        // 403 means the bot is already enabled in that room — not an error.
        if (error?.response?.status === 403) {
            logger.info(`ℹ️ Bot already enabled in ${roomToken} (403).`);
            return;
        }
        throw error;
    }
}
