import {initScreen, resizeScreen, setCrt, drawScreen} from "./screen.js";

import {
    createMachine,
    resetMachine,
    runFrame,
    insertTape,
    autoloadTape,
    playTape,
    insertDock,
    ejectDock,
    setVideoOn,
    enableSound,
    setSoundRate,
    takeAudio,
} from "./machine.js";

import {
    applySwitchParamValue,
    loadShaders,
    loadStartupRoms,
    showError,
    showInfo,
} from "./boot.js";

import {isTapeName, isCartName} from "./media.js";

import {
    detectMachine,
    fetchArchiveIndex,
    fetchZipListing,
    fetchZipMember,
    formatSize,
    memberUrl,
    zipUrl,
} from "./tsarchive.js";

import {initJoysticks, pollJoysticks} from "./joystick.js";

import {initKeyboard, handleKeyDown, handleKeyUp, handleBlur, scaleKeyboardFromY} from "./keyboard.js";

import {
    initSound,
    resumeSound,
    resetSound,
    pushSound,
    setSoundStereo,
    soundIsRunning,
    soundQueueReady,
} from "./sound.js";

const soundSampleHz = 44100;
// The SCLD frame is 262 lines of 224 T-states, so the machine runs at
// 3528000 / 58688 Hz. Duplicated from machine.js, as the frame sizes are.
const framesPerSecond = 3528000 / 58688;
const frameMs         = 1000 / framesPerSecond;
const turboFrames     = 100;

/**
 * @typedef {{
 *   label: string,
 *   action: "up" | "letter" | "zip" | "file",
 *   name: string,
 * }} BrowserRow
 */

const ui = {
    pageHeader:       /** @type {HTMLElement} */       (document.getElementById("page-header")),
    archivePathDir:   /** @type {HTMLElement} */       (document.getElementById("archive-path-dir")),
    archivePathFile:  /** @type {HTMLElement} */       (document.getElementById("archive-path-file")),
    downloadFile:     /** @type {HTMLButtonElement} */ (document.getElementById("download-file")),
    tsrunLink:        /** @type {HTMLAnchorElement} */ (document.getElementById("tsrun-link")),
    archivePane:      /** @type {HTMLElement} */       (document.getElementById("archive-pane")),
    archiveQuery:     /** @type {HTMLInputElement} */  (document.getElementById("archive-query")),
    ts2068:           /** @type {HTMLInputElement} */  (document.getElementById("ts2068")),
    archiveList:      /** @type {HTMLElement} */       (document.getElementById("archive-list")),
    split:            /** @type {HTMLElement} */       (document.getElementById("split")),
    options:          /** @type {HTMLElement} */       (document.getElementById("options")),
    status:           /** @type {HTMLElement} */       (document.getElementById("status")),
    initInfo:         /** @type {HTMLElement} */       (document.getElementById("init-info")),
    soundInfo:        /** @type {HTMLElement} */       (document.getElementById("sound-info")),
    tapeInfo:         /** @type {HTMLElement} */       (document.getElementById("tape-info")),
    auto:             /** @type {HTMLInputElement} */  (document.getElementById("auto")),
    playTape:         /** @type {HTMLButtonElement} */ (document.getElementById("play-tape")),
    reset:            /** @type {HTMLButtonElement} */ (document.getElementById("reset")),
    screenSlot:       /** @type {HTMLElement} */       (document.getElementById("screen-slot")),
    screen:           /** @type {HTMLCanvasElement} */ (document.getElementById("screen")),
    keyboardSplit:    /** @type {HTMLElement} */       (document.getElementById("keyboard-split")),
    keyboard:         /** @type {HTMLElement} */       (document.getElementById("keyboard")),
    keyboardToggle:   /** @type {HTMLInputElement} */  (document.getElementById("keyboard-toggle")),
    crt:              /** @type {HTMLInputElement} */  (document.getElementById("crt")),
    stereo:           /** @type {HTMLInputElement} */  (document.getElementById("stereo")),
    fullscreenToggle: /** @type {HTMLButtonElement} */ (document.getElementById("fullscreen-toggle")),
    turbo:            /** @type {HTMLInputElement} */  (document.getElementById("turbo")),
};

const query = new URLSearchParams(window.location.search);

const keyMatrix = new Uint8Array(8);
const joystick  = new Uint8Array(2);

initJoysticks(joystick);

/**
 * @type {{
 *   machine:            import("./machine.js").Machine,
 *   kbd:                import("./keyboard.js").Keyboard,
 *   gfx:                import("./screen.js").Gfx | null,
 *   sfx:                import("./sound.js").Sfx | null,
 *   tapeName:           string,
 *   tapeState:          "empty" | "ready" | "playing" | "blocked" | "done",
 *   frameId:            number | undefined,
 *   lastNow:            number,
 *   carryMs:            number,
 *   keyboardVisible:    boolean,
 *   screenOnly:         boolean,
 *   abortLoadRoms:      (function(): void) | null,
 *   screenOnlyFallback: boolean,
 * }}
 */
