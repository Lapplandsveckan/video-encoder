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
const errorBanner = document.getElementById('errorBanner')!;
const errorMessage = errorBanner.querySelector('.error-message') as HTMLSpanElement;
const errorClose = errorBanner.querySelector('.error-close') as HTMLButtonElement;

errorClose.addEventListener('click', () => {
    errorBanner.hidden = true;
});

function showError(message: string) {
    errorMessage.textContent = message;
    errorBanner.hidden = false;
}

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
});

async function openPicker() {
    const filePaths = await window.electron.pickFiles();
    if (!filePaths.length) return;
    handleFiles(filePaths);
}

dropZone.addEventListener('click', openPicker);
dropZone.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        openPicker();
    }
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

function formatDuration(ms: number): string {
    return new Date(ms).toISOString().slice(11, 19);
}

window.electron.on('encode-queued', (event: any, data: { file: string }) => {
    const li = fileToElement.get(data.file);
    if (!li) return;
    const label = li.querySelector('.label') as HTMLSpanElement;
    label.textContent = `⏳ Queued: ${basename(data.file)}`;
    li.classList.add('queued');
});

window.electron.on('encode-started', (event: any, data: { file: string }) => {
    const li = fileToElement.get(data.file);
    if (!li) return;
    const label = li.querySelector('.label') as HTMLSpanElement;
    label.textContent = `⚙️ Encoding: ${basename(data.file)}`;
    li.classList.remove('queued');
});

window.electron.on('encode-progress', (event: any, data: { file: string; progress: number; time: number }) => {
    const li = fileToElement.get(data.file);
    if (!li) return;

    const progressSpan = li.querySelector('.progress') as HTMLSpanElement;
    const timeSpan = li.querySelector('.time') as HTMLSpanElement;

    progressSpan.textContent = `${Math.floor(data.progress) || 0}%`;
    timeSpan.textContent = formatDuration(data.time);
});

window.electron.on('encode-done', (event: any, data: { file: string; output: string; time: number }) => {
    const li = fileToElement.get(data.file);
    if (!li) return;

    li.classList.add('done');
    li.textContent = `✅ Done: ${basename(data.output)} (${formatDuration(data.time)})`;

    fileToElement.delete(data.file);
});

window.electron.on('encode-error', (event: any, data: { file: string; message: string }) => {
    const li = fileToElement.get(data.file);
    if (!li) return;

    li.classList.add('error');
    li.textContent = `⚠️ Failed: ${basename(data.file)}`;
    li.title = data.message;

    fileToElement.delete(data.file);
});

window.electron.on('encode-skipped', (event: any, data: { file: string; version: number; currentVersion: number }) => {
    const li = fileToElement.get(data.file);
    if (!li) return;

    li.classList.add('skipped');
    const name = basename(data.file);
    if (data.version === data.currentVersion) {
        li.textContent = `✓ Already encoded (v${data.version}): ${name}`;
    } else {
        li.textContent = `ℹ️ Already encoded (v${data.version}, current v${data.currentVersion}): ${name}`;
    }

    fileToElement.delete(data.file);
});

window.electron.on('encode-cancelled', (event: any, filePath: string) => {
    const li = fileToElement.get(filePath);
    if (!li) return;

    li.classList.add('cancelled');
    li.textContent = `❌ Cancelled: ${basename(filePath)}`;
    fileToElement.delete(filePath);
});

window.electron.on('app-error', (event: any, error: { message: string; stack?: string }) => {
    console.error(`[App Error] ${error.message}`);
    if (error.stack) console.error(error.stack);
    showError(error.message);
});

function basename(filePath: string): string {
    return filePath.split(/[\\/]/).pop() || filePath;
}

function flashExisting(li: HTMLLIElement) {
    li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    li.classList.remove('flash');
    void li.offsetWidth; // restart animation
    li.classList.add('flash');
}

function handleFiles(files: string[]) {
    for (const filePath of files) {
        const name = basename(filePath);
        if (!name.match(/\.(mp4|mov|mkv)$/i)) continue;

        const existing = fileToElement.get(filePath);
        if (existing) {
            flashExisting(existing);
            continue;
        }

        const li = document.createElement('li');

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = `⏳ Queued: ${name}`;
        li.appendChild(label);

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

const concurrencySelect = document.getElementById('concurrencySelect') as HTMLSelectElement;
concurrencySelect.addEventListener('change', () => {
    const n = parseInt(concurrencySelect.value, 10);
    window.electron.send('set-concurrency', n);
});
