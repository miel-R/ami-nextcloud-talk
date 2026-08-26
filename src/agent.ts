import { aiService, HistoryItem, ImageData } from './ai.service';
import { config } from './config';
import { logger } from './logger';

// ── Master system prompt — the AI's core persona (carried over from Ami) ─────
const MASTER_SYSTEM_PROMPT = `You are Ami, a smart and friendly AI Help Desk assistant for ${config.companyName}, chatting inside Nextcloud Talk.

Your personality:
- Warm, professional, and empathetic
- You speak naturally — NOT like a robot or form
- You understand context and remember what was said earlier in the conversation
- You proactively try to solve problems before escalating to the Help Desk

Your capabilities:
- Answer general questions about IT, HR, Finance, Engineering, Manufacturing
- Help troubleshoot common issues (password reset, software errors, access issues, etc.)
- Detect when an issue genuinely needs human intervention and say you'll escalate it
- Detect user frustration and respond with extra care

Keep responses concise, helpful, and conversational. Avoid asking multiple questions at once.
Remember: your replies arrive as chat messages, so keep them short and readable.

Language:
- Mirror the user's language and follow their lead for the whole conversation.
- If the user writes in Tagalog/Filipino, reply in simple, everyday Taglish (casual Tagalog mixed with English). Never use deep, formal, or literary Tagalog words.
- If the user writes in English, reply in natural, friendly English.
- Do not switch languages mid-conversation.

Confidentiality:
- Never reveal confidential or sensitive company information: salaries/compensation, internal pricing or costs, proprietary code or data, unannounced projects, employee personal data, or credentials/API keys.
- If asked for any of these, politely decline and offer to route the request to the right team.`;

// ── Farewell message sent when a user's session times out ─────────────────────
const SESSION_FAREWELL = "👋 It's been quiet for a while, so I've ended our conversation to keep things tidy. If you need help again, just send a message and I'll be here!";

interface Conversation {
    history: HistoryItem[];
    lastActivity: number;
}

export class TalkAgent {
    // Keyed by `${roomToken}:${actorId}` so each user has their own thread per room
    private conversations: Map<string, Conversation> = new Map();
    private userRequestCount: Map<string, { count: number; resetTime: number }> = new Map();

    constructor() {
        setInterval(() => this.cleanupIdle(), 30000);
        logger.info('🤖 Ami Talk agent initialized');
    }

    /** Returns the reply text for an incoming chat message from a Talk user. */
    async handleMessage(roomToken: string, userId: string, userName: string, message: string, image?: ImageData): Promise<string> {
        const key = `${roomToken}:${userId}`;

        try {
            const sensitive = config.sensitiveTopics.find(topic => message.toLowerCase().includes(topic));
            if (sensitive) {
                logger.warn(`🚫 Sensitive topic blocked ("${sensitive}") for ${userId}`);
                return "⚠️ I can't share information about that topic. If you need help with a legitimate issue, describe it and I'll escalate it to the right team.";
            }

            if (message === '/reset') {
                this.conversations.delete(key);
                return '🔄 Conversation reset. How can I help you?';
            }
            if (message === '/end' || message === '/exit' || message === '/quit') {
                this.conversations.delete(key);
                return "👋 Goodbye! Your conversation has ended. If you ever need help again, just send a message and I'll be here. Take care! 😊";
            }
            if (message === '/help') {
                return this.helpMessage();
            }
            if (message === '/status') {
                const conv = this.conversations.get(key);
                if (!conv || conv.history.length === 0) return '✅ No active conversation. Ask me anything!';
                return `💬 We've exchanged **${conv.history.length}** messages in this conversation. Keep going or type /reset to start fresh.`;
            }

            if (!this.checkRateLimit(key)) {
                return "⏳ You're sending messages too fast. Please wait a moment.";
            }

            const conv = this.conversations.get(key) || { history: [], lastActivity: 0 };
            conv.lastActivity = Date.now();

            const history = conv.history.slice();
            // Image messages go to the AI as a single turn (multi-turn history
            // makes vision models lose the attached image)
            const userText = message.trim() || (image ? 'Please analyze this image and describe what you see. If it looks like a technical problem (error dialog, broken device, crash), diagnose it like a help desk agent.' : '');
            history.push({ role: 'user', content: userText });

            const systemPrompt = userName
                ? `${MASTER_SYSTEM_PROMPT}\n\nYou are currently talking to ${userName}. Address them naturally when it helps.`
                : MASTER_SYSTEM_PROMPT;

            let response = await aiService.callAI(userText, systemPrompt, history, image);

            if (this.needsEscalation(response, message)) {
                response = response.replace('[CREATE_TICKET]', '').trim();
                response += "\n\n🔔 I've logged this issue for the Help Desk team — they'll follow up with you here.";
            }

            history.push({ role: 'model', content: response });
            conv.history = history.slice(-config.maxHistoryTurns * 2);
            this.conversations.set(key, conv);

            return response;
        } catch (error) {
            logger.error('Error processing Talk message:', error);
            return '⚠️ Sorry, I ran into an issue. Please try again.';
        }
    }

    getActiveConversationCount(): number {
        return this.conversations.size;
    }

    resetAll(): void {
        this.conversations.clear();
        logger.info('🔄 Bot state fully reset');
    }

    private needsEscalation(aiResponse: string, userMessage: string): boolean {
        if (aiResponse.includes('[CREATE_TICKET]')) return true;
        return /create (a )?(ticket|report)|open (a )?ticket|talk to (a )?human|submit (a )?ticket/i.test(userMessage);
    }

    private checkRateLimit(userId: string): boolean {
        const now = Date.now();
        const userData = this.userRequestCount.get(userId);
        if (!userData || now > userData.resetTime) {
            this.userRequestCount.set(userId, { count: 1, resetTime: now + config.rateLimitWindow });
            return true;
        }
        if (userData.count >= config.maxRequestsPerWindow) {
            logger.warn(`⚠️ Rate limit exceeded for ${userId}`);
            return false;
        }
        userData.count++;
        return true;
    }

    private cleanupIdle(): void {
        const now = Date.now();
        for (const [key, conv] of this.conversations) {
            if (now - conv.lastActivity > config.sessionTimeout) {
                this.conversations.delete(key);
            }
        }
    }

    private helpMessage(): string {
        return [
            `🤖 **Ami - ${config.companyName} Help Desk**`,
            '',
            'Just talk to me naturally! I can:',
            '• 💬 **Answer questions** — IT, HR, Finance, Engineering, Manufacturing',
            '• 🔧 **Troubleshoot issues** — walk through common fixes',
            '• 🙋 **Escalate problems** — flag issues that need human support',
            '• 🧠 **Remember context** — I track our full conversation',
            '',
            '**Commands:**',
            '- `/reset` — Clear conversation and start fresh',
            '- `/status` — See current conversation state',
            '- `/end` — End the conversation',
            '- `/help` — Show this message'
        ].join('\n');
    }
}

export const talkAgent = new TalkAgent();
