/**
 * The identity of the person chatting with Ami.
 *
 * Mirrors the original Ami engine's `UserRequest.from` shape ({ id, name?, email? })
 * so the bot knows exactly who it is talking to.
 */
export interface User {
    /** Clean user id with any provider prefix stripped, e.g. "admin" (from "users/admin"). */
    id: string;
    /** Display name from the Talk actor, e.g. "Maria Santos". */
    displayName?: string;
    /** Reserved for a future Nextcloud user lookup. */
    email?: string;
}

/** Builds a User from a Nextcloud Talk webhook actor. */
export function fromActor(actor: { id: string; name?: string }): User {
    const rawId = actor.id || 'unknown';
    const id = rawId.replace(/^(users|bots|guests)\//, '');
    return {
        id,
        displayName: actor.name || undefined
    };
}
