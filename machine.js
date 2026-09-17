import {createZ80, resetZ80, runZ80, irqZ80} from "./z80.js";
import {createTape, parseTape, resetTape, startTape, rearmTape, stopTape, earLevel} from "./tape.js";
import {parseDck} from "./dock.js";
import {createAy, resetAy, aySeek, ayRunTo, ayRunSilent, ayTakeSample, ayWriteReg, ayReadReg} from "./ay.js";

export const homeRomSize     = 16384;
export const exRomSize       = 8192;
export const tStatesPerFrame = 58688;
export const cpuHz           = 3528000;
const ayClockHz       = cpuHz / 2;
// The audio amplifier feedback is 680 kOhm in parallel with 20 pF. Its one-pole
// response is integrated in emulated time before conversion to PCM, so fast
// ULA and AY edges are attenuated before they could alias.
const amplifierTauT   = cpuHz * 680000 * 20e-12;
// Tone counters run at the AY clock over 8, which is one tick every 16 CPU
// T-states: an exact grid, so the chip needs no rate accumulator.
const ayTickT  = cpuHz / (ayClockHz / 8);
const audioCap = 8192;
// How loudly the tape EAR line is mixed under the beeper.
const earMix          = 0.25;
const tapePollReads   = 8;
const tapePollGapT    = 256;
const tapeLoaderIdleT = cpuHz / 10;

// This is the state reached by the bundled TS2068 ROMs after LOAD "" enters
// the EXROM leader loop. Code that the ROM copies into RAM comes from the
// loaded ROM images below; only initialized variables and workspace are kept
// here.
const autoloadHomeHash = 0xFB7FAA94;
const autoloadExHash = 0x6F627310;
const autoloadSystemRam = Uint8Array.of(
    0xFF, 0x00, 0x00, 0x00, 0x0D, 0x05, 0x23, 0x0D, 0x0D, 0x23, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x06, 0x00, 0x0B, 0x00, 0x01, 0x00, 0x01, 0x00, 0x06, 0x00, 0x10, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3C, 0x40, 0x00, 0xFF, 0x9C, 0x01, 0xFC, 0x61, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xFF, 0xFE, 0xFF, 0x01, 0x38, 0x00, 0x00, 0x56, 0x68, 0x00, 0x00, 0x40,
    0x68, 0x40, 0x68, 0x56, 0x68, 0x5B, 0x68, 0x55, 0x68, 0x57, 0x68, 0x5A, 0x68, 0x5A, 0x68, 0x00,
    0x00, 0x5C, 0x68, 0x7E, 0x68, 0x7E, 0x68, 0x1A, 0x92, 0x5C, 0x10, 0x02, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x19, 0x00, 0x00, 0x68, 0x00, 0x00, 0x58, 0xFF, 0x00, 0x00, 0x21,
    0x00, 0x5B, 0x21, 0x17, 0x00, 0x40, 0xE0, 0x50, 0x21, 0x18, 0x21, 0x17, 0x01, 0x38, 0x00, 0x38,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x57, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xEA, 0x5E, 0x00, 0x00,
    0x00, 0x62, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,
    0xFF, 0xFF, 0x00, 0xFF, 0xFF, 0xFF, 0x80,
);

const autoloadStackRam = Uint8Array.of(
    0x2E, 0x09, 0x03, 0x07, 0xE3, 0x50, 0x03, 0x07, 0xE4, 0x50, 0x1D, 0x17, 0xF3, 0x05, 0x03, 0x07,
    0xE7, 0x50, 0x1A, 0x17, 0xF3, 0x05, 0x23, 0x16, 0x38, 0x00, 0xF4, 0x61, 0xF2, 0x61, 0x00, 0xFF,
    0x20, 0x0E, 0x59, 0x68, 0x08, 0x00, 0x20, 0x08, 0xF3, 0x61, 0x4D, 0x02, 0x15, 0x01, 0xE5, 0x00,
    0xE0, 0x04, 0x6D, 0x68, 0x56, 0x68, 0x3C, 0x66, 0x00, 0x00, 0xB9, 0x1A, 0x8D, 0x0E, 0x00, 0x3E,
);

const autoloadPatchRam = Uint8Array.of(
    0x00, 0x00, 0x4D, 0x02, 0x00, 0x00, 0x5E, 0x25, 0xCA, 0x65,
);

const autoloadWorkspaceRam = Uint8Array.of(
    0x05, 0x0E, 0x0C, 0x4B, 0x00, 0x05, 0xBF, 0x11, 0x53, 0xE7, 0x0A, 0xBF, 0x11, 0x52, 0x00, 0x05,
    0xBF, 0x11, 0x50, 0x80, 0x00, 0x80, 0xEF, 0x22, 0x22, 0x0D, 0x80, 0x00, 0xFF, 0x20, 0x20, 0x20,
    0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x0D, 0x59, 0x68,
);

const autoloadCpuState = {
    a:          0x00,
    f:          0x50,
    b:          0x00,
    c:          0x02,
    d:          0x00,
    e:          0x11,
    h:          0x00,
    l:          0xE5,
    a2:         0x00,
    f2:         0x01,
    b2:         0x17,
    c2:         0x21,
    d2:         0x3A,
    e2:         0xB6,
    h2:         0x00,
    l2:         0x00,
    xh:         0x68,
    xl:         0x6D,
    yh:         0x5C,
    yl:         0x3A,
    sp:         0x61EE,
    pc:         0x0111,
    i:          0x3F,
    r:          0x36,
    iff1:       false,
    iff2:       false,
    im:         1,
    halted:     false,
    eiDelay:    false,
    nmiPending: false,
};

