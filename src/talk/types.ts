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

/** Rich-object parameter for a file shared into the room (from object.content) */
export interface FileParameter {
    type: 'file';
    id: string;
    name: string;
    size?: string;
    /** Path relative to the sharer's storage, e.g. "Talk/test.png" */
    path?: string;
    /** Public share link (`/s/<token>`) or file page link (`/f/<id>`) */
    link?: string;
    mimetype?: string;
    etag?: string;
    'preview-available'?: string;
    width?: string;
    height?: string;
}

export interface ImageAttachment {
    mimeType: string;
    base64Data: string;
    fileName?: string;
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

/**
 * Finds an image file parameter in a message's rich-object content.
 * Returns null when the message carries no image attachment.
 */
export function extractImageFromContent(contentJson: string | undefined): FileParameter | null {
    if (!contentJson) return null;
    try {
        const parsed = JSON.parse(contentJson) as {
            message?: string;
            parameters?: Record<string, FileParameter>;
        };
        for (const param of Object.values(parsed.parameters || {})) {
            if (param?.type === 'file' && typeof param.mimetype === 'string' && param.mimetype.startsWith('image/')) {
                return param;
            }
        }
        return null;
    } catch {
        return null;
    }
}
