import {initScreen, resizeScreen, setCrt, drawScreen, stampPause} from "./screen.js";

import {
    createMachine,
    resetMachine,
    runFrame,
    autoloadTape,
    insertTape,
    ejectTape,
    playTape,
    rewindTape,
    forwardTape,
    requestNmi,
    setVideoOn,
    enableSound,
    setSoundRate,
    takeAudio,
    tapeInfo,
    tapeState,
    tapeListing,
    tapeCursor,
    cartInfo,
    setHomeRom,
    setExRom,
    cpuHz,
    tStatesPerFrame,
    homeRomSize,
    exRomSize,
} from "./machine.js";

import {loadShaders, loadStartupRoms} from "./boot.js";

import {initJoysticks, pollJoysticks, padLabel} from "./joystick.js";

import {initKeyboard, handleKeyDown, handleKeyUp, handleBlur, faceHeight, setFaceHeight} from "./keyboard.js";

import {
    initSound,
    resumeSound,
    resetSound,
    pushSound,
    setSoundStereo,
    setSoundMuted,
    setSoundPaused,
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
// The keyboard grip can grow the board to this share of the window height.
const keyboardMaxShare = 0.45;

/**
 * Chrome both pages share: the TV, the recorder with its printout, and the
 * case. `paused` is the TV's pause switch, which stops the machine while it is
 * on. Optional `nmi` and `ejectCart` are bound when the page has them.
 * `tapeCounter` holds three digit cells, `tapeBlocks` is the printout's table
 * body, and `printoutRows` is the box it scrolls in.
 *
 * @typedef {{
 *   initInfo:         HTMLElement,
 *   soundInfo:        HTMLElement,
 *   paused:           HTMLInputElement,
 *   auto:             HTMLInputElement,
 *   playTape:         HTMLButtonElement,
 *   rewTape:          HTMLButtonElement,
 *   ffTape:           HTMLButtonElement,
 *   playTapeLabel:    HTMLElement,
 *   tapeInfo:         HTMLElement,
 *   recorder:         HTMLElement,
 *   tapeLabel:        HTMLElement,
 *   tapeCounter:      HTMLElement,
 *   tapeTotal:        HTMLElement,
 *   printout:         HTMLElement,
 *   printoutName:     HTMLElement,
 *   printoutSummary:  HTMLElement,
 *   printoutRows:     HTMLElement,
 *   tapeBlocks:       HTMLTableSectionElement,
 *   cartInfo:         HTMLElement,
 *   joy1Info:         HTMLElement,
 *   joy2Info:         HTMLElement,
 *   reset:            HTMLButtonElement,
 *   screenSlot:       HTMLElement,
 *   screen:           HTMLCanvasElement,
 *   keyboardSplit:    HTMLElement,
 *   keyboard:         HTMLElement,
 *   keyboardToggle:   HTMLInputElement,
 *   crt:              HTMLInputElement,
 *   stereo:           HTMLInputElement,
 *   muted:            HTMLInputElement,
 *   fullscreenToggle: HTMLButtonElement,
 *   turbo:            HTMLInputElement,
 *   nmi?:             HTMLButtonElement,
 *   ejectCart?:       HTMLButtonElement,
 * }} HostUi
 */

/**
 * Page-specific host wiring. Callbacks that return true consume the event so
 * the emulator does not also see it. onRomsReady runs after the startup ROM
 * fetch finishes, including when it fails, so a page can apply a `?url=` file
 * that arrived first.
 *
 * @typedef {{
 *   query: URLSearchParams,
 *   onKeyDown?: function(KeyboardEvent): boolean,
 *   onKeyUp?: function(KeyboardEvent): boolean,
 *   onScreenOnly?: function(boolean): void,
 *   onRomsReady?: function(): void,
 *   onRomSlot?: function(number, string, string | null): void,
 * }} HostOptions
 */

/**
 * The session. `tapeState` and `tapeCursor` are what the recorder last showed,
 * and `tapeDirty` forces a full repaint after a tape goes in or out.
 * `blockRows` and `blockCells` are the printout's rows and state cells, with
 * `blockStates` the state text each shows. `padIds` is what the joystick poll
 * found this frame and `shownPadIds` what the ports show. `pausedFrame` is the
 * last frame with the paused caption drawn in.
 *
 * @typedef {{
 *   ui:                 HostUi,
 *   machine:            import("./machine.js").Machine,
 *   pausedFrame:        Uint8Array,
 *   kbd:                import("./keyboard.js").Keyboard,
 *   gfx:                import("./screen.js").Gfx | null,
 *   sfx:                import("./sound.js").Sfx | null,
 *   tapeName:           string,
 *   tapeState:          import("./machine.js").TapeState,
 *   tapeCursor:         number,
 *   tapeDirty:          boolean,
 *   blockRows:          HTMLElement[],
 *   blockCells:         HTMLElement[],
 *   blockStates:        string[],
 *   padIds:             string[],
 *   shownPadIds:        string[],
 *   splitStartY:        number,
 *   splitStartHeight:   number,
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
 *   onKeyDown:          (function(KeyboardEvent): boolean) | null,
 *   onKeyUp:            (function(KeyboardEvent): boolean) | null,
 *   onScreenOnly:       (function(boolean): void) | null,
 * }} Host
 */

/**
 * Show a status text. The title repeats it, since a narrow status line
 * shortens it with an ellipsis.
 *
 * @param {HTMLElement} el
 * @param {string} text
 */
export function showInfo(el, text) {
    el.textContent = text;
    el.title = text;
    el.classList.remove("error");
}

/**
 * @param {HTMLElement} el
 * @param {string} text
 */
export function showError(el, text) {
    el.textContent = text;
    el.title = text;
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

    const machine = createMachine(keyMatrix, joystick);
    /** @type {Host} */
    const host = {
        ui,
        machine,
        pausedFrame:        new Uint8Array(machine.pixels.length),
        kbd:                initKeyboard(ui.keyboard, keyMatrix),
        gfx:                null,
        sfx:                null,
        tapeName:           "",
        tapeState:          "empty",
        tapeCursor:         0,
        tapeDirty:          true,
        blockRows:          [],
        blockCells:         [],
        blockStates:        [],
        padIds:             ["", ""],
        shownPadIds:        ["", ""],
        splitStartY:        0,
        splitStartHeight:   0,
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
        onKeyDown,
        onKeyUp,
        onScreenOnly,
    };

    paintPrintout(host);
    refreshTapeStatus(host, null);
    refreshCartStatus(host, "", null);

    applySwitchParamValue(ui.keyboardToggle, options.query.get("keyboard") ?? "");
    applySwitchParamValue(ui.crt, options.query.get("crt") ?? "");
    applySwitchParamValue(ui.stereo, options.query.get("stereo") ?? "");
    applySwitchParamValue(ui.muted, options.query.get("muted") ?? "");
    applySwitchParamValue(ui.auto, options.query.get("auto") ?? "");
    applySwitchParamValue(ui.turbo, options.query.get("turbo") ?? "");
    setKeyboardVisibility(host, ui.keyboardToggle.checked);

    ui.reset.onclick = function () {
        resetSystem(host);
    };

    ui.playTape.onclick = function () {
        playTape(host.machine);
    };

    ui.rewTape.onclick = function () {
        rewindTape(host.machine);
        refreshTapeStatus(host, null);
    };

    ui.ffTape.onclick = function () {
        forwardTape(host.machine);
        refreshTapeStatus(host, null);
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

    ui.muted.onchange = function () {
        if (host.sfx !== null) {
            setSoundMuted(host.sfx, ui.muted.checked);
        }
    };

    ui.paused.onchange = function () {
        if (host.sfx !== null) {
            setSoundPaused(host.sfx, ui.paused.checked);
        }
    };

    ui.fullscreenToggle.onclick = function () {
        toggleCanvasFullscreen(host);
    };

    // Dragging the grip up grows the keyboard; the TV above gives way through
    // the layout, and the resize observer refits the screen.
    ui.keyboardSplit.onpointerdown = function (/** @type {PointerEvent} */ e) {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        document.body.classList.add("keyboard-splitting");
        host.splitStartY = e.clientY;
        host.splitStartHeight = faceHeight(ui.keyboard);
        ui.keyboardSplit.setPointerCapture(e.pointerId);
    };

    ui.keyboardSplit.onpointermove = function (/** @type {PointerEvent} */ e) {
        if (!ui.keyboardSplit.hasPointerCapture(e.pointerId)) {
            return;
        }
        const height = host.splitStartHeight + host.splitStartY - e.clientY;
        setFaceHeight(ui.keyboard, height, window.innerHeight * keyboardMaxShare);
    };

    ui.keyboardSplit.onpointerup = function (/** @type {PointerEvent} */ e) {
        endKeyboardSplit(host, e.pointerId);
    };

    ui.keyboardSplit.onpointercancel = function (/** @type {PointerEvent} */ e) {
        endKeyboardSplit(host, e.pointerId);
    };

    // screen.js fits the canvas to its parent, so that is the box to watch.
    new ResizeObserver(function () {
        resizeHost(host);
    }).observe(ui.screen.parentElement ?? ui.screenSlot);

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
            setSoundMuted(sfx, ui.muted.checked);
            setSoundPaused(sfx, ui.paused.checked);
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
 * Put a tape in the recorder: the old one comes out first, then the cassette,
 * counter, and printout show the new one. A tape that fails to parse leaves
 * the recorder empty with the error showing.
 *
 * @param {Host} host
 * @param {string} name
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string | null}
 */
export function loadTape(host, name, bytes) {
    const err = insertTape(host.machine, bytes);
    host.tapeName = "";
    if (err === null) {
        host.tapeName = name;
    }
    paintPrintout(host);
    host.tapeDirty = true;
    refreshTapeStatus(host, err);
    return err;
}

/**
 * Take the tape out of the recorder.
 *
 * @param {Host} host
 */
export function unloadTape(host) {
    ejectTape(host.machine);
    host.tapeName = "";
    paintPrintout(host);
    host.tapeDirty = true;
    refreshTapeStatus(host, null);
}

/**
 * Report what the tape transport is doing. This runs every frame, so it only
 * touches the page when something it shows actually changes: the state, or
 * the block the tape has reached. A load error stands until the next tape is
 * chosen. A failed insert still ejects the previous tape, so Play stays
 * disabled.
 *
 * @param {Host} host
 * @param {string | null} err
 */
export function refreshTapeStatus(host, err) {
    const state = tapeState(host.machine);
    const cursor = tapeCursor(host.machine);
    if (err === null && !host.tapeDirty && host.tapeState === state && host.tapeCursor === cursor) {
        return;
    }
    const textChanged = err !== null || host.tapeDirty || host.tapeState !== state;
    host.tapeDirty = false;
    host.tapeState = state;
    host.tapeCursor = cursor;
    paintTransport(host);
    if (err !== null) {
        showError(host.ui.tapeInfo, err);
        host.ui.playTapeLabel.textContent = "Play";
        host.ui.playTape.disabled = true;
        return;
    }
    if (!textChanged) {
        return;
    }
    switch (host.tapeState) {
    case "empty":
        showInfo(host.ui.tapeInfo, "No tape");
        host.ui.playTapeLabel.textContent = "Play";
        host.ui.playTape.disabled = true;
        break;
    case "ready": {
        const blockCount = tapeInfo(host.machine).blockCount + " blocks.";
        const playMessage = "Enter LOAD \"\" or press Play.";
        showInfo(host.ui.tapeInfo, host.tapeName + ": " + blockCount + " " + playMessage);
        host.ui.playTapeLabel.textContent = "Play";
        host.ui.playTape.disabled = false;
        break;
    }
    case "playing":
        showInfo(host.ui.tapeInfo, host.tapeName + ": Loading.");
        host.ui.playTapeLabel.textContent = "Play";
        host.ui.playTape.disabled = true;
        break;
    case "blocked": {
        const resumeMessage = "Enter LOAD \"\" or press Resume for the next part.";
        showInfo(host.ui.tapeInfo, host.tapeName + ": Stopped. " + resumeMessage);
        host.ui.playTapeLabel.textContent = "Resume";
        host.ui.playTape.disabled = false;
        break;
    }
    case "done":
        showInfo(host.ui.tapeInfo, host.tapeName + ": Ended.");
        host.ui.playTapeLabel.textContent = "Play";
        host.ui.playTape.disabled = true;
        break;
    }
}

/**
 * Show what is in the dock: the cartridge's name and what it maps, or that
 * the dock is empty, or an error from loading one. Eject is only enabled with
 * a cartridge in.
 *
 * @param {Host} host
 * @param {string} name
 * @param {string | null} err
 */
export function refreshCartStatus(host, name, err) {
    const info = cartInfo(host.machine);
    if (err !== null) {
        showError(host.ui.cartInfo, err);
    } else if (info.hasCart) {
        showInfo(host.ui.cartInfo, name + ": " + info.summary);
    } else {
        showInfo(host.ui.cartInfo, "No cartridge.");
    }
    if (host.ui.ejectCart !== undefined) {
        host.ui.ejectCart.disabled = !info.hasCart;
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
function resizeHost(host) {
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

    const slot = host.ui.screenSlot;
    if (slot.requestFullscreen === undefined) {
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

/**
 * Screen-only mode is the fallback when real fullscreen is refused: CSS turns
 * the screen slot into a full-window overlay and hides the rest of the page.
 *
 * @param {Host} host
 */
function applyVisibility(host) {
    host.ui.screenSlot.classList.toggle("screen-only", host.screenOnly);
    let keyboard = "";
    if (host.screenOnly || !host.keyboardVisible) {
        keyboard = "none";
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
    pollJoysticks(host.joystick, host.padIds);
    refreshPorts(host);
    if (host.ui.paused.checked) {
        // The machine holds where it is. The wall-clock budget and the speed
        // report start afresh when it continues, so the pause is not caught
        // up on or reported as lost audio.
        host.lastNow = now;
        host.carryMs = 0;
        host.statsAt = 0;
        refreshTapeStatus(host, null);
        if (host.gfx !== null) {
            host.pausedFrame.set(host.machine.pixels);
            stampPause(host.pausedFrame);
            drawScreen(host.gfx, host.pausedFrame);
        }
        return;
    }
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
 * Rebuild the printout for the tape now in the recorder, one row per block,
 * and the parts of the recorder that only change with the tape: the cassette
 * label and the block total. With no tape the printout is hidden.
 *
 * @param {Host} host
 */
function paintPrintout(host) {
    const listing = tapeListing(host.machine);
    const blocks = listing.blocks;
    const ui = host.ui;
    ui.tapeBlocks.replaceChildren();
    host.blockRows = [];
    host.blockCells = [];
    host.blockStates = [];
    for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        const row = document.createElement("tr");
        const num = document.createElement("td");
        num.className = "num";
        num.textContent = String(i + 1);
        const kind = document.createElement("td");
        kind.textContent = block.kind;
        const contents = document.createElement("td");
        contents.textContent = block.contents;
        contents.title = block.contents;
        const bytes = document.createElement("td");
        bytes.className = "num";
        if (block.bytes !== null) {
            bytes.textContent = String(block.bytes);
        }
        const state = document.createElement("td");
        row.append(num, kind, contents, bytes, state);
        ui.tapeBlocks.appendChild(row);
        host.blockRows.push(row);
        host.blockCells.push(state);
        host.blockStates.push("");
    }
    let plural = "s";
    if (blocks.length === 1) {
        plural = "";
    }
    ui.printout.hidden = blocks.length === 0;
    ui.printoutName.textContent = host.tapeName;
    ui.printoutName.title = host.tapeName;
    ui.printoutSummary.textContent = listing.format + ", " + blocks.length + " block" + plural;
    ui.printoutRows.scrollTop = 0;
    ui.tapeLabel.textContent = host.tapeName;
    ui.tapeLabel.title = host.tapeName;
    ui.tapeTotal.textContent = "";
    if (blocks.length > 0) {
        ui.tapeTotal.textContent = "of " + blocks.length + " block" + plural;
    }
}

/**
 * Move the recorder to where the tape is: its state drives the cassette and
 * the reels, the counter shows the next block (END once all have played), and
 * the printout marks blocks done, the next one, or the one loading, keeping
 * that row in view. Only the state cells that change are written.
 *
 * @param {Host} host
 */
function paintTransport(host) {
    const ui = host.ui;
    const state = host.tapeState;
    const cursor = host.tapeCursor;
    const count = host.blockCells.length;
    ui.recorder.dataset.state = state;
    ui.recorder.toggleAttribute("data-wound", count > 0 && cursor >= count);
    ui.rewTape.disabled = state === "empty";
    ui.ffTape.disabled = state === "empty" || cursor >= count;
    let digits = "000";
    if (state !== "empty" && count > 0) {
        digits = "END";
        if (cursor < count) {
            digits = String(Math.min(cursor + 1, 999)).padStart(3, "0");
        }
    }
    const cells = ui.tapeCounter.children;
    for (let i = 0; i < cells.length && i < digits.length; i += 1) {
        cells[i].textContent = digits[i];
    }
    for (let i = 0; i < count; i += 1) {
        let text = "";
        if (i < cursor) {
            text = "done";
        } else if (i === cursor) {
            text = "next";
            if (state === "playing") {
                text = "load";
            }
        }
        if (text === host.blockStates[i]) {
            continue;
        }
        host.blockStates[i] = text;
        host.blockCells[i].textContent = text;
        host.blockCells[i].classList.toggle("next", i === cursor);
    }
    if (cursor < count) {
        scrollRowIntoView(ui.printoutRows, host.blockRows[cursor]);
    }
}

/**
 * Scroll a printout row into its box without scrolling the page, which
 * scrollIntoView would also do.
 *
 * @param {HTMLElement} box
 * @param {HTMLElement} row
 */
function scrollRowIntoView(box, row) {
    const boxRect = box.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < boxRect.top) {
        box.scrollTop -= boxRect.top - rowRect.top;
    } else if (rowRect.bottom > boxRect.bottom) {
        box.scrollTop += rowRect.bottom - boxRect.bottom;
    }
}

/**
 * Name the gamepad on each joystick port, or show that there is none. The poll
 * runs every frame, so labels are only written when a port changes.
 *
 * @param {Host} host
 */
function refreshPorts(host) {
    const labels = [host.ui.joy1Info, host.ui.joy2Info];
    for (let i = 0; i < 2; i += 1) {
        const id = host.padIds[i];
        if (id === host.shownPadIds[i]) {
            continue;
        }
        host.shownPadIds[i] = id;
        if (id === "") {
            labels[i].textContent = "No gamepad";
            labels[i].title = "";
        } else {
            labels[i].textContent = padLabel(id);
            labels[i].title = id;
        }
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
    if (host.sfx === null || !soundIsRunning(host.sfx) || host.ui.paused.checked) {
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
        const start = soundStats(host.sfx);
        host.statsAt = now;
        host.framesRun = 0;
        host.statsCut = start.cut;
        host.statsGap = start.gap;
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
