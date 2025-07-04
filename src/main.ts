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

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
    sendErrorToRenderer(err)
})

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason)
    sendErrorToRenderer(reason instanceof Error ? reason : new Error(String(reason)))
})

function sendErrorToRenderer(error: Error) {
    const allWindows = BrowserWindow.getAllWindows()
    for (const win of allWindows) {
        win.webContents.send('app-error', {
            message: error.message,
            stack: error.stack,
        })
    }
}
