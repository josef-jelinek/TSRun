const ayVolume = Float64Array.of(
    0.0000,
    0.0137,
    0.0205,
    0.0291,
    0.0423,
    0.0618,
    0.0847,
    0.1369,
    0.1691,
    0.2647,
    0.3527,
    0.4499,
    0.5704,
    0.6873,
    0.8482,
    1.0000,
);

const ayRegNoise = 6;
const ayRegMixer = 7;
const ayRegAmpA = 8;
const ayRegEnvFine = 11;
const ayRegEnvCoarse = 12;
const ayRegEnvShape = 13;
const ayRegIoA = 14;
const ayAmpEnvMode = 0x10;
const ayMixerPortAOut = 0x40;

const ayResetState = {
    noiseLfsr: 1,
    noiseCounter: 0,
    noiseLevel: 0,
    clockDividerPhase: false,
    areaA: 0,
    areaB: 0,
    areaC: 0,
};

const ayEnvResetState = {
    counter: 0,
    step: 0,
    attack: false,
    holding: false,
    level: 0,
};

/**
 * @typedef {{
 *   counter: number,
 *   step: number,
 *   attack: boolean,
 *   holding: boolean,
 *   level: number,
 * }} AyEnv
 */

/**
 * t is the T-state the chip has been integrated up to, and area* accumulate
 * level x duration since the last sample was taken.
 *
 * @typedef {{
 *   tickT: number,
 *   t: number,
 *   nextTickT: number,
 *   regs: Uint8Array,
 *   toneCounter: Uint32Array,
 *   toneLevel: Uint8Array,
 *   noiseLfsr: number,
 *   noiseCounter: number,
 *   noiseLevel: number,
 *   env: AyEnv,
 *   clockDividerPhase: boolean,
 *   out: Float64Array,
 *   filterOut: Float64Array,
 *   filterDecay: Float64Array,
 *   filterTauT: number,
 *   areaA: number,
 *   areaB: number,
 *   areaC: number,
 * }} Ay
 */

/**
 * Create the PSG with its machine clock and external amplifier time constant.
 *
 * @param {number} tickT T-states between chip ticks
 * @param {number} filterTauT external output-filter time constant in T-states
 * @returns {Ay}
 */
export function createAy(tickT, filterTauT) {
    const ay = {
        tickT,
        filterTauT,
        t: 0,
        nextTickT: 0,
        regs: new Uint8Array(16),
        toneCounter: new Uint32Array(3),
        toneLevel: new Uint8Array(3),
        ...ayResetState,
        env: {...ayEnvResetState},
        out: new Float64Array(3),
        filterOut: new Float64Array(3),
        filterDecay: new Float64Array(tickT + 1),
    };
    for (let t = 0; t <= tickT; t += 1) {
        ay.filterDecay[t] = Math.exp(-t / filterTauT);
    }
    resetAy(ay, 0);
    return ay;
}

/**
 * @param {Ay} ay
 * @param {number} t
 */
export function resetAy(ay, t) {
    ay.regs.fill(0);
    ay.regs[ayRegMixer] = 0x3F;
    ay.toneCounter.fill(0);
    ay.toneLevel.fill(0);
    Object.assign(ay, ayResetState);
    Object.assign(ay.env, ayEnvResetState);
    ay.filterOut.fill(0);
    ay.t = t;
    ay.nextTickT = t + ay.tickT;
    ayRefreshLevels(ay);
}

/**
 * Move the chip clock without disturbing chip state, for when audio output
 * starts or the sample rate changes and the accumulated areas are stale. The
 * chip clock is free-running, so a seek to the time it already holds keeps its
 * tick phase instead of re-phasing the grid.
 *
 * @param {Ay} ay
 * @param {number} t
 */
export function aySeek(ay, t) {
    if (t !== ay.t) {
        ay.t = t;
        ay.nextTickT = t + ay.tickT;
    }
    ay.areaA = 0;
    ay.areaB = 0;
    ay.areaC = 0;
}

/**
 * @param {Ay} ay
 * @param {number} reg
 * @param {number} value
 */
