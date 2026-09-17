import {initScreen, resizeScreen, setCrt, drawScreen} from "./screen.js";

import {
    createMachine,
    resetMachine,
    runFrame,
    autoloadTape,
    playTape,
    requestNmi,
    setVideoOn,
    enableSound,
    setSoundRate,
    takeAudio,
    tapeInfo,
    tapeState,
    setHomeRom,
    setExRom,
    cpuHz,
    tStatesPerFrame,
    homeRomSize,
    exRomSize,
} from "./machine.js";

import {loadShaders, loadStartupRoms} from "./boot.js";

import {initJoysticks, pollJoysticks} from "./joystick.js";

import {initKeyboard, handleKeyDown, handleKeyUp, handleBlur, scaleKeyboardFromY} from "./keyboard.js";

import {
    initSound,
    resumeSound,
    resetSound,
    pushSound,
    setSoundStereo,
    setSoundNeedCallback,
    setSoundStateCallback,
    soundIsRunning,
    soundWantsFrame,
    soundStats,
} from "./sound.js";

const framesPerSecond  = cpuHz / tStatesPerFrame;
const frameMs          = 1000 / framesPerSecond;
const turboFrames      = 100;
// Most frames a turbo burst mixes before starting the next one. They run only
// while the audio queue is short; one frame is painted either way, so the
// display keeps following the tape.
const turboShownFrames = 4;
// How far the wall-clock budget may go into deficit. Audio-driven frames are
// charged to it in full, so it has to be able to go negative or the display
// loop runs those frames a second time; bounding it stops a long stall from
// banking catch-up the machine would then sprint through.
const carryFloorMs     = -4 * frameMs;
const statsWindowMs    = 1000;

/**
 * Chrome both pages share. Optional `nmi` is bound when the page has that
 * button.
 *
 * @typedef {{
 *   pageHeader:       HTMLElement,
 *   initInfo:         HTMLElement,
 *   soundInfo:        HTMLElement,
 *   auto:             HTMLInputElement,
 *   playTape:         HTMLButtonElement,
 *   tapeInfo:         HTMLElement,
 *   reset:            HTMLButtonElement,
 *   screenSlot:       HTMLElement,
 *   screen:           HTMLCanvasElement,
 *   keyboardSplit:    HTMLElement,
 *   keyboard:         HTMLElement,
 *   keyboardToggle:   HTMLInputElement,
 *   crt:              HTMLInputElement,
 *   stereo:           HTMLInputElement,
 *   fullscreenToggle: HTMLButtonElement,
 *   turbo:            HTMLInputElement,
 *   nmi?:             HTMLButtonElement,
 * }} HostUi
 */

/**
 * Page-specific host wiring. Callbacks that return true consume the event so
 * the emulator does not also see it. onResize runs before the screen is
 * fitted, so a page can drop a leftover split size when the workspace axis
 * changes. onRomsReady runs after the startup ROM fetch finishes, including
 * when it fails, so a page can apply a `?url=` file that arrived first.
 *
 * @typedef {{
 *   query: URLSearchParams,
 *   chrome?: HTMLElement[],
 *   screenOnlyClass?: boolean,
 *   onKeyDown?: function(KeyboardEvent): boolean,
 *   onKeyUp?: function(KeyboardEvent): boolean,
 *   onResize?: function(): void,
 *   onScreenOnly?: function(boolean): void,
 *   onRomsReady?: function(): void,
 *   onRomSlot?: function(number, string, string | null): void,
 * }} HostOptions
 */

/**
 * @typedef {{
 *   ui:                 HostUi,
 *   machine:            import("./machine.js").Machine,
 *   kbd:                import("./keyboard.js").Keyboard,
 *   gfx:                import("./screen.js").Gfx | null,
 *   sfx:                import("./sound.js").Sfx | null,
 *   tapeName:           string,
 *   tapeState:          import("./machine.js").TapeState,
 *   frameId:            number | undefined,
 *   lastNow:            number,
 *   carryMs:            number,
 *   framesRun:          number,
 *   statsAt:            number,
 *   statsCut:           number,
 *   statsGap:           number,
 *   keyboardVisible:    boolean,
 *   screenOnly:         boolean,
 *   abortLoadRoms:      (function(): void) | null,
 *   screenOnlyFallback: boolean,
 *   joystick:           Uint8Array,
 *   chrome:             HTMLElement[],
 *   screenOnlyClass:    boolean,
 *   onKeyDown:          (function(KeyboardEvent): boolean) | null,
 *   onKeyUp:            (function(KeyboardEvent): boolean) | null,
 *   onResize:           (function(): void) | null,
 *   onScreenOnly:       (function(boolean): void) | null,
 * }} Host
 */

