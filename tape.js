const cpuHz = 3528000;
const pauseT = cpuHz; // 1 s between TAP blocks
const pausePulseT = cpuHz / 1000;
const pilotT = 2168;
const sync1T = 667;
const sync2T = 735;
const bit0T = 855;
const bit1T = 1710;
const pilotHeader = 8063;
const pilotData = 3223;
const tzxHeaderSize = 10;
const tzxMaxSteps = 100000;
const tzxMaxPulses = 4194304;
const tzxMaxNesting = 64;

// Stands in as the current block until a tape is inserted, so playback never
// has to test for one that is not there.
const silentBlock = emptyBlock(0, false);

/**
 * One recorded block. A TAP block uses the ROM timings; a TZX block can
 * change any of them, leave parts out, or force an absolute signal level.
 * Durations are in T-states.
 *
 * @typedef {{
 *   pulses:      number[],
 *   pilotT:      number,
 *   pilotPulses: number,
 *   sync1T:      number,
 *   sync2T:      number,
 *   bit0T:       number,
 *   bit1T:       number,
 *   data:        Uint8Array,
 *   lastBits:    number,
 *   pauseT:      number,
 *   stop:        boolean,
 *   startLevel:  number | null,
 *   endPulse:    boolean,
 * }} TapeBlock
 */

/**
 * Playback state. The tape is a program of TZX entries rather than a flat list
 * of blocks, so loops and jumps are followed as it plays instead of being
 * unrolled up front, and `block` is the one being played right now. `pulseI`
 * counts the pulses the current phase has emitted, so what it is measured
 * against - a pulse list, a pilot count, a bit count - depends on `phase`.
 *
 * The transport is "empty" with no tape loaded, "ready" when a tape is armed to
 * start on the next loader attempt, "playing" while it advances, "blocked" when
 * a stop block has halted it until the loader lets go, and "done" once a loaded
 * tape has played out. Only "ready" and "blocked" hold a tape that a loader can
 * still start.
 *
 * @typedef {{
 *   entries:    TzxEntry[],
 *   blockCount: number,
 *   state:      "empty" | "ready" | "playing" | "blocked" | "done",
 *   level:      number,
 *   holdLevel:  boolean,
 *   nextT:      number,
 *   pc:         number,
 *   loops:      {pc: number, left: number}[],
 *   calls:      {pc: number, next: number, offsets: number[]}[],
 *   block:      TapeBlock,
 *   phase:      "start" | "pulses" | "pilot" | "sync1" | "sync2" | "data" | "tail" | "pause",
 *   pulseI:     number,
 * }} Tape
 */

/**
 * @typedef {{err: string} | {err: null, entries: TzxEntry[]}} TapeParse
 */

/**
 * One physical TZX block as the program sees it. Every block produces an entry,
 * so relative control-flow offsets keep their specified meaning, and each kind
 * carries only the payload that kind has.
 *
 * A "play" entry carries a waveform. A "command" - a pause, a stop point, a
 * signal level - occupies the timeline without producing one, and is carried as
 * a block so the player reaches it where the file puts it: after the preceding
 * block's pause has elapsed. Executing those while stepping the program instead
 * would apply them a whole pause early.
 *
 * @typedef {{kind: "play", block: TapeBlock} |
 *   {kind: "command", block: TapeBlock} |
 *   {kind: "jump", value: number} |
 *   {kind: "loop", value: number} |
 *   {kind: "endloop"} |
 *   {kind: "call", offsets: number[]} |
 *   {kind: "return"} |
 *   {kind: "skip"}} TzxEntry
 */

/**
 * @typedef {{err: string} |
 *   {err: null, entry: TzxEntry, next: number}} TzxRead
 */

/**
 * @typedef {{startLevel: number | null, pulses: number[]}} SamplePulses
 */

/**
 * Return a tape with a parsed tape program and position it on the first block
 * to play.
 *
 * @param {TzxEntry[] | null} entries
 * @param {number} tstates
 * @returns {Tape}
 */
export function createTape(entries, tstates) {
    /** @type {Tape} */
    const tape = {
        entries:    entries ?? [],
        blockCount: 0,
        state:      "empty",
        level:      0,
        holdLevel:  false,
        nextT:      tstates,
        pc:         0,
        loops:      [],
        calls:      [],
        block:      silentBlock,
        phase:      "start",
        pulseI:     0,
    };
    if (entries !== null && entries.length > 0) {
        tape.state = "ready";
        for (const entry of entries) {
            if (entry.kind === "play") {
                tape.blockCount += 1;
            }
        }
        tape.holdLevel = true;
        if (!runProgram(tape, 0)) {
            tape.state = "done";
        }
    }
    return tape;
}

