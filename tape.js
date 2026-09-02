const cpuHz = 3528000;
const pauseT = cpuHz; // 1 s between TAP blocks
const pilotT = 2168;
const sync1T = 667;
const sync2T = 735;
const bit0T = 855;
const bit1T = 1710;
const pilotHeader = 8063;
const pilotData = 3223;

/**
 * One recorded block. A TAP block uses the ROM timings; a TZX block can
 * change any of them, or leave out parts: a pure tone has only a pilot, a
 * pulse sequence has only `pulses`, and a pause has nothing at all.
 * Durations are in T-states.
 * @typedef {{
 *   pulses: number[],
 *   pilotT: number,
 *   pilotPulses: number,
 *   sync1T: number,
 *   sync2T: number,
 *   bit0T: number,
 *   bit1T: number,
 *   data: Uint8Array,
 *   lastBits: number,
 *   pauseT: number,
 *   stop: boolean,
 * }} TapeBlock
 */

/**
 * @typedef {{
 *   blocks: TapeBlock[],
 *   playing: boolean,
 *   waiting: boolean,
 *   level: number,
 *   nextT: number,
 *   block: number,
 *   phase: string,
 *   pulseI: number,
 *   pulseLeft: number,
 *   byteI: number,
 *   bitI: number,
 *   half: number,
 * }} Tape
 */

/**
 * @typedef {{err: string, blocks: null} | {err: null, blocks: TapeBlock[]}} TapeParse
 */

/**
 * A block with the ROM loader timings, as saved by SAVE.
 * @param {Uint8Array} data
 * @param {number} pause
 * @returns {TapeBlock}
 */
export function standardBlock(data, pause) {
    let pilotPulses = pilotData;
    if (data.length > 0 && data[0] < 128) {
        pilotPulses = pilotHeader;
    }
    return {
        pulses: [],
        pilotT: pilotT,
        pilotPulses: pilotPulses,
        sync1T: sync1T,
        sync2T: sync2T,
        bit0T: bit0T,
        bit1T: bit1T,
        data: data,
        lastBits: 8,
        pauseT: pause,
        stop: false,
    };
}

/**
 * A block with nothing to play. With a pause it is silence; with `stop` it
 * parks the tape until `LOAD ""` is waiting again.
 * @param {number} pause
 * @param {boolean} stop
 * @returns {TapeBlock}
 */
export function silentBlock(pause, stop) {
    return {
        pulses: [],
        pilotT: 0,
        pilotPulses: 0,
        sync1T: 0,
        sync2T: 0,
        bit0T: 0,
        bit1T: 0,
        data: new Uint8Array(0),
        lastBits: 8,
        pauseT: pause,
        stop: stop,
    };
}

/**
 * @param {number} ms
 * @returns {number}
 */
export function msToT(ms) {
    return Math.round(ms * cpuHz / 1000);
}

/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {TapeParse}
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
        blocks.push(standardBlock(u8.subarray(i, i + n), pauseT));
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
        pulseI: 0,
        pulseLeft: 0,
        byteI: 0,
        bitI: 0,
        half: 0,
    };
}

/**
 * @param {Tape} tape
 * @param {TapeBlock[]} blocks
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
    tape.pulseI = 0;
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
    while (tstates >= tape.nextT && tape.playing && !tape.waiting) {
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
    const block = tape.blocks[tape.block];
    switch (tape.phase) {
    case "pause":
        enterPhase(tape, "pulses");
        break;
    case "pulses":
        tape.pulseI += 1;
        if (tape.pulseI === block.pulses.length) {
            enterPhase(tape, "pilot");
        } else {
            flip(tape, block.pulses[tape.pulseI]);
        }
        break;
    case "pilot":
        tape.pulseLeft -= 1;
        if (tape.pulseLeft === 0) {
            enterPhase(tape, "sync1");
        } else {
            flip(tape, block.pilotT);
        }
        break;
    case "sync1":
        enterPhase(tape, "sync2");
        break;
    case "sync2":
        enterPhase(tape, "data");
        break;
    default:
        advanceData(tape);
        break;
    }
}

/**
 * Begin the given part of the current block, or the next part that the block
 * actually has. A block with nothing left to play ends here.
 * @param {Tape} tape
 * @param {string} phase
 */
function enterPhase(tape, phase) {
    const block = tape.blocks[tape.block];
    if (phase === "pulses") {
        if (block.pulses.length > 0) {
            tape.phase = "pulses";
            tape.pulseI = 0;
            flip(tape, block.pulses[0]);
            return;
        }
        phase = "pilot";
    }
    if (phase === "pilot") {
        if (block.pilotPulses > 0) {
            tape.phase = "pilot";
            tape.pulseLeft = block.pilotPulses;
            flip(tape, block.pilotT);
            return;
        }
        phase = "sync1";
    }
    if (phase === "sync1") {
        if (block.sync1T > 0) {
            tape.phase = "sync1";
            flip(tape, block.sync1T);
            return;
        }
        phase = "sync2";
    }
    if (phase === "sync2") {
        if (block.sync2T > 0) {
            tape.phase = "sync2";
            flip(tape, block.sync2T);
            return;
        }
        phase = "data";
    }
    if (block.data.length > 0) {
        tape.phase = "data";
        tape.byteI = 0;
        tape.bitI = 0;
        tape.half = 0;
        flip(tape, bitDuration(tape));
        return;
    }
    finishBlock(tape);
}

/** @param {Tape} tape */
function advanceData(tape) {
    const block = tape.blocks[tape.block];
    if (tape.half === 0) {
        tape.half = 1;
        flip(tape, bitDuration(tape));
        return;
    }
    tape.half = 0;
    tape.bitI += 1;
    let bitsInByte = 8;
    if (tape.byteI === block.data.length - 1) {
        bitsInByte = block.lastBits;
    }
    if (tape.bitI >= bitsInByte) {
        tape.bitI = 0;
        tape.byteI += 1;
        if (tape.byteI === block.data.length) {
            finishBlock(tape);
            return;
        }
    }
    flip(tape, bitDuration(tape));
}

/** @param {Tape} tape */
function finishBlock(tape) {
    const block = tape.blocks[tape.block];
    tape.level = 1;
    tape.block += 1;
    tape.phase = "pause";
    if (tape.block >= tape.blocks.length) {
        tape.playing = false;
        return;
    }
    // At least one T-state, so the level change of this edge is applied
    // before the next block flips it again.
    tape.nextT += Math.max(block.pauseT, 1);
    if (block.stop) {
        // Wait for the next LOAD "" before continuing, as with a stop-the-tape
        // pause in a multi-load program.
        tape.waiting = true;
    }
}

/**
 * @param {Tape} tape
 * @returns {number}
 */
function bitDuration(tape) {
    const block = tape.blocks[tape.block];
    const byte = block.data[tape.byteI];
    if (((byte >> (7 - tape.bitI)) & 1) === 1) {
        return block.bit1T;
    }
    return block.bit0T;
}

/**
 * @param {Tape} tape
 * @param {number} dur
 */
function flip(tape, dur) {
    tape.level = 1 - tape.level;
    tape.nextT += dur;
}
