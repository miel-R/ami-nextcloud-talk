import { aiService } from './ai.service';
import { config } from '../config/config.service';
import { logger } from '../core/logger';
import { sessionStore, sessionKey } from './session.service';
import { buildSystemPrompt } from '../features/agent/prompt';
import { helpMessage, isEndCommand } from '../features/agent/commands';
import { User } from '../models/user.model';
import { ImageData } from '../models/message.model';

export class TalkAgent {
    private userRequestCount: Map<string, { count: number; resetTime: number }> = new Map();

    constructor() {
        logger.info('🤖 Ami Talk agent initialized');
    }

    /** Returns the reply text for an incoming chat message from a Talk user. */
    async handleMessage(roomToken: string, roomName: string | undefined, rawActorId: string, user: User, message: string, image?: ImageData): Promise<string> {
        const key = sessionKey(roomToken, rawActorId);

        try {
            const sensitive = config.sensitiveTopics.find(topic => message.toLowerCase().includes(topic));
            if (sensitive) {
                logger.warn(`🚫 Sensitive topic blocked ("${sensitive}") for ${user.displayName || rawActorId}`);
                return "⚠️ I can't share information about that topic. If you need help with a legitimate issue, describe it and I'll escalate it to the right team.";
            }

            if (message === '/reset') {
                sessionStore.delete(key);
                return '🔄 Conversation reset. How can I help you?';
            }
            if (isEndCommand(message)) {
                sessionStore.delete(key);
                return "👋 Goodbye! Your conversation has ended. If you ever need help again, just send a message and I'll be here. Take care! 😊";
            }
            if (message === '/help') {
                return helpMessage();
            }
            if (message === '/status') {
                return sessionStore.describe(key);
            }

            if (!this.checkRateLimit(key)) {
                return "⏳ You're sending messages too fast. Please wait a moment.";
            }

            const session = sessionStore.getOrCreate(roomToken, roomName, user, rawActorId);
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
                response = response.replace('[CREATE_TICKET]', '').trim();
                response += "\n\n🔔 I've logged this issue for the Help Desk team — they'll follow up with you here.";
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
