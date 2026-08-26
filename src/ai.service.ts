import axios from 'axios';
import { config } from './config';
import { logger } from './logger';

export interface HistoryItem {
    role: 'user' | 'model';
    content: string;
}

export interface ImageData {
    mimeType: string;
    base64Data: string;
    fileName?: string;
}

type Provider = 'gemini' | 'azure' | 'openai' | 'none';

interface GeminiResponse {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

interface OpenAIResponse {
    choices?: Array<{ message?: { content?: string } }>;
}

interface ChatMessage {
    role: string;
    content: string;
}

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
                    return await this.callGemini(userMessage, systemPrompt, history, image);
                case 'openai':
                case 'azure':
                    return await this.callChatCompletions(userMessage, systemPrompt, history, image);
                default:
                    return '⚠️ No AI provider available.';
            }
        } catch (error: any) {
            logger.error(`${this.activeProvider.toUpperCase()} AI Error:`, error?.message || error);
            return '⚠️ Error generating AI response. Please try again.';
        }
    }

    private async callGemini(userMessage: string, systemPrompt: string, history?: HistoryItem[], image?: ImageData): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModelName}:generateContent?key=${config.geminiApiKey}`;

        const contents: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> =
            (history || []).map(item => ({ role: item.role, parts: [{ text: item.content }] }));

        if (image) {
            // Multi-turn history makes the model lose attached images — collapse
            // to a single turn containing the text prompt + the image.
            contents.length = 0;
            const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
                { text: userMessage || 'Analyze this image and respond.' }
            ];
            parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64Data } });
            contents.push({ role: 'user', parts });
        } else {
            contents.push({ role: 'user', parts: [{ text: userMessage || 'Help me.' }] });
        }

        const payload = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
        };

        const res = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
        const data = res.data as GeminiResponse;
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a response.";
    }

    private async callChatCompletions(userMessage: string, systemPrompt: string, history?: HistoryItem[], image?: ImageData): Promise<string> {
        if (!history || history.length === 0) {
            history = [];
        }
        const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
        for (const item of history) {
            messages.push({ role: item.role === 'model' ? 'assistant' : 'user', content: item.content });
        }
        if (image) {
            // Vision message: text + image as a data URL in a content array
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: userMessage || 'Analyze this image and respond.' },
                    { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64Data}` } }
                ]
            } as unknown as ChatMessage);
        } else if (!history || history.length === 0) {
            messages.push({ role: 'user', content: userMessage });
        }

        const isAzure = this.activeProvider === 'azure';
        const url = isAzure
            ? `${config.azureOpenAIEndpoint}/openai/deployments/${config.azureOpenAIDeployment}/chat/completions?api-version=2024-02-15-preview`
            : 'https://api.openai.com/v1/chat/completions';

        const body: Record<string, unknown> = { messages, temperature: 0.7, max_tokens: 800 };
        if (!isAzure) body.model = config.openAIModel;

        const res = await axios.post(url, body, {
            headers: isAzure
                ? { 'Content-Type': 'application/json', 'api-key': config.azureOpenAIKey }
                : { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openAIApiKey}` },
            timeout: 30000
        });

        const data = res.data as OpenAIResponse;
        return data.choices?.[0]?.message?.content || "I couldn't generate a response.";
    }
}

export const aiService = new AIService();
