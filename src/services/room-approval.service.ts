import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger';

export interface ApprovedRoom {
    token: string;
    name: string;
    approvedBy: string;
    approvedAt: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'approved-rooms.json');

function load(): ApprovedRoom[] {
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

function save(rooms: ApprovedRoom[]): void {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(rooms, null, 2));
    } catch (error) {
        logger.error(`❌ Failed to persist approved rooms: ${(error as Error).message}`);
    }
}

/**
 * Tracks which Talk rooms have been approved by the Nextcloud admin.
 * Persisted to a JSON file so approvals survive container rebuilds.
 */
export class RoomApprovalStore {
    private rooms: ApprovedRoom[];

    constructor() {
        this.rooms = load();
        logger.info(`🗂️ Loaded ${this.rooms.length} approved room(s) from ${FILE}`);
    }

    isApproved(token: string): boolean {
        return this.rooms.some(r => r.token === token);
    }

    /** Returns true when newly approved, false if it was already approved. */
    approve(token: string, name: string, byUser: string): boolean {
        if (this.isApproved(token)) return false;
        this.rooms.push({ token, name, approvedBy: byUser, approvedAt: Date.now() });
        save(this.rooms);
        return true;
    }

    /** Returns true when a previously-approved room was revoked. */
    revoke(token: string): boolean {
        const before = this.rooms.length;
        this.rooms = this.rooms.filter(r => r.token !== token);
        if (this.rooms.length !== before) {
            save(this.rooms);
            return true;
        }
        return false;
    }

    list(): ApprovedRoom[] {
        return this.rooms.slice();
    }
}

export const roomApprovalStore = new RoomApprovalStore();