// The following frame sizes are duplicated in canvas setup and machine.js.
// Buffer is 640x240 (hi-res pixel clock); CSS displays it as 640x480.
const frameW    = 640;
const frameH    = 240;
const scrX      = 64;
const scrY      = 24;
const scrW      = 512;
const scrH      = 192;
const dfile0    = 0x4000;
const dfile1    = 0x6000;
const dfileSize = 0x1B00;

// Beam map. The SCLD raster is free-running: 224 T-states per line and 262
// lines per frame, which is exactly the 58688 T-states above. Both come from
// the SCLD video counter chain, which divides the 1.764 MHz video clock by 16
// and then by 7 for one line, and the line counter by 262 for one frame, so
// the frame rate is 60.1145 Hz rather than a round 60. One T-state is
// two normal pixels, and the buffer runs at the hi-res clock, so one T-state
// is four buffer columns. Line 0 column 0 is the moment of the frame
// interrupt, which is what raster code times against.
// activeStartLine / activeStartT place the active area against that interrupt
// and are the only two figures here not derived from the others.
const tPerLine = 224;
const tPerColumn = 4;
const activeStartLine = 40;
const activeStartT = 32;
const windowStartLine = activeStartLine - scrY;
const windowStartT = activeStartT - scrX / tPerColumn;

/**
 * @typedef {{
 *   pc:     number,
 *   port:   number,
 *   firstT: number,
 *   lastT:  number,
 *   count:  number,
 * }} TapePoll
 */

/**
 * @typedef {{
 *   homeRom:     Uint8Array,
 *   exRom:       Uint8Array,
 *   ram:         Uint8Array,
 *   dock:        (Uint8Array | null)[],
 *   dockRam:     boolean[],
 *   exCart:      (Uint8Array | null)[],
 *   exCartRam:   boolean[],
 *   homeCart:    (Uint8Array | null)[],
 *   homeCartRam: boolean[],
 *   homeRamSave: (Uint8Array | null)[],
 *   portF4:      number,
 *   portFF:      number,
 *   border:      number,
 *   pixels:      Uint8Array,
 *   beamT:       number,
 *   videoOn:     boolean,
 *   dfileStart:  number,
 *   dfileEnd:    number,
 *   keyMatrix:   Uint8Array,
 *   joystick:    Uint8Array,
 *   tstates:     number,
 *   stepAdded:   number,
 *   frameStart:  number,
 *   flashFrame:  number,
 *   tape:        import("./tape.js").Tape,
 *   tapePoll:    TapePoll,
 *   cpu:         import("./z80.js").Z80,
 *   bus:         import("./z80.js").Z80Bus,
 *   ay:          import("./ay.js").Ay,
 *   ayLatch:     number,
 *   ulaOut:      number,
 *   earBit:      number,
 *   ulaLevel:    number,
 *   ulaFiltered: number,
 *   ulaT:        number,
 *   ulaArea:     number,
 *   soundOn:     boolean,
 *   sampleRate:  number,
 *   sampleT:     number,
 *   sampleEndT:  number,
 *   sampleAcc:   number,
 *   audioFill:   number,
 *   audioUla:    Float32Array,
 *   audioA:      Float32Array,
 *   audioB:      Float32Array,
 *   audioC:      Float32Array,
 *   onEarEdge:   function(number, number): void,
 * }} Machine
 */

/**
 * One frame of mixed planes for the audio host to interleave. n is how many
 * samples are filled; the typed arrays may be longer.
 *
 * @typedef {{
 *   n:   number,
 *   ula: Float32Array,
 *   a:   Float32Array,
 *   b:   Float32Array,
 *   c:   Float32Array,
 * }} AudioChunk
 */

/**
 * @param {Uint8Array} keyMatrix
 * @param {Uint8Array} joystick one active-low contact byte per stick
 * @returns {Machine}
 */
export function createMachine(keyMatrix, joystick) {
    /** @type {Machine} */
    let m;
    m = {
        homeRom:     new Uint8Array(homeRomSize),
        exRom:       new Uint8Array(exRomSize),
        ram:         new Uint8Array(65536),
        dock:        emptyPages(),
        dockRam:     emptyFlags(),
        exCart:      emptyPages(),
        exCartRam:   emptyFlags(),
        homeCart:    emptyPages(),
        homeCartRam: emptyFlags(),
        homeRamSave: emptyPages(),
        portF4:      0,
        portFF:      0,
        border:      0,
        // One byte per pixel indexes the palette in the fragment shader.
        pixels:     new Uint8Array(frameW * frameH),
        beamT:      0,
        videoOn:    true,
        dfileStart: dfile0,
        dfileEnd:   dfile0 + dfileSize,
        keyMatrix,
        joystick,
        tstates:    0,
        stepAdded:  0,
        frameStart: 0,
        flashFrame: 0,
        tape:       createTape(null, 0),
        tapePoll: {
            pc: -1,
            port: -1,
            firstT: 0,
            lastT: 0,
            count: 0,
        },
        cpu: createZ80(),
        bus: {
            read: function (addr) {
                return memRead(m, addr);
            },
            write: function (addr, value) {
                memWrite(m, addr, value);
            },
            ioRead: function (port) {
                return ioRead(m, port);
            },
            ioWrite: function (port, value) {
                ioWrite(m, port, value);
            },
        },
        ay:           createAy(ayTickT, amplifierTauT),
        ayLatch:      0,
        ulaOut:       0,
        earBit:       0,
        ulaLevel:     0,
        ulaFiltered: 0,
        ulaT:         0,
        ulaArea:      0,
        soundOn:      false,
        sampleRate:   44100,
        sampleT:      0,
        sampleEndT:   0,
        sampleAcc:    0,
        audioFill:    0,
        audioUla:     new Float32Array(audioCap),
        audioA:       new Float32Array(audioCap),
        audioB:       new Float32Array(audioCap),
        audioC:       new Float32Array(audioCap),
        onEarEdge: function (t, level) {
            renderAudioTo(m, t);
            m.earBit = level;
            setUlaLevel(m);
        },
    };
    resetMachine(m);
    return m;
}