/**
 * Detect the tape format by its contents and parse it for playback.
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {TapeParse}
 */
export function parseTape(bytes) {
    const u8 = new Uint8Array(bytes);
    if (isTzx(u8)) {
        return parseTzx(u8);
    }
    return parseTap(u8);
}

/**
 * Stop a machine reset's tape where it is and restart the block it was playing.
 * The position is kept, but the ROM loader needs a leader to lock onto, so
 * resuming in the middle of the data would never load. A tape that has played
 * out stays played out.
 *
 * @param {Tape} tape
 */
export function resetTape(tape) {
    if (tape.state === "ready" || tape.state === "playing" || tape.state === "blocked") {
        tape.state = "ready";
    }
    tape.level = 0;
    tape.holdLevel = true;
    tape.phase = "start";
    tape.pulseI = 0;
}

/**
 * Start a tape that is ready for a loader attempt.
 *
 * @param {Tape} tape
 * @param {number} tstates
 */
export function startTape(tape, tstates) {
    if (tape.state !== "ready") {
        return;
    }
    tape.state = "playing";
    tape.nextT = tstates;
}

/**
 * Let a tape stopped between parts wait for another loader attempt.
 *
 * @param {Tape} tape
 */
export function rearmTape(tape) {
    if (tape.state === "blocked") {
        tape.state = "ready";
    }
}

/**
 * Freeze a playing tape without rewinding. Used when the loader has stopped
 * sampling EAR so leftover pulses are not mixed into the running program.
 *
 * @param {Tape} tape
 */
export function stopTape(tape) {
    if (tape.state === "playing") {
        tape.state = "ready";
    }
}

/**
 * @param {Tape} tape
 * @param {number} tstates
 * @param {function(number, number): void} onEdge
 * @returns {number}
 */
export function earLevel(tape, tstates, onEdge) {
    // A tape stopped part way holds what it last drove, so a level asserted by
    // a 0x2B before the stop is still there when the loader looks. One that has
    // not started, or has none, leaves the line at rest: merely inserting a
    // tape must not change what the port reads.
    if (tape.state === "blocked") {
        return tape.level;
    }
    if (tape.state !== "playing") {
        return 1;
    }
    let idle = 0;
    while (tstates >= tape.nextT && tape.state === "playing") {
        const tEdge = tape.nextT;
        advanceEdge(tape);
        onEdge(tEdge, tape.level);
        if (tape.nextT !== tEdge) {
            idle = 0;
        } else {
            // Blocks that take no time are legal in runs, but a loop of them
            // would spin here forever. Every duration the player consumes is
            // checked to be at least one T-state, so anything else is bounded
            // by the elapsed T-states.
            idle += 1;
            if (idle > tzxMaxSteps) {
                tape.state = "done";
            }
        }
    }
    // Only the drain loop above can have ended the tape by here.
    if (tape.state === "done") {
        return 1;
    }
    return tape.level;
}

/**
 * TAP consists of two-byte block lengths followed by ROM-encoded data.
 *
 * @param {Uint8Array} u8
 * @returns {TapeParse}
 */
function parseTap(u8) {
    /** @type {TzxEntry[]} */
    const entries = [];
    let i = 0;
    while (i < u8.length) {
        if (i + 2 > u8.length) {
            return {err: "Truncated TAP length."};
        }
        const n = u16(u8, i);
        i += 2;
        if (n === 0) {
            return {err: "Empty TAP block."};
        }
        if (i + n > u8.length) {
            return {err: "Truncated TAP block."};
        }
        entries.push({kind: "play", block: standardBlock(u8.subarray(i, i + n), pauseT)});
        i += n;
    }
    if (entries.length === 0) {
        return {err: "TAP has no blocks."};
    }
    return {err: null, entries};
}

/**
 * Parse physical TZX blocks, then follow their playback control flow.
 *
 * @param {Uint8Array} u8
 * @returns {TapeParse}
 */
