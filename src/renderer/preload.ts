const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, func) => ipcRenderer.on(channel, (_, ...args) => func(_, ...args)),
    off: (channel, func) => ipcRenderer.removeListener(channel, func),

    getPathForFile: (file) => webUtils.getPathForFile(file),
    pickFiles: async () => ipcRenderer.invoke('pick-files'),
});
