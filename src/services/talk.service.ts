import { aiService } from './ai.service';
import { config } from '../config/config.service';
import { logger } from '../core/logger';
import { sessionStore, sessionKey } from './session.service';
import { buildSystemPrompt } from '../features/agent/prompt';
import { helpMessage, isEndCommand } from '../features/agent/commands';
import { User } from '../models/user.model';
import { Session } from '../models/session.model';
import { ImageData } from '../models/message.model';
import { sendTalkMessage } from './talk/talk-client.service';
import { notificationStore } from './notification.service';
import { getDepartments, getCategories, renderMenu, parseChoice, formatTicket } from '../features/agent/ticket';

export class TalkAgent {
    private userRequestCount: Map<string, { count: number; resetTime: number }> = new Map();

    constructor() {
        logger.info('🤖 Ami Talk agent initialized');
    }

    /** Returns the reply text for an incoming chat message from a Talk user. */
    async handleMessage(roomToken: string, roomName: string | undefined, rawActorId: string, user: User, message: string, image: ImageData | undefined, isAdmin: boolean): Promise<string> {
        const key = sessionKey(roomToken, rawActorId);

        try {
            const sensitive = config.sensitiveTopics.find(topic => message.toLowerCase().includes(topic));
            if (sensitive) {
                logger.warn(`🚫 Sensitive topic blocked ("${sensitive}") for ${user.displayName || rawActorId}`);
                return "⚠️ I can't share information about that topic. If you need help with a legitimate issue, describe it and I'll escalate it to the right team.";
            }

            if (message === '$reset') {
                sessionStore.delete(key);
                return '🔄 Conversation reset. How can I help you?';
            }
            if (isEndCommand(message)) {
                sessionStore.delete(key);
                return "👋 Goodbye! Your conversation has ended. If you ever need help again, just send a message and I'll be here. Take care! 😊";
            }
            if (message === '$help') {
                return helpMessage(isAdmin);
            }
            if (message === '$whoami') {
                return `🪪 I recognise you as **${user.displayName || user.id}** (id: \`${user.id}\`)${isAdmin ? ' — you are the Nextcloud admin, so you can manage room approval with `$approve`, `$revoke` and `$list`.' : ''}.`;
            }
            if (message === '$status') {
                return sessionStore.describe(key);
            }

            if (!this.checkRateLimit(key)) {
                return "⏳ You're sending messages too fast. Please wait a moment.";
            }

            const session = sessionStore.getOrCreate(roomToken, roomName, user, rawActorId);

            // Mid-escalation: drive the structured intake instead of the AI.
            if (session.escalation) {
                return this.handleEscalationStep(session, message, roomName, user);
            }

            const isNewConversation = session.history.length === 0;
            session.lastActivity = Date.now();

            const history = session.history.slice();
            // Image messages go to the AI as a single turn (multi-turn history
            // makes vision models lose the attached image)
            const userText = message.trim() || (image ? 'Please analyze this image and describe what you see. If it looks like a technical problem (error dialog, broken device, crash), diagnose it like a help desk agent.' : '');
            history.push({ role: 'user', content: userText });

            const systemPrompt = buildSystemPrompt(user.displayName, isNewConversation);

            let response = await aiService.callAI(userText, systemPrompt, history, image);

            if (this.needsEscalation(response, message)) {
                session.escalation = { step: 'department' };
                sessionStore.touch(key);
                return renderMenu(
                    'I\'ll get the right team to help. Which department should handle this? (reply with the number)',
                    getDepartments().map(d => d.label)
                );
            }

            history.push({ role: 'model', content: response });
            session.history = history.slice(-config.maxHistoryTurns * 2);
            sessionStore.touch(key);

            return response;
        } catch (error) {
            logger.error('Error processing Talk message:', error);
            return '⚠️ Sorry, I ran into an issue. Please try again.';
        }
    }

    getActiveConversationCount(): number {
        return sessionStore.activeCount();
    }

    /**
     * Drives the multi-step escalation intake (Department → Category → System → Problem)
     * and, on the final step, posts the ticket to every configured notification room.
     */
    private async handleEscalationStep(session: Session, message: string, roomName: string | undefined, user: User): Promise<string> {
        const esc = session.escalation!;

        // Let the user bail out of the intake at any point.
        if (/^\/cancel$/i.test(message) || isEndCommand(message)) {
            session.escalation = undefined;
            sessionStore.touch(session.key);
            return isEndCommand(message)
                ? "👋 Okay, I've cancelled the request. If you need anything else, just ask!"
                : '❌ Escalation cancelled. How else can I help?';
        }

        switch (esc.step) {
            case 'department': {
                const depts = getDepartments();
                const idx = parseChoice(message, depts.map(d => d.label));
                if (idx < 0) return 'Please reply with the number of your department, e.g. 1) IT / Help Desk.';
                esc.departmentId = depts[idx].id;
                esc.departmentLabel = depts[idx].label;
                esc.step = 'category';
                sessionStore.touch(session.key);
                return renderMenu(`Thanks — under **${depts[idx].label}**. What category is it? (reply with the number)`, getCategories(depts[idx].id).map(c => c.label));
            }
            case 'category': {
                const cats = getCategories(esc.departmentId!);
                const idx = parseChoice(message, cats.map(c => c.label));
                if (idx < 0) return 'Please reply with the number of the category.';
                esc.categoryId = cats[idx].id;
                esc.categoryLabel = cats[idx].label;
                esc.step = 'system';
                sessionStore.touch(session.key);
                return renderMenu('Got it. Which item exactly? (reply with the number)', cats[idx].systemTypes);
            }
            case 'system': {
                const cat = getCategories(esc.departmentId!).find(c => c.id === esc.categoryId);
                const sys = cat?.systemTypes || [];
                const idx = parseChoice(message, sys);
                if (idx < 0) return 'Please reply with the number of the item.';
                esc.systemType = sys[idx];
                esc.step = 'problem';
                sessionStore.touch(session.key);
                return 'Almost there — please describe the problem in your own words (a sentence or two is fine).';
            }
            case 'problem': {
                esc.problem = message.trim();
                const ticket = formatTicket(esc, user, roomName);
                const rooms = notificationStore.list();
                for (const r of rooms) {
                    await sendTalkMessage(r.token, ticket);
                }
                session.escalation = undefined;
                sessionStore.touch(session.key);
                const where = rooms.length
                    ? `I've sent your request to ${rooms.length} Help Desk group chat(s).`
                    : 'I couldn\'t find a configured Help Desk group to notify — ask your admin to run $notify-add <roomToken>.';
                return `✅ Thanks ${user.displayName || user.id}, your request is logged:\n\n${ticket}\n\n${where} Someone will follow up with you here.`;
            }
        }
    }

    resetAll(): void {
        sessionStore.clearAll();
        logger.info('🔄 Bot state fully reset');
    }

    private needsEscalation(aiResponse: string, userMessage: string): boolean {
        if (aiResponse.includes('[CREATE_TICKET]')) return true;
        return /create (a )?(ticket|report)|open (a )?ticket|talk to (a )?human|submit (a )?ticket/i.test(userMessage);
    }

    private checkRateLimit(key: string): boolean {
        const now = Date.now();
        const userData = this.userRequestCount.get(key);
        if (!userData || now > userData.resetTime) {
            this.userRequestCount.set(key, { count: 1, resetTime: now + config.rateLimitWindow });
            return true;
        }
        if (userData.count >= config.maxRequestsPerWindow) {
            logger.warn(`⚠️ Rate limit exceeded for ${key}`);
            return false;
        }
        userData.count++;
        return true;
    }
}

export const talkAgent = new TalkAgent();