/**
 * @param {Machine} m
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string | null}
 */
export function setHomeRom(m, bytes) {
    return setRom(m.homeRom, bytes, homeRomSize);
}

/**
 * @param {Machine} m
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string | null}
 */
export function setExRom(m, bytes) {
    return setRom(m.exRom, bytes, exRomSize);
}

/**
 * @param {Uint8Array} dest
 * @param {ArrayBuffer | Uint8Array} bytes
 * @param {number} byteLength
 * @returns {string | null}
 */
function setRom(dest, bytes, byteLength) {
    let src;
    if (bytes instanceof Uint8Array) {
        src = bytes;
    } else {
        src = new Uint8Array(bytes);
    }
    if (src.length !== byteLength) {
        return "Expected " + byteLength + ", got " + src.length + " bytes.";
    }
    dest.set(src);
    return null;
}

/** @param {Machine} m */
export function resetMachine(m) {
    m.portF4 = 0;
    m.portFF = 0;
    m.border = 0;
    m.flashFrame = 0;
    m.beamT = m.tstates;
    m.frameStart = m.tstates;
    setDisplayWatch(m);
    resetZ80(m.cpu);
    resetAy(m.ay, m.tstates);
    m.ayLatch = 0;
    m.ulaOut = 0;
    m.earBit = 0;
    m.ulaFiltered = 0;
    resetTape(m.tape);
    resetTapePoll(m);
    setUlaLevel(m);
    m.audioFill = 0;
    resyncSound(m);
}

/**
 * The span of RAM the current screen mode actually displays. Only writes in
 * here need to stall the raster; in mode 0 that excludes 0x6000-0x7AFF, where
 * the ROM keeps its RAM copy of the OS and writes constantly.
 *
 * @param {Machine} m
 */
function setDisplayWatch(m) {
    const mode = m.portFF & 7;
    if (mode === 0) {
        m.dfileStart = dfile0;
        m.dfileEnd = dfile0 + dfileSize;
        return;
    }
    if (mode === 1) {
        m.dfileStart = dfile1;
        m.dfileEnd = dfile1 + dfileSize;
        return;
    }
    // Hi-colour and hi-res read from both files; watch the whole span.
    m.dfileStart = dfile0;
    m.dfileEnd = dfile1 + dfileSize;
}

/**
 * Turn raster painting off for frames that will be thrown away, as turbo tape
 * loading does. The beam still advances, it just does not paint.
 *
 * @param {Machine} m
 * @param {boolean} on
 */
export function setVideoOn(m, on) {
    m.videoOn = on;
}

/** @param {Machine} m */
export function requestNmi(m) {
    m.cpu.nmiPending = true;
}

/**
 * runZ80 always covers a whole frame in one call: it either overshoots the
 * budget on the final instruction, or, when halted, consumes it exactly
 * because tStatesPerFrame is a multiple of 4. Only a halted CPU can come up
 * short, and then just by the sub-instruction remainder.
 *
 * @param {Machine} m
 */
export function runFrame(m) {
    const end = m.frameStart + tStatesPerFrame;
    runZ80(m.cpu, m.bus, end - m.tstates, m);
    if (m.tstates < end) {
        m.tstates = end;
    }
    videoRunTo(m, end);
    endRasterFrame(m);
    renderSound(m, m.tstates);
}

/**
 * @param {Machine} m
 * @param {number} sampleRate
 */
export function setSoundRate(m, sampleRate) {
    if (m.sampleRate === sampleRate) {
        return;
    }
    m.sampleRate = sampleRate;
    resyncSound(m);
}

/**
 * @param {Machine} m
 * @param {boolean} on
 */
export function enableSound(m, on) {
    if (on === m.soundOn) {
        return;
    }
    m.soundOn = on;
    m.audioFill = 0;
    resyncSound(m);
}

/**
 * @param {Machine} m
 * @returns {AudioChunk}
 */
export function takeAudio(m) {
    const n = m.audioFill;
    m.audioFill = 0;
    return {
        n,
        ula: m.audioUla,
        a:   m.audioA,
        b:   m.audioB,
        c:   m.audioC,
    };
}

/**
 * @typedef {"empty" | "ready" | "playing" | "blocked" | "done"} TapeState
 */

/**
 * @typedef {{
 *   state: TapeState,
 *   blockCount: number,
 * }} TapeInfo
 */

/**
 * Transport position the host paints. blockCount is only meaningful once a
 * tape is loaded.
 *
 * @param {Machine} m
 * @returns {TapeInfo}
 */
export function tapeInfo(m) {
    return {
        state: m.tape.state,
        blockCount: m.tape.blockCount,
    };
}

/**
 * Where the transport is. The frame loop reads this once per animation frame
 * and again on every emulated frame of a turbo burst, so it returns the bare
 * state instead of allocating a TapeInfo.
 *
 * @param {Machine} m
 * @returns {TapeState}
 */
export function tapeState(m) {
    return m.tape.state;
}

/**
 * Install a TAP or TZX image. The previous tape is ejected first, including
 * when the new bytes fail to parse.
 *
 * @param {Machine} m
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string | null}
 */
export function insertTape(m, bytes) {
    const parsed = parseTape(bytes);
    if (parsed.err !== null) {
        m.tape = createTape(null, 0);
    } else {
        m.tape = createTape(parsed.entries, m.tstates);
    }
    resetTapePoll(m);
    setUlaLevel(m);
    return parsed.err;
}