function parseTzx(u8) {
    if (u8.length < tzxHeaderSize) {
        return {err: "Truncated TZX header."};
    }
    if (u8[8] !== 1) {
        return {err: "Unsupported TZX major version " + u8[8] + "."};
    }
    /** @type {TzxEntry[]} */
    const entries = [];
    for (let i = tzxHeaderSize; i < u8.length;) {
        const id = u8[i];
        const read = readTzxBlock(u8, i + 1, id);
        if (read.err !== null) {
            return {err: read.err};
        }
        entries.push(read.entry);
        i = read.next;
    }
    return checkTzxProgram(entries);
}

/**
 * Read one TZX block starting after its ID byte. Every physical block returns
 * one entry so relative control-flow offsets retain their specified meaning.
 *
 * @param {Uint8Array} u8
 * @param {number} i
 * @param {number} id
 * @returns {TzxRead}
 */
function readTzxBlock(u8, i, id) {
    /** @type {TzxEntry} */
    let entry = {kind: "skip"};
    let next = i;
    const truncated = {err: "Truncated TZX block 0x" + id.toString(16).toUpperCase().padStart(2, "0") + "."};
    switch (id) {
    case 0x10: {
        if (i + 4 > u8.length) {
            return truncated;
        }
        const pause = u16(u8, i);
        const len = u16(u8, i + 2);
        next = i + 4 + len;
        if (i + 4 + len > u8.length) {
            return truncated;
        }
        const block = standardBlock(u8.subarray(i + 4, next), 0);
        block.pauseT = Math.round(cpuHz * pause / 1000);
        entry = {kind: "play", block};
        break;
    }
    case 0x11: {
        if (i + 18 > u8.length) {
            return truncated;
        }
        const len = u24(u8, i + 15);
        next = i + 18 + len;
        if (i + 18 + len > u8.length) {
            return truncated;
        }
        const block = emptyBlock(0, false);
        block.pilotT = u16(u8, i);
        block.sync1T = u16(u8, i + 2);
        block.sync2T = u16(u8, i + 4);
        block.bit0T = u16(u8, i + 6);
        block.bit1T = u16(u8, i + 8);
        block.pilotPulses = u16(u8, i + 10);
        block.lastBits = lastBits(u8[i + 12]);
        block.data = u8.subarray(i + 18, next);
        block.endPulse = block.pilotPulses > 0 || block.sync1T > 0 || block.sync2T > 0 || block.data.length > 0;
        block.pauseT = Math.round(cpuHz * u16(u8, i + 13) / 1000);
        entry = {kind: "play", block};
        break;
    }
    case 0x12: {
        if (i + 4 > u8.length) {
            return truncated;
        }
        const block = emptyBlock(0, false);
        block.pilotT = u16(u8, i);
        block.pilotPulses = u16(u8, i + 2);
        block.endPulse = block.pilotPulses > 0;
        entry = {kind: "play", block};
        next = i + 4;
        break;
    }
    case 0x13: {
        if (i + 1 > u8.length) {
            return truncated;
        }
        const n = u8[i];
        next = i + 1 + 2 * n;
        if (i + 1 + 2 * n > u8.length) {
            return truncated;
        }
        const block = emptyBlock(0, false);
        for (let p = 0; p < n; p += 1) {
            block.pulses.push(u16(u8, i + 1 + 2 * p));
        }
        block.endPulse = block.pulses.length > 0;
        entry = {kind: "play", block};
        break;
    }
    case 0x14: {
        if (i + 10 > u8.length) {
            return truncated;
        }
        const len = u24(u8, i + 7);
        next = i + 10 + len;
        if (i + 10 + len > u8.length) {
            return truncated;
        }
        const block = emptyBlock(0, false);
        block.bit0T = u16(u8, i);
        block.bit1T = u16(u8, i + 2);
        block.lastBits = lastBits(u8[i + 4]);
        block.data = u8.subarray(i + 10, next);
        block.endPulse = block.data.length > 0;
        block.pauseT = Math.round(cpuHz * u16(u8, i + 5) / 1000);
        entry = {kind: "play", block};
        break;
    }
    case 0x15: {
        if (i + 8 > u8.length) {
            return truncated;
        }
        const len = u24(u8, i + 5);
        next = i + 8 + len;
        if (i + 8 + len > u8.length) {
            return truncated;
        }
        const block = emptyBlock(0, false);
        const samples = samplesToPulses(
            u8.subarray(i + 8, next),
            lastBits(u8[i + 4]),
            u16(u8, i),
        );
        if (samples === null) {
            return {err: "Invalid TZX direct recording length."};
        }
        block.startLevel = samples.startLevel;
        block.pulses = samples.pulses;
        block.pauseT = Math.round(cpuHz * u16(u8, i + 2) / 1000);
        entry = {kind: "play", block};
        break;
    }
    case 0x18:
        return {err: "TZX CSW recording blocks are not supported."};
    case 0x19:
        return {err: "TZX generalized data blocks are not supported."};
    case 0x20: {
        if (i + 2 > u8.length) {
            return truncated;
        }
        const pause = u16(u8, i);
        entry = {kind: "command", block: emptyBlock(Math.round(cpuHz * pause / 1000), pause === 0)};
        next = i + 2;
        break;
    }
    case 0x21:
        if (i + 1 > u8.length) {
            return truncated;
        }
        next = i + 1 + u8[i];
        break;
    case 0x22:
        break;
    case 0x23:
        if (i + 2 > u8.length) {
            return truncated;
        }
        entry = {kind: "jump", value: i16(u8, i)};
        next = i + 2;
        break;
    case 0x24:
        if (i + 2 > u8.length) {
            return truncated;
        }
        entry = {kind: "loop", value: u16(u8, i)};
        next = i + 2;
        break;
    case 0x25:
        entry = {kind: "endloop"};
        break;
    case 0x26: {
        if (i + 2 > u8.length) {
            return truncated;
        }
        const n = u16(u8, i);
        next = i + 2 + 2 * n;
        if (i + 2 + 2 * n > u8.length) {
            return truncated;
        }
        const offsets = [];
        for (let c = 0; c < n; c += 1) {
            offsets.push(i16(u8, i + 2 + 2 * c));
        }
        entry = {kind: "call", offsets};
        break;
    }
    case 0x27:
        entry = {kind: "return"};
        break;
    case 0x28:
        return {err: "TZX select blocks are not supported."};
    case 0x2A:
        if (i + 4 > u8.length) {
            return truncated;
        }
        // "Stop if in 48K mode", which a TS 2068 always is.
        entry = {kind: "command", block: emptyBlock(0, true)};
        next = i + 4 + u32(u8, i);
        break;
    case 0x2B: {
        if (i + 5 > u8.length) {
            return truncated;
        }
        if (u32(u8, i) !== 1 || u8[i + 4] > 1) {
            return {err: "Invalid TZX set signal level block."};
        }
        const block = emptyBlock(0, false);
        block.startLevel = u8[i + 4];
        entry = {kind: "command", block};
        next = i + 5;
        break;
    }
    case 0x30:
        if (i + 1 > u8.length) {
            return truncated;
        }
        next = i + 1 + u8[i];
        break;
    case 0x31:
        if (i + 2 > u8.length) {
            return truncated;
        }
        next = i + 2 + u8[i + 1];
        break;
    case 0x32:
        if (i + 2 > u8.length) {
            return truncated;
        }
        next = i + 2 + u16(u8, i);
        break;
    case 0x33:
        if (i + 1 > u8.length) {
            return truncated;
        }
        next = i + 1 + 3 * u8[i];
        break;
    case 0x34:
        next = i + 8;
        break;
    case 0x35:
        if (i + 20 > u8.length) {
            return truncated;
        }
        next = i + 20 + u32(u8, i + 16);
        break;
    case 0x40:
        if (i + 4 > u8.length) {
            return truncated;
        }
        next = i + 4 + u24(u8, i + 1);
        break;
    case 0x5A:
        next = i + 9;
        break;
    default:
        // Future custom blocks carry a four-byte payload length.
        if (i + 4 > u8.length) {
            return truncated;
        }
        next = i + 4 + u32(u8, i);
        break;
    }
    if (next > u8.length) {
        return truncated;
    }
    if (entry.kind === "play") {
        const fault = timingFault(entry.block);
        if (fault !== null) {
            return {err: "Invalid TZX " + fault + "."};
        }
    }
    return {err: null, entry, next};
}

