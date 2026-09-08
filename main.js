import {initScreen, resizeScreen, setCrt, drawScreen} from "./screen.js";

import {
    createMachine,
    resetMachine,
    runFrame,
    insertTape,
    ejectTape,
    autoloadTape,
    playTape,
    insertDock,
    ejectDock,
    requestNmi,
    setVideoOn,
    enableSound,
    setSoundRate,
    takeAudio,
} from "./machine.js";

import {httpGet, readFile} from "./io.js";
import {unpackedMemberUrl} from "./tsarchive.js";

import {
    applySwitchParamValue,
    homeRomSize,
    exRomSize,
    loadShaders,
    loadStartupRoms,
    showError,
    showInfo,
} from "./boot.js";

import {isHiddenName, isZipName, isTapeName, isCartName, maxMediaSize, maxZipSize} from "./media.js";

import {listZip, readZipEntry} from "./zip.js";

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

const ui = {
    pageHeader:       /** @type {HTMLElement} */       (document.getElementById("page-header")),
    initInfo:         /** @type {HTMLElement} */       (document.getElementById("init-info")),
    soundInfo:        /** @type {HTMLElement} */       (document.getElementById("sound-info")),
    startupFileInfo:  /** @type {HTMLElement} */       (document.getElementById("startup-file-info")),
    loadTape:         /** @type {HTMLButtonElement} */ (document.getElementById("load-tape")),
    fileTape:         /** @type {HTMLInputElement} */  (document.getElementById("file-tape")),
    auto:             /** @type {HTMLInputElement} */  (document.getElementById("auto")),
    playTape:         /** @type {HTMLButtonElement} */ (document.getElementById("play-tape")),
    tapeInfo:         /** @type {HTMLElement} */       (document.getElementById("tape-info")),
    loadCart:         /** @type {HTMLButtonElement} */ (document.getElementById("load-cart")),
    fileCart:         /** @type {HTMLInputElement} */  (document.getElementById("file-cart")),
    ejectCart:        /** @type {HTMLButtonElement} */ (document.getElementById("eject-cart")),
    cartInfo:         /** @type {HTMLElement} */       (document.getElementById("cart-info")),
    loadRom0:         /** @type {HTMLButtonElement} */ (document.getElementById("load-rom0")),
    fileRom0:         /** @type {HTMLInputElement} */  (document.getElementById("file-rom0")),
    rom0Info:         /** @type {HTMLElement} */       (document.getElementById("rom0-info")),
    loadRom1:         /** @type {HTMLButtonElement} */ (document.getElementById("load-rom1")),
    fileRom1:         /** @type {HTMLInputElement} */  (document.getElementById("file-rom1")),
    rom1Info:         /** @type {HTMLElement} */       (document.getElementById("rom1-info")),
    reset:            /** @type {HTMLButtonElement} */ (document.getElementById("reset")),
    nmi:              /** @type {HTMLButtonElement} */ (document.getElementById("nmi")),
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
 *   machine:              import("./machine.js").Machine,
 *   kbd:                  import("./keyboard.js").Keyboard,
 *   gfx:                  import("./screen.js").Gfx | null,
 *   sfx:                  import("./sound.js").Sfx | null,
 *   tapeName:             string,
 *   tapeState:            "empty" | "ready" | "playing" | "blocked" | "done",
 *   frameId:              number | undefined,
 *   lastNow:              number,
 *   carryMs:              number,
 *   keyboardVisible:      boolean,
 *   screenOnly:           boolean,
 *   abortLoadRoms:        (function(): void) | null,
 *   abortLoadStartupFile: (function(): void) | null,
 *   startupFileName:      string | null,
 *   startupFileBytes:     ArrayBuffer | null,
 *   screenOnlyFallback:   boolean,
 * }}
 */