/**
 * @param {HTMLElement} el
 * @param {string} text
 */
export function showInfo(el, text) {
    el.textContent = text;
    el.classList.remove("error");
}

/**
 * @param {HTMLElement} el
 * @param {string} text
 */
export function showError(el, text) {
    el.textContent = text;
    el.classList.add("error");
}

/**
 * @param {HTMLInputElement} input
 * @param {string} value
 */
export function applySwitchParamValue(input, value) {
    switch (value) {
    case "0":
        input.checked = false;
        break;
    case "1":
        input.checked = true;
        break;
    }
}

/**
 * Build the shared emulator session and start its frame loop, display, sound,
 * and ROM fetch. Page-specific media loading stays in the page.
 *
 * @param {HostUi} ui
 * @param {HostOptions} options
 * @returns {Host}
 */
export function createHost(ui, options) {
    const keyMatrix = new Uint8Array(8);
    const joystick  = new Uint8Array(2);
    initJoysticks(joystick);

    /** @type {HTMLElement[]} */
    let chrome = [];
    if (options.chrome !== undefined) {
        chrome = options.chrome;
    }
    let screenOnlyClass = false;
    if (options.screenOnlyClass !== undefined) {
        screenOnlyClass = options.screenOnlyClass;
    }
    /** @type {(function(KeyboardEvent): boolean) | null} */
    let onKeyDown = null;
    if (options.onKeyDown !== undefined) {
        onKeyDown = options.onKeyDown;
    }
    /** @type {(function(KeyboardEvent): boolean) | null} */
    let onKeyUp = null;
    if (options.onKeyUp !== undefined) {
        onKeyUp = options.onKeyUp;
    }
    /** @type {(function(): void) | null} */
    let onResize = null;
    if (options.onResize !== undefined) {
        onResize = options.onResize;
    }
    /** @type {(function(boolean): void) | null} */
    let onScreenOnly = null;
    if (options.onScreenOnly !== undefined) {
        onScreenOnly = options.onScreenOnly;
    }
    /** @type {(function(): void) | null} */
    let onRomsReady = null;
    if (options.onRomsReady !== undefined) {
        onRomsReady = options.onRomsReady;
    }
    /** @type {(function(number, string, string | null): void) | null} */
    let onRomSlot = null;
    if (options.onRomSlot !== undefined) {
        onRomSlot = options.onRomSlot;
    }

    /** @type {Host} */
    const host = {
        ui,
        machine:            createMachine(keyMatrix, joystick),
        kbd:                initKeyboard(ui.keyboard, keyMatrix),
        gfx:                null,
        sfx:                null,
        tapeName:           "",
        tapeState:          "empty",
        frameId:            undefined,
        lastNow:            0,
        carryMs:            0,
        framesRun:          0,
        statsAt:            0,
        statsCut:           0,
        statsGap:           0,
        keyboardVisible:    false,
        screenOnly:         false,
        abortLoadRoms:      null,
        screenOnlyFallback: false,
        joystick,
        chrome,
        screenOnlyClass,
        onKeyDown,
        onKeyUp,
        onResize,
        onScreenOnly,
    };

    applySwitchParamValue(ui.keyboardToggle, options.query.get("keyboard") ?? "");
    applySwitchParamValue(ui.crt, options.query.get("crt") ?? "");
    applySwitchParamValue(ui.stereo, options.query.get("stereo") ?? "");
    applySwitchParamValue(ui.auto, options.query.get("auto") ?? "");
    applySwitchParamValue(ui.turbo, options.query.get("turbo") ?? "");
    setKeyboardVisibility(host, ui.keyboardToggle.checked);

    ui.reset.onclick = function () {
        resetSystem(host);
    };

    ui.playTape.onclick = function () {
        playTape(host.machine);
    };

    if (ui.nmi !== undefined) {
        ui.nmi.onclick = function () {
            requestNmi(host.machine);
        };
    }

    ui.keyboardToggle.onchange = function () {
        setKeyboardVisibility(host, ui.keyboardToggle.checked);
    };

    ui.crt.onchange = function () {
        if (host.gfx !== null) {
            setCrt(host.gfx, ui.crt.checked);
        }
    };

    ui.stereo.onchange = function () {
        if (host.sfx !== null) {
            setSoundStereo(host.sfx, ui.stereo.checked);
        }
    };

    ui.fullscreenToggle.onclick = function () {
        toggleCanvasFullscreen(host);
    };

    ui.keyboardSplit.onpointerdown = function (/** @type {PointerEvent} */ e) {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        document.body.classList.add("keyboard-splitting");
        scaleKeyboardFromY(ui.keyboard, ui.keyboardSplit, e.clientY);
        resizeHost(host);
        ui.keyboardSplit.setPointerCapture(e.pointerId);
    };

    ui.keyboardSplit.onpointermove = function (/** @type {PointerEvent} */ e) {
        if (!ui.keyboardSplit.hasPointerCapture(e.pointerId)) {
            return;
        }
        scaleKeyboardFromY(ui.keyboard, ui.keyboardSplit, e.clientY);
        resizeHost(host);
    };

    ui.keyboardSplit.onpointerup = function (/** @type {PointerEvent} */ e) {
        endKeyboardSplit(host, e.pointerId);
    };

    ui.keyboardSplit.onpointercancel = function (/** @type {PointerEvent} */ e) {
        endKeyboardSplit(host, e.pointerId);
    };

    new ResizeObserver(function () {
        if (host.onResize !== null) {
            host.onResize();
        }
        resizeHost(host);
    }).observe(ui.screenSlot);

    document.onfullscreenchange = function () {
        let on = false;
        if (document.fullscreenElement !== null || host.screenOnlyFallback) {
            on = true;
        }
        setScreenOnly(host, on);
    };

    window.onkeydown = function (e) {
        if (host.sfx !== null) {
            resumeSound(host.sfx);
        }
        if (e.code === "F1") {
            e.preventDefault();
            if (!e.repeat) {
                setKeyboardVisibility(host, !host.keyboardVisible);
            }
            return;
        }
        if (e.code === "F11") {
            e.preventDefault();
            if (!e.repeat) {
                toggleCanvasFullscreen(host);
            }
            return;
        }
        if (host.onKeyDown !== null && host.onKeyDown(e)) {
            return;
        }
        handleKeyDown(host.kbd, e);
    };

    window.onpointerdown = function () {
        if (host.sfx !== null) {
            resumeSound(host.sfx);
        }
    };

    window.onkeyup = function (e) {
        if (e.code === "F1" || e.code === "F11") {
            e.preventDefault();
            return;
        }
        if (host.onKeyUp !== null && host.onKeyUp(e)) {
            return;
        }
        handleKeyUp(host.kbd, e);
    };

    window.onblur = function () {
        handleBlur(host.kbd);
    };

    loadShaders(
        function (err, shaders) {
            if (err !== null) {
                showError(ui.initInfo, err);
                return;
            }
            if (shaders === null) {
                showError(ui.initInfo, "No shaders.");
                return;
            }
            initScreen(
                ui.screen,
                shaders,
                function (err, gfx) {
                    host.gfx = gfx;
                    if (err !== null) {
                        showError(ui.initInfo, err);
                        return;
                    }
                    if (gfx === null) {
                        showError(ui.initInfo, "No graphics context.");
                        return;
                    }
                    setCrt(gfx, ui.crt.checked);
                    showInfo(ui.initInfo, "Ready.");
                },
            );
        },
    );

    initSound(
        framesPerSecond,
        function (err, sfx) {
            if (err !== null) {
                showError(ui.soundInfo, "No sound: " + err);
                return;
            }
            if (sfx === null) {
                showError(ui.soundInfo, "No sound.");
                return;
            }
            host.sfx = sfx;
            setSoundNeedCallback(sfx, function () {
                fillSoundQueue(host);
            });
            setSoundStereo(sfx, ui.stereo.checked);
            setSoundRate(host.machine, sfx.context.sampleRate);
            setSoundStateCallback(sfx, function (running) {
                syncSoundState(host, running);
            });
            syncSoundState(host, soundIsRunning(sfx));
        },
    );

    host.abortLoadRoms = loadStartupRoms(
        options.query.get("rom") ?? "",
        homeRomSize,
        exRomSize,
        function (errs, names, roms) {
            host.abortLoadRoms = null;
            // Each slot stands on its own: install the ones that arrived even
            // when the other failed, rather than dropping a ROM already held.
            let homeErr = errs[0];
            let exErr = errs[1];
            let installed = false;
            if (roms[0] !== null) {
                homeErr = setHomeRom(host.machine, roms[0]);
                if (homeErr === null) {
                    installed = true;
                }
            }
            if (roms[1] !== null) {
                exErr = setExRom(host.machine, roms[1]);
                if (exErr === null) {
                    installed = true;
                }
            }
            if (onRomSlot !== null) {
                onRomSlot(0, names[0], homeErr);
                onRomSlot(1, names[1], exErr);
            } else {
                // No per-slot reporter, so both errors share the one line.
                let msg = "";
                if (homeErr !== null) {
                    msg = homeErr;
                }
                if (exErr !== null) {
                    if (msg !== "") {
                        msg += " ";
                    }
                    msg += exErr;
                }
                if (msg !== "") {
                    showError(ui.initInfo, msg);
                }
            }
            if (installed) {
                resetSystem(host);
            }
            if (onRomsReady !== null) {
                onRomsReady();
            }
        },
    );

    host.frameId = requestAnimationFrame(function (now) {
        onFrame(host, now);
    });

    return host;
}

