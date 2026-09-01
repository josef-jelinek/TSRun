const pauseT = 3528000;
const pilotT = 2168;
const sync1T = 667;
const sync2T = 735;
const bit0T = 855;
const bit1T = 1710;
const pilotHeader = 8063;
const pilotData = 3223;

/**
 * @typedef {{
 *   blocks: Uint8Array[],
 *   playing: boolean,
 *   waiting: boolean,
 *   level: number,
 *   nextT: number,
 *   block: number,
 *   phase: string,
 *   pulseLeft: number,
 *   byteI: number,
 *   bitI: number,
 *   half: number,
 * }} Tape
 */

/**
 * @typedef {{err: string, blocks: null} | {err: null, blocks: Uint8Array[]}} TapParse
 */

/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {TapParse}
 */
export function parseTap(bytes) {
    const u8 = new Uint8Array(bytes);
    const blocks = [];
    let i = 0;
    while (i < u8.length) {
        if (i + 2 > u8.length) {
            return {err: "Truncated TAP length.", blocks: null};
        }
        const n = u8[i] | (u8[i + 1] << 8);
        i += 2;
        if (n === 0) {
            return {err: "Empty TAP block.", blocks: null};
        }
        if (i + n > u8.length) {
            return {err: "Truncated TAP block.", blocks: null};
        }
        blocks.push(u8.subarray(i, i + n));
        i += n;
    }
    if (blocks.length === 0) {
        return {err: "TAP has no blocks.", blocks: null};
    }
    return {err: null, blocks: blocks};
}

/** @returns {Tape} */
export function createTape() {
    return {
        blocks: [],
        playing: false,
        waiting: false,
        level: 1,
        nextT: 0,
        block: 0,
        phase: "pause",
        pulseLeft: 0,
        byteI: 0,
        bitI: 0,
        half: 0,
    };
}

/**
 * @param {Tape} tape
 * @param {Uint8Array[]} blocks
 * @param {number} tstates
 */
export function insertTape(tape, blocks, tstates) {
    tape.blocks = blocks;
    tape.playing = true;
    tape.waiting = true;
    tape.level = 1;
    tape.nextT = tstates;
    tape.block = 0;
    tape.phase = "pause";
    tape.pulseLeft = 0;
    tape.byteI = 0;
    tape.bitI = 0;
    tape.half = 0;
}

/**
 * Start the leader once the ROM loader is sampling EAR.
 * @param {Tape} tape
 * @param {number} tstates
 */
export function armTape(tape, tstates) {
    if (!tape.waiting) {
        return;
    }
    tape.waiting = false;
    tape.nextT = tstates;
}

/**
 * @param {Tape} tape
 * @param {number} tstates
 * @param {function(number, number): void} onEdge
 * @returns {number}
 */
export function earLevel(tape, tstates, onEdge) {
    if (!tape.playing) {
        return 1;
    }
    if (tape.waiting) {
        return tape.level;
    }
    while (tstates >= tape.nextT && tape.playing) {
        const tEdge = tape.nextT;
        advanceEdge(tape);
        onEdge(tEdge, tape.level);
    }
    if (!tape.playing) {
        return 1;
    }
    return tape.level;
}

/** @param {Tape} tape */
function advanceEdge(tape) {
    switch (tape.phase) {
    case "pause":
        startPilot(tape);
        break;
    case "pilot":
        tape.pulseLeft -= 1;
        if (tape.pulseLeft === 0) {
            tape.phase = "sync1";
            flip(tape, sync1T);
        } else {
            flip(tape, pilotT);
        }
        break;
    case "sync1":
        tape.phase = "sync2";
        flip(tape, sync2T);
        break;
    case "sync2":
        tape.phase = "data";
        tape.byteI = 0;
        tape.bitI = 0;
        tape.half = 0;
        flip(tape, bitDuration(tape));
        break;
    default:
        advanceData(tape);
        break;
    }
}

/** @param {Tape} tape */
function startPilot(tape) {
    tape.phase = "pilot";
    if (tape.blocks[tape.block][0] === 0) {
        tape.pulseLeft = pilotHeader;
    } else {
        tape.pulseLeft = pilotData;
    }
    flip(tape, pilotT);
}

/** @param {Tape} tape */
function advanceData(tape) {
    if (tape.half === 0) {
        tape.half = 1;
        flip(tape, bitDuration(tape));
        return;
    }
    tape.half = 0;
    tape.bitI += 1;
    if (tape.bitI === 8) {
        tape.bitI = 0;
        tape.byteI += 1;
        if (tape.byteI === tape.blocks[tape.block].length) {
            finishBlock(tape);
            return;
        }
    }
    flip(tape, bitDuration(tape));
}

/** @param {Tape} tape */
function finishBlock(tape) {
    tape.level = 1;
    tape.block += 1;
    if (tape.block >= tape.blocks.length) {
        tape.playing = false;
        return;
    }
    tape.phase = "pause";
    tape.nextT += pauseT;
}

/**
 * @param {Tape} tape
 * @returns {number}
 */
function bitDuration(tape) {
    const byte = tape.blocks[tape.block][tape.byteI];
    if (((byte >> (7 - tape.bitI)) & 1) === 1) {
        return bit1T;
    }
    return bit0T;
}

/**
 * @param {Tape} tape
 * @param {number} dur
 */
function flip(tape, dur) {
    tape.level = 1 - tape.level;
    tape.nextT += dur;
}