/**
 * @param {Machine} m
 */
export function ejectTape(m) {
    m.tape = createTape(null, 0);
    resetTapePoll(m);
    setUlaLevel(m);
}

/**
 * Put the bundled TS2068 ROM directly into the state reached by LOAD "".
 * Incompatible ROM and cartridge configurations keep their running state and
 * can use normal loader detection or the manual Play control instead.
 *
 * @param {Machine} m
 * @returns {boolean}
 */
export function autoloadTape(m) {
    if (m.tape.state !== "ready" || !tapeAutoloadCompatible(m)) {
        return false;
    }

    resetMachine(m);
    m.ram.fill(0);
    m.ram.fill(0x38, 0x5800, 0x5B00);
    m.ram.set(autoloadSystemRam, 0x5C00);
    m.ram.set(m.homeRom.subarray(0x0E0B, 0x0E28), 0x6000);
    m.ram.set(autoloadStackRam, 0x61C0);
    m.ram.set(m.exRom.subarray(0x1000, 0x1624), 0x6200);
    m.ram[0x6315] = 0;
    m.ram.set(autoloadPatchRam, 0x65C6);
    m.ram.set(autoloadWorkspaceRam, 0x6841);

    Object.assign(m.cpu, autoloadCpuState);
    m.portF4 = 0x01;
    m.portFF = 0x80;
    m.border = 7;
    setDisplayWatch(m);
    m.ayLatch = 14;
    ayWriteReg(m.ay, m.ayLatch, 0xFF);
    setUlaLevel(m);
    return true;
}

/** @param {Machine} m */
export function playTape(m) {
    rearmTape(m.tape);
    startTape(m.tape, m.tstates);
    resetTapePoll(m);
    setUlaLevel(m);
}

/**
 * @param {Machine} m
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string | null}
 */
export function insertDock(m, bytes) {
    clearCart(m);
    const parsed = parseDck(bytes);
    if (parsed.err !== null) {
        return parsed.err;
    }
    for (let b = 0; b < parsed.blocks.length; b += 1) {
        applyDckBlock(m, parsed.blocks[b]);
    }
    return null;
}

/** @param {Machine} m */
export function ejectDock(m) {
    clearCart(m);
}

/**
 * @typedef {{
 *   hasCart: boolean,
 *   summary: string,
 * }} CartInfo
 */

/**
 * Dock occupancy for status text and for whether unplugging a cart should
 * reset the machine.
 *
 * @param {Machine} m
 * @returns {CartInfo}
 */
export function cartInfo(m) {
    /** @type {string[]} */
    const parts = [];
    addBankSummary(parts, "dock", m.dock, m.dockRam);
    addBankSummary(parts, "EXROM", m.exCart, m.exCartRam);
    addBankSummary(parts, "HOME", m.homeCart, m.homeCartRam);

    let homePages = 0;
    for (let i = 0; i < 8; i += 1) {
        if (m.homeRamSave[i] !== null) {
            homePages += 1;
        }
    }
    if (homePages > 0) {
        parts.push(homePages + " HOME RAM pages");
    }
    let summary = "no cartridge chunks.";
    if (parts.length > 0) {
        summary = parts.join(", ") + ".";
    }
    return {
        hasCart: parts.length > 0,
        summary,
    };
}

/**
 * @param {string[]} out
 * @param {string} name
 * @param {(Uint8Array | null)[]} pages
 * @param {boolean[]} ramFlags
 */
function addBankSummary(out, name, pages, ramFlags) {
    let rom = 0;
    let ram = 0;
    for (let i = 0; i < 8; i += 1) {
        if (pages[i] !== null) {
            if (ramFlags[i]) {
                ram += 1;
            } else {
                rom += 1;
            }
        }
    }
    if (rom > 0) {
        out.push(rom + " " + name + " ROM chunks");
    }
    if (ram > 0) {
        out.push(ram + " " + name + " RAM chunks");
    }
}

/**
 * @returns {(Uint8Array | null)[]}
 */
function emptyPages() {
    return [null, null, null, null, null, null, null, null];
}

/**
 * @returns {boolean[]}
 */
function emptyFlags() {
    return [false, false, false, false, false, false, false, false];
}

/** @param {Machine} m */
function clearCart(m) {
    for (let c = 0; c < 8; c += 1) {
        const saved = m.homeRamSave[c];
        if (saved !== null) {
            m.ram.set(saved, c << 13);
        }
    }
    m.homeRamSave = emptyPages();
    m.dock = emptyPages();
    m.dockRam = emptyFlags();
    m.exCart = emptyPages();
    m.exCartRam = emptyFlags();
    m.homeCart = emptyPages();
    m.homeCartRam = emptyFlags();
}

/**
 * @param {Machine} m
 * @param {import("./dock.js").DckBlock} block
 */
function applyDckBlock(m, block) {
    switch (block.bank) {
    case 0:
        applyCartBank(m.dock, m.dockRam, block.chunks);
        break;
    case 254:
        applyCartBank(m.exCart, m.exCartRam, block.chunks);
        break;
    default:
        applyHomeBank(m, block.chunks);
        break;
    }
}

/**
 * @param {(Uint8Array | null)[]} pages
 * @param {boolean[]} ramFlags
 * @param {import("./dock.js").DckChunk[]} chunks
 */
function applyCartBank(pages, ramFlags, chunks) {
    for (let c = 0; c < 8; c += 1) {
        const chunk = chunks[c];
        if (chunk.kind === 0) {
            continue;
        }
        pages[c] = chunk.data;
        ramFlags[c] = chunk.kind === 1 || chunk.kind === 3;
    }
}