const env = {
    machine:            createMachine(keyMatrix, joystick),
    kbd:                initKeyboard(ui.keyboard, keyMatrix),
    gfx:                null,
    sfx:                null,
    tapeName:           "",
    tapeState:          "empty",
    frameId:            undefined,
    lastNow:            0,
    carryMs:            0,
    keyboardVisible:    false,
    screenOnly:         false,
    abortLoadRoms:      null,
    screenOnlyFallback: false,
};

/**
 * @type {{
 *   index:        import("./tsarchive.js").ArchiveFile[],
 *   level:        "letters" | "letter" | "zip",
 *   letter:       string,
 *   zip:          string,
 *   zipFiles:     import("./tsarchive.js").ArchiveFile[],
 *   items:        BrowserRow[],
 *   cursor:       number,
 *   lastClicked:  number,
 *   listingGen:   number,
 *   abortListing: (function(): void) | null,
 *   abortMember:  (function(): void) | null,
 *   savedZip:     string | null,
 *   savedName:    string | null,
 *   savedBytes:   ArrayBuffer | null,
 * }}
 */
const browser = {
    index:        [],
    level:        "letters",
    letter:       "",
    zip:          "",
    zipFiles:     [],
    items:        [],
    cursor:       0,
    lastClicked:  -1,
    listingGen:   0,
    abortListing: null,
    abortMember:  null,
    savedZip:     null,
    savedName:    null,
    savedBytes:   null,
};

applySwitchParamValue(ui.keyboardToggle, query.get("keyboard") ?? "");
applySwitchParamValue(ui.crt, query.get("crt") ?? "");
applySwitchParamValue(ui.stereo, query.get("stereo") ?? "");
applySwitchParamValue(ui.auto, query.get("auto") ?? "");
applySwitchParamValue(ui.turbo, query.get("turbo") ?? "");
applySwitchParamValue(ui.ts2068, query.get("ts2068") ?? "");

setKeyboardVisibility(ui.keyboardToggle.checked);

ui.reset.onclick = function () {
    resetSystem();
};

ui.playTape.onclick = function () {
    playTape(env.machine);
};

ui.downloadFile.onclick = function () {
    downloadCursorFile();
};

ui.archiveQuery.oninput = function () {
    applyArchiveFilter();
};

ui.ts2068.onchange = function () {
    applyArchiveFilter();
};

ui.keyboardToggle.onchange = function () {
    setKeyboardVisibility(ui.keyboardToggle.checked);
};

ui.crt.onchange = function () {
    if (env.gfx !== null) {
        setCrt(env.gfx, ui.crt.checked);
    }
};

ui.stereo.onchange = function () {
    if (env.sfx !== null) {
        setSoundStereo(env.sfx, ui.stereo.checked);
    }
};

ui.fullscreenToggle.onclick = function () {
    toggleCanvasFullscreen();
};

ui.options.onclick = function (/** @type {MouseEvent} */ e) {
    let el = /** @type {HTMLElement | null} */ (e.target);
    while (el !== null && el !== ui.options) {
        if (el === ui.tsrunLink || el.tagName === "BUTTON" || el.classList.contains("switch")) {
            ui.screen.focus();
            return;
        }
        el = el.parentElement;
    }
};

ui.keyboard.onpointerup = function () {
    ui.screen.focus();
};

ui.keyboard.onpointercancel = function () {
    ui.screen.focus();
};

ui.split.onpointerdown = function (/** @type {PointerEvent} */ e) {
    if (e.button !== 0) {
        return;
    }
    e.preventDefault();
    ui.split.setPointerCapture(e.pointerId);
    document.body.classList.add("splitting");
    applySplitSize(e.clientX, e.clientY);
};

ui.split.onpointermove = function (/** @type {PointerEvent} */ e) {
    if (!ui.split.hasPointerCapture(e.pointerId)) {
        return;
    }
    applySplitSize(e.clientX, e.clientY);
};

ui.split.onpointerup = function (/** @type {PointerEvent} */ e) {
    endSplit(e.pointerId);
};

ui.split.onpointercancel = function (/** @type {PointerEvent} */ e) {
    endSplit(e.pointerId);
};

ui.keyboardSplit.onpointerdown = function (/** @type {PointerEvent} */ e) {
    if (e.button !== 0) {
        return;
    }
    e.preventDefault();
    document.body.classList.add("keyboard-splitting");
    scaleKeyboardFromY(ui.keyboard, ui.keyboardSplit, e.clientY);
    if (env.gfx !== null) {
        resizeScreen(env.gfx);
    }
    ui.keyboardSplit.setPointerCapture(e.pointerId);
};

