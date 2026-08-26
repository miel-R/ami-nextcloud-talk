// Types for the Nextcloud Talk bot webhook protocol.
// Payloads follow the Activity Streams 2.0 vocabulary.
// See https://nextcloud-talk.readthedocs.io/en/latest/bots/

export interface TalkActor {
    type: string;
    /** e.g. "users/ada" or "bots/bot-a78f46c5..." */
    id: string;
    name: string;
    talkParticipantType?: number;
}

export interface TalkObject {
    type: string;
    /** Message ID on the origin server */
    id: string;
    /** "message" for regular chat messages, otherwise a system message identifier */
    name: string;
    /** JSON-encoded {"message": "...", "parameters": {...}} */
    content?: string;
    mediaType?: string;
}

export interface TalkTarget {
    type: string;
    /** Room token */
    id: string;
    /** Room name */
    name: string;
}

export interface TalkWebhook {
    /** "Create" = new chat message, "Join"/"Leave" = bot added/removed, "Like"/"Undo" = reactions */
    type: string;
    actor?: TalkActor;
    object?: TalkObject;
    target?: TalkTarget;
}

export interface ParsedChatMessage {
    roomToken: string;
    actorId: string;
    actorName: string;
    text: string;
}

/** Replaces rich-object placeholders like {mention-user1} with @DisplayName */
export function renderMessageText(contentJson: string | undefined): string {
    if (!contentJson) return '';
    try {
        const parsed = JSON.parse(contentJson) as {
            message?: string;
            parameters?: Record<string, { name?: string }>;
        };
        let text = parsed.message || '';
        for (const [key, param] of Object.entries(parsed.parameters || {})) {
            if (param?.name) {
                text = text.split(`{${key}}`).join(`@${param.name}`);
            }
        }
        return text.trim();
    } catch {
        return '';
    }
}
