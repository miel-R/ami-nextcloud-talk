import express from 'express';
import { config } from '../config/config.service';
import { talkAgent } from '../services/talk.service';

export function registerHealth(app: express.Express): void {
    app.get('/api/health', (_req: express.Request, res: express.Response) => {
        res.json({
            status: 'healthy',
            company: config.companyName,
            channel: 'nextcloud-talk',
            talkConfigured: Boolean(config.talkServerUrl && config.talkSecret),
            activeConversations: talkAgent.getActiveConversationCount(),
            timestamp: new Date().toISOString()
        });
    });
}
