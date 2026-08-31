/**
 * @typedef {{
 *   frameSampleCount: number,
 *   context: AudioContext,
 *   node: AudioWorkletNode,
 *   queuedSamples: number,
 * }} Sfx
 */

/**
 * @param {number} sampleRate
 * @param {function(string | null, Sfx | null): void} onDone
 */
export function initSound(sampleRate, onDone) {
    let context = null;
    try {
        context = new AudioContext({sampleRate});
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
            const sfx = {
                frameSampleCount: Math.round(context.sampleRate / 60),
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
            };

            sfx.node.port.onmessage = function (e) {
                if (e.data === null || e.data === undefined) {
                    return;
                }
                if (e.data.type === "need" && typeof e.data.remain === "number") {
                    sfx.queuedSamples = e.data.remain;
                }
            };

            sfx.node.connect(context.destination);
            sfx.node.port.postMessage({type: "frame-samples", value: sfx.frameSampleCount});
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
 * @param {Sfx} sfx
 * @returns {boolean}
 */
export function soundQueueReady(sfx) {
    return sfx.queuedSamples >= sfx.frameSampleCount;
}

/**
 * @param {Sfx} sfx
 * @returns {boolean}
 */
export function soundIsRunning(sfx) {
    return sfx.context.state === "running";
}

/** @param {Sfx} sfx */
export function resetSound(sfx) {
    sfx.queuedSamples = 0;
    sfx.node.port.postMessage({type: "reset"});
}

/** @param {Sfx} sfx */
export function resumeSound(sfx) {
    if (sfx.context.state === "suspended") {
        sfx.context.resume();
    }
}

/**
 * @param {Sfx} sfx
 * @param {import("./machine.js").AudioChunk} chunk
 */
export function pushSound(sfx, chunk) {
    sfx.queuedSamples += chunk.n;
    sfx.node.port.postMessage({
        type: "data",
        ula: chunk.ula.subarray(0, chunk.n),
        channelA: chunk.a.subarray(0, chunk.n),
        channelB: chunk.b.subarray(0, chunk.n),
        channelC: chunk.c.subarray(0, chunk.n),
    });
}