/**
 * Name the zero duration a block would make the player consume, or null when
 * every duration it reaches lasts at least one T-state. Playback depends on
 * this: a pulse of no length advances no time, so a block full of them runs for
 * as many edges as it has bits without the machine's clock ever catching up.
 * Durations the player never reaches are deliberately not checked, which is
 * what lets pause and signal-level blocks carry zeroes throughout.
 *
 * @param {TapeBlock} block
 * @returns {string | null}
 */
function timingFault(block) {
    for (const pulse of block.pulses) {
        // Dropping a zero here instead of rejecting it would invert every
        // level after it, since two toggles at one instant cancel.
        if (pulse === 0) {
            return "pulse length";
        }
    }
    if (block.pilotPulses > 0 && block.pilotT === 0) {
        return "pilot pulse length";
    }
    // sync1T and sync2T need no check: enterPhase reads a zero as "absent".
    if (block.data.length > 0 && (block.bit0T === 0 || block.bit1T === 0)) {
        return "bit pulse length";
    }
    return null;
}

/**
 * Reject the control flow a tape cannot recover from once it is playing. What
 * is left over - a loop that never reaches a block, a stray return - stops the
 * tape instead, since playback has no way to report a broken file.
 *
 * @param {TzxEntry[]} entries
 * @returns {TapeParse}
 */