ui.keyboardSplit.onpointermove = function (/** @type {PointerEvent} */ e) {
    if (!ui.keyboardSplit.hasPointerCapture(e.pointerId)) {
        return;
    }
    scaleKeyboardFromY(ui.keyboard, ui.keyboardSplit, e.clientY);
    if (env.gfx !== null) {
        resizeScreen(env.gfx);
    }
};

ui.keyboardSplit.onpointerup = function (/** @type {PointerEvent} */ e) {
    endKeyboardSplit(e.pointerId);
};

ui.keyboardSplit.onpointercancel = function (/** @type {PointerEvent} */ e) {
    endKeyboardSplit(e.pointerId);
};

ui.screenSlot.onpointerdown = function () {
    ui.screen.focus();
};

ui.archiveList.onclick = function (/** @type {MouseEvent} */ e) {
    let el = /** @type {HTMLElement | null} */ (e.target);
    while (el !== null && el !== ui.archiveList) {
        if (el.classList.contains("archive-row")) {
            const i = Number(el.dataset.index);
            if (Number.isFinite(i) && i >= 0 && i < browser.items.length) {
                // First click highlights; a later click on that same row
                // activates. There is no double-click time window.
                if (i === browser.lastClicked) {
                    activateRow();
                } else {
                    browser.cursor = i;
                    browser.lastClicked = i;
                    paintSelection();
                    scrollCursorIntoView();
                }
            }
            return;
        }
        el = el.parentElement;
    }
};

new ResizeObserver(function () {
    const workspace = ui.archivePane.parentElement;
    if (workspace !== null) {
        if (getComputedStyle(workspace).flexDirection === "column") {
            ui.archivePane.style.width = "";
        } else {
            ui.archivePane.style.height = "";
        }
    }
    if (env.gfx !== null) {
        resizeScreen(env.gfx);
    }
}).observe(ui.screenSlot);

document.onfullscreenchange = function () {
    setScreenOnly(document.fullscreenElement !== null || env.screenOnlyFallback);
};

window.onkeydown = function (e) {
    if (env.sfx !== null) {
        resumeSound(env.sfx);
    }
    if (e.code === "F1") {
        e.preventDefault();
        if (!e.repeat) {
            setKeyboardVisibility(!env.keyboardVisible);
        }
        return;
    }
    if (e.code === "F11") {
        e.preventDefault();
        if (!e.repeat) {
            toggleCanvasFullscreen();
        }
        return;
    }
    if (!env.screenOnly && document.activeElement === ui.archiveList) {
        if (isListNavKey(e.code)) {
            e.preventDefault();
            if (!e.repeat || e.code !== "Enter") {
                onListKey(e.code);
            }
        }
        return;
    }
    if (!env.screenOnly && document.activeElement === ui.archiveQuery) {
        if (isSearchListNavKey(e.code)) {
            e.preventDefault();
            if (e.code === "Enter") {
                if (!e.repeat) {
                    activateRow();
                    ui.archiveList.focus();
                }
                return;
            }
            onListKey(e.code);
        }
        return;
    }
    if (isEmulatorFocused()) {
        handleKeyDown(env.kbd, e);
    }
};

window.onpointerdown = function () {
    if (env.sfx !== null) {
        resumeSound(env.sfx);
    }
};

window.onkeyup = function (e) {
    if (e.code === "F1" || e.code === "F11") {
        e.preventDefault();
        return;
    }
    if (!env.screenOnly && document.activeElement === ui.archiveList && isListNavKey(e.code)) {
        e.preventDefault();
        return;
    }
    if (!env.screenOnly && document.activeElement === ui.archiveQuery && isSearchListNavKey(e.code)) {
        e.preventDefault();
        return;
    }
    handleKeyUp(env.kbd, e);
};

window.onblur = function () {
    handleBlur(env.kbd);
};

ui.screen.onblur = function () {
    handleBlur(env.kbd);
};

showListMessage("Loading...");
fetchArchiveIndex(function (err, files) {
    if (err !== null) {
        showListMessage(err);
        showError(ui.tapeInfo, err);
        return;
    }
    if (files === null) {
        showListMessage("No files.");
        return;
    }
    browser.index = files;
    browser.level = "letters";
    browser.cursor = 0;
    renderList();
    ui.archiveList.focus();
});

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
                env.gfx = gfx;
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
    soundSampleHz,
    function (err, sfx) {
        if (err !== null) {
            showError(ui.soundInfo, "No sound: " + err);
            return;
        }
        if (sfx === null) {
            showError(ui.soundInfo, "No sound.");
            return;
        }
        env.sfx = sfx;
        setSoundStereo(sfx, ui.stereo.checked);
        setSoundRate(env.machine, sfx.context.sampleRate);
        enableSound(env.machine, true);
    },
);

