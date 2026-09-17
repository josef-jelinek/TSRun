// On the main board the tied AY outputs enter the audio amplifier through R48
// (47 kOhm), while SCLD SPKR/TAPE OUT enters through R49 (100 kOhm). Preserve that
// conductance ratio and normalize the documented worst case to leave headroom.
const ayInputOhms = 47000;
const ulaInputOhms = 100000;
const ayPathRatio = ulaInputOhms / ayInputOhms;
const ulaPathGain = 0.95 / (1.5 * ayPathRatio + 1.25);
const ayPathGain = ulaPathGain * ayPathRatio;

// The speaker and the TV audio input are both AC coupled, while the levels
// arriving here are the unipolar 0..1 the chips put out. One pole at 20 Hz
// takes the offset off without touching the audible band, so a queue seam or a
// channel falling silent no longer steps the output by its own DC.
const dcBlockHz = 20;
const dcBlockPole = 1 - 2 * Math.PI * dcBlockHz / sampleRate;

/**
 * One chunk of interleaved ULA, A, B and C samples. The buffer is pooled and
 * can be longer than the audio in it, so length is carried rather than derived.
 *
 * @typedef {{
 *   samples: Float32Array,
 *   length: number,
 * }} WorkletChunk
 */

/**
 * @typedef {{type: "reset"}
 *     | {type: "queue-samples", low: number, cap: number}
 *     | {type: "pan", near: number, center: number, far: number}
 *     | ({type: "data"} & WorkletChunk)
 * } WorkletMessage
 */

/**
 * @typedef {{
 *   chunks: WorkletChunk[],
 *   head: number,
 *   offset: number,
 *   waiting: boolean,
 *   waitSamples: number,
 *   receivedSamples: number,
 *   panNear: number,
 *   panCenter: number,
 *   panFar: number,
 *   ayGain: number,
 *   ulaGain: number,
 *   lowSamples: number,
 *   capSamples: number,
 *   cutSamples: number,
 *   gapSamples: number,
 *   statsSamples: number,
 *   lastL: number,
 *   lastR: number,
 *   transitionFromL: number,
 *   transitionFromR: number,
 *   transitionFrames: number,
 *   fadeInPending: boolean,
 *   dcInL: number,
 *   dcOutL: number,
 *   dcInR: number,
 *   dcOutR: number,
 *   port: MessagePort,
 *   process: function(Float32Array[][], Float32Array[][]): boolean,
 * }} WorkletProc
 */

/** @returns {WorkletProc} */
function TSRunProcessor() {
    const p = /** @type {WorkletProc} */ (Reflect.construct(AudioWorkletProcessor, [], TSRunProcessor));
    p.chunks = [];
    p.head = 0;
    p.offset = 0;
    p.waiting = false;
    p.waitSamples = 0;
    p.receivedSamples = 0;
    // Hardware mono, until a "pan" message spreads the channels out.
    p.panNear = 0.5;
    p.panCenter = 0.5;
    p.panFar = 0.5;
    p.ayGain = ayPathGain;
    p.ulaGain = ulaPathGain;
    // Both replaced by "queue-samples"; sound.js owns the depth policy.
    p.lowSamples = 2 * 44100 / (3528000 / 58688);
    p.capSamples = 2 * p.lowSamples;
    p.cutSamples = 0;
    p.gapSamples = 0;
    p.statsSamples = 0;
    p.lastL = 0;
    p.lastR = 0;
    p.transitionFromL = 0;
    p.transitionFromR = 0;
    p.transitionFrames = 0;
    p.fadeInPending = true;
    p.dcInL = 0;
    p.dcOutL = 0;
    p.dcInR = 0;
    p.dcOutR = 0;

    p.port.onmessage = function (e) {
        if (e.data !== null && e.data !== undefined) {
            handleMessage(p, e.data);
        }
    };

    p.process = function (inputs, outputs) {
        process(p, outputs[0]);
        return true;
    };

    return p;
}
TSRunProcessor.prototype = Object.create(AudioWorkletProcessor.prototype);
TSRunProcessor.prototype.constructor = TSRunProcessor;