/** @param {Host} host */
export function resetSystem(host) {
    if (host.sfx === null) {
        resetMachine(host.machine);
        return;
    }
    resetSound(host.sfx);
    resetMachine(host.machine);
    resumeSound(host.sfx);
}

/**
 * Report what the tape transport is doing. This runs every frame, so it only
 * touches the page when something it shows actually changes. A load error
 * stands until the next tape is chosen. A failed insert still ejects the
 * previous tape, so Play stays disabled.
 *
 * @param {Host} host
 * @param {string | null} err
 */
export function refreshTapeStatus(host, err) {
    const state = tapeState(host.machine);
    if (err !== null) {
        host.tapeState = state;
        showError(host.ui.tapeInfo, err);
        host.ui.playTape.textContent = "Play";
        host.ui.playTape.disabled = true;
        return;
    }
    if (host.tapeState === state) {
        return;
    }
    host.tapeState = state;
    switch (host.tapeState) {
    case "empty":
        showInfo(host.ui.tapeInfo, "No tape");
        host.ui.playTape.textContent = "Play";
        host.ui.playTape.disabled = true;
        break;
    case "ready": {
        const blockCount = tapeInfo(host.machine).blockCount + " blocks.";
        const playMessage = "Enter LOAD \"\" or press Play.";
        showInfo(host.ui.tapeInfo, host.tapeName + ": " + blockCount + " " + playMessage);
        host.ui.playTape.textContent = "Play";
        host.ui.playTape.disabled = false;
        break;
    }
    case "playing":
        showInfo(host.ui.tapeInfo, host.tapeName + ": Loading.");
        host.ui.playTape.textContent = "Play";
        host.ui.playTape.disabled = true;
        break;
    case "blocked": {
        const resumeMessage = "Enter LOAD \"\" or press Resume for the next part.";
        showInfo(host.ui.tapeInfo, host.tapeName + ": Stopped. " + resumeMessage);
        host.ui.playTape.textContent = "Resume";
        host.ui.playTape.disabled = false;
        break;
    }
    case "done":
        showInfo(host.ui.tapeInfo, host.tapeName + ": Ended.");
        host.ui.playTape.textContent = "Play";
        host.ui.playTape.disabled = true;
        break;
    }
}