env.abortLoadRoms = loadStartupRoms(
    query.get("rom") ?? "",
    function (errs, names, roms) {
        env.abortLoadRoms = null;
        if (errs !== null) {
            showError(ui.initInfo, errs[0] + " " + errs[1]);
            return;
        }
        if (roms !== null) {
            env.machine.homeRom.set(new Uint8Array(roms[0]));
            env.machine.exRom.set(new Uint8Array(roms[1]));
        }
        resetSystem();
    },
);

env.frameId = requestAnimationFrame(onFrame);

/** @param {number} now */
function onFrame(now) {
    env.frameId = requestAnimationFrame(onFrame);
    pollJoysticks(joystick);
    if (env.lastNow === 0) {
        env.lastNow = now;
        env.carryMs = frameMs;
    }
    let dt = now - env.lastNow;
    env.lastNow = now;
    if (dt > 80) {
        dt = 80;
    }
    env.carryMs += dt;
    const turboEnabled = ui.turbo.checked;
    let ran = 0;
    while (env.carryMs >= frameMs && ran < 4) {
        stepMachine(turboEnabled);
        env.carryMs -= frameMs;
        ran += 1;
    }
    if (turboEnabled && env.machine.tape.state === "playing") {
        while (turboEnabled && ran < turboFrames && env.machine.tape.state === "playing") {
            stepMachine(turboEnabled);
            ran += 1;
        }
        // One painted frame is mixed so loader tones are heard. Drop the
        // worklet queue first, and force a sound resync, or a behind sample
        // clock dumps many frames of EAR that then repeat.
        if (env.sfx !== null) {
            resetSound(env.sfx);
        }
        enableSound(env.machine, false);
        stepMachine(false);
    } else if (ran < 4 && env.sfx !== null && soundIsRunning(env.sfx) && !soundQueueReady(env.sfx)) {
        stepMachine(turboEnabled);
        env.carryMs = Math.max(env.carryMs, 0) - frameMs;
    }
    refreshTapeStatus(null);
    if (env.gfx !== null) {
        drawScreen(env.gfx, env.machine.pixels);
    }
}

/** @param {boolean} turboEnabled */
function stepMachine(turboEnabled) {
    const turbo = turboEnabled && env.machine.tape.state === "playing";
    setVideoOn(env.machine, !turbo);
    enableSound(env.machine, !turbo && env.sfx !== null);
    runFrame(env.machine);
    const chunk = takeAudio(env.machine);
    if (turbo) {
        return;
    }
    if (chunk.n > 0 && env.sfx !== null && (soundIsRunning(env.sfx) || !soundQueueReady(env.sfx))) {
        pushSound(env.sfx, chunk);
    }
}

/**
 * @param {string | null} err
 */
function refreshTapeStatus(err) {
    if (err !== null) {
        env.tapeState = env.machine.tape.state;
        showError(ui.tapeInfo, err);
        ui.playTape.textContent = "Play";
        ui.playTape.disabled = true;
        return;
    }
    if (env.tapeState === env.machine.tape.state) {
        return;
    }
    env.tapeState = env.machine.tape.state;
    switch (env.tapeState) {
    case "empty":
        showInfo(ui.tapeInfo, "No tape");
        ui.playTape.textContent = "Play";
        ui.playTape.disabled = true;
        break;
    case "ready": {
        const blockCount = env.machine.tape.blockCount + " blocks.";
        const playMessage = "Enter LOAD \"\" or press Play.";
        showInfo(ui.tapeInfo, env.tapeName + ": " + blockCount + " " + playMessage);
        ui.playTape.textContent = "Play";
        ui.playTape.disabled = false;
        break;
    }
    case "playing":
        showInfo(ui.tapeInfo, env.tapeName + ": Loading.");
        ui.playTape.textContent = "Play";
        ui.playTape.disabled = true;
        break;
    case "blocked": {
        const resumeMessage = "Enter LOAD \"\" or press Resume for the next part.";
        showInfo(ui.tapeInfo, env.tapeName + ": Stopped. " + resumeMessage);
        ui.playTape.textContent = "Resume";
        ui.playTape.disabled = false;
        break;
    }
    case "done":
        showInfo(ui.tapeInfo, env.tapeName + ": Ended.");
        ui.playTape.textContent = "Play";
        ui.playTape.disabled = true;
        break;
    }
}

function resetSystem() {
    if (env.sfx === null) {
        resetMachine(env.machine);
        return;
    }
    resetSound(env.sfx);
    resetMachine(env.machine);
    resumeSound(env.sfx);
}

/** @param {boolean} visible */
function setKeyboardVisibility(visible) {
    env.keyboardVisible = visible;
    ui.keyboardToggle.checked = visible;
    applyVisibility();
}