/**
 * @param {Machine} m
 * @param {import("./dock.js").DckChunk[]} chunks
 */
function applyHomeBank(m, chunks) {
    for (let c = 0; c < 8; c += 1) {
        const chunk = chunks[c];
        if (chunk.kind === 0) {
            continue;
        }
        if (c < 2) {
            m.homeCart[c] = chunk.data;
            m.homeCartRam[c] = chunk.kind === 1 || chunk.kind === 3;
        } else if (chunk.data !== null) {
            const off = c << 13;
            if (m.homeRamSave[c] === null) {
                m.homeRamSave[c] = new Uint8Array(m.ram.subarray(off, off + 0x2000));
            }
            m.ram.set(chunk.data, off);
        }
    }
}

/**
 * @param {Machine} m
 * @param {number} addr
 * @returns {number}
 */
function memRead(m, addr) {
    addr = addr & 0xFFFF;
    const chunk = addr >>> 13;
    const off = addr & 0x1FFF;
    if ((m.portF4 & (1 << chunk)) !== 0) {
        if ((m.portFF & 0x80) !== 0) {
            return m.exCart[chunk]?.[off] ?? m.exRom[off];
        }
        return m.dock[chunk]?.[off] ?? 0xFF;
    }
    if (addr < 0x4000) {
        return m.homeCart[chunk]?.[off] ?? m.homeRom[addr];
    }
    return m.ram[addr];
}

/**
 * @param {Machine} m
 * @param {number} addr
 * @param {number} value
 */
function memWrite(m, addr, value) {
    addr = addr & 0xFFFF;
    const chunk = addr >>> 13;
    const off = addr & 0x1FFF;
    value = value & 0xFF;
    if ((m.portF4 & (1 << chunk)) !== 0) {
        if ((m.portFF & 0x80) !== 0) {
            if (m.exCart[chunk] !== null && m.exCartRam[chunk]) {
                m.exCart[chunk][off] = value;
            }
            return;
        }
        if (m.dock[chunk] !== null && m.dockRam[chunk]) {
            m.dock[chunk][off] = value;
        }
        return;
    }
    if (addr < 0x4000) {
        if (m.homeCart[chunk] !== null && m.homeCartRam[chunk]) {
            m.homeCart[chunk][off] = value;
        }
        return;
    }
    // The raster reads display memory as it paints, and it paints lazily, so it
    // has to catch up before the byte changes or the new value would apply to
    // scanlines the beam already passed. m.tstates is the start of the
    // instruction doing the write, which places the change within a few
    // T-states of the real write cycle.
    if (addr >= m.dfileStart && addr < m.dfileEnd) {
        videoRunTo(m, m.tstates);
    }
    m.ram[addr] = value;
}

/**
 * The SCLD decodes its own ports on the full low byte and answers first. The
 * ULA behind it decodes A0 alone, so every other even port is keyboard/EAR.
 *
 * @param {Machine} m
 * @param {number} port
 * @returns {number}
 */
function ioRead(m, port) {
    const p = port & 0xFF;
    switch (p) {
    case 0xF4:
        return m.portF4;
    case 0xF5:
        return 0xFF;
    case 0xF6:
        return ayReadReg(m.ay, m.ayLatch, readJoysticks(m, port));
    case 0xFF:
        return m.portFF;
    default:
        break;
    }
    if ((p & 1) === 0) {
        return readKeys(m, port);
    }
    return 0xFF;
}

/**
 * Both sticks are read through AY I/O port A. A8 drives the read strobe of the
 * left (player 1) stick low and A9 that of the right, so B holds the player
 * number in the usual IN A,(C) sequence. The contacts pull their bit down
 * through isolation diodes, which is why strobing both at once merges them and
 * why an unstrobed read floats high.
 *
 * @param {Machine} m
 * @param {number} port
 * @returns {number}
 */
function readJoysticks(m, port) {
    let bits = 0xFF;
    if ((port & 0x0100) !== 0) {
        bits &= m.joystick[0];
    }
    if ((port & 0x0200) !== 0) {
        bits &= m.joystick[1];
    }
    return bits;
}

/**
 * @param {Machine} m
 * @param {number} port
 * @returns {number}
 */
function readKeys(m, port) {
    let bits = 0x1F;
    for (let row = 0; row < 8; row += 1) {
        if ((port & (0x0100 << row)) === 0) {
            bits &= m.keyMatrix[row];
        }
    }
    noteTapeRead(m, port);
    let ear = 0;
    if (earLevel(m.tape, m.tstates, m.onEarEdge) === 1) {
        ear = 0x40;
    }
    return 0xA0 | ear | bits;
}

/**
 * @param {Machine} m
 * @param {number} port
 * @param {number} value
 */
function ioWrite(m, port, value) {
    const p = port & 0xFF;
    switch (p) {
    case 0xF4:
        m.portF4 = value & 0xFF;
        noteRomLoaderIdle(m);
        return;
    case 0xF5:
        renderSound(m, m.tstates);
        m.ayLatch = value & 0x0F;
        return;
    case 0xF6:
        renderSound(m, m.tstates);
        ayWriteReg(m.ay, m.ayLatch, value);
        return;
    case 0xFF:
        videoRunTo(m, m.tstates);
        m.portFF = value & 0xFF;
        setDisplayWatch(m);
        noteRomLoaderIdle(m);
        return;
    default:
        break;
    }
    if ((p & 1) === 0) {
        renderSound(m, m.tstates);
        videoRunTo(m, m.tstates);
        m.ulaOut = value & 0x18;
        setUlaLevel(m);
        m.border = value & 7;
    }
}