/**
 * @param {Host} host
 * @returns {boolean}
 */
export function autoloadTapeIfEnabled(host) {
    if (!host.ui.auto.checked) {
        return false;
    }
    if (!autoloadTape(host.machine)) {
        return false;
    }
    if (host.sfx !== null) {
        resetSound(host.sfx);
    }
    return true;
}

/** @param {Host} host */
export function resizeHost(host) {
    if (host.gfx !== null) {
        resizeScreen(host.gfx);
    }
}

/**
 * @param {Host} host
 * @param {boolean} visible
 */
function setKeyboardVisibility(host, visible) {
    host.keyboardVisible = visible;
    host.ui.keyboardToggle.checked = visible;
    applyVisibility(host);
}

/** @param {Host} host */
function toggleCanvasFullscreen(host) {
    if (document.fullscreenElement !== null || host.screenOnlyFallback) {
        host.screenOnlyFallback = false;
        if (document.fullscreenElement !== null && document.exitFullscreen !== undefined) {
            document.exitFullscreen()?.then(
                function () {
                },
                function () {
                    setScreenOnly(host, false);
                },
            );
            return;
        }
        setScreenOnly(host, false);
        return;
    }

    const slot = host.ui.screen.parentElement;
    if (slot?.requestFullscreen === undefined) {
        host.screenOnlyFallback = true;
        setScreenOnly(host, true);
        return;
    }
    slot.requestFullscreen()?.then(
        function () {
        },
        function () {
            host.screenOnlyFallback = true;
            setScreenOnly(host, true);
        },
    );
}

