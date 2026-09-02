import {standardBlock, silentBlock, msToT} from "./tape.js";

// TZX 1.20: https://worldofspectrum.net/features/TZXformat.html
// Data and timing blocks become tape blocks. Loops, jumps and call sequences
// are unrolled. Text, hardware and other information blocks are skipped.
// CSW (0x18) and generalized data (0x19) blocks are not supported.

const headerSize = 10;
const maxSteps = 100000;

/**
 * @typedef {{
 *   kind: string,
 *   block: import("./tape.js").TapeBlock | null,
 *   value: number,
 *   offsets: number[],
 * }} TzxEntry
 */

/**
 * @typedef {{err: string, entries: null, next: number} | {err: null, entries: TzxEntry[], next: number}} TzxRead
 */

/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {boolean}
 */
export function isTzx(bytes) {
    const u8 = new Uint8Array(bytes);
    if (u8.length < headerSize) {
        return false;
    }
    const magic = "ZXTape!";
    for (let i = 0; i < magic.length; i += 1) {
        if (u8[i] !== magic.charCodeAt(i)) {
            return false;
        }
    }
    return u8[7] === 0x1A;
}

/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {import("./tape.js").TapeParse}
 */
export function parseTzx(bytes) {
    const u8 = new Uint8Array(bytes);
    if (!isTzx(u8)) {
        return {err: "Not a TZX file.", blocks: null};
    }
    /** @type {TzxEntry[]} */
    const entries = [];
    let i = headerSize;
    while (i < u8.length) {
        const id = u8[i];
        const read = readBlock(u8, i + 1, id);
        if (read.err !== null) {
            return {err: read.err, blocks: null};
        }
        for (let e = 0; e < read.entries.length; e += 1) {
            entries.push(read.entries[e]);
        }
        i = read.next;
    }
    return unroll(entries);
}

/**
 * @param {Uint8Array} u8
 * @param {number} i
 * @param {number} n
 * @returns {boolean}
 */
function has(u8, i, n) {
    return i + n <= u8.length;
}

/**
 * @param {Uint8Array} u8
 * @param {number} i
 * @returns {number}
 */
function u16(u8, i) {
    return u8[i] | (u8[i + 1] << 8);
}

/**
 * @param {Uint8Array} u8
 * @param {number} i
 * @returns {number}
 */
function i16(u8, i) {
    const v = u16(u8, i);
    if (v >= 0x8000) {
        return v - 0x10000;
    }
    return v;
}

/**
 * @param {Uint8Array} u8
 * @param {number} i
 * @returns {number}
 */
function u24(u8, i) {
    return u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16);
}

/**
 * @param {Uint8Array} u8
 * @param {number} i
 * @returns {number}
 */
function u32(u8, i) {
    return (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16)) + u8[i + 3] * 0x1000000;
}

/**
 * @param {import("./tape.js").TapeBlock} block
 * @returns {TzxEntry}
 */
function play(block) {
    return {kind: "play", block: block, value: 0, offsets: []};
}

/**
 * @param {string} kind
 * @param {number} value
 * @returns {TzxEntry}
 */
function control(kind, value) {
    return {kind: kind, block: null, value: value, offsets: []};
}

/**
 * @param {number} id
 * @returns {string}
 */
