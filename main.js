import {initScreen, resizeScreen, drawScreen} from "./screen.js";

import {
    createMachine,
    resetMachine,
    runFrame,
    insertTap,
    insertDock,
    ejectDock,
    requestNmi,
    setVideoOn,
    enableSound,
    setSoundRate,
    takeAudio,
} from "./machine.js";

import {httpGet, readFile} from "./io.js";

import {
    initKeyboard,
    handleKeyDown,
    handleKeyUp,
    handleBlur,
} from "./keyboard.js";

import {
    initSound,
    resumeSound,
    resetSound,
    pushSound,
    soundIsRunning,
    soundQueueReady,
} from "./sound.js";

const soundSampleHz = 44100;
const frameMs = 1000 / 60;
const turboFrames = 100;

const homeRomSize = 16384;
const exRomSize = 8192;

const ui = {
    pageHeader: /** @type {HTMLElement} */ (document.getElementById("page-header")),
    topInfo: /** @type {HTMLElement} */ (document.getElementById("top-info")),
    loadTape: /** @type {HTMLButtonElement} */ (document.getElementById("load-tape")),
    fileTape: /** @type {HTMLInputElement} */ (document.getElementById("file-tape")),
    tapeInfo: /** @type {HTMLElement} */ (document.getElementById("tape-info")),
    loadCart: /** @type {HTMLButtonElement} */ (document.getElementById("load-cart")),
    fileCart: /** @type {HTMLInputElement} */ (document.getElementById("file-cart")),
    ejectCart: /** @type {HTMLButtonElement} */ (document.getElementById("eject-cart")),
    cartInfo: /** @type {HTMLElement} */ (document.getElementById("cart-info")),
    loadRom0: /** @type {HTMLButtonElement} */ (document.getElementById("load-rom0")),
    fileRom0: /** @type {HTMLInputElement} */ (document.getElementById("file-rom0")),
    rom0Info: /** @type {HTMLElement} */ (document.getElementById("rom0-info")),
    loadRom1: /** @type {HTMLButtonElement} */ (document.getElementById("load-rom1")),
    fileRom1: /** @type {HTMLInputElement} */ (document.getElementById("file-rom1")),
    rom1Info: /** @type {HTMLElement} */ (document.getElementById("rom1-info")),
    reset: /** @type {HTMLButtonElement} */ (document.getElementById("reset")),
    nmi: /** @type {HTMLButtonElement} */ (document.getElementById("nmi")),
    screen: /** @type {HTMLCanvasElement} */ (document.getElementById("screen")),
    keyboard: /** @type {HTMLElement} */ (document.getElementById("keyboard")),
    keyboardToggle: /** @type {HTMLButtonElement} */ (document.getElementById("keyboard-toggle")),
    turbo: /** @type {HTMLInputElement} */ (document.getElementById("turbo")),
};

const keyMatrix = new Uint8Array(8);

/**
 * @typedef {{
 *   name: string,
 *   bytes: ArrayBuffer,
 * }} MediaFile
 */

/**
 * @type {{
 *   machine: import("./machine.js").Machine,
 *   kbd: import("./keyboard.js").Keyboard,
 *   gfx: import("./screen.js").Gfx | null,
 *   gfxErr: string | null,
 *   sfx: import("./sound.js").Sfx | null,
 *   sfxErr: string | null,
 *   cartInserted: boolean,
 *   ready: boolean,
 *   frameId: number | undefined,
 *   lastNow: number,
 *   carryMs: number,
 *   romFetchPending: number,
 *   keyboardShown: boolean,
 *   screenOnly: boolean,
 *   userRomOverride: boolean[],
 *   screenOnlyFallback: boolean,
 * }}
 */
const env = {
    machine: createMachine(keyMatrix),
    kbd: initKeyboard(ui.keyboard, keyMatrix),
    gfx: null,
    gfxErr: null,
    sfx: null,
    sfxErr: null,
    cartInserted: false,
    ready: false,
    frameId: undefined,
    lastNow: 0,
    carryMs: 0,
    romFetchPending: 0,
    keyboardShown: false,
    screenOnly: false,
    // If user selected ROM file, prevent slow-fetched default ROM to override it.
    userRomOverride: [false, false],
    screenOnlyFallback: false,
};

ui.loadTape.onclick = function () {
    ui.fileTape.click();
};

