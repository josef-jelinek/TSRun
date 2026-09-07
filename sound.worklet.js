/**
 * @typedef {{
 *   ula: Float32Array,
 *   channelA: Float32Array,
 *   channelB: Float32Array,
 *   channelC: Float32Array,
 * }} WorkletChunk
 */

/**
 * @typedef {{type: "reset"}
 *     | {type: "frame-samples", value: number}
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
 *   panNear: number,
 *   panCenter: number,
 *   panFar: number,
 *   masterGain: number,
 *   ulaGain: number,
 *   frameSamples: number,
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
    // Hardware mono, until a "pan" message spreads the channels out.
    p.panNear = 0.5;
    p.panCenter = 0.5;
    p.panFar = 0.5;
    p.masterGain = 24000 / 32768;
    p.ulaGain = 0.20;
    p.frameSamples = 44100 / (3528000 / 58688); // replaced by "frame-samples"

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
        p.chunks = [];
        p.head = 0;
        p.offset = 0;
        p.waiting = false;
        return;
    case "frame-samples":
        if (data.value > 0) {
            p.frameSamples = data.value;
        }
        return;
    case "pan":
        if (Number.isFinite(data.near) && Number.isFinite(data.center) && Number.isFinite(data.far)) {
            p.panNear = data.near;
            p.panCenter = data.center;
            p.panFar = data.far;
        }
        return;
    case "data":
        p.chunks.push({
            ula: new Float32Array(data.ula),
            channelA: new Float32Array(data.channelA),
            channelB: new Float32Array(data.channelB),
            channelC: new Float32Array(data.channelC),
        });
        dropOldAudio(p);
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
            fillZero(ol, or, i, n);
            request(p, n);
            return;
        }
        const chunk = p.chunks[p.head];
        const take = Math.min(n - i, chunk.channelA.length - p.offset);
        if (take <= 0) {
            p.head += 1;
            p.offset = 0;
            continue;
        }
        for (let j = 0; j < take; j += 1) {
            const source = p.offset + j;
            const levelL = chunk.channelA[source];
            const levelM = chunk.channelB[source];
            const levelR = chunk.channelC[source];
            const ula = chunk.ula[source] * p.ulaGain;
            const left = levelL * p.panNear + levelM * p.panCenter + levelR * p.panFar;
            const sampleL = Math.min(Math.max(left * p.masterGain + ula, -1), 1);
            ol[i + j] = sampleL;
            if (or !== undefined) {
                const right = levelL * p.panFar + levelM * p.panCenter + levelR * p.panNear;
                or[i + j] = Math.min(Math.max(right * p.masterGain + ula, -1), 1);
            }
        }
        p.offset += take;
        if (p.offset >= chunk.channelA.length) {
            p.head += 1;
            p.offset = 0;
            if (p.head >= p.chunks.length) {
                p.chunks = [];
                p.head = 0;
            } else if (p.head > 8) {
                compact(p);
            }
        }
        i += take;
    }
    request(p, n);
}

/**
 * @param {WorkletProc} p
 * @param {number} quantum
 */
function request(p, quantum) {
    const remain = queuedLength(p);
    if (!p.waiting && remain < p.frameSamples) {
        p.waiting = true;
        p.port.postMessage({type: "need", remain, quantum});
    }
}

/** @param {WorkletProc} p */
function queuedLength(p) {
    let remain = 0;
    for (let i = p.head; i < p.chunks.length; i += 1) {
        let len = p.chunks[i].channelA.length;
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
function dropOldAudio(p) {
    const cap = p.frameSamples * 2;
    while (p.head < p.chunks.length - 1 && queuedLength(p) > cap) {
        p.head += 1;
        p.offset = 0;
    }
    if (p.head >= p.chunks.length) {
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
function compact(p) {
    const remain = p.chunks.length - p.head;
    for (let i = 0; i < remain; i += 1) {
        p.chunks[i] = p.chunks[p.head + i];
    }
    p.chunks.length = remain;
    p.head = 0;
}

/**
 * @param {Float32Array} ol
 * @param {Float32Array | undefined} or
 * @param {number} from
 * @param {number} to
 */
function fillZero(ol, or, from, to) {
    for (let j = from; j < to; j += 1) {
        ol[j] = 0;
    }
    if (or !== undefined) {
        for (let j = from; j < to; j += 1) {
            or[j] = 0;
        }
    }
}
