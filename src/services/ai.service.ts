import { config } from '../config/config.service';
import { logger } from '../core/logger';
import { HistoryItem, ImageData } from '../models/message.model';
import { callGemini } from '../features/ai/providers/gemini';
import { callOpenAI } from '../features/ai/providers/openai';
import { callAzure } from '../features/ai/providers/azure';

type Provider = 'gemini' | 'azure' | 'openai' | 'none';

class AIService {
    private activeProvider: Provider;

    constructor() {
        this.activeProvider = this.resolveProvider();
        if (this.activeProvider !== 'none') {
            logger.info(`🤖 AI Provider: ${this.activeProvider.toUpperCase()}`);
        } else {
            logger.warn('⚠️ No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY in your env file.');
        }
    }

    private resolveProvider(): Provider {
        const manual = config.aiProvider;

        if (manual !== 'auto') {
            if (manual === 'gemini' && config.geminiApiKey) return 'gemini';
            if (manual === 'openai' && config.openAIApiKey) return 'openai';
            if (manual === 'azure' && config.azureOpenAIEndpoint && config.azureOpenAIKey) return 'azure';
            logger.warn(`⚠️ AI_PROVIDER="${manual}" set but required API key is missing. Falling back to auto-detect.`);
        }

        if (config.geminiApiKey) return 'gemini';
        if (config.openAIApiKey) return 'openai';
        if (config.azureOpenAIEndpoint && config.azureOpenAIKey) return 'azure';

        return 'none';
    }

    getActiveProvider(): Provider {
        return this.activeProvider;
    }

    async callAI(userMessage: string, systemPrompt: string, history?: HistoryItem[], image?: ImageData): Promise<string> {
        if (this.activeProvider === 'none') {
            return '⚠️ No AI provider configured. Please set GEMINI_API_KEY or OPENAI_API_KEY.';
        }
        try {
            switch (this.activeProvider) {
                case 'gemini':
                    return await callGemini(userMessage, systemPrompt, history, image);
                case 'openai':
                    return await callOpenAI(userMessage, systemPrompt, history, image);
                case 'azure':
                    return await callAzure(userMessage, systemPrompt, history, image);
                default:
                    return '⚠️ No AI provider available.';
            }
        } catch (error: any) {
            logger.error(`${this.activeProvider.toUpperCase()} AI Error:`, error?.message || error);
            return '⚠️ Error generating AI response. Please try again.';
        }
    }
}

export const aiService = new AIService();