function toggleCanvasFullscreen() {
    if (document.fullscreenElement !== null || env.screenOnlyFallback) {
        env.screenOnlyFallback = false;
        if (document.fullscreenElement !== null && document.exitFullscreen !== undefined) {
            document.exitFullscreen()?.then(
                function () {
                },
                function () {
                    setScreenOnly(false);
                },
            );
            return;
        }
        setScreenOnly(false);
        return;
    }

    const slot = ui.screen.parentElement;
    if (slot?.requestFullscreen === undefined) {
        env.screenOnlyFallback = true;
        setScreenOnly(true);
        return;
    }
    slot.requestFullscreen()?.then(
        function () {
        },
        function () {
            env.screenOnlyFallback = true;
            setScreenOnly(true);
        },
    );
}

/** @param {boolean} on */
function setScreenOnly(on) {
    env.screenOnly = on;
    applyVisibility();
    if (on) {
        ui.screen.focus();
    }
}

/**
 * @param {number} pointerX
 * @param {number} pointerY
 */
function applySplitSize(pointerX, pointerY) {
    const workspace = ui.archivePane.parentElement;
    if (workspace === null) {
        return;
    }
    const rect = workspace.getBoundingClientRect();
    const splitRect = ui.split.getBoundingClientRect();
    const column = getComputedStyle(workspace).flexDirection === "column";
    let size = pointerX - rect.left;
    let max = rect.width - splitRect.width - 160;
    if (column) {
        size = pointerY - rect.top;
        max = rect.height - splitRect.height - 80;
        document.body.style.cursor = "row-resize";
    } else {
        document.body.style.cursor = "col-resize";
    }
    const min = 80;
    size = Math.min(Math.max(size, min), Math.max(min, max));
    ui.archivePane.style.flexBasis = size + "px";
    if (column) {
        ui.archivePane.style.height = size + "px";
        ui.archivePane.style.width = "";
    } else {
        ui.archivePane.style.width = size + "px";
        ui.archivePane.style.height = "";
    }
    if (env.gfx !== null) {
        resizeScreen(env.gfx);
    }
}

/** @param {number} pointerId */
function endSplit(pointerId) {
    if (ui.split.hasPointerCapture(pointerId)) {
        ui.split.releasePointerCapture(pointerId);
    }
    document.body.classList.remove("splitting");
    document.body.style.cursor = "";
}

/** @param {number} pointerId */
function endKeyboardSplit(pointerId) {
    if (ui.keyboardSplit.hasPointerCapture(pointerId)) {
        ui.keyboardSplit.releasePointerCapture(pointerId);
    }
    document.body.classList.remove("keyboard-splitting");
}

function applyVisibility() {
    let chrome = "";
    if (env.screenOnly) {
        chrome = "none";
        ui.screenSlot.classList.add("screen-only");
    } else {
        ui.screenSlot.classList.remove("screen-only");
    }
    let keyboard = "";
    if (env.screenOnly || !env.keyboardVisible) {
        keyboard = "none";
    }
    ui.pageHeader.style.display = chrome;
    ui.archivePane.style.display = chrome;
    ui.split.style.display = chrome;
    ui.options.style.display = chrome;
    ui.status.style.display = chrome;
    ui.keyboardSplit.style.display = keyboard;
    ui.keyboard.style.display = keyboard;
    if (env.gfx !== null) {
        resizeScreen(env.gfx);
    }
}

function applyArchiveFilter() {
    if (browser.index.length === 0 && browser.level === "letters") {
        return;
    }
    if (browser.level === "zip") {
        return;
    }
    if (ui.archiveQuery.value !== "" && browser.level === "letter") {
        browser.level = "letters";
        browser.letter = "";
    }
    browser.cursor = 0;
    browser.lastClicked = -1;
    renderList();
}