registerProcessor("tsrun-out", TSRunProcessor);

/**
 * @param {WorkletProc} p
 * @param {WorkletMessage} data
 */
function handleMessage(p, data) {
    switch (data.type) {
    case "reset":
        releaseChunks(p, p.chunks.length);
        p.chunks = [];
        p.head = 0;
        p.offset = 0;
        p.waiting = false;
        beginTransition(p);
        p.fadeInPending = true;
        return;
    case "queue-samples":
        if (data.low > 0 && data.cap >= data.low) {
            p.lowSamples = data.low;
            p.capSamples = data.cap;
        }
        return;
    case "pan":
        if (Number.isFinite(data.near) && Number.isFinite(data.center) && Number.isFinite(data.far)) {
            beginTransition(p);
            p.panNear = data.near;
            p.panCenter = data.center;
            p.panFar = data.far;
        }
        return;
    case "data":
        p.receivedSamples += data.length;
        p.chunks.push({samples: data.samples, length: data.length});
        trimOldAudio(p);
        p.waiting = false;
        request(p, 128);
        return;
    }
}

/**
 * @param {WorkletProc} p
 * @param {Float32Array[]} output
 */
function process(p, output) {
    const ol = output[0];
    const or = output[1];
    const n = ol.length;
    let i = 0;
    while (i < n) {
        if (p.head >= p.chunks.length) {
            if (!p.fadeInPending) {
                beginTransition(p);
                p.fadeInPending = true;
            }
            fillSilence(p, ol, or, i, n);
            p.gapSamples += n - i;
            break;
        }
        const chunk = p.chunks[p.head];
        const chunkLength = chunk.length;
        const take = Math.min(n - i, chunkLength - p.offset);
        if (take <= 0) {
            p.head += 1;
            p.offset = 0;
            continue;
        }
        if (p.fadeInPending) {
            beginTransition(p);
            p.fadeInPending = false;
        }
        for (let j = 0; j < take; j += 1) {
            const source = p.offset + j;
            const at = source * 4;
            const ula = chunk.samples[at] * p.ulaGain;
            const levelL = chunk.samples[at + 1];
            const levelM = chunk.samples[at + 2];
            const levelR = chunk.samples[at + 3];
            const left = levelL * p.panNear + levelM * p.panCenter + levelR * p.panFar;
            const sampleL = left * p.ayGain + ula;
            let sampleR = sampleL;
            if (or !== undefined) {
                const right = levelL * p.panFar + levelM * p.panCenter + levelR * p.panNear;
                sampleR = right * p.ayGain + ula;
            }
            writeSample(p, ol, or, i + j, sampleL, sampleR);
        }
        p.offset += take;
        if (p.offset >= chunkLength) {
            p.head += 1;
            p.offset = 0;
            if (p.head >= p.chunks.length) {
                releaseChunks(p, p.chunks.length);
                p.chunks = [];
                p.head = 0;
            } else if (p.head > 8) {
                compact(p);
            }
        }
        i += take;
    }
    p.waitSamples += n;
    p.statsSamples += n;
    if (p.statsSamples >= sampleRate) {
        p.statsSamples = 0;
        p.port.postMessage({type: "stats", cut: p.cutSamples, gap: p.gapSamples});
    }
    request(p, n);
}

/**
 * Say that the queue has fallen below its low mark. One request is outstanding
 * at a time, but a request still unanswered a mark's worth of output later is
 * repeated: the flag otherwise clears only on a "data" or "reset" message, so a
 * producer that decides to send nothing would leave the queue waiting on a
 * request no one answers. Answering twice costs nothing, since the producer
 * works from the level this reports rather than sending a fixed amount. The
 * count of what has arrived goes with it, so a producer that pushed after this
 * was measured can tell that its audio is on the way rather than sending more,
 * and so does the time it was taken, since a busy producer may only read the
 * message some way into the audio it describes.
 *
 * @param {WorkletProc} p
 * @param {number} quantum
 */