/**
 * @param {Host} host
 * @param {boolean} on
 */
function setScreenOnly(host, on) {
    host.screenOnly = on;
    applyVisibility(host);
    if (host.onScreenOnly !== null) {
        host.onScreenOnly(on);
    }
}

/** @param {Host} host */
function applyVisibility(host) {
    let chromeDisplay = "";
    if (host.screenOnly) {
        chromeDisplay = "none";
        if (host.screenOnlyClass) {
            host.ui.screenSlot.classList.add("screen-only");
        }
    } else if (host.screenOnlyClass) {
        host.ui.screenSlot.classList.remove("screen-only");
    }
    let keyboard = "";
    if (host.screenOnly || !host.keyboardVisible) {
        keyboard = "none";
    }
    host.ui.pageHeader.style.display = chromeDisplay;
    for (let i = 0; i < host.chrome.length; i += 1) {
        host.chrome[i].style.display = chromeDisplay;
    }
    host.ui.keyboardSplit.style.display = keyboard;
    host.ui.keyboard.style.display = keyboard;
    resizeHost(host);
}

/**
 * @param {Host} host
 * @param {number} pointerId
 */
function endKeyboardSplit(host, pointerId) {
    if (host.ui.keyboardSplit.hasPointerCapture(pointerId)) {
        host.ui.keyboardSplit.releasePointerCapture(pointerId);
    }
    document.body.classList.remove("keyboard-splitting");
}

/**
 * @param {Host} host
 * @param {number} now
 */
function onFrame(host, now) {
    host.frameId = requestAnimationFrame(function (next) {
        onFrame(host, next);
    });
    pollJoysticks(host.joystick);
    if (host.lastNow === 0) {
        host.lastNow = now;
        host.carryMs = frameMs;
    }
    let dt = now - host.lastNow;
    host.lastNow = now;
    if (dt > 80) {
        dt = 80;
    }
    host.carryMs += dt;
    const turboEnabled = host.ui.turbo.checked;
    let ran = 0;
    while (host.carryMs >= frameMs && ran < 4) {
        stepMachine(host, turboEnabled);
        host.carryMs -= frameMs;
        ran += 1;
    }
    if (turboLoading(host)) {
        while (ran < turboFrames && turboLoading(host)) {
            stepMachine(host, turboEnabled);
            ran += 1;
        }
        // Mix the frames the burst landed on, so the loader is heard while the
        // tape warps past. A run of neighbouring frames is one snippet, where
        // one frame per refresh is a fragment the worklet fades in and out of,
        // and only what the queue has room for is worth running: the rest
        // would be cut at the play head, which is what a click sounds like.
        let shown = 0;
        while (shown < turboShownFrames && host.sfx !== null && soundWantsFrame(host.sfx)) {
            stepMachine(host, false);
            shown += 1;
        }
        if (shown === 0) {
            stepPaintedMachine(host);
        }
    } else if (ran < 4) {
        fillSoundQueue(host);
    }
    refreshTapeStatus(host, null);
    refreshSoundStatus(host, now);
    if (host.gfx !== null) {
        drawScreen(host.gfx, host.machine.pixels);
    }
}