function renderList() {
    /** @type {BrowserRow[]} */
    const items = [];
    const zips = matchingZips();
    const searching = ui.archiveQuery.value !== "";
    if (browser.level === "zip" || (browser.level === "letter" && !searching)) {
        items.push({label: "..", action: "up", name: ""});
    }
    if (browser.level === "zip") {
        for (let i = 0; i < browser.zipFiles.length; i += 1) {
            const f = browser.zipFiles[i];
            items.push({
                label: f.name + " (" + formatSize(f.size) + ")",
                action: "file",
                name: f.name,
            });
        }
    } else if (searching) {
        for (let i = 0; i < zips.length; i += 1) {
            const z = zips[i];
            items.push({
                label: z.name + " (" + formatSize(z.size) + ")",
                action: "zip",
                name: z.name,
            });
        }
    } else {
        switch (browser.level) {
        case "letters": {
            const letters = lettersFromIndex(zips);
            for (let i = 0; i < letters.length; i += 1) {
                items.push({
                    label: "[ " + letters[i] + " ]",
                    action: "letter",
                    name: letters[i],
                });
            }
            break;
        }
        case "letter": {
            const letterZips = zipsForLetter(zips, browser.letter);
            for (let i = 0; i < letterZips.length; i += 1) {
                const z = letterZips[i];
                items.push({
                    label: z.name + " (" + formatSize(z.size) + ")",
                    action: "zip",
                    name: z.name,
                });
            }
            break;
        }
        }
    }
    browser.items = items;
    browser.lastClicked = -1;
    if (browser.cursor < 0) {
        browser.cursor = 0;
    }
    if (browser.cursor >= items.length) {
        browser.cursor = Math.max(items.length - 1, 0);
    }

    ui.archiveList.replaceChildren();
    for (let i = 0; i < items.length; i += 1) {
        const row = document.createElement("div");
        row.className = "archive-row";
        row.dataset.index = String(i);
        row.textContent = items[i].label;
        if (items[i].action === "file" && (isTapeName(items[i].name) || isCartName(items[i].name))) {
            row.classList.add("media");
        }
        ui.archiveList.appendChild(row);
    }
    if (browser.abortListing !== null) {
        const row = document.createElement("div");
        row.className = "archive-row";
        row.textContent = "Loading...";
        ui.archiveList.appendChild(row);
    } else if (items.length === 0) {
        const row = document.createElement("div");
        row.className = "archive-row";
        row.textContent = "No files.";
        ui.archiveList.appendChild(row);
    }
    paintSelection();
    scrollCursorIntoView();
}

function paintSelection() {
    const rows = ui.archiveList.children;
    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (i === browser.cursor && browser.items.length > 0) {
            row.classList.add("selected");
        } else {
            row.classList.remove("selected");
        }
    }
    refreshPath();
}

/**
 * Header path, Download, and Open in TSRun follow the list cursor, including
 * a highlighted row that has not been opened yet.
 */
function refreshPath() {
    let dir = "";
    let file = "";
    let media = false;
    let canDownload = false;
    let zip = "";
    let member = "";
    let slash = -1;
    const item = browser.items[browser.cursor];
    if (item !== undefined) {
        switch (item.action) {
        case "up":
            switch (browser.level) {
            case "zip":
                file = browser.zip;
                zip = browser.zip;
                canDownload = zip !== "";
                break;
            case "letter":
                file = browser.letter;
                break;
            }
            break;
        case "letter":
            file = item.name;
            break;
        case "zip":
            file = item.name;
            zip = item.name;
            canDownload = true;
            break;
        case "file":
            zip = browser.zip;
            member = item.name;
            dir = zip;
            slash = member.lastIndexOf("/");
            if (slash >= 0) {
                dir += " / " + member.slice(0, slash).replaceAll("/", " / ");
                file = member.slice(slash + 1);
            } else {
                file = member;
            }
            media = isTapeName(file) || isCartName(file);
            canDownload = true;
            break;
        }
    }
    if (file === "") {
        file = "\u00A0";
    }
    ui.archivePathDir.textContent = dir;
    ui.archivePathFile.textContent = file;
    if (media) {
        ui.archivePathFile.classList.add("media");
        ui.tsrunLink.href = "index.html?url=" + encodeURIComponent(zipUrl(zip) + "#" + member);
        ui.tsrunLink.style.display = "";
    } else {
        ui.archivePathFile.classList.remove("media");
        ui.tsrunLink.removeAttribute("href");
        ui.tsrunLink.style.display = "none";
    }
    if (canDownload) {
        ui.downloadFile.style.display = "";
    } else {
        ui.downloadFile.style.display = "none";
    }
}

function downloadCursorFile() {
    const item = browser.items[browser.cursor];
    if (item === undefined) {
        return;
    }
    if (item.action === "zip") {
        saveRemoteFile(zipUrl(item.name), item.name);
        return;
    }
    if (item.action === "up" && browser.level === "zip" && browser.zip !== "") {
        saveRemoteFile(zipUrl(browser.zip), browser.zip);
        return;
    }
    if (item.action !== "file") {
        return;
    }
    const zip = browser.zip;
    const name = item.name;
    if (browser.savedZip === zip && browser.savedName === name && browser.savedBytes !== null) {
        saveLocalFile(name, browser.savedBytes);
        return;
    }
    saveRemoteFile(memberUrl(zip, name), name);
}

/**
 * @param {string} zip
 * @param {string} name
 * @param {ArrayBuffer} bytes
 */
function rememberMemberBytes(zip, name, bytes) {
    browser.savedZip = zip;
    browser.savedName = name;
    browser.savedBytes = bytes;
}

/**
 * @param {string} name
 * @param {ArrayBuffer} bytes
 */
