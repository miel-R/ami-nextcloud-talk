import express from 'express';
import { config } from '../config/config.service';
import { logger } from '../core/logger';
import { talkAgent } from '../services/talk.service';
import { sendTalkMessage, isAdminModeratorInRoom } from '../services/talk/talk-client.service';
import { verifyTalkSignature } from '../services/talk/talk-verify.service';
import { downloadTalkImage } from '../services/talk/talk-files.service';
import { extractImageFromContent, renderMessageText, TalkWebhook } from '../models/webhook.model';
import { fromActor } from '../models/user.model';
import { ImageData } from '../models/message.model';
import { sessionStore } from '../services/session.service';
import { roomApprovalStore } from '../services/room-approval.service';
import { notificationStore } from '../services/notification.service';
import { enableBotInRoom, sendTalkMessageStatus } from '../services/talk/talk-client.service';
import { ADMIN_COMMANDS, adminList } from '../features/agent/commands';
import { isUserAdmin } from '../services/talk/talk-client.service';

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
        // Bot enabled/disabled in a conversation arrives as a Join/Leave webhook
        // where the *actor* is the bot itself (actor.type=Application, id=bots/…).
        // The room token/name are in object.id / object.name (target is undefined).
        // We auto-approve on enable so a freshly created/enabled group chat answers
        // immediately, and auto-revoke on disable to keep the store clean.
        if ((hook.type === 'Join' || hook.type === 'Leave') && hook.actor && hook.actor.type === 'Application') {
            const roomToken = hook.object?.id;
            const roomName = hook.object?.name || roomToken || '';
            if (roomToken) {
                if (hook.type === 'Join') {
                    let adminOwned = false;
                    try {
                        adminOwned = await isAdminModeratorInRoom(roomToken);
                    } catch {
                        adminOwned = false;
                    }
                    if (adminOwned) {
                        const newlyApproved = roomApprovalStore.approve(roomToken, roomName, hook.actor.id);
                        logger.info(`🤖 Bot enabled in ${roomToken} (${roomName}) — admin-owned, auto-approved.`);
                        if (newlyApproved) {
                            await sendTalkMessage(roomToken, '👋 **Ami chatbot enabled!** I\'m your help desk assistant. Type `$help` to see what I can do.');
                        }
                    } else {
                        logger.info(`🤖 Bot enabled in ${roomToken} (${roomName}) by a non-admin — sending authorization notice (not auto-approved).`);
                        await sendTalkMessage(roomToken, '🔔 **Ami was enabled in this chat.** To let her answer here, a Nextcloud admin must authorize it — ask an admin to join this conversation and send `ami $approve`. Until then I won\'t respond to messages.');
                    }
                } else {
                    roomApprovalStore.revoke(roomToken);
                    logger.info(`🤖 Bot disabled in ${roomToken} (${roomName}) — auto-revoked.`);
                }
            }
            return;
        }

        if (!isMessageHook || !hook.object || !hook.target || !hook.actor) {
            logger.info(`ℹ️ Ignored webhook (type=${hook.type}, object.name=${hook.object?.name})`);
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

        // A mention is only required to START a session. Once a session is active
        // for this room + user, the user no longer needs to say "ami" — matching a
        // natural "talk to Ami" conversation — until it idles out or is ended.
        const sessionActive = sessionStore.has(roomToken, actorId);
        const isMentioned = /\bami\b/i.test(text);

        if (imageParam) {
            // Before a session exists, an image still needs an "ami" mention so
            // random screenshots don't trigger analysis. Once armed, it doesn't.
            if (!isMentioned && !sessionActive) {
                logger.info(`🖼️ Image "${imageParam.name}" from ${hook.actor.name || actorId} has no "ami" mention and no active session — ignoring.`);
                return;
            }
            // Strip the mention so the AI sees the actual request/caption
            text = text.replace(/\bami\b/gi, '').trim();
        } else {
            // Text: require "ami" only when there's no active session AND the global gate is on
            if (config.talkRequireMention && !sessionActive && !isMentioned) return;
            // Strip a leading "ami" mention so the AI sees the actual request
            text = text.replace(/\bami\b/gi, '').trim() || 'Hello!';
        }

        const user = fromActor(hook.actor);
        const isAdmin = await isUserAdmin(user.id);
        logger.info(`📨 Room ${roomToken} | ${user.displayName || actorId}: "${text.substring(0, 80)}"${imageParam ? ` 📸 [${imageParam.name}]` : ''}`);

        // ── Admin commands ──────────────────────────────────────────────────────
        // Handled before the approval gate so the admin can $approve/$revoke/$list
        // even in a room Ami would otherwise ignore.
        if (new RegExp('^\\$(' + ADMIN_COMMANDS.map(c => c.slice(1)).join('|') + ')(\\s|$)').test(text)) {
            if (!isAdmin) {
                await sendTalkMessage(roomToken, '⛔ Only the Nextcloud admin can manage Ami.', messageId);
                return;
            }
            if (text === '$approve') {
                if (roomApprovalStore.approve(roomToken, roomName || roomToken, user.id)) {
                    await sendTalkMessage(roomToken, '✅ Room approved — I\'ll answer here now. Type `$help` to see what I can do.', messageId);
                } else {
                    await sendTalkMessage(roomToken, 'ℹ️ This room is already approved.', messageId);
                }
                return;
            }
            if (text === '$revoke') {
                if (roomApprovalStore.revoke(roomToken)) {
                    await sendTalkMessage(roomToken, '🔒 Room approval revoked — I\'ll ignore messages here until approved again.', messageId);
                } else {
                    await sendTalkMessage(roomToken, 'ℹ️ This room was not approved.', messageId);
                }
                return;
            }
            if (text === '$list') {
                const rooms = roomApprovalStore.list();
                const body = rooms.length
                    ? rooms.map(r => `- **${r.name}** (` + '`' + r.token + '`' + `) — approved by ${r.approvedBy}`).join('\n')
                    : '_No rooms approved yet._';
                await sendTalkMessage(roomToken, `📋 **Approved rooms:**\n${body}`, messageId);
                return;
            }
            if (text === '$notify-add' || text.startsWith('$notify-add ')) {
                const tok = text.slice('$notify-add'.length).trim();
                const target = tok || roomToken;
                const targetName = tok ? tok : (roomName || roomToken);
                const added = notificationStore.add(target, targetName, user.id);
                let msg = added
                    ? `🔔 Added notification room \`${target}\`${tok ? '' : ' (this room)'}.`
                    : `ℹ️ Room \`${target}\` is already a notification target.`;
                try {
                    await enableBotInRoom(target, config.talkBotId);
                    msg += ' Ami has been enabled in that room.';
                } catch (error: any) {
                    msg += ` ⚠️ Could not auto-enable Ami there (${error?.message || 'check admin creds / bot id'}); enable her manually.`;
                }
                await sendTalkMessage(roomToken, msg, messageId);
                return;
            }
            if (text === '$notify-remove' || text.startsWith('$notify-remove ')) {
                const tok = text.slice('$notify-remove'.length).trim();
                const target = tok || roomToken;
                const removed = notificationStore.remove(target);
                await sendTalkMessage(roomToken, removed ? `🔕 Removed notification room \`${target}\`.` : `ℹ️ Room \`${target}\` was not a notification target.`, messageId);
                return;
            }
            if (text === '$notify-test') {
                const rs = notificationStore.list();
                if (!rs.length) {
                    await sendTalkMessage(roomToken, 'ℹ️ No notification rooms configured — add one with `$notify-add` first.', messageId);
                    return;
                }
                let okCount = 0;
                const failed: string[] = [];
                for (const r of rs) {
                    const res = await sendTalkMessageStatus(r.token, '✅ Ami escalation test — this Help Desk group is reachable and will receive tickets.');
                    if (res.ok) okCount++; else failed.push(r.token);
                }
                let msg = `🧪 **Escalation test:** delivered to ${okCount}/${rs.length} group(s).`;
                if (failed.length) msg += `\n⚠️ Not reachable: ${failed.map(t => '`' + t + '`').join(', ')}`;
                else msg += ' All good. 🎉';
                await sendTalkMessage(roomToken, msg, messageId);
                return;
            }
            if (text === '$notify-list') {
                const rs = notificationStore.list();
                const body = rs.length
                    ? rs.map(r => `- \`${r.token}\`${r.name ? ` (${r.name})` : ''} — added by ${r.addedBy}`).join('\n')
                    : '_No notification rooms configured._';
                await sendTalkMessage(roomToken, `🔔 **Notification rooms:**\n${body}`, messageId);
                return;
            }
        }

        // ── Public query (works even in unapproved rooms, no session needed) ─
        if (text === '$admin' || text === '$admins' || text === '$refresh') {
            const isAdmin = await isUserAdmin(user.id);
            await sendTalkMessage(roomToken, `👑 Nextcloud admin(s): **${adminList()}**${isAdmin ? ' — you are an admin.' : ' — ask one of them to join this room and send \`ami $approve\` to authorize it.'}`, messageId);
            return;
        }

        // ── Approval gate ───────────────────────────────────────────────────────
        // Unapproved rooms are ignored entirely; the admin already had their chance above.
        if (!roomApprovalStore.isApproved(roomToken)) return;

        try {
            let image: ImageData | undefined;
            if (imageParam) {
                image = await downloadTalkImage(imageParam, actorId) || undefined;
                if (!image) {
                    await sendTalkMessage(roomToken, `⚠️ Sorry ${user.displayName || ''}, I couldn't download "${imageParam.name}" so I can't analyze it. Try re-sharing the image.`, messageId);
                    return;
                }
            }
            const reply = await talkAgent.handleMessage(roomToken, roomName, actorId, user, text, image, isAdmin);
            await sendTalkMessage(roomToken, reply, messageId);
        } catch (error) {
            logger.error('Error handling webhook:', error);
        }
    });
}