export function ayWriteReg(ay, reg, value) {
    const addr = reg & 0x0F;
    ay.regs[addr] = value & 0xFF;
    if (addr === ayRegEnvShape) {
        ayEnvReset(ay);
    }
    ayRefreshLevels(ay);
}

/**
 * @param {Ay} ay
 * @param {number} reg
 * @param {number} portAIn level held on the I/O port A pins by whatever is wired there
 * @returns {number}
 */
export function ayReadReg(ay, reg, portAIn) {
    const addr = reg & 0x0F;
    if (addr === ayRegIoA) {
        if ((ay.regs[ayRegMixer] & ayMixerPortAOut) === 0) {
            return portAIn & 0xFF;
        }
        return ay.regs[addr];
    }
    if (addr === 0x0F) {
        return 0xFF;
    }
    return ay.regs[addr];
}

/**
 * Integrate the chip forward to an exact T-state, accumulating level x duration
 * per channel. Register writes flush through here first, so an envelope retrigger
 * lands on the T-state that wrote it rather than on the next sample boundary.
 *
 * @param {Ay} ay
 * @param {number} t
 */
export function ayRunTo(ay, t) {
    ayAdvanceTo(ay, t, true);
}

/**
 * Advance the chip with nothing listening. The counters, noise shift register
 * and envelope still run, so a tone or envelope that should finish during a
 * discarded turbo burst really does; only the per-interval sample areas are
 * skipped.
 *
 * @param {Ay} ay
 * @param {number} t
 */
export function ayRunSilent(ay, t) {
    ayAdvanceTo(ay, t, false);
}

/**
 * @param {Ay} ay
 * @param {number} period
 * @param {Float32Array} channelA
 * @param {Float32Array} channelB
 * @param {Float32Array} channelC
 * @param {number} at
 */
export function ayTakeSample(ay, period, channelA, channelB, channelC, at) {
    const inv = 1 / period;
    channelA[at] = ay.areaA * inv;
    channelB[at] = ay.areaB * inv;
    channelC[at] = ay.areaC * inv;
    ay.areaA = 0;
    ay.areaB = 0;
    ay.areaC = 0;
}

/**
 * Advance both the chip and its external analog reconstruction filter.
 *
 * @param {Ay} ay
 * @param {number} t
 * @param {boolean} collect
 */
function ayAdvanceTo(ay, t, collect) {
    while (t > ay.t) {
        let next = ay.nextTickT;
        if (next > t) {
            next = t;
        }
        const dur = next - ay.t;
        const decay = ay.filterDecay[dur];
        const areaScale = ay.filterTauT * (1 - decay);
        const deltaA = ay.filterOut[0] - ay.out[0];
        const deltaB = ay.filterOut[1] - ay.out[1];
        const deltaC = ay.filterOut[2] - ay.out[2];
        if (collect) {
            ay.areaA += ay.out[0] * dur + deltaA * areaScale;
            ay.areaB += ay.out[1] * dur + deltaB * areaScale;
            ay.areaC += ay.out[2] * dur + deltaC * areaScale;
        }
        ay.filterOut[0] = ay.out[0] + deltaA * decay;
        ay.filterOut[1] = ay.out[1] + deltaB * decay;
        ay.filterOut[2] = ay.out[2] + deltaC * decay;
        ay.t = next;
        if (ay.t === ay.nextTickT) {
            ayTick(ay);
            ayRefreshLevels(ay);
            ay.nextTickT += ay.tickT;
        }
    }
}

/**
 * Clock tone every divider step and noise plus envelope on alternating steps.
 *
 * @param {Ay} ay
 */