const env = {
    machine:              createMachine(keyMatrix, joystick),
    kbd:                  initKeyboard(ui.keyboard, keyMatrix),
    gfx:                  null,
    sfx:                  null,
    tapeName:             "",
    tapeState:            "empty",
    frameId:              undefined,
    lastNow:              0,
    carryMs:              0,
    keyboardVisible:      false,
    screenOnly:           false,
    abortLoadRoms:        null,
    abortLoadStartupFile: null,
    startupFileName:      null,
    startupFileBytes:     null,
    screenOnlyFallback:   false,
};

applySwitchParamValue(ui.keyboardToggle, query.get("keyboard") ?? "");
applySwitchParamValue(ui.crt, query.get("crt") ?? "");
applySwitchParamValue(ui.stereo, query.get("stereo") ?? "");
applySwitchParamValue(ui.auto, query.get("auto") ?? "");
applySwitchParamValue(ui.turbo, query.get("turbo") ?? "");

setKeyboardVisibility(ui.keyboardToggle.checked);

ui.loadTape.onclick = function () {
    ui.fileTape.click();
};

ui.fileTape.onchange = function () {
    const file = ui.fileTape.files?.[0];
    ui.fileTape.value = "";
    if (file === undefined) {
        return;
    }
    if (env.abortLoadStartupFile !== null) {
        env.abortLoadStartupFile();
        env.abortLoadStartupFile = null;
    }
    env.startupFileName = null;
    env.startupFileBytes = null;
    ejectTape(env.machine);
    env.tapeName = "";
    refreshTapeStatus(null);
    // Triggering multiple concurrent file reads is too unlikely to guard against.
    readFile(file, "arraybuffer", function (err, buf) {
        if (err !== null) {
            refreshTapeStatus(err);
            return;
        }
        const tapeErr = insertTape(env.machine, buf);
        if (tapeErr !== null) {
            refreshTapeStatus(tapeErr);
            return;
        }
        env.tapeName = file.name;
        refreshTapeStatus(null);
        showInfo(ui.startupFileInfo, "");
        if (ui.auto.checked && autoloadTape(env.machine) && env.sfx !== null) {
            resetSound(env.sfx);
        }
    });
};

ui.playTape.onclick = function () {
    playTape(env.machine);
};

ui.loadCart.onclick = function () {
    ui.fileCart.click();
};

ui.fileCart.onchange = function () {
    const file = ui.fileCart.files?.[0];
    ui.fileCart.value = "";
    if (file === undefined) {
        return;
    }
    if (env.abortLoadStartupFile !== null) {
        env.abortLoadStartupFile();
        env.abortLoadStartupFile = null;
    }
    env.startupFileName = null;
    env.startupFileBytes = null;
    ejectDock(env.machine);
    // Triggering multiple concurrent file reads is too unlikely to guard against.
    readFile(file, "arraybuffer", function (err, buf) {
        if (err !== null) {
            showError(ui.cartInfo, err);
            return;
        }
        const dockErr = insertDock(env.machine, buf);
        if (dockErr !== null) {
            showError(ui.cartInfo, dockErr);
            return;
        }
        resetSystem();
        showInfo(ui.cartInfo, file.name + ": " + cartSummary(env.machine));
        showInfo(ui.startupFileInfo, "");
    });
};

ui.ejectCart.onclick = function () {
    ejectDock(env.machine);
    resetSystem();
    showInfo(ui.cartInfo, "No cartridge.");
};

ui.loadRom0.onclick = function () {
    ui.fileRom0.click();
};

ui.fileRom0.onchange = function () {
    pickRom(0, ui.fileRom0, homeRomSize, ui.rom0Info);
};

ui.loadRom1.onclick = function () {
    ui.fileRom1.click();
};

ui.fileRom1.onchange = function () {
    pickRom(1, ui.fileRom1, exRomSize, ui.rom1Info);
};

ui.reset.onclick = function () {
    resetSystem();
};