/**
 * Paint one frame without mixing it. A burst still has to show where the tape
 * got to when the queue is already full, and audio it has no room for would
 * only be cut at the play head.
 *
 * @param {Host} host
 */
function stepPaintedMachine(host) {
    setVideoOn(host.machine, true);
    enableSound(host.machine, false);
    runFrame(host.machine);
    host.framesRun += 1;
    takeAudio(host.machine);
}

/**
 * Run the machine while the audio queue is below its low mark, which is what
 * the audio thread asks for when it is about to run out. Every frame is charged
 * to the wall-clock budget in full: a frame the queue needed now is a frame the
 * display loop must not run again later.
 *
 * @param {Host} host
 */
function fillSoundQueue(host) {
    if (host.sfx === null || !soundIsRunning(host.sfx)) {
        return;
    }
    for (let ran = 0; ran < 4 && soundWantsFrame(host.sfx); ran += 1) {
        stepMachine(host, false);
        host.carryMs = Math.max(host.carryMs - frameMs, carryFloorMs);
    }
}

/**
 * Report emulated speed and what the audio queue lost, once a second. Frames
 * per second above the machine's own rate means the frame loop is running it
 * too fast, and the cut and gap milliseconds are the audio an overrun discarded
 * and an underrun filled with silence over that second.
 *
 * @param {Host} host
 * @param {number} now
 */
function refreshSoundStatus(host, now) {
    if (host.sfx === null) {
        return;
    }
    if (host.statsAt === 0) {
        host.statsAt = now;
        host.framesRun = 0;
        return;
    }
    const span = now - host.statsAt;
    if (span < statsWindowMs) {
        return;
    }
    const stats = soundStats(host.sfx);
    const fps = host.framesRun * 1000 / span;
    const cut = Math.round(stats.cut - host.statsCut);
    const gap = Math.round(stats.gap - host.statsGap);
    host.statsAt = now;
    host.framesRun = 0;
    host.statsCut = stats.cut;
    host.statsGap = stats.gap;
    showInfo(host.ui.soundInfo, fps.toFixed(1) + " fps, cut " + cut + " ms, gap " + gap + " ms");
}

/**
 * @param {Host} host
 * @param {boolean} running
 */
function syncSoundState(host, running) {
    enableSound(host.machine, running);
}

/**
 * Whether the tape is being warped through, which is when frames are thrown
 * away undrawn and unmixed. Read again wherever it matters, since a burst can
 * end part way through a frame's worth of stepping.
 *
 * @param {Host} host
 * @returns {boolean}
 */
function turboLoading(host) {
    return host.ui.turbo.checked && tapeState(host.machine) === "playing";
}

/**
 * @param {Host} host
 * @param {boolean} turboEnabled
 */
function stepMachine(host, turboEnabled) {
    const turbo = turboEnabled && tapeState(host.machine) === "playing";
    setVideoOn(host.machine, !turbo);
    let sound = false;
    if (!turbo && host.sfx !== null) {
        sound = soundIsRunning(host.sfx);
    }
    enableSound(host.machine, sound);
    runFrame(host.machine);
    host.framesRun += 1;
    const chunk = takeAudio(host.machine);
    if (turbo) {
        return;
    }
    if (chunk.n > 0 && host.sfx !== null && (soundIsRunning(host.sfx) || soundWantsFrame(host.sfx))) {
        pushSound(host.sfx, chunk);
    }
}
