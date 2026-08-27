import { User } from './user.model';
import { HistoryItem } from './message.model';
import { EscalationState } from '../features/agent/ticket';

/** An isolated conversation thread, scoped per room + user. */
export interface Session {
    /** Stable key: `${roomToken}:${rawActorId}`. */
    key: string;
    user: User;
    roomToken: string;
    roomName?: string;
    history: HistoryItem[];
    createdAt: number;
    lastActivity: number;
    /** Present while Ami is collecting a structured escalation request. */
    escalation?: EscalationState;
}
