import fs from 'fs';
import path from 'path';
import { logger } from '../../core/logger';
import { User } from '../../models/user.model';

export interface TicketDepartment {
    id: string;
    label: string;
    categories: { id: string; label: string; systemTypes: string[] }[];
}
export interface TicketConfig {
    departments: TicketDepartment[];
}

export type EscalationStep = 'department' | 'category' | 'system' | 'problem';

export interface EscalationState {
    step: EscalationStep;
    departmentId?: string;
    departmentLabel?: string;
    categoryId?: string;
    categoryLabel?: string;
    systemType?: string;
    problem?: string;
}

const FILE = path.resolve(process.cwd(), 'ticket-categories.json');

let cache: TicketConfig | null = null;

export function loadTicketConfig(): TicketConfig {
    if (cache) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as TicketConfig;
    } catch (error) {
        logger.error(`❌ Failed to load ${FILE}: ${(error as Error).message}`);
        cache = { departments: [] };
    }
    return cache;
}

export function getDepartments(): TicketDepartment[] {
    return loadTicketConfig().departments;
}

export function getDepartment(id: string): TicketDepartment | undefined {
    return getDepartments().find(d => d.id === id);
}

export function getCategories(deptId: string): TicketDepartment['categories'] {
    return getDepartment(deptId)?.categories || [];
}

/** Renders a numbered menu. Options may be strings or {label} objects. */
export function renderMenu(title: string, options: string[]): string {
    const lines = options.map((o, i) => `${i + 1}) ${o}`);
    return `${title}\n${lines.join('\n')}`;
}

/**
 * Parses a user's choice against a list of option labels.
 * Accepts a leading number ("1", "2) ...") or the exact label (case-insensitive).
 * Returns the 0-based index, or -1 when nothing matched.
 */
export function parseChoice(input: string, options: string[]): number {
    const t = input.trim();
    const numMatch = t.match(/^(\d+)/);
    if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        if (n >= 1 && n <= options.length) return n - 1;
    }
    const lower = t.toLowerCase();
    const exact = options.findIndex(o => o.toLowerCase() === lower);
    if (exact >= 0) return exact;
    return -1;
}

/** Builds the escalation ticket text posted to the notification rooms. */
export function formatTicket(esc: EscalationState, user: User, roomName?: string): string {
    const who = user.displayName ? `**${user.displayName}** (${user.id})` : `**${user.id}**`;
    const where = roomName ? `**${roomName}**` : 'this room';
    return [
        '📩 **New help request**',
        `Department: ${esc.departmentLabel || '-'}`,
        `Category: ${esc.categoryLabel || '-'}`,
        `System: ${esc.systemType || '-'}`,
        `From: ${who} — room ${where}`,
        `Problem: ${esc.problem || '-'}`
    ].join('\n');
}
