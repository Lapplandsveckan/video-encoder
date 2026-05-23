import * as dgram from 'dgram';
import { BrowserWindow } from 'electron';

const BEACON_PORT = 5354;
const BEACON_TYPE = 'cg-manager';
const EXPIRY_MS = 6000; // ~3× the cg-manager beacon interval
const SWEEP_MS = 2000;

export interface DiscoveredServer {
    id: string;
    name: string;
    host: string;
    port: number;
}

interface BeaconPayload {
    type: string;
    id: string;
    name: string;
    port: number;
    version?: string;
    t?: number;
}

interface TrackedServer extends DiscoveredServer {
    lastSeen: number;
}

let socket: dgram.Socket | null = null;
let sweepTimer: NodeJS.Timeout | null = null;
const servers = new Map<string, TrackedServer>();

function broadcast(channel: string, payload: unknown) {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
}

function parseBeacon(buf: Buffer): BeaconPayload | null {
    try {
        const parsed = JSON.parse(buf.toString('utf8')) as BeaconPayload;
        if (parsed && parsed.type === BEACON_TYPE &&
            typeof parsed.id === 'string' &&
            typeof parsed.name === 'string' &&
            typeof parsed.port === 'number') {
            return parsed;
        }
    } catch {}
    return null;
}

function sweepExpired() {
    const now = Date.now();
    for (const [id, server] of servers) {
        if (now - server.lastSeen > EXPIRY_MS) {
            servers.delete(id);
            broadcast('discovery-lost', { id });
        }
    }
}

export function startDiscovery() {
    if (socket) return;

    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    sock.on('error', (err) => {
        console.error('[discovery] socket error:', err.message);
    });

    sock.on('message', (msg, rinfo) => {
        const beacon = parseBeacon(msg);
        if (!beacon) return;

        const existing = servers.get(beacon.id);
        const server: TrackedServer = {
            id: beacon.id,
            name: beacon.name,
            host: rinfo.address,
            port: beacon.port,
            lastSeen: Date.now(),
        };
        servers.set(beacon.id, server);

        if (!existing) {
            broadcast('discovery-found', {
                id: server.id,
                name: server.name,
                host: server.host,
                port: server.port,
            });
        }
    });

    sock.bind(BEACON_PORT, () => {
        try { sock.setBroadcast(true); } catch {}
        console.log(`[discovery] listening on UDP :${BEACON_PORT}`);
    });

    socket = sock;
    sweepTimer = setInterval(sweepExpired, SWEEP_MS);
}

export function stopDiscovery() {
    if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
    }
    if (socket) {
        try { socket.close(); } catch {}
        socket = null;
    }
    servers.clear();
}

export function listServers(): DiscoveredServer[] {
    return Array.from(servers.values()).map(({ lastSeen, ...rest }) => rest);
}

export function getServer(id: string): DiscoveredServer | undefined {
    const s = servers.get(id);
    if (!s) return undefined;
    const { lastSeen, ...rest } = s;
    return rest;
}
