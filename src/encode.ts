import {BrowserWindow, ipcMain} from 'electron';
import * as ffmpegPath from 'ffmpeg-static'
import * as ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';

if (!ffmpegPath) throw new Error("FFmpeg binary not found")
ffmpeg.setFfmpegPath(ffmpegPath);

const runningEncodes = new Map<string, ffmpeg.FfmpegCommand>();
export function encodeVideo(file: string, output: string, onProgress: (progress: number, time: number) => void, onComplete: (time: number) => void) {
    const startTime = Date.now();

    const command = ffmpeg();
    command
        .input(file)
        .videoCodec('libx264')
        .size('1920x1080')
        .aspect('16:9')
        .autopad()
        .fps(30)
        .videoBitrate(10000) // 10 Mbps
        .videoFilters([
            // Convert HDR to SDR, and 10-bit to 8-bit
            'format=yuv420p',
            'colorspace=all=bt709:iall=bt2020:fast=1'
        ])
        .outputOptions([
            '-movflags faststart',
            '-preset veryslow',
        ])
        .output(output.replace(/\.\w*$/, '.mp4'))
        .on("end", function () {
            const endTime = Date.now();
            const duration = endTime - startTime;

            onComplete(duration);
        })
        .on("progress", function (progress) {
            const endTime = Date.now();
            const duration = endTime - startTime;

            onProgress(progress.percent, duration);
        })
        .on('error', (err, stdout, stderr) => {
            sendErrorToRenderer(new Error(`FFmpeg error: ${err.message}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`));
        })
        .run();

    return command;
}

ipcMain.on('encode-video', (event, filePath: string) => {
    if (runningEncodes.has(filePath)) return;

    const tempOut = path.join(
        require('os').tmpdir(),
        `converted-${Date.now()}.mp4`
    );

    const process = encodeVideo(
        filePath,
        tempOut,
        (progress, time) => {
            event.sender.send('encode-progress', {
                file: filePath,
                progress,
                time,
            });
        },
        (time) => {
            const name = path.basename(filePath)
                .replace(/[^a-z0-9.\-_\s]/gi, '')
                .replace(/\.\w+$/, '.converted.mp4');

            const output = path.join(
                path.dirname(filePath),
                name
            );

            fs.renameSync(tempOut, output);
            event.sender.send('encode-done', {
                file: filePath,
                output,
                time,
            });
        },
    );

    runningEncodes.set(filePath, process);
});

ipcMain.on('cancel-encode', (event, filePath: string) => {
    const command = runningEncodes.get(filePath);
    if (command) {
        command.kill('SIGKILL');
        runningEncodes.delete(filePath);

        event.sender.send('encode-cancelled', filePath);
    }
});

function sendErrorToRenderer(error: Error) {
    const allWindows = BrowserWindow.getAllWindows()
    for (const win of allWindows) {
        win.webContents.send('app-error', {
            message: error.message,
            stack: error.stack,
        })
    }
}