function request(p, quantum) {
    const remain = queuedLength(p);
    if (remain >= p.lowSamples) {
        return;
    }
    if (p.waiting && p.waitSamples < p.lowSamples) {
        return;
    }
    p.waiting = true;
    p.waitSamples = 0;
    p.port.postMessage({type: "need", remain, quantum, received: p.receivedSamples, time: currentTime});
}

/** @param {WorkletProc} p */
function queuedLength(p) {
    let remain = 0;
    for (let i = p.head; i < p.chunks.length; i += 1) {
        let len = p.chunks[i].length;
        if (i === p.head) {
            len -= p.offset;
        }
        if (len > 0) {
            remain += len;
        }
    }
    return remain;
}

/** @param {WorkletProc} p */
function trimOldAudio(p) {
    let drop = queuedLength(p) - p.capSamples;
    if (drop <= 0) {
        return;
    }
    beginTransition(p);
    p.cutSamples += drop;
    while (drop > 0 && p.head < p.chunks.length) {
        const chunk = p.chunks[p.head];
        const chunkLength = chunk.length;
        const available = chunkLength - p.offset;
        const take = Math.min(drop, available);
        p.offset += take;
        drop -= take;
        if (p.offset >= chunkLength) {
            p.head += 1;
            p.offset = 0;
        }
    }
    if (p.head >= p.chunks.length) {
        releaseChunks(p, p.chunks.length);
        p.chunks = [];
        p.head = 0;
        p.offset = 0;
        return;
    }
    if (p.head > 8) {
        compact(p);
    }
}

/** @param {WorkletProc} p */
function beginTransition(p) {
    p.transitionFromL = p.lastL;
    p.transitionFromR = p.lastR;
    p.transitionFrames = 128;
}

/**
 * Take the offset off the signal, crossfade a discontinuous source change over
 * one normal render quantum, and clip what is left to the output range. Silence
 * goes through here too, so the DC block keeps settling across a gap instead of
 * holding a level to step away from when audio comes back.
 *
 * @param {WorkletProc} p
 * @param {Float32Array} ol
 * @param {Float32Array | undefined} or
 * @param {number} at
 * @param {number} sampleL
 * @param {number} sampleR
 */
function writeSample(p, ol, or, at, sampleL, sampleR) {
    let outL = sampleL - p.dcInL + dcBlockPole * p.dcOutL;
    let outR = sampleR - p.dcInR + dcBlockPole * p.dcOutR;
    p.dcInL = sampleL;
    p.dcOutL = outL;
    p.dcInR = sampleR;
    p.dcOutR = outR;
    if (p.transitionFrames > 0) {
        const mix = (129 - p.transitionFrames) / 128;
        outL = p.transitionFromL + (outL - p.transitionFromL) * mix;
        outR = p.transitionFromR + (outR - p.transitionFromR) * mix;
        p.transitionFrames -= 1;
    }
    outL = Math.min(Math.max(outL, -1), 1);
    outR = Math.min(Math.max(outR, -1), 1);
    ol[at] = outL;
    if (or !== undefined) {
        or[at] = outR;
    }
    p.lastL = outL;
    p.lastR = outR;
}

/** @param {WorkletProc} p */
function compact(p) {
    releaseChunks(p, p.head);
    const remain = p.chunks.length - p.head;
    for (let i = 0; i < remain; i += 1) {
        p.chunks[i] = p.chunks[p.head + i];
    }
    p.chunks.length = remain;
    p.head = 0;
}

/**
 * Hand the buffers of the chunks below `upto` back for refilling. The producer
 * transfers one away per frame, so without this the page allocates a buffer
 * every frame and the audio thread collects it.
 *
 * @param {WorkletProc} p
 * @param {number} upto
 */
function releaseChunks(p, upto) {
    for (let i = 0; i < upto; i += 1) {
        const samples = p.chunks[i].samples;
        p.port.postMessage({type: "spent", samples}, [samples.buffer]);
    }
}

/**
 * @param {WorkletProc} p
 * @param {Float32Array} ol
 * @param {Float32Array | undefined} or
 * @param {number} from
 * @param {number} to
 */
function fillSilence(p, ol, or, from, to) {
    for (let j = from; j < to; j += 1) {
        writeSample(p, ol, or, j, 0, 0);
    }
}
