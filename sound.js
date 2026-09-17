// Output weights for the near, centre and far channel positions. The TS 2068
// sums the three PSG outputs into one analog path, so mono is what the hardware
// does and the spread is only a listening convenience. Both sets total 1.5 per
// output channel, so left plus right is identical either way.
const monoPan = {near: 0.5, center: 0.5, far: 0.5};
const stereoPan = {near: 0.85, center: 0.5, far: 0.15};

// Queue depth, in frames of audio. Below the low mark the audio thread asks for
// more, and the producer answers with whole frames, so the queue runs between
// the mark and one frame above it. One frame is what a single display refresh
// covers and leaves no room for a late refresh, a collection pause or a slow
// message; two absorb that. Asking by level rather than by amount is what keeps
// the machine at the device's pace: a frame is only run once a frame has been
// played, however long the round trip took. Past the cap the oldest audio is
// dropped, which is audible, so the cap sits well clear of the mark.
const queueLowFrames = 2;
const queueCapFrames = 4;
const bufferPoolSize = 8;

/**
 * @typedef {{
 *   frameSampleCount: number,
 *   lowSamples: number,
 *   context: AudioContext,
 *   node: AudioWorkletNode,
 *   queuedSamples: number,
 *   queuedAt: number,
 *   sentSamples: number,
 *   pool: Float32Array[],
 *   stats: SoundStats,
 *   onNeed: (function(): void) | null,
 *   onStateChange: (function(boolean): void) | null,
 * }} Sfx
 */

/**
 * Audio the queue has lost since the page loaded, in milliseconds. `cut` is
 * what an overrun discarded, which means the producer ran ahead of the device;
 * `gap` is what an underrun filled with silence, which means it fell behind.
 * Both stay at zero while the producer keeps pace.
 *
 * @typedef {{
 *   cut: number,
 *   gap: number,
 * }} SoundStats
 */

/**
 * Frames per second is passed in rather than read from the emulator core, so
 * the audio host stays usable without it.
 *
 * @param {number} framesPerSecond
 * @param {function(string | null, Sfx | null): void} onDone
 */
export function initSound(framesPerSecond, onDone) {
    let context = null;
    try {
        context = new AudioContext();
    } catch (ex) {
        console.error("AudioContext fail", ex);
        onDone("No AudioContext available", null);
        return;
    }
    if (context.audioWorklet === undefined) {
        context.close();
        onDone("No AudioWorklet available", null);
        return;
    }

    context.audioWorklet.addModule("sound.worklet.js").then(
        function () {
            const frameSampleCount = Math.round(context.sampleRate / framesPerSecond);
            /** @type {Sfx} */
            const sfx = {
                frameSampleCount,
                lowSamples: frameSampleCount * queueLowFrames,
                context,
                node: new AudioWorkletNode(
                    context,
                    "tsrun-out",
                    {
                        numberOfInputs: 0,
                        numberOfOutputs: 1,
                        outputChannelCount: [2],
                    },
                ),
                queuedSamples: 0,
                queuedAt: performance.now(),
                sentSamples: 0,
                pool: [],
                stats: {cut: 0, gap: 0},
                onNeed: null,
                onStateChange: null,
            };

            sfx.node.port.onmessage = function (e) {
                const data = e.data;
                if (data === null || data === undefined) {
                    return;
                }
                switch (data.type) {
                case "need":
                    if (typeof data.remain === "number") {
                        // Whatever was sent after the audio thread took this
                        // reading is on its way but not in it yet, and whatever
                        // played while the reading waited to be read is gone.
                        const waited = Math.max(context.currentTime - data.time, 0);
                        const queued = data.remain + sfx.sentSamples - data.received - waited * context.sampleRate;
                        sfx.queuedSamples = Math.max(queued, 0);
                        sfx.queuedAt = performance.now();
                        if (sfx.onNeed !== null) {
                            sfx.onNeed();
                        }
                    }
                    return;
                case "spent":
                    if (sfx.pool.length < bufferPoolSize) {
                        sfx.pool.push(data.samples);
                    }
                    return;
                case "stats":
                    sfx.stats.cut = data.cut * 1000 / context.sampleRate;
                    sfx.stats.gap = data.gap * 1000 / context.sampleRate;
                    return;
                }
            };

            sfx.node.connect(context.destination);
            sfx.node.port.postMessage({
                type: "queue-samples",
                low: sfx.lowSamples,
                cap: frameSampleCount * queueCapFrames,
            });
            context.onstatechange = function () {
                resetSound(sfx);
                if (sfx.onStateChange !== null) {
                    sfx.onStateChange(soundIsRunning(sfx));
                }
            };
            onDone(null, sfx);
        },
        function (ex) {
            console.error("AudioWorklet module fail", ex);
            context.close();
            onDone("Failed to load audio worklet", null);
        },
    );
}

