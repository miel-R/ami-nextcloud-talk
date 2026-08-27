import { config } from '../../config/config.service';
import { User } from '../../models/user.model';

/** Commands that end the conversation and clear the session. */
export const END_COMMANDS = ['/end', '/exit', '/quit'];

export function isEndCommand(message: string): boolean {
    return END_COMMANDS.includes(message);
}

/** Commands any approved user can run. */
export const USER_COMMANDS = ['/help', '/status', '/whoami', '/reset', '/end'];

/** Commands only the Nextcloud admin account may run. */
export const ADMIN_COMMANDS = ['/approve', '/revoke', '/list', '/notify-add', '/notify-remove', '/notify-list', '/notify-test'];

const ADMIN_COMMAND_DESCRIPTIONS: Record<string, string> = {
    '/approve': 'Approve this room so Ami answers here',
    '/revoke': 'Revoke this room\'s approval',
    '/list': 'List every approved room',
    '/notify-add': 'Add THIS room (or a <token>) to receive escalation tickets',
    '/notify-remove': 'Remove THIS room (or a <token>) from escalation notifications',
    '/notify-list': 'List group chats that receive escalation tickets',
    '/notify-test': 'Send a test ticket to all configured notification groups'
};

/**
 * True when the sender is the configured Nextcloud admin account.
 * Pure string comparison against TALK_ADMIN_USER — no Talk API / DB / Apache call.
 */
export function isAdminUser(user: User): boolean {
    return config.talkAdminUser !== '' && user.id === config.talkAdminUser;
}

/** The text shown for `/help`. Admins also see the admin command tier. */
export function helpMessage(isAdmin: boolean): string {
    const lines = [
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
        '- `/status` — See who I\'m talking to and the conversation state',
        '- `/whoami` — Show the account I recognise you as',
        '- `/end` — End the conversation',
        '- `/help` — Show this message'
    ];
    if (isAdmin) {
        lines.push('', '**Admin commands:**');
        for (const cmd of ADMIN_COMMANDS) {
            lines.push(`- \`${cmd}\` — ${ADMIN_COMMAND_DESCRIPTIONS[cmd]}`);
        }
    }
    return lines.join('\n');
}