ui.nmi.onclick = function () {
    requestNmi(env.machine);
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

/** @param {number} pointerId */
function endKeyboardSplit(pointerId) {
    if (ui.keyboardSplit.hasPointerCapture(pointerId)) {
        ui.keyboardSplit.releasePointerCapture(pointerId);
    }
    document.body.classList.remove("keyboard-splitting");
}

new ResizeObserver(function () {
    if (env.gfx !== null) {
        resizeScreen(env.gfx);
    }
}).observe(ui.screenSlot);

document.onfullscreenchange = function () {
    setScreenOnly(document.fullscreenElement !== null || env.screenOnlyFallback);
};

window.onkeydown = function (e) {
    if (env.sfx !== null) {
        resumeSound(env.sfx); // needs a user interaction to activate
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
    handleKeyDown(env.kbd, e);
};

window.onpointerdown = function () {
    if (env.sfx !== null) {
        resumeSound(env.sfx); // needs a user interaction to activate
    }
};

window.onkeyup = function (e) {
    if (e.code === "F1" || e.code === "F11") {
        e.preventDefault();
        return;
    }
    handleKeyUp(env.kbd, e);
};

window.onblur = function () {
    handleBlur(env.kbd);
};

// In order to initialize the screen renderer, we need GPU shader sources first.
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
            function (err, gfx) { // can be called multiple times on context loss / refresh
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
            showError(ui.rom0Info, errs[0]);
            showError(ui.rom1Info, errs[1]);
            return;
        }
        if (names !== null) {
            showInfo(ui.rom0Info, names[0]);
            showInfo(ui.rom1Info, names[1]);
        }
        if (roms !== null) {
            env.machine.homeRom.set(new Uint8Array(roms[0]));
            env.machine.exRom.set(new Uint8Array(roms[1]));
        }
        resetSystem();
        if (env.startupFileName !== null && env.startupFileBytes !== null) {
            applyStartupFile(env.startupFileName, env.startupFileBytes);
        }
    },
);

const startupFileUrl = query.get("url") ?? "";
if (startupFileUrl !== "") {
    env.abortLoadStartupFile = loadStartupFile(
        startupFileUrl,
        function (err, name, bytes) {
            env.abortLoadStartupFile = null;
            if (err !== null) {
                showError(ui.startupFileInfo, err);
                return;
            }
            if (env.abortLoadRoms === null && name !== null && bytes !== null) {
                applyStartupFile(name, bytes);
                return;
            }
            // remember the file data until roms are ready
            env.startupFileName = name;
            env.startupFileBytes = bytes
        },
    );
}

env.frameId = requestAnimationFrame(onFrame);

/**
 * @param {string} urlParam
 * @param {function(string | null, string | null, ArrayBuffer | null): void} onDone
 * @returns {(function(): void) | null} abort
 */
function loadStartupFile(urlParam, onDone) {
    /** @type {URL | null} */
    let url = null;
    try {
        url = new URL(urlParam, window.location.href);
    } catch {
        onDone("Invalid startup file URL.", null, null);
        return null; // synchronous onDone, no abort
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        onDone("A startup file protocol must be http(s).", null, null);
        return null; // synchronous onDone, no abort
    }
    const zip = isZipName(url.pathname);
    if (!zip && !isTapeName(url.pathname) && !isCartName(url.pathname)) {
        onDone("Unsupported startup file type: " + url.pathname + ".", null, null);
        return null; // synchronous onDone, no abort
    }
    // Serializing a URL escapes a space and everything non-ASCII, so the
    // fragment read back here is encoded again whatever the parameter held, and
    // what a ZIP calls the entry has to be decoded out of it. A name carrying a
    // literal percent is not encoded at all and decoding it throws, so it
    // stands as written.
    let member = url.hash.slice(1);
    try {
        member = decodeURIComponent(member);
    } catch {
        // Not percent-encoded after all.
    }
    let name = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    let maxBytes = maxMediaSize;
    let loadZip = zip;
    // The fragment is not sent; fetch the ZIP path, or the unpacked member
    // when this is an archive.org ZIP that cannot be read cross-origin.
    let requestUrl = url.origin + url.pathname + url.search;
    const unpacked = unpackedMemberUrl(url, member);
    if (unpacked !== null) {
        if (!isTapeName(member) && !isCartName(member)) {
            onDone("ZIP entry " + member + " is not a TAP, TZX, or DCK.", null, null);
            return null; // synchronous onDone, no abort
        }
        requestUrl = unpacked;
        loadZip = false;
        name = member;
    } else if (zip) {
        maxBytes = maxZipSize;
    }
    let done = false; // mostly to prevent non-abortable unzip to trigger post-abort callback
    const abort = httpGet(
        requestUrl,
        "arraybuffer",
        maxBytes,
        function (err, buf) {
            if (done) {
                return;
            }
            if (err !== null) {
                done = true;
                onDone(err, null, null);
                return;
            }
            if (!(buf instanceof ArrayBuffer)) {
                done = true;
                onDone("Could not load " + requestUrl + ": empty response.", null, null);
                return;
            }
            if (!loadZip) {
                done = true;
                onDone(null, name, buf);
                return;
            }
            extractFromZip(
                member,
                buf,
                function (err, name, bytes) {
                    if (done) {
                        return;
                    }
                    done = true;
                    onDone(err, name, bytes);
                },
            );
        },
    );
    
    if (abort === null) {
        return null; // synchronous onDone, no abort
    }
    
    return function() {
        if (done) {
            return;
        }
        done = true;
        abort();
        onDone("Aborted.", null, null);
    };
}

