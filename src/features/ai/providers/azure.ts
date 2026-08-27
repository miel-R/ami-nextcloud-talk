import axios from 'axios';
import { config } from '../../../config/config.service';
import { logger } from '../../../core/logger';
import { HistoryItem, ImageData } from '../../../models/message.model';
import { ChatMessage } from './openai';

export async function callAzure(userMessage: string, systemPrompt: string, history?: HistoryItem[], image?: ImageData): Promise<string> {
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const item of history || []) {
        messages.push({ role: item.role === 'model' ? 'assistant' : 'user', content: item.content });
    }
    if (image) {
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

    const url = `${config.azureOpenAIEndpoint}/openai/deployments/${config.azureOpenAIDeployment}/chat/completions?api-version=2024-02-15-preview`;
    const body: Record<string, unknown> = { messages, temperature: 0.7, max_tokens: 800 };

    const res = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json', 'api-key': config.azureOpenAIKey },
        timeout: 30000
    });

    const data = res.data as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || "I couldn't generate a response.";
}
