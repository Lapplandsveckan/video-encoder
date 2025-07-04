export {};

declare global {
    interface Window {
        electron: {
            send: (channel: string, ...args: any[]) => void;
            on: (channel: string, listener: (...args: any[]) => void) => void;
            off: (channel: string, listener: (...args: any[]) => void) => void;
            getPathForFile: (file: File) => string;
            pickFiles: () => Promise<string[]>;
        };
    }
}

const dropZone = document.getElementById('dropZone')!;
const videoList = document.getElementById('videoList')!;

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('click', async () => {
    const filePaths = await window.electron.pickFiles();
    if (!filePaths.length) return;

    handleFiles(filePaths);
});

const fileToElement = new Map<string, HTMLLIElement>();

dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');

    if (!e.dataTransfer || !e.dataTransfer.files) return;

    const files = Array.from(e.dataTransfer.files);
    const filePaths = files.map(file => window.electron.getPathForFile(file));
    if (!filePaths.length) return;

    handleFiles(filePaths);
});

window.electron.on('encode-progress', (event: any, data: { file: string; progress: number; time: number }) => {
    const li = fileToElement.get(data.file);
    if (!li) return;

    const progressSpan = li.querySelector('.progress') as HTMLSpanElement;
    const timeSpan = li.querySelector('.time') as HTMLSpanElement;

    progressSpan.textContent = `${Math.floor(data.progress) || 0}%`;
    timeSpan.textContent = new Date(data.time).toISOString().substr(11, 8);
});

window.electron.on('encode-done', (event: any, data: { file: string; output: string; time: number }) => {
    const li = fileToElement.get(data.file);
    if (!li) return;

    const progressSpan = li.querySelector('.progress') as HTMLSpanElement;
    const timeSpan = li.querySelector('.time') as HTMLSpanElement;

    progressSpan.textContent = '100%';
    timeSpan.textContent = new Date(data.time).toISOString().substr(11, 8);
    li.textContent = `✅ Done: ${basename(data.output)}`;

    fileToElement.delete(data.file);
});

window.electron.on('encode-cancelled', (event: any, filePath: string) => {
    const li = fileToElement.get(filePath);
    if (!li) return;

    li.innerHTML = ''; // Clear existing content
    li.textContent = `❌ Cancelled: ${basename(filePath)}`;
    fileToElement.delete(filePath);
});

function basename(filePath: string): string {
    return filePath.split('/').pop() || filePath;
}

function handleFiles(files: string[]) {
    for (const filePath of files) {
        const name = basename(filePath);
        if (!name.match(/\.(mp4|mov|mkv)$/i)) continue;

        const li = document.createElement('li');
        li.textContent = `⚙️ Encoding ${name}`;

        const dataDiv = document.createElement('div');
        li.appendChild(dataDiv);

        const progressSpan = document.createElement('span');
        progressSpan.className = 'progress';
        progressSpan.textContent = '0%';
        dataDiv.appendChild(progressSpan);

        const timeSpan = document.createElement('span');
        timeSpan.className = 'time';
        timeSpan.textContent = '00:00:00';
        dataDiv.appendChild(timeSpan);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => {
            window.electron.send('cancel-encode', filePath);
            cancelBtn.disabled = true;
            cancelBtn.textContent = 'Cancelling...';
        };

        dataDiv.appendChild(cancelBtn);
        videoList.appendChild(li);

        fileToElement.set(filePath, li);
        window.electron.send('encode-video', filePath);
    }
}
