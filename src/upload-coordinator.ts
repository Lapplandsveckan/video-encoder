import { ipcMain, WebContents } from 'electron';
import * as path from 'path';
import { getServer, DiscoveredServer } from './discovery';
import { uploadFile, login, AuthRequired } from './upload';

interface PasswordResolver {
    resolve: (password: string) => void;
    reject: (err: Error) => void;
}

let selectedServerId: string | null = null;
const cookieByServer = new Map<string, string>();
const pendingPasswordPromises = new Map<string, PasswordResolver>();

function safeSend(sender: WebContents, channel: string, ...args: unknown[]) {
    if (!sender.isDestroyed()) sender.send(channel, ...args);
}

ipcMain.on('set-upload-target', (_event, serverId: string | null) => {
    selectedServerId = serverId;
});

ipcMain.on('submit-password', (_event, payload: { serverId: string; password: string | null }) => {
    const resolver = pendingPasswordPromises.get(payload.serverId);
    if (!resolver) return;
    pendingPasswordPromises.delete(payload.serverId);
    if (payload.password === null) {
        resolver.reject(new Error('Password prompt cancelled'));
    } else {
        resolver.resolve(payload.password);
    }
});

function promptPassword(sender: WebContents, server: DiscoveredServer): Promise<string> {
    return new Promise((resolve, reject) => {
        pendingPasswordPromises.set(server.id, { resolve, reject });
        safeSend(sender, 'auth-prompt', { serverId: server.id, serverName: server.name });
    });
}

async function ensureCookie(sender: WebContents, server: DiscoveredServer, retry = false): Promise<string | undefined> {
    if (!retry && cookieByServer.has(server.id)) return cookieByServer.get(server.id);

    const password = await promptPassword(sender, server);
    const cookie = await login(server, password);
    cookieByServer.set(server.id, cookie);
    return cookie;
}

async function runUpload(sender: WebContents, server: DiscoveredServer, sourceFile: string, encodedPath: string, cookie?: string) {
    const remoteName = path.basename(encodedPath);

    await uploadFile({
        server,
        filePath: encodedPath,
        remoteName,
        cookie,
        onProgress: (uploaded, total) => {
            const percent = total > 0 ? Math.floor((uploaded / total) * 100) : 0;
            safeSend(sender, 'upload-progress', { file: sourceFile, percent, uploaded, total });
        },
    });
}

export async function maybeUpload(sender: WebContents, sourceFile: string, encodedPath: string) {
    if (!selectedServerId) return;
    const server = getServer(selectedServerId);
    if (!server) {
        safeSend(sender, 'upload-error', { file: sourceFile, message: 'Selected server is no longer available' });
        return;
    }

    safeSend(sender, 'upload-started', { file: sourceFile, serverName: server.name });

    try {
        let cookie = cookieByServer.get(server.id);
        try {
            await runUpload(sender, server, sourceFile, encodedPath, cookie);
        } catch (err) {
            if (!(err instanceof AuthRequired)) throw err;
            cookie = await ensureCookie(sender, server, true);
            await runUpload(sender, server, sourceFile, encodedPath, cookie);
        }

        safeSend(sender, 'upload-done', { file: sourceFile, serverName: server.name });
    } catch (err) {
        safeSend(sender, 'upload-error', { file: sourceFile, message: (err as Error).message });
    }
}
