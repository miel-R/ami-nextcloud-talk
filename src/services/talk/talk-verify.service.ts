import crypto from 'crypto';
import { Request } from 'express';
import { logger } from '../../core/logger';

/**
 * Verifies the signature of an inbound webhook from Nextcloud Talk.
 *
 * Talk sends: X-Nextcloud-Talk-Signature = hash_hmac('sha256', <Random> . <raw body>, SECRET)
 * We must check against the RAW body bytes, not a re-serialized JSON object.
 */
export function verifyTalkSignature(req: Request & { rawBody?: Buffer }, secret: string): boolean {
    const random = req.header('X-Nextcloud-Talk-Random') || '';
    const signature = req.header('X-Nextcloud-Talk-Signature') || '';

    if (!secret) {
        logger.warn('TALK_SECRET is not configured — accepting webhook WITHOUT signature verification (dev mode only).');
        return true;
    }
    if (!random || !signature || !req.rawBody) return false;

    const expected = crypto.createHmac('sha256', secret).update(random + req.rawBody.toString('utf8')).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Builds the signed headers for posting a message back to Talk.
 *
 * Since Talk 17+ the reply endpoint authenticates via these headers while the
 * room is identified in the URL path; Talk matches our secret against every
 * bot enabled in that room.
 */
export function buildSignedHeaders(body: string, secret: string): Record<string, string> {
    // Random must be at least 32 characters
    const random = crypto.randomBytes(32).toString('hex');
    const signature = crypto.createHmac('sha256', secret).update(random + body).digest('hex');
    return {
        'Content-Type': 'application/json',
        'OCS-APIRequest': 'true',
        'Accept': 'application/json',
        'X-Nextcloud-Talk-Bot-Random': random,
        'X-Nextcloud-Talk-Bot-Signature': signature
    };
}