function checkTzxProgram(entries) {
    let blocks = 0;
    let depth = 0;
    let calls = 0;
    let returns = 0;
    for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry.kind === "play") {
            blocks += 1;
        }
        switch (entry.kind) {
        case "jump":
            // Landing one past the last entry is how a tape ends early.
            if (i + entry.value < 0 || i + entry.value > entries.length) {
                return {err: "TZX control flow leaves the tape."};
            }
            break;
        case "loop":
            depth += 1;
            break;
        case "endloop":
            if (depth === 0) {
                return {err: "TZX loop end without a loop start."};
            }
            depth -= 1;
            break;
        case "call":
            calls += 1;
            for (const offset of entry.offsets) {
                if (i + offset < 0 || i + offset >= entries.length) {
                    return {err: "TZX control flow leaves the tape."};
                }
            }
            break;
        case "return":
            returns += 1;
            break;
        default:
            break;
        }
    }
    if (depth > 0) {
        return {err: "TZX loop start without a loop end."};
    }
    if (calls > 0 && returns === 0) {
        return {err: "TZX call sequence has no return."};
    }
    if (returns > 0 && calls === 0) {
        return {err: "TZX return without a call sequence."};
    }
    if (blocks === 0) {
        return {err: "TZX has no playable blocks."};
    }
    // Low, per the TZX current-pulse-level convention: the first pulse is low
    // and its transition comes after that pulse, not at the start of the tape.
    // This is the level a level-sensitive block sees with no 0x2B before it.
    return {err: null, entries};
}

/** @param {Tape} tape */
function advanceEdge(tape) {
    const block = tape.block;
    switch (tape.phase) {
    case "start":
        if (block.startLevel !== null) {
            // An absolute level is a statement about the level the next pulse
            // starts at, so hold it rather than let that pulse toggle it away.
            tape.level = block.startLevel;
            tape.holdLevel = true;
        }
        enterPhase(tape, "pulses");
        break;
    case "pulses":
        tape.pulseI += 1;
        if (tape.pulseI >= block.pulses.length) {
            enterPhase(tape, "pilot");
        } else {
            nextPulse(tape, block.pulses[tape.pulseI]);
        }
        break;
    case "pilot":
        tape.pulseI += 1;
        if (tape.pulseI >= block.pilotPulses) {
            enterPhase(tape, "sync1");
        } else {
            nextPulse(tape, block.pilotT);
        }
        break;
    case "sync1":
        enterPhase(tape, "sync2");
        break;
    case "sync2":
        enterPhase(tape, "data");
        break;
    case "data":
        advanceData(tape);
        break;
    case "tail": {
        tape.level = 0;
        tape.holdLevel = true;
        const remaining = block.pauseT - Math.min(block.pauseT, pausePulseT);
        if (remaining > 0) {
            tape.phase = "pause";
            tape.nextT += remaining;
        } else {
            finishEntry(tape);
        }
        break;
    }
    case "pause":
        finishEntry(tape);
        break;
    }
}

/**
 * Begin the given part of the current block, skipping parts it does not have.
 *
 * @param {Tape} tape
 * @param {"pulses" | "pilot" | "sync1" | "sync2" | "data"} phase
 */
