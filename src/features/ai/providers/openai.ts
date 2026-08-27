import axios from 'axios';
import { config } from '../../../config/config.service';
import { logger } from '../../../core/logger';
import { HistoryItem, ImageData } from '../../../models/message.model';

export interface ChatMessage {
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export async function callOpenAI(userMessage: string, systemPrompt: string, history?: HistoryItem[], image?: ImageData): Promise<string> {
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const item of history || []) {
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
        });
    } else if (!history || history.length === 0) {
        messages.push({ role: 'user', content: userMessage });
    }

    const body: Record<string, unknown> = { messages, temperature: 0.7, max_tokens: 800, model: config.openAIModel };

    const res = await axios.post('https://api.openai.com/v1/chat/completions', body, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openAIApiKey}` },
        timeout: 30000
    });

    const data = res.data as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || "I couldn't generate a response.";
}
