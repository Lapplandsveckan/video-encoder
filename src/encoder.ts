// Functionalities
// - Audio reencoding
// - Low pass filter
// - High pass filter
// - Remove background noise
// - Audio normalization
// - Audio volume adjustment
// - Video reencoding
// - Video cropping

import * as ffmpeg from 'fluent-ffmpeg';

export function encodeVideo(file: string, output: string, onComplete?: () => void) {
    const startTime = Date.now();

    const command = ffmpeg();
    command
        .input(file)
        .videoCodec('libx264')
        // .audioCodec('libmp3lame')
        .size('1920x1080')
        .aspect('16:9')
        .autopad()
        .fps(30)
        .videoBitrate(10000) // 10 Mbps
        // .audioBitrate(128) // 128 kbps
        // .audioChannels(2)
        // .audioFrequency(48000)
        // .audioFilters([
        //     'dynaudnorm',
        // ])
        .outputOptions([
            '-movflags faststart',
            '-preset veryslow',
        ])
        .output(output.replace(/\.\w*$/, '.mp4'))

        .on("end", function() {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const timeElapsed = new Date(duration).toISOString().substr(11, 8);

            console.log("Finished processing (" + output.split('/').pop() + ") in " + timeElapsed);

            if (onComplete) {
                onComplete();
            }
        })
        .on("progress", function(progress) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const timeElapsed = new Date(duration).toISOString().substr(11, 8);

            console.log("Processing video (" + output.split('/').pop() + "): " + Math.floor(progress.percent) + "% done, " + timeElapsed + " elapsed")
        })
        .run();
}