function ayTick(ay) {
    const clock16 = !ay.clockDividerPhase;
    ay.clockDividerPhase = !ay.clockDividerPhase;

    for (let ch = 0; ch < 3; ch += 1) {
        if (ay.toneCounter[ch] === 0) {
            ay.toneLevel[ch] ^= 1;
            const half = ayTonePeriod(ay, ch);
            ay.toneCounter[ch] = half - 1;
        } else {
            ay.toneCounter[ch] -= 1;
        }
    }

    if (clock16) {
        if (ay.noiseCounter === 0) {
            ay.noiseCounter = ayNoisePeriod(ay) - 1;
            ayNoiseTick(ay);
        } else {
            ay.noiseCounter -= 1;
        }
        if (ay.env.counter === 0) {
            ay.env.counter = ayEnvPeriod(ay) - 1;
            ayEnvStep(ay);
        } else {
            ay.env.counter -= 1;
        }
    }
}

/**
 * Cache the three output levels. Everything that can change them - a tick, a
 * register write, an envelope step - calls this, so integrating a span is three
 * multiply-adds with no register decoding in the loop.
 *
 * @param {Ay} ay
 */
function ayRefreshLevels(ay) {
    const mixer = ay.regs[ayRegMixer];
    const noiseHigh = ay.noiseLevel !== 0;
    for (let ch = 0; ch < 3; ch += 1) {
        const toneOut = ay.toneLevel[ch] !== 0 || (mixer & (1 << ch)) !== 0;
        const noiseOut = noiseHigh || (mixer & (1 << (ch + 3))) !== 0;
        if (!toneOut || !noiseOut) {
            ay.out[ch] = 0;
            continue;
        }
        const ampreg = ay.regs[ayRegAmpA + ch];
        let amp = ampreg & 0x0F;
        if ((ampreg & ayAmpEnvMode) !== 0) {
            amp = ay.env.level;
        }
        ay.out[ch] = ayVolume[amp];
    }
}

/** @param {Ay} ay */
function ayEnvReset(ay) {
    const e = ay.env;
    e.attack = (ay.regs[ayRegEnvShape] & 0x04) !== 0;
    e.step = 0;
    e.holding = false;
    e.counter = ayEnvPeriod(ay) - 1;
    ayEnvSetLevel(ay);
}

/** @param {Ay} ay */
function ayEnvStep(ay) {
    const e = ay.env;
    if (e.holding) {
        return;
    }
    if (e.step < 15) {
        e.step += 1;
        ayEnvSetLevel(ay);
        return;
    }
    const shape = ay.regs[ayRegEnvShape] & 0x0F;
    const cont = (shape & 0x08) !== 0;
    const alt = (shape & 0x02) !== 0;
    const hold = (shape & 0x01) !== 0;
    if (!cont) {
        e.holding = true;
        e.level = 0;
        return;
    }
    if (hold) {
        e.holding = true;
        if (alt) {
            e.attack = !e.attack;
        }
        if (e.attack) {
            e.level = 15;
        } else {
            e.level = 0;
        }
        return;
    }
    if (alt) {
        e.attack = !e.attack;
    }
    e.step = 0;
    ayEnvSetLevel(ay);
}

/** @param {Ay} ay */
function ayNoiseTick(ay) {
    const feedback = (ay.noiseLfsr ^ (ay.noiseLfsr >> 3)) & 1;
    ay.noiseLfsr = (ay.noiseLfsr >> 1) | (feedback << 16);
    ay.noiseLevel = ay.noiseLfsr & 1;
}

/**
 * @param {Ay} ay
 * @param {number} ch
 * @returns {number}
 */
function ayTonePeriod(ay, ch) {
    const fine = ay.regs[ch * 2];
    const coarse = ay.regs[ch * 2 + 1] & 0x0F;
    return Math.max((coarse << 8) | fine, 1);
}

/**
 * @param {Ay} ay
 * @returns {number}
 */
function ayNoisePeriod(ay) {
    return Math.max(ay.regs[ayRegNoise] & 0x1F, 1);
}

/**
 * @param {Ay} ay
 * @returns {number}
 */
function ayEnvPeriod(ay) {
    return Math.max(ay.regs[ayRegEnvFine] | (ay.regs[ayRegEnvCoarse] << 8), 1);
}

/** @param {Ay} ay */
function ayEnvSetLevel(ay) {
    const e = ay.env;
    if (e.attack) {
        e.level = e.step;
    } else {
        e.level = 15 - e.step;
    }
}
