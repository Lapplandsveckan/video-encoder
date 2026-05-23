import * as http from 'http';
import * as fs from 'fs';
import { DiscoveredServer } from './discovery';

const CHUNK_SIZE = 1024 * 1024; // 1 MB

export class AuthRequired extends Error {
    constructor() { super('Authentication required'); }
}

interface HttpResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

function httpRequest(
    server: DiscoveredServer,
    method: string,
    pathname: string,
    headers: Record<string, string>,
    body?: Buffer | string,
): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: server.host,
            port: server.port,
            method,
            path: pathname,
            headers,
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                body: Buffer.concat(chunks),
            }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

export async function login(server: DiscoveredServer, password: string): Promise<string> {
    const body = JSON.stringify({ password });
    const res = await httpRequest(server, 'POST', '/api/auth/login', {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
    }, body);

    if (res.status === 401) throw new Error('Wrong password');
    if (res.status >= 400) throw new Error(`Login failed: HTTP ${res.status}`);

    const setCookie = res.headers['set-cookie'];
    if (!setCookie || setCookie.length === 0) throw new Error('Server did not return a session cookie');

    return setCookie.map(c => c.split(';')[0]).join('; ');
}

export interface UploadOptions {
    server: DiscoveredServer;
    filePath: string;
    remoteName: string;
    cookie?: string;
    onProgress: (uploaded: number, total: number) => void;
}

export async function uploadFile(opts: UploadOptions): Promise<void> {
    const stat = fs.statSync(opts.filePath);
    const totalChunks = Math.max(1, Math.ceil(stat.size / CHUNK_SIZE));

    const initBody = JSON.stringify({ path: opts.remoteName, chunks: totalChunks });
    const authHeaders: Record<string, string> = opts.cookie ? { Cookie: opts.cookie } : {};

    // REP "ACTION" maps to HTTP POST on the wire.
    const initRes = await httpRequest(opts.server, 'POST', '/api/caspar/media/upload', {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(initBody).toString(),
        ...authHeaders,
    }, initBody);

    if (initRes.status === 401) throw new AuthRequired();
    if (initRes.status >= 400) {
        throw new Error(`Init upload failed: HTTP ${initRes.status} ${initRes.body.toString().slice(0, 200)}`);
    }

    let uploadId: string;
    try {
        uploadId = (JSON.parse(initRes.body.toString()) as { id: string }).id;
    } catch {
        throw new Error(`Unexpected init response: ${initRes.body.toString().slice(0, 200)}`);
    }

    const fh = fs.openSync(opts.filePath, 'r');
    try {
        const buf = Buffer.alloc(CHUNK_SIZE);
        let uploaded = 0;
        for (let i = 0; i < totalChunks; i++) {
            const offset = i * CHUNK_SIZE;
            const length = Math.min(CHUNK_SIZE, stat.size - offset);
            fs.readSync(fh, buf, 0, length, offset);
            const chunkData = Buffer.from(buf.subarray(0, length));

            const chunkRes = await httpRequest(
                opts.server,
                'POST',
                `/api/upload/chunk?id=${encodeURIComponent(uploadId)}&chunk=${i}`,
                {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': length.toString(),
                    ...authHeaders,
                },
                chunkData,
            );

            if (chunkRes.status >= 400) {
                throw new Error(`Chunk ${i + 1}/${totalChunks} failed: HTTP ${chunkRes.status}`);
            }
            uploaded += length;
            opts.onProgress(uploaded, stat.size);
        }
    } finally {
        fs.closeSync(fh);
    }
}

export async function cancelUpload(server: DiscoveredServer, uploadId: string, cookie?: string): Promise<void> {
    const body = JSON.stringify({ id: uploadId });
    await httpRequest(server, 'POST', '/api/caspar/media/upload/cancel', {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
        ...(cookie ? { Cookie: cookie } : {}),
    }, body);
}
