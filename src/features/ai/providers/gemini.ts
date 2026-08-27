import axios from 'axios';
import { config } from '../../../config/config.service';
import { logger } from '../../../core/logger';
import { HistoryItem, ImageData } from '../../../models/message.model';

interface GeminiResponse {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export async function callGemini(userMessage: string, systemPrompt: string, history?: HistoryItem[], image?: ImageData): Promise<string> {
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