ui.fileTape.onchange = function () {
    const tapeFiles = ui.fileTape.files;
    if (tapeFiles === null) {
        return;
    }
    const file = tapeFiles[0];
    ui.fileTape.value = "";
    if (file !== undefined) {
        readFile(file, "arraybuffer", function (err, buf) {
            if (err !== null) {
                setStatus(ui.tapeInfo, err, true);
                return;
            }
            const tap = {
                name: file.name,
                bytes: buf,
            };
            applyTap(tap);
        });
    }
};

ui.loadCart.onclick = function () {
    ui.fileCart.click();
};

ui.fileCart.onchange = function () {
    const cartFiles = ui.fileCart.files;
    if (cartFiles === null) {
        return;
    }
    const file = cartFiles[0];
    ui.fileCart.value = "";
    if (file !== undefined) {
        readFile(file, "arraybuffer", function (err, buf) {
            if (err !== null) {
                setStatus(ui.cartInfo, err, true);
                return;
            }
            const cart = {
                name: file.name,
                bytes: buf,
            };
            if (applyCart(cart)) {
                env.cartInserted = true;
            }
        });
    }
};

ui.ejectCart.onclick = function () {
    handleEject();
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

ui.keyboardToggle.onclick = function () {
    toggleKeyboard();
};

window.onresize = function () {
    resizeScreen(env.gfx);
};

document.onfullscreenchange = function () {
    syncScreenOnly();
};

window.onkeydown = function (e) {
    if (env.sfx !== null) {
        resumeSound(env.sfx); // needs a user interaction to not be suspended
    }
    if (e.code === "F1") {
        e.preventDefault();
        if (!e.repeat) {
            toggleKeyboard();
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
        resumeSound(env.sfx); // needs a user interaction to not be suspended
    }
};

window.onkeyup = function (e) {
    if (e.code === "F1") {
        e.preventDefault();
        return;
    }
    handleKeyUp(env.kbd, e);
};

window.onblur = function () {
    handleBlur(env.kbd);
};

loadRoms();
loadShaders(function (err, shaders) {
    if (err !== null || shaders === null) {
        handleGfx(err, null);
        return;
    }
    initScreen(ui.screen, shaders, handleGfx);
});
initSound(soundSampleHz, handleSfx);
startAnimationLoop();

function loadRoms() {
    let name = new URLSearchParams(window.location.search).get("rom");
    if (name === null || name === "") {
        name = "ts2068";
    }
    if (!/^[A-Za-z0-9]+$/.test(name)) {
        setStatus(ui.rom0Info, "Invalid rom parameter name.", true);
        setStatus(ui.rom1Info, "Invalid rom parameter name.", true);
        return;
    }

    env.romFetchPending = 2;
    getRom(0, "roms/" + name + "-0.rom", homeRomSize, ui.rom0Info);
    getRom(1, "roms/" + name + "-1.rom", exRomSize, ui.rom1Info);
}

/**
 * @param {number} slot
 * @param {string} url
 * @param {number} byteLength
 * @param {HTMLElement} infoEl
 */
function getRom(slot, url, byteLength, infoEl) {
    httpGet(url, "arraybuffer", function (err, buf) {
        storeFetchedRom(slot, url, byteLength, infoEl, err, buf);
        // Both slots are fetched in parallel; reset once, so the CPU never
        // starts on a half-loaded pair.
        env.romFetchPending -= 1;
        if (env.romFetchPending === 0) {
            resetSystem();
        }
    });
}

/**
 * Store one fetched ROM image, or report why it was skipped.
 * @param {number} slot
 * @param {string} url
 * @param {number} byteLength
 * @param {HTMLElement} infoEl
 * @param {string | null} err
 * @param {*} buf
 */
function storeFetchedRom(slot, url, byteLength, infoEl, err, buf) {
    if (env.userRomOverride[slot]) {
        return;
    }
    if (err !== null) {
        setStatus(infoEl, err, true);
        return;
    }
    if (!(buf instanceof ArrayBuffer) || buf.byteLength !== byteLength) {
        const s = "Expected " + byteLength + ", got " + buf.byteLength + " bytes.";
        setStatus(infoEl, "Could not load \"" + url + "\": " + s, true);
        return;
    }
    const slash = url.lastIndexOf("/");
    let name = url;
    if (slash >= 0) {
        name = url.slice(slash + 1);
    }
    applyRom(slot, name, new Uint8Array(buf), infoEl);
}

/**
 * @param {number} slot
 * @param {HTMLInputElement} input
 * @param {number} byteLength
 * @param {HTMLElement} infoEl
 */
function pickRom(slot, input, byteLength, infoEl) {
    const files = input.files;
    if (files === null) {
        return;
    }
    const file = files[0];
    input.value = "";
    if (file === undefined) {
        return;
    }
    readFile(file, "arraybuffer", function (err, buf) {
        if (err !== null) {
            setStatus(infoEl, err, true);
            return;
        }
        if (!(buf instanceof ArrayBuffer) || buf.byteLength !== byteLength) {
            setStatus(infoEl, "Expected " + byteLength + ", got " + buf.byteLength + " bytes.", true);
            return;
        }
        env.userRomOverride[slot] = true;
        applyRom(slot, file.name, new Uint8Array(buf), infoEl);
        resetSystem();
    });
}

/**
 * @param {number} slot
 * @param {string} name
 * @param {Uint8Array} bytes
 * @param {HTMLElement} infoEl
 */
function applyRom(slot, name, bytes, infoEl) {
    if (slot === 0) {
        env.machine.homeRom.set(bytes);
    } else {
        env.machine.exRom.set(bytes);
    }
    setStatus(infoEl, name, false);
}

/**
 * @param {function(string | null, import("./screen.js").Shaders | null): void} onDone
 */
function loadShaders(onDone) {
    const shaders = ["", ""];
    let failed = false;
    getShader(0, "screen.vert.glsl");
    getShader(1, "screen.frag.glsl");

    /**
     * @param {number} slot
     * @param {string} url
     */
    function getShader(slot, url) {
        httpGet(url, "text", function (err, text) {
            if (failed) {
                return;
            }
            if (err !== null || typeof text !== "string" || text === "") {
                failed = true;
                onDone("Failed to load \"" + url + "\"", null);
                return;
            }
            shaders[slot] = text;
            if (shaders[0] !== "" && shaders[1] !== "") {
                onDone(null, {vert: shaders[0], frag: shaders[1]});
            }
        });
    }
}

/**
 * @param {string | null} err
 * @param {import("./screen.js").Gfx | null} gfx
 */
function handleGfx(err, gfx) {
    env.gfx = gfx;
    env.gfxErr = err;
    checkEnv();
}

/**
 * @param {string | null} err
 * @param {import("./sound.js").Sfx | null} sfx
 */
function handleSfx(err, sfx) {
    env.sfx = sfx;
    env.sfxErr = err;
    checkEnv();
}

function checkEnv() {
    if (env.gfxErr !== null) {
        setStatus(ui.topInfo, env.gfxErr, true);
        return;
    }
    if (env.gfx === null) {
        return; // gfx are still being initialized
    }
    if (env.sfx === null && env.sfxErr === null) {
        return; // sfx still being initialized
    }
    if (!env.ready) {
        if (env.sfx !== null) {
            setSoundRate(env.machine, env.sfx.context.sampleRate);
            enableSound(env.machine, true);
        }
        env.ready = true;
    }
    if (env.sfxErr !== null) {
        setStatus(ui.topInfo, "Ready. No sound: " + env.sfxErr, true);
        return;
    }
    setStatus(ui.topInfo, "Ready.", false);
}

function startAnimationLoop() {
    if (env.frameId !== undefined) {
        return;
    }
    env.frameId = requestAnimationFrame(onFrame);
}

/** @param {number} now */
function onFrame(now) {
    env.frameId = requestAnimationFrame(onFrame);
    if (env.gfx === null) {
        return;
    }
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
    if (turboEnabled && turboloading()) {
        while (turboEnabled && ran < turboFrames && turboloading()) {
            stepMachine(turboEnabled);
            ran += 1;
        }
        stepMachine(false); // one full frame so screen and sound catch up
    } else if (env.sfx !== null && soundIsRunning(env.sfx) && !soundQueueReady(env.sfx) && ran < 4) {
        stepMachine(turboEnabled);
        env.carryMs = Math.max(env.carryMs, 0) - frameMs;
    }
    drawScreen(env.gfx, env.machine.pixels);
}

/** @param {boolean} turboEnabled */
function stepMachine(turboEnabled) {
    // A turbo frame is thrown away, so it runs with no raster painting and no
    // sound synthesis. Only the frame after the burst is drawn and heard.
    const turbo = turboEnabled && turboloading();
    setVideoOn(env.machine, !turbo);
    enableSound(env.machine, !turbo && env.sfx !== null);
    runFrame(env.machine);
    const chunk = takeAudio(env.machine);
    if (turbo) {
        return;
    }
    if (env.sfx !== null && chunk.n > 0 && (soundIsRunning(env.sfx) || !soundQueueReady(env.sfx))) {
        pushSound(env.sfx, chunk);
    }
}

/**
 * @returns {boolean}
 */
function turboloading() {
    const tape = env.machine.tape;
    return tape.playing && !tape.waiting;
}

function resetSystem() {
    if (env.sfx !== null) {
        resetSound(env.sfx);
    }
    resetMachine(env.machine);
    // TAP file is kept at the same position, just switched to waiting
    if (env.sfx !== null) {
        resumeSound(env.sfx);
    }
}

function handleEject() {
    const hadCart = env.cartInserted;
    env.cartInserted = false;
    ejectDock(env.machine);
    if (hadCart) {
        resetSystem();
    }
    setStatus(ui.cartInfo, "No cartridge", false);
}

/**
 * @param {MediaFile} tap
 */
function applyTap(tap) {
    const err = insertTap(env.machine, tap.bytes);
    if (err !== null) {
        setStatus(ui.tapeInfo, err, true);
        return;
    }
    const numBlocks = env.machine.tape.blocks.length;
    setStatus(ui.tapeInfo, tap.name + ": " + numBlocks + " blocks. Enter LOAD \"\".", false);
}

/**
 * @param {MediaFile} cart
 * @returns {boolean}
 */
function applyCart(cart) {
    const err = insertDock(env.machine, cart.bytes);
    if (err !== null) {
        setStatus(ui.cartInfo, err, true);
        return false;
    }
    resetSystem();
    setStatus(ui.cartInfo, cart.name + ": " + cartSummary(env.machine), false);
    return true;
}

/**
 * @param {import("./machine.js").Machine} machine
 * @returns {string}
 */
function cartSummary(machine) {
    const banks = [
        {name: "dock", pages: machine.dock, ramFlags: machine.dockRam},
        {name: "EXROM", pages: machine.exCart, ramFlags: machine.exCartRam},
        {name: "HOME", pages: machine.homeCart, ramFlags: machine.homeCartRam},
    ];
    const parts = [];
    for (let b = 0; b < banks.length; b += 1) {
        const bank = banks[b];
        let rom = 0;
        let ram = 0;
        for (let i = 0; i < 8; i += 1) {
            if (bank.pages[i] !== null) {
                if (bank.ramFlags[i]) {
                    ram += 1;
                } else {
                    rom += 1;
                }
            }
        }
        if (rom > 0) {
            parts.push(rom + " " + bank.name + " ROM chunks");
        }
        if (ram > 0) {
            parts.push(ram + " " + bank.name + " RAM chunks");
        }
    }
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
}

/**
 * @param {HTMLElement} el
 * @param {string} text
 * @param {boolean} isError
 */
function setStatus(el, text, isError) {
    el.textContent = text;
    if (isError) {
        el.classList.add("error");
    } else {
        el.classList.remove("error");
    }
}

function toggleKeyboard() {
    env.keyboardShown = !env.keyboardShown;
    applyVisibility();
}

function toggleCanvasFullscreen() {
    if (document.fullscreenElement !== null || env.screenOnlyFallback) {
        leaveFullscreen();
        return;
    }
    enterSlotFullscreen();
}

function enterSlotFullscreen() {
    const slot = ui.screen.parentElement;
    if (slot === null || slot.requestFullscreen === undefined) {
        env.screenOnlyFallback = true;
        setScreenOnly(true);
        return;
    }
    const p = slot.requestFullscreen();
    if (p !== undefined) {
        p.then(function () {}, function () {
            env.screenOnlyFallback = true;
            setScreenOnly(true);
        });
    }
}

function leaveFullscreen() {
    env.screenOnlyFallback = false;
    if (document.fullscreenElement !== null && document.exitFullscreen !== undefined) {
        const p = document.exitFullscreen();
        if (p !== undefined) {
            p.then(function () {}, function () {
                setScreenOnly(false);
            });
        }
        return;
    }
    setScreenOnly(false);
}

function syncScreenOnly() {
    setScreenOnly(document.fullscreenElement !== null || env.screenOnlyFallback);
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
    if (env.screenOnly || !env.keyboardShown) {
        keyboard = "none";
    }
    ui.pageHeader.style.display = header;
    ui.keyboard.style.display = keyboard;
    resizeScreen(env.gfx);
}
