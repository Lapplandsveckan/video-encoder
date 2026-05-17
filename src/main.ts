import {app, BrowserWindow, ipcMain, dialog, screen} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import './encode';

ipcMain.handle('pick-files', async () => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, {
        title: 'Select video files',
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Videos', extensions: ['mp4', 'mov', 'mkv'] }
        ]
    });

    if (result.canceled) return [];
    return result.filePaths;
});

interface WindowState {
    x?: number;
    y?: number;
    width: number;
    height: number;
}

const DEFAULT_STATE: WindowState = { width: 900, height: 640 };

function stateFilePath(): string {
    return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState {
    try {
        const raw = fs.readFileSync(stateFilePath(), 'utf-8');
        const parsed = JSON.parse(raw) as WindowState;
        const display = screen.getDisplayMatching({
            x: parsed.x ?? 0,
            y: parsed.y ?? 0,
            width: parsed.width,
            height: parsed.height,
        });
        const bounds = display.workArea;
        if (
            parsed.x !== undefined && parsed.y !== undefined &&
            (parsed.x + parsed.width < bounds.x ||
                parsed.x > bounds.x + bounds.width ||
                parsed.y + parsed.height < bounds.y ||
                parsed.y > bounds.y + bounds.height)
        ) {
            return DEFAULT_STATE;
        }
        return parsed;
    } catch {
        return DEFAULT_STATE;
    }
}

function persistWindowState(win: BrowserWindow) {
    const save = () => {
        if (win.isDestroyed()) return;
        const bounds = win.getNormalBounds();
        try {
            fs.writeFileSync(stateFilePath(), JSON.stringify(bounds));
        } catch (err) {
            console.error('Failed to save window state:', err);
        }
    };
    win.on('close', save);
}

function createWindow() {
    const state = loadWindowState();

    const win = new BrowserWindow({
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
        minWidth: 480,
        minHeight: 360,
        webPreferences: {
            preload: path.join(__dirname, 'renderer', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    persistWindowState(win);
    win.loadFile(path.join(__dirname, '../public', 'index.html'));
}

app.whenReady().then(createWindow);

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    sendErrorToRenderer(err);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    sendErrorToRenderer(reason instanceof Error ? reason : new Error(String(reason)));
});

function sendErrorToRenderer(error: Error) {
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
        win.webContents.send('app-error', {
            message: error.message,
            stack: error.stack,
        });
    }
}
