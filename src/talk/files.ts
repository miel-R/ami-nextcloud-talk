import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import { FileParameter, ImageAttachment } from './types';

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];

/**
 * Downloads an image that was shared into a Talk room.
 *
 * Strategy (in order):
 * 1. Public share link — when the file parameter carries a `/s/<token>` link,
 *    appending `/download` yields the raw file without authentication.
 * 2. WebDAV fallback — room shares mount flat under the configured admin
 *    user's `Talk/` folder, so we fetch `remote.php/dav/files/<admin>/<path>`
 *    with basic auth. Requires TALK_ADMIN_USER + SECRET_TALK_ADMIN_PASSWORD.
 */
export async function downloadTalkImage(file: FileParameter): Promise<ImageAttachment | null> {
    const maxSizeBytes = config.maxImageSizeMB * 1024 * 1024;
    if (file.size && parseInt(file.size, 10) > maxSizeBytes) {
        logger.warn(`⚠️ Image "${file.name}" is ${file.size} bytes — exceeds ${config.maxImageSizeMB} MB limit.`);
        return null;
    }

    let result: ImageAttachment | null = null;

    if (file.link && /\/s\/[A-Za-z0-9_-]+$/.test(file.link)) {
        result = await downloadViaPublicShare(file);
    }

    if (!result && config.talkAdminUser && config.talkAdminPassword) {
        result = await downloadViaWebdav(file);
    }

    if (result) {
        logger.info(`📸 Downloaded image "${file.name}" (${result.base64Data.length} b64 chars, ${result.mimeType})`);
    } else {
        logger.error(`❌ Could not download image "${file.name}" (no public share link${config.talkAdminUser ? '' : ' and no admin credentials configured'})`);
    }
    return result;
}

async function downloadViaPublicShare(file: FileParameter): Promise<ImageAttachment | null> {
    if (!file.link) return null;
    const url = `${file.link.replace(/\/+$/, '')}/download`;
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer', maxRedirects: 5, timeout: 30000 });
        return toAttachment(file, res);
    } catch (error: any) {
        logger.warn(`⚠️ Public-share download failed for "${file.name}": ${error.response?.status || error.message}`);
        return null;
    }
}

async function downloadViaWebdav(file: FileParameter): Promise<ImageAttachment | null> {
    if (!file.path) {
        logger.warn('⚠️ No file path available for WebDAV fallback.');
        return null;
    }
    const cleanPath = file.path.replace(/^\/+/, '');
    const url = `${config.talkServerUrl}/remote.php/dav/files/${encodeURIComponent(config.talkAdminUser)}/${cleanPath}`;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: { Authorization: basicAuth(config.talkAdminUser, config.talkAdminPassword) }
        });
        return toAttachment(file, res);
    } catch (error: any) {
        logger.warn(`⚠️ WebDAV download failed for "${file.name}": ${error.response?.status || error.message}`);
        return null;
    }
}

function toAttachment(file: FileParameter, res: { headers: Record<string, unknown>; data: ArrayBuffer }): ImageAttachment | null {
    const buffer = Buffer.from(res.data);
    const mimeType = sanitizeMime((res.headers['content-type'] as string) || file.mimetype || 'image/png');
    if (!IMAGE_MIME_TYPES.some(t => mimeType.startsWith(t))) {
        logger.warn(`⚠️ Downloaded "${file.name}" is "${mimeType}", not a supported image.`);
        return null;
    }
    return { mimeType, base64Data: buffer.toString('base64'), fileName: file.name };
}

function sanitizeMime(mime: string): string {
    return mime.split(';')[0].trim().toLowerCase();
}

function basicAuth(user: string, password: string): string {
    return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}