function saveLocalFile(name, bytes) {
    const url = URL.createObjectURL(new Blob([bytes]));
    saveRemoteFile(url, name);
    URL.revokeObjectURL(url);
}

/**
 * @param {string} url
 * @param {string} name
 */
function saveRemoteFile(url, name) {
    let file = name;
    const slash = name.lastIndexOf("/");
    if (slash >= 0) {
        file = name.slice(slash + 1);
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    link.rel = "noopener";
    link.click();
}

function scrollCursorIntoView() {
    const row = ui.archiveList.children[browser.cursor];
    if (row instanceof HTMLElement) {
        row.scrollIntoView({block: "nearest", inline: "nearest"});
    }
}

function activateRow() {
    const item = browser.items[browser.cursor];
    if (item === undefined) {
        return;
    }
    switch (item.action) {
    case "up":
        goUp();
        break;
    case "letter":
        openLetter(item.name);
        break;
    case "zip":
        openZip(item.name);
        break;
    case "file":
        openFile(browser.zip, item.name);
        break;
    }
}

function cancelListing() {
    browser.listingGen += 1;
    if (browser.abortListing !== null) {
        browser.abortListing();
        browser.abortListing = null;
    }
}

/**
 * @param {BrowserRow["action"]} action
 * @param {string} name
 */
function selectRow(action, name) {
    for (let i = 0; i < browser.items.length; i += 1) {
        if (browser.items[i].action === action && browser.items[i].name === name) {
            browser.cursor = i;
            paintSelection();
            scrollCursorIntoView();
            return;
        }
    }
}

function goUp() {
    cancelListing();
    switch (browser.level) {
    case "zip": {
        const zip = browser.zip;
        const searching = ui.archiveQuery.value !== "";
        browser.zip = "";
        browser.zipFiles = [];
        browser.cursor = 0;
        if (searching) {
            browser.level = "letters";
            browser.letter = "";
        } else {
            browser.level = "letter";
        }
        renderList();
        selectRow("zip", zip);
        break;
    }
    case "letter": {
        const letter = browser.letter;
        browser.level = "letters";
        browser.letter = "";
        browser.cursor = 0;
        renderList();
        selectRow("letter", letter);
        break;
    }
    }
}

/** @param {string} letter */
function openLetter(letter) {
    cancelListing();
    browser.level = "letter";
    browser.letter = letter;
    browser.cursor = 0;
    renderList();
}

/** @param {string} zip */
function openZip(zip) {
    cancelListing();
    const gen = browser.listingGen;
    browser.level = "zip";
    browser.zip = zip;
    browser.zipFiles = [];
    browser.cursor = 0;
    browser.abortListing = fetchZipListing(zip, function (err, files) {
        if (gen !== browser.listingGen) {
            return;
        }
        browser.abortListing = null;
        if (err !== null) {
            showError(ui.tapeInfo, err);
            goUp();
            return;
        }
        if (files === null) {
            showError(ui.tapeInfo, "No files in " + zip + ".");
            goUp();
            return;
        }
        browser.zipFiles = files;
        browser.cursor = 0;
        renderList();
    });
    renderList();
}

/**
 * Fetch a ZIP member and insert it as tape or cartridge.
 *
 * @param {string} zip
 * @param {string} name
 */
function openFile(zip, name) {
    if (!isTapeName(name) && !isCartName(name)) {
        showError(ui.tapeInfo, "\"" + name + "\" is not a TAP, TZX, or DCK.");
        return;
    }
    if (browser.abortMember !== null) {
        browser.abortMember();
        browser.abortMember = null;
    }
    showInfo(ui.tapeInfo, "Loading " + name + "...");
    browser.abortMember = fetchZipMember(zip, name, function (err, buf) {
        browser.abortMember = null;
        if (err !== null) {
            showError(ui.tapeInfo, err);
            return;
        }
        if (!(buf instanceof ArrayBuffer)) {
            showError(ui.tapeInfo, "Could not load " + name + ".");
            return;
        }
        rememberMemberBytes(zip, name, buf);
        applyArchiveFile(zip, name, buf);
    });
}

/**
 * @param {string} zip
 * @param {string} name
 * @param {ArrayBuffer} bytes
 */
function applyArchiveFile(zip, name, bytes) {
    if (isTapeName(name)) {
        const hadCart = machineHasCart(env.machine);
        ejectDock(env.machine);
        const tapeErr = insertTape(env.machine, bytes);
        if (tapeErr !== null) {
            env.tapeName = "";
            refreshTapeStatus(tapeErr);
            if (hadCart) {
                resetSystem();
            }
            return;
        }
        env.tapeName = name;
        env.tapeState = "empty";
        refreshTapeStatus(null);
        if (ui.auto.checked && autoloadTape(env.machine)) {
            if (env.sfx !== null) {
                resetSound(env.sfx);
            }
            return;
        }
        if (hadCart) {
            resetSystem();
        }
        return;
    }
    if (isCartName(name)) {
        const dockErr = insertDock(env.machine, bytes);
        if (dockErr !== null) {
            showError(ui.tapeInfo, dockErr);
            return;
        }
        resetSystem();
        showInfo(ui.tapeInfo, name);
        return;
    }
}

/** @param {import("./machine.js").Machine} machine */
function machineHasCart(machine) {
    for (let i = 0; i < 8; i += 1) {
        if (machine.dock[i] !== null || machine.exCart[i] !== null || machine.homeCart[i] !== null) {
            return true;
        }
    }
    return false;
}

/** @param {string} code */
function onListKey(code) {
    const n = browser.items.length;
    if (n === 0) {
        return;
    }
    const page = pageRows();
    const from = browser.cursor;
    switch (code) {
    case "ArrowUp":
        browser.cursor = Math.max(browser.cursor - 1, 0);
        break;
    case "ArrowDown":
        browser.cursor = Math.min(browser.cursor + 1, n - 1);
        break;
    case "PageUp":
        browser.cursor = Math.max(browser.cursor - page, 0);
        break;
    case "PageDown":
        browser.cursor = Math.min(browser.cursor + page, n - 1);
        break;
    case "Home":
        browser.cursor = 0;
        break;
    case "End":
        browser.cursor = n - 1;
        break;
    case "Enter":
        activateRow();
        return;
    }
    if (browser.cursor !== from) {
        browser.lastClicked = -1;
    }
    paintSelection();
    scrollCursorIntoView();
}

/** @returns {number} */
function pageRows() {
    const row = ui.archiveList.querySelector(".archive-row");
    if (!(row instanceof HTMLElement) || row.clientHeight <= 0) {
        return 10;
    }
    return Math.max(1, Math.floor(ui.archiveList.clientHeight / row.clientHeight) - 1);
}

/** @returns {boolean} */
function isEmulatorFocused() {
    return ui.screenSlot.contains(document.activeElement);
}

/** @param {string} code */
function isListNavKey(code) {
    switch (code) {
    case "ArrowUp":
    case "ArrowDown":
    case "PageUp":
    case "PageDown":
    case "Home":
    case "End":
    case "Enter":
        return true;
    default:
        return false;
    }
}

/** @param {string} code */
function isSearchListNavKey(code) {
    switch (code) {
    case "ArrowUp":
    case "ArrowDown":
    case "PageUp":
    case "PageDown":
    case "Enter":
        return true;
    default:
        return false;
    }
}

/** @param {string} text */
function showListMessage(text) {
    ui.archiveList.replaceChildren();
    const row = document.createElement("div");
    row.className = "archive-row";
    row.textContent = text;
    ui.archiveList.appendChild(row);
}

/**
 * ZIP titles passing the TS2068 switch and the search substring.
 *
 * @returns {import("./tsarchive.js").ArchiveFile[]}
 */
function matchingZips() {
    const needle = ui.archiveQuery.value.toLowerCase();
    const tagged = ui.ts2068.checked;
    /** @type {import("./tsarchive.js").ArchiveFile[]} */
    const out = [];
    for (let i = 0; i < browser.index.length; i += 1) {
        const f = browser.index[i];
        if (tagged && detectMachine(f.name) !== "ts2068") {
            continue;
        }
        if (needle !== "" && f.name.toLowerCase().indexOf(needle) < 0) {
            continue;
        }
        out.push(f);
    }
    return out;
}

/**
 * @param {import("./tsarchive.js").ArchiveFile[]} files
 * @returns {string[]}
 */
function lettersFromIndex(files) {
    /** @type {string[]} */
    const letters = [];
    for (let i = 0; i < files.length; i += 1) {
        const ch = firstLetter(files[i].name);
        let found = false;
        for (let j = 0; j < letters.length; j += 1) {
            if (letters[j] === ch) {
                found = true;
                break;
            }
        }
        if (!found) {
            letters.push(ch);
        }
    }
    letters.sort(function (a, b) {
        return a.localeCompare(b, "en", {sensitivity: "base", numeric: true});
    });
    return letters;
}

/**
 * @param {import("./tsarchive.js").ArchiveFile[]} files
 * @param {string} letter
 * @returns {import("./tsarchive.js").ArchiveFile[]}
 */
function zipsForLetter(files, letter) {
    /** @type {import("./tsarchive.js").ArchiveFile[]} */
    const out = [];
    for (let i = 0; i < files.length; i += 1) {
        if (firstLetter(files[i].name) === letter) {
            out.push(files[i]);
        }
    }
    return out;
}

/**
 * @param {string} name
 * @returns {string}
 */
function firstLetter(name) {
    if (name === "") {
        return "?";
    }
    return name.charAt(0).toUpperCase();
}
