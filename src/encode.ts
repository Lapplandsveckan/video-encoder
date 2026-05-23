import {app, ipcMain, WebContents} from 'electron';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { maybeUpload } from './upload-coordinator';

const DEFAULT_CONCURRENCY = 1;
const MAX_CONCURRENCY = 8;

function getSafeFfmpegPath(): string {
    if (!ffmpegPath) throw new Error('FFmpeg path is undefined');

    if (app.isPackaged) return ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    return ffmpegPath;
}

ffmpeg.setFfmpegPath(getSafeFfmpegPath());

export function encodeVideo(
    file: string,
    output: string,
    onProgress: (progress: number, time: number) => void,
    onComplete: (time: number) => void,
    onError: (err: Error) => void,
) {
    const startTime = Date.now();

    const command = ffmpeg();
    command
        .input(file)
        .videoCodec('libx264')
        .size('1920x1080')
        .aspect('16:9')
        .autopad()
        .fps(30)
        .videoFilters([
            // HDR/10-bit → SDR/8-bit
            'format=yuv420p',
            'colorspace=all=bt709:iall=bt2020:fast=1'
        ])
        .audioCodec('aac')
        .audioBitrate('192k')
        .audioFrequency(48000)
        .audioChannels(2)
        .outputOptions([
            '-crf 18',
            '-preset slow',
            '-tune film',
            '-movflags +faststart',
        ])
        .output(output)
        .on('end', () => {
            onComplete(Date.now() - startTime);
        })
        .on('progress', (progress) => {
            onProgress(progress.percent ?? 0, Date.now() - startTime);
        })
        .on('error', (err, stdout, stderr) => {
            onError(new Error(`FFmpeg error: ${err.message}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`));
        })
        .run();

    return command;
}

interface QueueItem {
    filePath: string;
    sender: WebContents;
}

const pendingQueue: QueueItem[] = [];
const activeEncodes = new Map<string, ffmpeg.FfmpegCommand>();
let concurrencyLimit = DEFAULT_CONCURRENCY;

function safeSend(sender: WebContents, channel: string, ...args: unknown[]) {
    if (!sender.isDestroyed()) sender.send(channel, ...args);
}

function sanitizeBasename(filePath: string): string {
    return path.basename(filePath)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9.\-_\s]/gi, '')
        .replace(/\.\w+$/, '');
}

function drainQueue() {
    while (activeEncodes.size < concurrencyLimit && pendingQueue.length > 0) {
        const item = pendingQueue.shift()!;
        startEncode(item);
    }
}

function startEncode(item: QueueItem) {
    const { filePath, sender } = item;
    const tempOut = path.join(os.tmpdir(), `converted-${Date.now()}-${process.pid}.mp4`);

    const command = encodeVideo(
        filePath,
        tempOut,
        (progress, time) => {
            safeSend(sender, 'encode-progress', { file: filePath, progress, time });
        },
        (time) => {
            const output = uniqueOutputPath(
                path.dirname(filePath),
                `${sanitizeBasename(filePath)}.converted`,
                '.mp4',
            );

            try {
                moveFile(tempOut, output);
            } catch (err) {
                activeEncodes.delete(filePath);
                safeSend(sender, 'encode-error', {
                    file: filePath,
                    message: `Failed to write output: ${(err as Error).message}`,
                });
                drainQueue();
                return;
            }

            activeEncodes.delete(filePath);
            safeSend(sender, 'encode-done', { file: filePath, output, time });
            drainQueue();
            maybeUpload(sender, filePath, output);
        },
        (err) => {
            activeEncodes.delete(filePath);
            try { fs.unlinkSync(tempOut); } catch {}
            safeSend(sender, 'encode-error', { file: filePath, message: err.message });
            drainQueue();
        },
    );

    activeEncodes.set(filePath, command);
    safeSend(sender, 'encode-started', { file: filePath });
}

function moveFile(src: string, dest: string) {
    try {
        fs.renameSync(src, dest);
    } catch (err: any) {
        if (err && err.code === 'EXDEV') {
            fs.copyFileSync(src, dest);
            fs.unlinkSync(src);
        } else {
            throw err;
        }
    }
}

function uniqueOutputPath(dir: string, base: string, ext: string): string {
    let candidate = path.join(dir, `${base}${ext}`);
    let i = 1;
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${base} (${i})${ext}`);
        i++;
    }
    return candidate;
}

function isQueuedOrActive(filePath: string): boolean {
    return activeEncodes.has(filePath) || pendingQueue.some(p => p.filePath === filePath);
}

ipcMain.on('encode-video', (event, filePath: string) => {
    if (isQueuedOrActive(filePath)) return;

    pendingQueue.push({ filePath, sender: event.sender });
    safeSend(event.sender, 'encode-queued', { file: filePath });
    drainQueue();
});

ipcMain.on('cancel-encode', (event, filePath: string) => {
    const command = activeEncodes.get(filePath);
    if (command) {
        command.kill('SIGKILL');
        activeEncodes.delete(filePath);
        safeSend(event.sender, 'encode-cancelled', filePath);
        drainQueue();
        return;
    }

    const idx = pendingQueue.findIndex(p => p.filePath === filePath);
    if (idx !== -1) {
        pendingQueue.splice(idx, 1);
        safeSend(event.sender, 'encode-cancelled', filePath);
    }
});

ipcMain.on('set-concurrency', (event, n: number) => {
    if (!Number.isFinite(n)) return;
    concurrencyLimit = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(n)));
    drainQueue();
});