function enterPhase(tape, phase) {
    const block = tape.block;
    switch (phase) {
    case "pulses":
        if (block.pulses.length > 0) {
            tape.phase = "pulses";
            tape.pulseI = 0;
            nextPulse(tape, block.pulses[0]);
            return;
        }
        // falls through
    case "pilot":
        if (block.pilotPulses > 0) {
            tape.phase = "pilot";
            tape.pulseI = 0;
            nextPulse(tape, block.pilotT);
            return;
        }
        // falls through
    case "sync1":
        if (block.sync1T > 0) {
            tape.phase = "sync1";
            nextPulse(tape, block.sync1T);
            return;
        }
        // falls through
    case "sync2":
        if (block.sync2T > 0) {
            tape.phase = "sync2";
            nextPulse(tape, block.sync2T);
            return;
        }
        // falls through
    case "data":
        if (block.data.length > 0) {
            tape.phase = "data";
            tape.pulseI = 0;
            nextPulse(tape, bitDuration(tape));
            return;
        }
        finishBlock(tape);
    }
}

/**
 * Step the data cursor by one half-pulse. Two of them make a bit, and the last
 * byte contributes only its leading lastBits bits, so where a bit sits is pure
 * arithmetic and the only thing the block decides is how many there are.
 *
 * @param {Tape} tape
 */
function advanceData(tape) {
    const block = tape.block;
    tape.pulseI += 1;
    if (tape.pulseI >= 2 * ((block.data.length - 1) * 8 + block.lastBits)) {
        finishBlock(tape);
        return;
    }
    nextPulse(tape, bitDuration(tape));
}

/** @param {Tape} tape */
function finishBlock(tape) {
    const block = tape.block;
    if (block.endPulse) {
        // Every listed pulse ends with a transition. The following pulse holds
        // that new level so two block boundaries at one instant do not toggle
        // it twice.
        tape.level = 1 - tape.level;
        tape.holdLevel = true;
    }

    if (block.pauseT === 0) {
        finishEntry(tape);
        return;
    }

    if (block.endPulse) {
        // TZX data pauses hold the level opposite the final pulse for 1 ms,
        // then remain low for the rest of the requested pause.
        tape.phase = "tail";
        tape.nextT += Math.min(block.pauseT, pausePulseT);
    } else {
        tape.level = 0;
        tape.holdLevel = true;
        tape.phase = "pause";
        tape.nextT += block.pauseT;
    }
}

/**
 * Advance the tape program only after the current block and pause finish.
 *
 * @param {Tape} tape
 */
function finishEntry(tape) {
    const stop = tape.block.stop;
    tape.phase = "start";
    if (!runProgram(tape, tape.pc + 1)) {
        tape.state = "done";
        return;
    }
    if (stop) {
        // Wait for the next LOAD "" before continuing a multi-load tape.
        tape.state = "blocked";
    }
}

/**
 * @param {Tape} tape
 * @returns {number}
 */
function bitDuration(tape) {
    const block = tape.block;
    const bitI = tape.pulseI >> 1;
    const byte = block.data[bitI >> 3];
    if (((byte >> (7 - (bitI & 7))) & 1) === 1) {
        return block.bit1T;
    }
    return block.bit0T;
}

/**
 * Start the next pulse. It toggles the signal, except for the one pulse that
 * follows an absolute level, which holds the level it was just given.
 *
 * @param {Tape} tape
 * @param {number} duration
 */
function nextPulse(tape, duration) {
    if (tape.holdLevel) {
        tape.holdLevel = false;
    } else {
        tape.level = 1 - tape.level;
    }
    tape.nextT += duration;
}

/**
 * Step the program from pc to the next block to play, following jumps, loops
 * and call sequences. Returns false when the tape ends or the control flow
 * never reaches a block.
 *
 * @param {Tape} tape
 * @param {number} pc
 * @returns {boolean}
 */
