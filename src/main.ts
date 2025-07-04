import {app, BrowserWindow, ipcMain, dialog} from 'electron';
import * as path from 'path';
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

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'renderer', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    win.loadFile(path.join(__dirname, '../public', 'index.html'));
}

app.whenReady().then(createWindow);