/**
 * Recognize either the stock EXROM loader or a tight custom EAR polling loop.
 * The first candidate read anchors playback so confirming the loop does not
 * shorten its first pulse.
 *
 * @param {Machine} m
 * @param {number} port
 */
function noteTapeRead(m, port) {
    const tape = m.tape;
    const poll = m.tapePoll;
    const tstates = m.tstates;
    const gap = tstates - poll.lastT;

    if (tape.state === "blocked") {
        if (gap >= tapeLoaderIdleT) {
            rearmTape(tape);
        } else {
            poll.count = 0;
            poll.lastT = tstates;
            return;
        }
    }
    if (tape.state === "playing") {
        // Keyboard IN FE (ROM interrupt or a key-wait loop) must not look
        // like a loader or leftover blocks keep rolling after STOP THE TAPE.
        if (romTapeLoaderActive(m)) {
            poll.lastT = tstates;
            return;
        }
        const playingPort = port & 0xFFFF;
        if (poll.count > 0 && poll.pc === m.cpu.pc && poll.port === playingPort && gap <= tapePollGapT) {
            poll.count += 1;
            poll.lastT = tstates;
        } else {
            poll.pc = m.cpu.pc;
            poll.port = playingPort;
            poll.count = 1;
        }
        return;
    }
    if (tape.state !== "ready") {
        poll.count = 0;
        poll.lastT = tstates;
        return;
    }
    if (romTapeLoaderActive(m)) {
        startTape(tape, tstates);
        poll.count = 0;
        poll.lastT = tstates;
        return;
    }

    const fullPort = port & 0xFFFF;
    if (poll.count > 0 && poll.pc === m.cpu.pc && poll.port === fullPort && gap <= tapePollGapT) {
        poll.count += 1;
    } else {
        poll.pc = m.cpu.pc;
        poll.port = fullPort;
        poll.firstT = tstates;
        poll.count = 1;
    }
    poll.lastT = tstates;
    if (poll.count >= tapePollReads) {
        const firstT = poll.firstT;
        poll.count = 0;
        startTape(tape, firstT);
    }
}

/**
 * A stopped tape may resume as soon as the stock loader pages out.
 *
 * @param {Machine} m
 */
function noteRomLoaderIdle(m) {
    if (!romTapeLoaderActive(m)) {
        rearmTape(m.tape);
    }
}

/**
 * The ROM tape loader runs from the EXROM, so the machine is sampling EAR only
 * while chunk 0 is paged to it and the Timex EXROM enable is on.
 *
 * @param {Machine} m
 * @returns {boolean}
 */
function romTapeLoaderActive(m) {
    return (m.portF4 & 1) !== 0 && (m.portFF & 0x80) !== 0;
}

/**
 * A TAP/TZX still has pause and later blocks after LOAD has started the
 * program. Keep rolling only while a loader is sampling EAR; ordinary
 * keyboard scans of port FE do not count, or a STOP THE TAPE screen
 * would never halt the transport.
 *
 * @param {Machine} m
 * @param {number} untilT
 */
function stopTapeIfLoaderIdle(m, untilT) {
    if (m.tape.state !== "playing") {
        return;
    }
    if (romTapeLoaderActive(m)) {
        return;
    }
    if (untilT - m.tapePoll.lastT < tapeLoaderIdleT) {
        return;
    }
    stopTape(m.tape);
    setUlaLevel(m);
}

/** @param {Machine} m */
function resetTapePoll(m) {
    m.tapePoll.pc = -1;
    m.tapePoll.port = -1;
    m.tapePoll.firstT = m.tstates;
    m.tapePoll.lastT = m.tstates;
    m.tapePoll.count = 0;
}

/**
 * The saved loader state depends on the exact bundled ROM code and on there
 * being no cartridge mappings for it to collide with.
 *
 * @param {Machine} m
 * @returns {boolean}
 */
function tapeAutoloadCompatible(m) {
    if (romHash(m.homeRom) !== autoloadHomeHash || romHash(m.exRom) !== autoloadExHash) {
        return false;
    }
    for (let i = 0; i < 8; i += 1) {
        if (m.dock[i] !== null || m.exCart[i] !== null || m.homeCart[i] !== null || m.homeRamSave[i] !== null) {
            return false;
        }
    }
    return true;
}

/**
 * Fingerprint a ROM without adding a second copy of it solely for comparison.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function romHash(bytes) {
    let hash = 0x811C9DC5;
    for (let i = 0; i < bytes.length; i += 1) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
}

/**
 * An NMI is taken by runZ80 as soon as it is requested, so only the maskable
 * 60 Hz interrupt is raised here. Bit 6 of port FF inhibits it.
 *
 * @param {Machine} m
 */
function endRasterFrame(m) {
    if ((m.portFF & 0x40) === 0) {
        m.tstates += irqZ80(m.cpu, m.bus);
    }
    // Free-running: the raster does not wait for the CPU to land on the
    // boundary, so end-of-frame overshoot carries into the next frame instead
    // of dragging the beam origin along with it.
    m.frameStart += tStatesPerFrame;
    m.beamT = m.frameStart;
    m.flashFrame = (m.flashFrame + 1) & 0xFF;
}

/**
 * Draw the picture from wherever the beam was left up to untilT. Every caller
 * flushes here before changing anything the raster reads - the border, the port
 * FF mode, display memory - so a program racing the beam gets the same split the
 * hardware would produce. The beam paints lazily, so a flush that is skipped
 * does not just delay the change, it applies it to scanlines already scanned.
 *
 * @param {Machine} m
 * @param {number} untilT
 */
