import { config } from '../config/config.service';
import { logger } from '../core/logger';
import { User } from '../models/user.model';
import { Session } from '../models/session.model';

export type SessionExpireHandler = (session: Session) => void | Promise<void>;

/** Builds the stable session key for a room + raw Talk actor id. */
export function sessionKey(roomToken: string, rawActorId: string): string {
    return `${roomToken}:${rawActorId}`;
}

/**
 * In-memory session store. Pluggable behind a small interface so a persisted
 * backend (Redis / node-cache) can replace it later without touching the agent
 * logic. Mirrors the original Ami engine's session + conversationHistory +
 * lastActivity maps, with TTL-based idle cleanup and an eviction callback.
 */
export class SessionStore {
    private sessions: Map<string, Session> = new Map();
    private onExpire: SessionExpireHandler | null = null;

    constructor() {
        setInterval(() => this.cleanupIdle(), 30000).unref();
    }

    /** Registers a callback fired when an idle session is evicted (e.g. post a farewell). */
    setExpireHandler(handler: SessionExpireHandler): void {
        this.onExpire = handler;
    }

    getOrCreate(roomToken: string, roomName: string | undefined, user: User, rawActorId: string): Session {
        const key = sessionKey(roomToken, rawActorId);
        let session = this.sessions.get(key);
        if (!session) {
            session = {
                key,
                user,
                roomToken,
                roomName,
                history: [],
                createdAt: Date.now(),
                lastActivity: Date.now()
            };
            this.sessions.set(key, session);
            logger.info(`🆕 New session ${key} for ${user.displayName || user.id}`);
        }
        session.lastActivity = Date.now();
        return session;
    }

    get(key: string): Session | undefined {
        return this.sessions.get(key);
    }

    /** True when an active session already exists for this room + raw Talk actor id. */
    has(roomToken: string, rawActorId: string): boolean {
        return this.sessions.has(sessionKey(roomToken, rawActorId));
    }

    delete(key: string): void {
        this.sessions.delete(key);
    }

    touch(key: string): void {
        const session = this.sessions.get(key);
        if (session) session.lastActivity = Date.now();
    }

    activeCount(): number {
        return this.sessions.size;
    }

    clearAll(): void {
        this.sessions.clear();
    }

    /** Human-readable summary of a session for the /status command. */
    describe(key: string): string {
        const session = this.sessions.get(key);
        if (!session) return '✅ No active conversation. Ask me anything!';
        const who = session.user.displayName ? `**${session.user.displayName}** (${session.user.id})` : `**${session.user.id}**`;
        const where = session.roomName ? `**${session.roomName}**` : `\`${session.roomToken}\``;
        return `💬 Talking to ${who} in room ${where}. We've exchanged **${session.history.length}** messages so far. Type /reset to start fresh.`;
    }

    private cleanupIdle(): void {
        const now = Date.now();
        for (const [key, session] of this.sessions) {
            if (now - session.lastActivity > config.sessionTimeout) {
                this.sessions.delete(key);
                if (this.onExpire) {
                    try {
                        void this.onExpire(session);
                    } catch (error) {
                        logger.error('Session expire handler error:', error);
                    }
                }
            }
        }
    }
}

export const sessionStore = new SessionStore();
