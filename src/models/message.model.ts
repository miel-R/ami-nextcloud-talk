export interface HistoryItem {
    role: 'user' | 'model';
    content: string;
}

export interface ImageData {
    mimeType: string;
    base64Data: string;
    fileName?: string;
}

/** A normalized incoming message after mention-stripping and image extraction. */
export interface NormalizedMessage {
    text: string;
    image?: ImageData;
}
