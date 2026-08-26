import crypto from 'crypto';
import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';

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
 */
export async function sendTalkMessage(roomToken: string, text: string): Promise<void> {
    if (!config.talkServerUrl) {
        logger.error('TALK_SERVER_URL is not configured — cannot send reply.');
        return;
    }
    if (!config.talkSecret) {
        logger.error('TALK_SECRET is not configured — cannot sign the reply request.');
        return;
    }

    const url = `${config.talkServerUrl}/ocs/v2.php/apps/spreed/api/v1/bot/${roomToken}/message`;
    const body = JSON.stringify({ message: text });

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
        logger.info(`📤 Reply posted to room ${roomToken}: "${text.substring(0, 60)}..."`);
    } catch (error: any) {
        logger.error(`❌ Failed to post reply to room ${roomToken}:`, error.response?.status, JSON.stringify(error.response?.data) || error.message);
    }
}
