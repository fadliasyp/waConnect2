import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Folder sessions
export const SESSION_PATH = path.join(__dirname, '../../sessions');

// Folder QR Codes (optional)
export const QR_FOLDER_PATH = path.join(SESSION_PATH, 'qrcodes');
