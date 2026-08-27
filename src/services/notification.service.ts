import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger';

export interface NotifyRoom {
    token: string;
    name?: string;
    addedBy: string;
    addedAt: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'notify-rooms.json');

function load(): NotifyRoom[] {
    try {
        if (!fs.existsSync(FILE)) return [];
        const raw = fs.readFileSync(FILE, 'utf-8').trim();
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        logger.warn(`⚠️ Could not read ${FILE}, starting empty: ${(error as Error).message}`);
        return [];
    }
}

function save(rooms: NotifyRoom[]): void {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(rooms, null, 2));
    } catch (error) {
        logger.error(`❌ Failed to persist notification rooms: ${(error as Error).message}`);
    }
}

/** Persisted list of Talk rooms (group chats) that receive escalation tickets. */
export class NotificationStore {
    private rooms: NotifyRoom[];

    constructor() {
        this.rooms = load();
        logger.info(`🔔 Loaded ${this.rooms.length} notification room(s) from ${FILE}`);
    }

    list(): NotifyRoom[] {
        return this.rooms.slice();
    }

    /** Returns true when newly added, false if it was already present. */
    add(token: string, name: string, byUser: string): boolean {
        if (this.rooms.some(r => r.token === token)) return false;
        this.rooms.push({ token, name, addedBy: byUser, addedAt: Date.now() });
        save(this.rooms);
        return true;
    }

    /** Returns true when a room was removed. */
    remove(token: string): boolean {
        const before = this.rooms.length;
        this.rooms = this.rooms.filter(r => r.token !== token);
        if (this.rooms.length !== before) {
            save(this.rooms);
            return true;
        }
        return false;
    }
}

export const notificationStore = new NotificationStore();
