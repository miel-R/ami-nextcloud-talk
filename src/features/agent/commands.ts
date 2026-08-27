import { config } from '../../config/config.service';

/** Commands that end the conversation and clear the session. */
export const END_COMMANDS = ['/end', '/exit', '/quit'];

export function isEndCommand(message: string): boolean {
    return END_COMMANDS.includes(message);
}

/** The text shown for `/help`. */
export function helpMessage(): string {
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
        '- `/status` — See who I\'m talking to and the conversation state',
        '- `/end` — End the conversation',
        '- `/help` — Show this message'
    ].join('\n');
}
