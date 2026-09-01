import { config } from '../../config/config.service';
import { User } from '../../models/user.model';

/** Commands that end the conversation and clear the session. */
export const END_COMMANDS = ['$end', '$exit', '$quit'];

export function isEndCommand(message: string): boolean {
    return END_COMMANDS.includes(message);
}

/** Natural-language sign-offs that should close the conversation immediately
 *  (so the idle farewell isn't sent later). Covers EN + Tagalog closings. */
const CLOSING_RE = /\b(bye|good ?bye|thanks|thank you|thx|salamat|done|finished|wala na|ayos na|ok na|okey na|that'?s all|all set|all good)\b/i;

export function isClosingMessage(message: string): boolean {
    return CLOSING_RE.test(message.toLowerCase());
}

/** Commands any approved user can run. */
export const USER_COMMANDS = ['$help', '$status', '$whoami', '$reset', '$end', '$admin', '$refresh'];

/** Commands only the Nextcloud admin account may run. */
export const ADMIN_COMMANDS = ['$approve', '$revoke', '$list', '$notify-add', '$notify-remove', '$notify-list', '$notify-test'];

const ADMIN_COMMAND_DESCRIPTIONS: Record<string, string> = {
    '$approve': 'Approve this room so Ami answers here',
    '$revoke': 'Revoke this room\'s approval',
    '$list': 'List every approved room',
    '$notify-add': 'Add THIS room (or a <token>) to receive escalation tickets',
    '$notify-remove': 'Remove THIS room (or a <token>) from escalation notifications',
    '$notify-list': 'List group chats that receive escalation tickets',
    '$notify-test': 'Send a test ticket to all configured notification groups'
};

/**
 * True when the sender is the configured Nextcloud admin account.
 * Supports comma-separated TALK_ADMIN_USER (e.g. "admin,alice,bob") and
 * case-insensitive comparison — no Talk API / DB call.
 */
export function isAdminUser(user: User): boolean {
    if (!config.talkAdminUser) return false;
    const admins = config.talkAdminUser.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return admins.includes(user.id.toLowerCase());
}

export function adminList(): string {
    if (!config.talkAdminUser) return '(none — set TALK_ADMIN_USER)';
    return config.talkAdminUser.split(',').map(s => s.trim()).filter(Boolean).join(', ');
}

/** The text shown for `$help`. Admins also see the admin command tier. */
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
        '- `$reset` — Clear conversation and start fresh',
        '- `$status` — See who I\'m talking to and the conversation state',
        '- `$whoami` — Show the account I recognise you as',
        '- `$admin` — Show who the Nextcloud admin is (for `ami $approve`)',
        '- `$refresh` — Same as `$admin` — query without starting a chat',
        '- `$end` — End the conversation',
        '- `$help` — Show this message'
    ];
    if (isAdmin) {
        lines.push('', '**Admin commands:**');
        for (const cmd of ADMIN_COMMANDS) {
            lines.push(`- \`${cmd}\` — ${ADMIN_COMMAND_DESCRIPTIONS[cmd]}`);
        }
    }
    return lines.join('\n');
}
