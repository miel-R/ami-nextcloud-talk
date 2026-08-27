import { config } from '../config/config.service';
import { logger } from '../core/logger';
import { roomApprovalStore } from './room-approval.service';
import { notificationStore } from './notification.service';
import { sendTalkMessage } from './talk/talk-client.service';

let timer: NodeJS.Timeout | null = null;

/**
 * Posts the periodic "need help?" reminder into every approved room EXCEPT the
 * notification rooms added via $notify-add (those are admin/tech sinks and don't
 * need the prompt). Bot-authored messages are ignored by the webhook handler, so
 * this never triggers a reply loop.
 */
async function postNudges(): Promise<void> {
    const notifyTokens = new Set(notificationStore.list().map(r => r.token));
    const targets = roomApprovalStore.list().filter(r => !notifyTokens.has(r.token));
    if (targets.length === 0) return;
    logger.info(`⏰ Posting hourly nudge to ${targets.length} approved room(s) (notification rooms skipped)...`);
    for (const room of targets) {
        try {
            await sendTalkMessage(room.token, config.talkNudgeMessage);
        } catch (error) {
            logger.warn(`⚠️ Nudge failed for room ${room.token}: ${(error as Error).message}`);
        }
    }
}

export function startNudgeScheduler(): void {
    const intervalMin = config.talkNudgeIntervalMin;
    if (!intervalMin || intervalMin <= 0) {
        logger.info('⏰ Nudge scheduler disabled (TALK_NUDGE_INTERVAL_MIN=0).');
        return;
    }
    const ms = intervalMin * 60 * 1000;
    timer = setInterval(() => { void postNudges(); }, ms);
    logger.info(`⏰ Nudge scheduler started — every ${intervalMin} min into approved (non-notification) rooms.`);
}

export function stopNudgeScheduler(): void {
    if (timer) { clearInterval(timer); timer = null; }
}