function runProgram(tape, pc) {
    const entries = tape.entries;
    for (let steps = 0; steps <= tzxMaxSteps; steps += 1) {
        if (pc < 0 || pc >= entries.length) {
            return false;
        }
        const entry = entries[pc];
        if (entry.kind === "play" || entry.kind === "command") {
            tape.pc = pc;
            tape.block = entry.block;
            return true;
        }
        switch (entry.kind) {
        case "jump":
            pc += entry.value;
            break;
        case "loop": {
            // A count of zero or one plays the body once. Landing on a loop
            // start again restarts that loop rather than stacking a second copy
            // of it, so flow that never reaches the matching end cannot grow
            // the stack without limit.
            const depth = tape.loops.length;
            const left = Math.max(entry.value, 1);
            if (depth > 0 && tape.loops[depth - 1].pc === pc) {
                tape.loops[depth - 1].left = left;
            } else if (depth >= tzxMaxNesting) {
                return false;
            } else {
                tape.loops.push({pc, left});
            }
            pc += 1;
            break;
        }
        case "endloop": {
            if (tape.loops.length === 0) {
                return false;
            }
            const loop = tape.loops[tape.loops.length - 1];
            loop.left -= 1;
            if (loop.left > 0) {
                pc = loop.pc + 1;
            } else {
                tape.loops.pop();
                pc += 1;
            }
            break;
        }
        case "call":
            if (entry.offsets.length === 0) {
                pc += 1;
            } else if (tape.calls.length >= tzxMaxNesting) {
                return false;
            } else {
                tape.calls.push({pc, next: 1, offsets: entry.offsets});
                pc += entry.offsets[0];
            }
            break;
        case "return": {
            if (tape.calls.length === 0) {
                return false;
            }
            const frame = tape.calls[tape.calls.length - 1];
            if (frame.next < frame.offsets.length) {
                pc = frame.pc + frame.offsets[frame.next];
                frame.next += 1;
            } else {
                tape.calls.pop();
                pc = frame.pc + 1;
            }
            break;
        }
        default:
            pc += 1;
            break;
        }
    }
    return false;
}

/**
 * A block with the ROM loader timings, as saved by SAVE.
 *
 * @param {Uint8Array} data
 * @param {number} pause
 * @returns {TapeBlock}
 */
function standardBlock(data, pause) {
    let pilotPulses = pilotData;
    if (data.length > 0 && data[0] < 128) {
        pilotPulses = pilotHeader;
    }
    const block = emptyBlock(pause, false);
    block.pilotT = pilotT;
    block.pilotPulses = pilotPulses;
    block.sync1T = sync1T;
    block.sync2T = sync2T;
    block.bit0T = bit0T;
    block.bit1T = bit1T;
    block.data = data;
    block.endPulse = true;
    return block;
}

/**
 * Create an empty waveform block for pauses and specialized TZX data.
 *
 * @param {number} pause
 * @param {boolean} stop
 * @returns {TapeBlock}
 */
function emptyBlock(pause, stop) {
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
        stop,
        startLevel: null,
        endPulse: false,
    };
}

/**
 * Turn direct-recording samples into runs while retaining the first level, or
 * null when the recording would expand past the pulse limit.
 *
 * @param {Uint8Array} samples
 * @param {number} lastBitsUsed
 * @param {number} tPerSample
 * @returns {SamplePulses | null}
 */
function samplesToPulses(samples, lastBitsUsed, tPerSample) {
    /** @type {number[]} */
    const pulses = [];
    if (samples.length === 0) {
        return {startLevel: null, pulses};
    }
    const total = (samples.length - 1) * 8 + lastBitsUsed;
    const startLevel = (samples[0] >> 7) & 1;
    let level = startLevel;
    let run = 0;
    for (let bitI = 0; bitI < total; bitI += 1) {
        const bit = (samples[bitI >> 3] >> (7 - (bitI & 7))) & 1;
        if (bit !== level) {
            if (pulses.length >= tzxMaxPulses) {
                // Stop rather than let a 16 MB block become a pulse per bit.
                return null;
            }
            pulses.push(run * tPerSample);
            level = bit;
            run = 0;
        }
        run += 1;
    }
    pulses.push(run * tPerSample);
    return {startLevel, pulses};
}

/**
 * @param {Uint8Array} u8
 * @returns {boolean}
 */
function isTzx(u8) {
    const magic = "ZXTape!";
    if (u8.length < magic.length + 1) {
        return false;
    }
    for (let i = 0; i < magic.length; i += 1) {
        if (u8[i] !== magic.charCodeAt(i)) {
            return false;
        }
    }
    return u8[7] === 0x1A;
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
    return (u16(u8, i) << 16) >> 16;
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
 * Returns 1 to 7 for bits between 1 and 7, returns 8 otherwise.
 *
 * @param {number} bits
 * @returns {number}
 */
function lastBits(bits) {
    return Math.min(bits + ((bits - 1) >>> 31) * 8, 8);
}