function hex(id) {
    return "0x" + id.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * @param {number} id
 * @returns {TzxRead}
 */
function truncated(id) {
    return {err: "Truncated TZX block " + hex(id) + ".", entries: null, next: 0};
}

/**
 * Read one block starting after its ID byte.
 * @param {Uint8Array} u8
 * @param {number} i
 * @param {number} id
 * @returns {TzxRead}
 */
function readBlock(u8, i, id) {
    /** @type {TzxEntry[]} */
    const entries = [];
    let next = i;
    switch (id) {
    case 0x10: {
        if (!has(u8, i, 4)) {
            return truncated(id);
        }
        const pause = u16(u8, i);
        const len = u16(u8, i + 2);
        next = i + 4 + len;
        if (!has(u8, i + 4, len)) {
            return truncated(id);
        }
        entries.push(play(standardBlock(u8.subarray(i + 4, next), msToT(pause))));
        break;
    }
    case 0x11: {
        if (!has(u8, i, 18)) {
            return truncated(id);
        }
        const len = u24(u8, i + 15);
        next = i + 18 + len;
        if (!has(u8, i + 18, len)) {
            return truncated(id);
        }
        entries.push(play({
            pulses: [],
            pilotT: u16(u8, i),
            pilotPulses: u16(u8, i + 10),
            sync1T: u16(u8, i + 2),
            sync2T: u16(u8, i + 4),
            bit0T: u16(u8, i + 6),
            bit1T: u16(u8, i + 8),
            data: u8.subarray(i + 18, next),
            lastBits: lastBits(u8[i + 12]),
            pauseT: msToT(u16(u8, i + 13)),
            stop: false,
        }));
        break;
    }
    case 0x12: {
        if (!has(u8, i, 4)) {
            return truncated(id);
        }
        const block = silentBlock(0, false);
        block.pilotT = u16(u8, i);
        block.pilotPulses = u16(u8, i + 2);
        entries.push(play(block));
        next = i + 4;
        break;
    }
    case 0x13: {
        if (!has(u8, i, 1)) {
            return truncated(id);
        }
        const n = u8[i];
        next = i + 1 + 2 * n;
        if (!has(u8, i + 1, 2 * n)) {
            return truncated(id);
        }
        const block = silentBlock(0, false);
        for (let p = 0; p < n; p += 1) {
            block.pulses.push(u16(u8, i + 1 + 2 * p));
        }
        entries.push(play(block));
        break;
    }
    case 0x14: {
        if (!has(u8, i, 10)) {
            return truncated(id);
        }
        const len = u24(u8, i + 7);
        next = i + 10 + len;
        if (!has(u8, i + 10, len)) {
            return truncated(id);
        }
        const block = silentBlock(msToT(u16(u8, i + 5)), false);
        block.bit0T = u16(u8, i);
        block.bit1T = u16(u8, i + 2);
        block.lastBits = lastBits(u8[i + 4]);
        block.data = u8.subarray(i + 10, next);
        entries.push(play(block));
        break;
    }
    case 0x15: {
        if (!has(u8, i, 8)) {
            return truncated(id);
        }
        const len = u24(u8, i + 5);
        next = i + 8 + len;
        if (!has(u8, i + 8, len)) {
            return truncated(id);
        }
        const block = silentBlock(msToT(u16(u8, i + 2)), false);
        block.pulses = samplesToPulses(u8.subarray(i + 8, next), lastBits(u8[i + 4]), u16(u8, i));
        entries.push(play(block));
        break;
    }
    case 0x18:
        return {err: "TZX CSW recording blocks are not supported.", entries: null, next: 0};
    case 0x19:
        return {err: "TZX generalized data blocks are not supported.", entries: null, next: 0};
    case 0x20: {
        if (!has(u8, i, 2)) {
            return truncated(id);
        }
        const pause = u16(u8, i);
        if (pause === 0) {
            entries.push(play(silentBlock(0, true)));
        } else {
            entries.push(play(silentBlock(msToT(pause), false)));
        }
        next = i + 2;
        break;
    }
    case 0x21:
        if (!has(u8, i, 1)) {
            return truncated(id);
        }
        next = i + 1 + u8[i];
        break;
    case 0x22:
        break;
    case 0x23:
        if (!has(u8, i, 2)) {
            return truncated(id);
        }
        entries.push(control("jump", i16(u8, i)));
        next = i + 2;
        break;
    case 0x24:
        if (!has(u8, i, 2)) {
            return truncated(id);
        }
        entries.push(control("loop", u16(u8, i)));
        next = i + 2;
        break;
    case 0x25:
        entries.push(control("endloop", 0));
        break;
    case 0x26: {
        if (!has(u8, i, 2)) {
            return truncated(id);
        }
        const n = u16(u8, i);
        next = i + 2 + 2 * n;
        if (!has(u8, i + 2, 2 * n)) {
            return truncated(id);
        }
        const entry = control("call", 0);
        for (let c = 0; c < n; c += 1) {
            entry.offsets.push(i16(u8, i + 2 + 2 * c));
        }
        entries.push(entry);
        break;
    }
    case 0x27:
        entries.push(control("return", 0));
        break;
    case 0x28:
    case 0x32:
        if (!has(u8, i, 2)) {
            return truncated(id);
        }
        next = i + 2 + u16(u8, i);
        break;
    case 0x30:
        if (!has(u8, i, 1)) {
            return truncated(id);
        }
        next = i + 1 + u8[i];
        break;
    case 0x31:
        if (!has(u8, i, 2)) {
            return truncated(id);
        }
        next = i + 2 + u8[i + 1];
        break;
    case 0x33:
        if (!has(u8, i, 1)) {
            return truncated(id);
        }
        next = i + 1 + 3 * u8[i];
        break;
    case 0x34:
        next = i + 8;
        break;
    case 0x35:
        if (!has(u8, i, 20)) {
            return truncated(id);
        }
        next = i + 20 + u32(u8, i + 16);
        break;
    case 0x40:
        if (!has(u8, i, 4)) {
            return truncated(id);
        }
        next = i + 4 + u24(u8, i + 1);
        break;
    case 0x5A:
        next = i + 9;
        break;
    default:
        // Every block ID not listed in the spec carries a 4-byte length.
        if (!has(u8, i, 4)) {
            return truncated(id);
        }
        next = i + 4 + u32(u8, i);
        break;
    }
    if (next > u8.length) {
        return truncated(id);
    }
    return {err: null, entries: entries, next: next};
}

/**
 * @param {number} n
 * @returns {number}
 */
function lastBits(n) {
    if (n < 1 || n > 8) {
        return 8;
    }
    return n;
}

/**
 * Turn 1-bit samples into pulse lengths: each run of equal bits is one pulse.
 * @param {Uint8Array} samples
 * @param {number} lastBitsUsed
 * @param {number} tPerSample
 * @returns {number[]}
 */
function samplesToPulses(samples, lastBitsUsed, tPerSample) {
    /** @type {number[]} */
    const pulses = [];
    if (samples.length === 0) {
        return pulses;
    }
    const total = (samples.length - 1) * 8 + lastBitsUsed;
    let level = (samples[0] >> 7) & 1;
    let run = 0;
    for (let b = 0; b < total; b += 1) {
        const bit = (samples[b >> 3] >> (7 - (b & 7))) & 1;
        if (bit !== level) {
            pulses.push(run * tPerSample);
            level = bit;
            run = 0;
        }
        run += 1;
    }
    pulses.push(run * tPerSample);
    return pulses;
}

/**
 * Follow loops, jumps and call sequences to get the blocks in play order.
 * @param {TzxEntry[]} entries
 * @returns {import("./tape.js").TapeParse}
 */
function unroll(entries) {
    /** @type {import("./tape.js").TapeBlock[]} */
    const blocks = [];
    /** @type {{pc: number, left: number}[]} */
    const loops = [];
    /** @type {{pc: number, next: number}[]} */
    const calls = [];
    let pc = 0;
    let steps = 0;
    while (pc >= 0 && pc < entries.length) {
        steps += 1;
        if (steps > maxSteps) {
            return {err: "TZX loops or jumps do not end.", blocks: null};
        }
        const e = entries[pc];
        switch (e.kind) {
        case "play":
            if (e.block !== null) {
                blocks.push(e.block);
            }
            pc += 1;
            break;
        case "jump":
            pc += e.value;
            break;
        case "loop":
            loops.push({pc: pc, left: e.value});
            pc += 1;
            break;
        case "endloop": {
            if (loops.length === 0) {
                return {err: "TZX loop end without a loop start.", blocks: null};
            }
            const loop = loops[loops.length - 1];
            loop.left -= 1;
            if (loop.left > 0) {
                pc = loop.pc + 1;
            } else {
                loops.pop();
                pc += 1;
            }
            break;
        }
        case "call":
            if (e.offsets.length === 0) {
                pc += 1;
            } else {
                calls.push({pc: pc, next: 1});
                pc += e.offsets[0];
            }
            break;
        case "return": {
            if (calls.length === 0) {
                return {err: "TZX return without a call sequence.", blocks: null};
            }
            const frame = calls[calls.length - 1];
            const offsets = entries[frame.pc].offsets;
            if (frame.next < offsets.length) {
                pc = frame.pc + offsets[frame.next];
                frame.next += 1;
            } else {
                calls.pop();
                pc = frame.pc + 1;
            }
            break;
        }
        default:
            pc += 1;
            break;
        }
    }
    if (blocks.length === 0) {
        return {err: "TZX has no playable blocks.", blocks: null};
    }
    return {err: null, blocks: blocks};
}