/**
 * Select and extract one loadable file from a ZIP bytes.
 *
 * @param {string} member
 * @param {ArrayBuffer} bytes
 * @param {function(string | null, string | null, ArrayBuffer | null): void} onDone
 */
function extractFromZip(member, bytes, onDone) {
    const listing = listZip(bytes);
    if (listing.err !== null) {
        onDone(listing.err, null, null);
        return;
    }

    let selected = null;
    if (member !== "") {
        for (const entry of listing.entries) {
            if (entry.name === member) {
                selected = entry;
                break;
            }
        }
        if (selected === null) {
            onDone("ZIP entry " + member + " does not exist.", null, null);
            return;
        }
        if (!isTapeName(selected.name) && !isCartName(selected.name)) {
            onDone("ZIP entry " + selected.name + " is not a TAP, TZX, or DCK.", null, null);
            return;
        }
        if (selected.size > maxMediaSize) {
            onDone("ZIP entry " + selected.name + " is too large to load.", null, null);
            return;
        }
    } else {
        const usable = [];
        for (const entry of listing.entries) {
            const supported = isTapeName(entry.name) || isCartName(entry.name);
            const readable = entry.method === 0 || entry.method === 8 && typeof DecompressionStream !== "undefined";
            if (!isHiddenName(entry.name) && supported && !entry.encrypted && readable && entry.size <= maxMediaSize) {
                usable.push(entry);
            }
        }
        if (usable.length === 0) {
            onDone("ZIP file has no usable TAP, TZX, or DCK entries.", null, null);
            return;
        }
        selected = usable[0];
        for (const s of usable) {
            if (s.name < selected.name) {
                selected = s;
            }
        }
    }

    readZipEntry(
        bytes,
        selected,
        function (err, buf) {
            if (err !== null) {
                onDone(err, null, null);
                return;
            }
            if (!(buf instanceof ArrayBuffer)) {
                onDone("Could not extract ZIP entry " + selected.name + ".", null, null);
                return;
            }
            onDone(null, selected.name, buf);
        },
    );
}

/**
 * Dispatch fetched startup bytes through the same paths as locally selected
 * media, including their parsing, status, reset, and tape autoload behavior.
 *
 * @param {string} name
 * @param {ArrayBuffer} bytes
 */
function applyStartupFile(name, bytes) {
    if (isTapeName(name)) {
        const tapeErr = insertTape(env.machine, bytes);
        if (tapeErr !== null) {
            env.tapeName = "";
            refreshTapeStatus(tapeErr);
            return;
        }
        env.tapeName = name;
        refreshTapeStatus(null);
        if (ui.auto.checked && autoloadTape(env.machine) && env.sfx !== null) {
            resetSound(env.sfx);
        }
        return;
    }
    if (isCartName(name)) {
        const dockErr = insertDock(env.machine, bytes);
        if (dockErr !== null) {
            showError(ui.cartInfo, dockErr);
            return;
        }
        resetSystem();
        showInfo(ui.cartInfo, name + ": " + cartSummary(env.machine));
        return;
    }
    showError(ui.startupFileInfo, "Unsupported startup file type: " + name + ".");
}