/**
 * Whether the queue has fallen below its low mark and wants another frame. The
 * audio thread reports its depth when it asks for more, and elapsed time covers
 * the rest: a turbo burst, or any long task, drains the queue with no chance to
 * say so, and a producer working from the stale figure would hold off refilling
 * exactly when refilling matters. The wall clock is read rather than
 * `context.currentTime`, which only moves between tasks and so reads as frozen
 * from inside the burst that is draining the queue. A suspended context is not
 * playing anything, so nothing drains.
 *
 * @param {Sfx} sfx
 * @returns {boolean}
 */
export function soundWantsFrame(sfx) {
    let played = 0;
    if (soundIsRunning(sfx)) {
        played = (performance.now() - sfx.queuedAt) * sfx.context.sampleRate / 1000;
    }
    return Math.max(sfx.queuedSamples - played, 0) < sfx.lowSamples;
}

/**
 * Live counters, updated about once a second. The record is reused, so read the
 * fields rather than holding on to it.
 *
 * @param {Sfx} sfx
 * @returns {SoundStats}
 */
export function soundStats(sfx) {
    return sfx.stats;
}

/**
 * @param {Sfx} sfx
 * @returns {boolean}
 */
export function soundIsRunning(sfx) {
    return sfx.context.state === "running";
}

/**
 * Run the producer as soon as the audio thread asks for data, without waiting
 * for the next display refresh.
 *
 * @param {Sfx} sfx
 * @param {function(): void} onNeed
 */
export function setSoundNeedCallback(sfx, onNeed) {
    sfx.onNeed = onNeed;
}

/**
 * Keep emulated synthesis aligned with browser audio lifecycle changes.
 *
 * @param {Sfx} sfx
 * @param {function(boolean): void} onStateChange
 */
export function setSoundStateCallback(sfx, onStateChange) {
    sfx.onStateChange = onStateChange;
}

/** @param {Sfx} sfx */
export function resetSound(sfx) {
    sfx.queuedSamples = 0;
    sfx.queuedAt = performance.now();
    sfx.node.port.postMessage({type: "reset"});
}

/** @param {Sfx} sfx */
export function resumeSound(sfx) {
    if (sfx.context.state === "suspended") {
        // The resync belongs to the state change this causes, which lands when
        // the context has actually started rather than a moment before.
        sfx.context.resume();
    }
}

/**
 * Spread the AY channels across the stereo image, or sum them the way the
 * single analog output on the machine does.
 *
 * @param {Sfx} sfx
 * @param {boolean} on
 */
export function setSoundStereo(sfx, on) {
    let pan = monoPan;
    if (on) {
        pan = stereoPan;
    }
    sfx.node.port.postMessage({type: "pan", near: pan.near, center: pan.center, far: pan.far});
}

/**
 * One frame of mixed planes the worklet will interleave, exactly as takeAudio
 * hands it over. Aliased rather than copied so the shape stays checked against
 * its producer. This is a type-only import and pulls in no code.
 *
 * @typedef {import("./machine.js").AudioChunk} AudioChunk
 */

/**
 * @param {Sfx} sfx
 * @param {AudioChunk} chunk
 */
export function pushSound(sfx, chunk) {
    let n = chunk.n;
    // The machine reuses one 8192-sample buffer. A view of it can deserialize
    // with the full backing store, so later frames would replay stale loader
    // audio. Copy a cap of two frames, nothing more.
    const maxN = sfx.frameSampleCount * 2;
    if (n > maxN) {
        n = maxN;
    }
    if (n <= 0) {
        return;
    }
    // Interleave once and transfer ownership to the audio thread. This avoids
    // four structured-clone copies and four more allocations in the worklet.
    // Buffers come back once played, so a steady stream allocates nothing; they
    // are always cut to the cap, which lets any of them hold any frame.
    let samples = sfx.pool.pop();
    if (samples === undefined) {
        samples = new Float32Array(maxN * 4);
    }
    for (let i = 0; i < n; i += 1) {
        const at = i * 4;
        samples[at] = chunk.ula[i];
        samples[at + 1] = chunk.a[i];
        samples[at + 2] = chunk.b[i];
        samples[at + 3] = chunk.c[i];
    }
    sfx.queuedSamples += n;
    sfx.sentSamples += n;
    sfx.node.port.postMessage({type: "data", samples, length: n}, [samples.buffer]);
}