function videoRunTo(m, untilT) {
    if (untilT <= m.beamT) {
        return; // fast path: display writes call in far more often than the beam moves
    }
    const frameEnd = m.frameStart + tStatesPerFrame;
    const to = Math.min(untilT, frameEnd);
    if (to <= m.beamT) {
        return;
    }
    if (!m.videoOn) {
        m.beamT = to;
        return;
    }
    let from = m.beamT;
    if (from < m.frameStart) {
        from = m.frameStart;
    }
    while (from < to) {
        const line = Math.floor((from - m.frameStart) / tPerLine);
        const lineStart = m.frameStart + line * tPerLine;
        const segEnd = Math.min(lineStart + tPerLine, to);
        drawLineSpan(m, line, from - lineStart, segEnd - lineStart);
        from = segEnd;
    }
    m.beamT = to;
}

/**
 * Paint one scanline between two T-states within that line, splitting it into
 * left border, active area, and right border.
 *
 * @param {Machine} m
 * @param {number} line
 * @param {number} t0
 * @param {number} t1
 */
function drawLineSpan(m, line, t0, t1) {
    const y = line - windowStartLine;
    if (y < 0 || y >= frameH) {
        return;
    }
    const x0 = Math.max((t0 - windowStartT) * tPerColumn, 0);
    const x1 = Math.min((t1 - windowStartT) * tPerColumn, frameW);
    if (x1 <= x0) {
        return;
    }
    const mode = m.portFF & 7;
    let border = m.border & 7;
    if ((mode & 4) !== 0) {
        border = ((m.portFF >> 3) & 7) ^ 7;
    }
    const sy = line - activeStartLine;
    if (sy < 0 || sy >= scrH) {
        fillLine(m.pixels, x0, y, x1 - x0, border);
        return;
    }
    let x = x0;
    if (x < scrX) {
        let w = scrX;
        if (x1 < w) {
            w = x1;
        }
        fillLine(m.pixels, x, y, w - x, border);
        x = w;
    }
    if (x < scrX + scrW && x < x1) {
        let e = scrX + scrW;
        if (x1 < e) {
            e = x1;
        }
        paintScreenSpan(m, y, sy, x, e, mode);
        x = e;
    }
    if (x < x1) {
        fillLine(m.pixels, x, y, x1 - x, border);
    }
}

/**
 * Paint the active-area part of one scanline. The source addresses and colours
 * are decided once per span, not once per character column.
 *
 * @param {Machine} m
 * @param {number} y
 * @param {number} sy
 * @param {number} x0
 * @param {number} x1
 * @param {number} mode
 */
function paintScreenSpan(m, y, sy, x0, x1, mode) {
    const ram = m.ram;
    const lineAddr = pixelLine(sy);
    const attrRow = (sy >>> 3) << 5;
    const col0 = (x0 - scrX) >> 4;
    const colEnd = ((x1 - scrX) + 15) >> 4;
    if ((mode & 4) !== 0) {
        // Bits 5-3 pick the ink and the paper is its complement. The SCLD fixes
        // bright and flash off in these modes, so the ink is not made bright.
        const ink = (m.portFF >> 3) & 7;
        const paper = ink ^ 7;
        let leftAddr = dfile0 + lineAddr;
        let rightAddr = dfile1 + lineAddr;
        switch (mode) {
        case 4:
            rightAddr = dfile0 + 0x1800 + attrRow;
            break;
        case 5:
            leftAddr = dfile1 + lineAddr;
            rightAddr = dfile1 + 0x1800 + attrRow;
            break;
        case 7:
            leftAddr = dfile1 + lineAddr;
            rightAddr = leftAddr;
            break;
        default:
            break;
        }
        for (let col = col0; col < colEnd; col += 1) {
            const cx = scrX + col * 16;
            putBits(m.pixels, cx, y, ram[leftAddr + col], ink, paper, 1, x0, x1);
            putBits(m.pixels, cx + 8, y, ram[rightAddr + col], ink, paper, 1, x0, x1);
        }
        return;
    }
    const flashOn = (m.flashFrame & 0x10) !== 0;
    let pixAddr = dfile0 + lineAddr;
    let attrAddr = dfile0 + 0x1800 + attrRow;
    if ((mode & 1) !== 0) {
        pixAddr = dfile1 + lineAddr;
        attrAddr = dfile1 + 0x1800 + attrRow;
    }
    if ((mode & 2) !== 0) {
        // Hi-colour: one attribute byte per pixel line, from the other screen.
        attrAddr = dfile1 + lineAddr;
        if ((mode & 1) !== 0) {
            attrAddr = dfile0 + lineAddr;
        }
    }
    for (let col = col0; col < colEnd; col += 1) {
        const attr = ram[attrAddr + col];
        let ink = attr & 7;
        let paper = (attr >>> 3) & 7;
        if ((attr & 0x40) !== 0) {
            ink += 8;
            paper += 8;
        }
        if ((attr & 0x80) !== 0 && flashOn) {
            const t = ink;
            ink = paper;
            paper = t;
        }
        putBits(m.pixels, scrX + col * 16, y, ram[pixAddr + col], ink, paper, 2, x0, x1);
    }
}

/**
 * @param {number} y
 * @returns {number}
 */
function pixelLine(y) {
    return ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
}

/**
 * @param {Uint8Array} pixels
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} color
 */
function fillLine(pixels, x, y, w, color) {
    const dst = y * frameW + x;
    pixels.fill(color, dst, dst + w);
}

/**
 * Paint 8 source pixels, each pixW buffer columns wide. Only the first and last
 * character column of a span can straddle the clip edges, so the common case
 * takes the unchecked loop.
 *
 * @param {Uint8Array} pixels
 * @param {number} x
 * @param {number} y
 * @param {number} bits
 * @param {number} ink
 * @param {number} paper
 * @param {number} pixW
 * @param {number} clipL
 * @param {number} clipR
 */
