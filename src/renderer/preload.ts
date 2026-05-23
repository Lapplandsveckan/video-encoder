import { contextBridge, ipcRenderer, webUtils, IpcRendererEvent } from 'electron';

type Listener = (event: IpcRendererEvent, ...args: any[]) => void;

contextBridge.exposeInMainWorld('electron', {
    send: (channel: string, data?: unknown) => ipcRenderer.send(channel, data),
    on: (channel: string, func: Listener) =>
        ipcRenderer.on(channel, (event, ...args) => func(event, ...args)),
    off: (channel: string, func: Listener) => ipcRenderer.removeListener(channel, func),

    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    pickFiles: async () => ipcRenderer.invoke('pick-files'),
    listServers: async () => ipcRenderer.invoke('list-servers'),
});
