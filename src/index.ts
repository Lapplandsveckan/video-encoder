import * as fs from 'fs';
import {encodeVideo} from './encoder';
import {config} from './config';

function encodeVideos() {
    let finished = 0;

    const files = fs.readdirSync(config.input);
    for (const file of files) {
        if (file.startsWith('.')) continue;

        const inputPath = `${config.input}/${file}`;
        const outputPath = `${config.output}/${file.replace(/[^a-z0-9.\-_\s]/gi, '')}`;
        encodeVideo(inputPath, outputPath, () => {
            finished++
            if (finished === files.length) {
                console.log('Finished encoding all videos');
            }
        });
    }
}

encodeVideos();