function putBits(pixels, x, y, bits, ink, paper, pixW, clipL, clipR) {
    const row = y * frameW;
    const clipped = x < clipL || x + 8 * pixW > clipR;
    let dst = x;
    for (let i = 0; i < 8; i += 1) {
        let color = paper;
        if ((bits & 0x80) !== 0) {
            color = ink;
        }
        for (let p = 0; p < pixW; p += 1) {
            if (!clipped || (dst >= clipL && dst < clipR)) {
                pixels[row + dst] = color;
            }
            dst += 1;
        }
        bits = (bits << 1) & 0xFF;
    }
}

/**
 * Emit output samples as exact time-weighted averages. Everything that can
 * change the signal - a beeper edge, an AY register write, a tape edge - flushes
 * through here first, so each change is integrated from the T-state it really
 * happened rather than being snapped to a sample boundary.
 *
 * @param {Machine} m
 * @param {number} untilT
 */
function renderSound(m, untilT) {
    stopTapeIfLoaderIdle(m, untilT);
    if (!m.soundOn) {
        // Nothing is listening, but the AY is still a running piece of hardware.
        // Keep its counters, noise and envelope advancing so state that should
        // move on during a discarded turbo burst actually does.
        ayRunSilent(m.ay, untilT);
        ulaRunTo(m, untilT);
        return;
    }
    // Each tape callback closes preceding sample windows before changing EAR,
    // keeping edges and sample boundaries in chronological order.
    earLevel(m.tape, untilT, m.onEarEdge);
    renderAudioTo(m, untilT);
}

/**
 * Advance the audio clocks without advancing the tape. Tape callbacks use this
 * directly so several pending EAR edges cannot run ahead of sample boundaries.
 *
 * @param {Machine} m
 * @param {number} untilT
 */
function renderAudioTo(m, untilT) {
    if (!m.soundOn) {
        ulaRunTo(m, untilT);
        return;
    }
    const maxFill = Math.ceil(m.sampleRate * tStatesPerFrame / cpuHz) + 8;
    while (m.sampleEndT <= untilT) {
        if (m.audioFill >= maxFill) {
            // Behind by more than one frame: keep this frame's samples and
            // jump the clocks, or the worklet would play a backlog of EAR.
            ayRunSilent(m.ay, untilT);
            ulaRunTo(m, untilT);
            m.ulaArea = 0;
            m.sampleAcc = 0;
            m.sampleEndT = untilT;
            nextSampleWindow(m);
            return;
        }
        ayRunTo(m.ay, m.sampleEndT);
        ulaRunTo(m, m.sampleEndT);
        const period = m.sampleEndT - m.sampleT;
        let at = m.audioFill;
        if (at >= audioCap) {
            at = audioCap - 1;
        } else {
            m.audioFill += 1;
        }
        m.audioUla[at] = m.ulaArea / period;
        ayTakeSample(m.ay, period, m.audioA, m.audioB, m.audioC, at);
        m.ulaArea = 0;
        nextSampleWindow(m);
    }
    ayRunTo(m.ay, untilT);
    ulaRunTo(m, untilT);
}

/**
 * Integrate the beeper line, which is a plain step function, up to an exact
 * T-state. The guard also absorbs a tape edge reported very slightly late.
 *
 * @param {Machine} m
 * @param {number} t
 */
function ulaRunTo(m, t) {
    if (t <= m.ulaT) {
        return;
    }
    const dur = t - m.ulaT;
    // ay.js precomputes its decay, because a chip tick is always one of a
    // handful of durations. This one spans a sample window, a port write or a
    // whole silent frame, so there is nothing to tabulate.
    const decay = Math.exp(-dur / amplifierTauT);
    const delta = m.ulaFiltered - m.ulaLevel;
    if (m.soundOn) {
        m.ulaArea += m.ulaLevel * dur + delta * amplifierTauT * (1 - decay);
    }
    m.ulaFiltered = m.ulaLevel + delta * decay;
    m.ulaT = t;
}

/**
 * Mix EAR only while the tape is producing pulses. Mixing its resting level
 * during a pause would add silent DC that only eats audio headroom. Every tape
 * transition reports an edge after it updates the phase, so the gate follows
 * pulse and pause boundaries exactly.
 *
 * @param {Machine} m
 */
function setUlaLevel(m) {
    // The SCLD exposes one SPKR/TAPE OUT pin. The ROM holds tape bit 3 high
    // while toggling beeper bit 4, and holds bit 4 low while toggling bit 3,
    // which makes their internal combination an exclusive-or.
    let level = ((m.ulaOut >>> 3) ^ (m.ulaOut >>> 4)) & 1;
    const tape = m.tape;
    if (m.earBit === 1 && tape.state === "playing" && tape.phase !== "start" && tape.phase !== "pause") {
        level += earMix;
    }
    m.ulaLevel = level;
}

/**
 * Sample boundaries land on whole T-states; the accumulator keeps their average
 * spacing at exactly cpuHz / sampleRate even when that is not an integer.
 *
 * @param {Machine} m
 */
function nextSampleWindow(m) {
    m.sampleT = m.sampleEndT;
    m.sampleAcc += cpuHz;
    const step = Math.floor(m.sampleAcc / m.sampleRate);
    m.sampleAcc -= step * m.sampleRate;
    m.sampleEndT = m.sampleT + step;
}

/** @param {Machine} m */
function resyncSound(m) {
    m.ulaT = m.tstates;
    m.ulaArea = 0;
    aySeek(m.ay, m.tstates);
    m.sampleAcc = 0;
    m.sampleEndT = m.tstates;
    nextSampleWindow(m);
}