/**
 * @param {number} slot
 * @param {HTMLInputElement} input
 * @param {number} byteLength
 * @param {HTMLElement} infoEl
 */
function pickRom(slot, input, byteLength, infoEl) {
    if (env.abortLoadRoms !== null) {
        env.abortLoadRoms();
        env.abortLoadRoms = null;
    }
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) {
        return;
    }
    readFile(file, "arraybuffer", function (err, buf) {
        if (err !== null) {
            showError(infoEl, err);
            return;
        }
        if (!(buf instanceof ArrayBuffer) || buf.byteLength !== byteLength) {
            showError(infoEl, "Expected " + byteLength + ", got " + buf.byteLength + " bytes.");
            return;
        }
        if (slot === 0) {
            env.machine.homeRom.set(new Uint8Array(buf));
        } else {
            env.machine.exRom.set(new Uint8Array(buf));
        }
        resetSystem();
        showInfo(infoEl, file.name);
    });
}

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
    // A turbo frame is thrown away, so it runs with no raster painting and no
    // sound synthesis. Only the frame after the burst is drawn and heard.
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
 * Report what the tape transport is doing. This runs every frame, so it only
 * touches the page when something it shows actually changes. A load error
 * stands until the next tape is chosen. A failed insert still ejects the
 * previous tape, so Play stays disabled.
 *
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
    case "ready":
        const blockCount = env.machine.tape.blockCount + " blocks.";
        const playMessage = "Enter LOAD \"\" or press Play.";
        showInfo(ui.tapeInfo, env.tapeName + ": " + blockCount + " " + playMessage);
        ui.playTape.textContent = "Play";
        ui.playTape.disabled = false;
        break;
    case "playing":
        showInfo(ui.tapeInfo, env.tapeName + ": Loading.");
        ui.playTape.textContent = "Play";
        ui.playTape.disabled = true;
        break;
    case "blocked":
        const resumeMessage = "Enter LOAD \"\" or press Resume for the next part.";
        showInfo(ui.tapeInfo, env.tapeName + ": Stopped. " + resumeMessage);
        ui.playTape.textContent = "Resume";
        ui.playTape.disabled = false;
        break;
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


/**
 * @param {import("./machine.js").Machine} machine
 * @returns {string}
 */
function cartSummary(machine) {
    /** @type {string[]} */
    const parts = [];
    addBankSummary(parts, "dock", machine.dock, machine.dockRam);
    addBankSummary(parts, "EXROM", machine.exCart, machine.exCartRam);
    addBankSummary(parts, "HOME", machine.homeCart, machine.homeCartRam);

    let homePages = 0;
    for (let i = 0; i < 8; i += 1) {
        if (machine.homeRamSave[i] !== null) {
            homePages += 1;
        }
    }
    if (homePages > 0) {
        parts.push(homePages + " HOME RAM pages");
    }
    if (parts.length === 0) {
        return "no cartridge chunks.";
    }
    return parts.join(", ") + ".";
    
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
}

/** @param {boolean} visible*/
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
}

// Header and keyboard visibility both derive from these two flags, so the
// fullscreen view and the F1 toggle cannot fight over the same inline style.
function applyVisibility() {
    let header = "";
    if (env.screenOnly) {
        header = "none";
    }
    let keyboard = "";
    if (env.screenOnly || !env.keyboardVisible) {
        keyboard = "none";
    }
    ui.pageHeader.style.display = header;
    ui.keyboardSplit.style.display = keyboard;
    ui.keyboard.style.display = keyboard;
    if (env.gfx !== null) {
        resizeScreen(env.gfx);
    }
}
