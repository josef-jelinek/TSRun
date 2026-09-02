import {initScreen, resizeScreen, setCrt, drawScreen} from "./screen.js";

import {
    createMachine,
    resetMachine,
    runFrame,
    insertTapeBlocks,
    insertDock,
    ejectDock,
    requestNmi,
    setVideoOn,
    enableSound,
    setSoundRate,
    takeAudio,
} from "./machine.js";

import {httpGet, readFile} from "./io.js";
import {parseTap} from "./tape.js";
import {isTzx, parseTzx} from "./tzx.js";
import {isZip, listZip, readZipEntry} from "./zip.js";

import {
    fetchArchiveIndex,
    fetchZipListing,
    fetchZipMember,
    memberUrl,
    isJunk,
    isTapeName,
    isCartName,
    isOtherMachine,
    formatSize,
} from "./archive.js";

import {initJoysticks, pollJoysticks} from "./joystick.js";

import {
    initKeyboard,
    handleKeyDown,
    handleKeyUp,
    handleBlur,
    typeLoad,
} from "./keyboard.js";

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
const frameMs = 1000 / framesPerSecond;
const turboFrames = 100;

const homeRomSize = 16384;
const exRomSize = 8192;
// How long after a reset the ROM is at the K cursor, so LOAD "" can be typed.
const bootMs = 1500;

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
    keyboardToggle: /** @type {HTMLInputElement} */ (document.getElementById("keyboard-toggle")),
    crt: /** @type {HTMLInputElement} */ (document.getElementById("crt")),
    stereo: /** @type {HTMLInputElement} */ (document.getElementById("stereo")),
    fullscreenToggle: /** @type {HTMLButtonElement} */ (document.getElementById("fullscreen-toggle")),
    turbo: /** @type {HTMLInputElement} */ (document.getElementById("turbo")),
    typeLoad: /** @type {HTMLInputElement} */ (document.getElementById("type-load")),
    browseArchive: /** @type {HTMLButtonElement} */ (document.getElementById("browse-archive")),
    archivePanel: /** @type {HTMLElement} */ (document.getElementById("archive-panel")),
    archiveSearch: /** @type {HTMLInputElement} */ (document.getElementById("archive-search")),
    archiveTs2068: /** @type {HTMLInputElement} */ (document.getElementById("archive-ts2068")),
    archiveInfo: /** @type {HTMLElement} */ (document.getElementById("archive-info")),
    archiveClose: /** @type {HTMLButtonElement} */ (document.getElementById("archive-close")),
    archiveList: /** @type {HTMLElement} */ (document.getElementById("archive-list")),
    archiveMembers: /** @type {HTMLElement} */ (document.getElementById("archive-members")),
};

const keyMatrix = new Uint8Array(8);
const joystick = new Uint8Array(2);
initJoysticks(joystick);

/**
 * @typedef {{
 *   name: string,
 *   bytes: ArrayBuffer,
 * }} MediaFile
 */

/**
 * The files of one ZIP, from archive.org or a local file, shown in the
 * members list. `open` inserts a tape or cartridge member; `link` is where
 * another member can be viewed, if anywhere.
 * @typedef {{
 *   title: string,
 *   files: import("./archive.js").ArchiveFile[],
 *   open: (member: string) => void,
 *   link: ((member: string) => string) | null,
 * }} MemberSource
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
 *   archiveIndex: import("./archive.js").ArchiveFile[] | null,
 *   archiveLoading: boolean,
 *   archiveShown: boolean,
 *   archiveZip: string | null,
 *   archiveRequest: number,
 *   members: MemberSource | null,
 *   resetAt: number,
 *   typeTimer: number | undefined,
 * }}
 */
const env = {
    machine: createMachine(keyMatrix, joystick),
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
    archiveIndex: null,
    archiveLoading: false,
    archiveShown: false,
    archiveZip: null,
    // Bumped by every archive click, so a slow earlier fetch cannot land on
    // top of a later choice.
    archiveRequest: 0,
    members: null,
    resetAt: 0,
    typeTimer: undefined,
};

ui.loadTape.onclick = function () {
    ui.fileTape.click();
};

ui.fileTape.onchange = function () {
    const file = ui.fileTape.files?.[0];
    ui.fileTape.value = "";
    if (file === undefined) {
        return;
    }
    readFile(file, "arraybuffer", function (err, buf) {
        if (err !== null) {
            setStatus(ui.tapeInfo, err, true);
            return;
        }
        if (isZip(buf)) {
            openLocalZip(file.name, buf);
            return;
        }
        applyTapeBytes(file.name, buf);
    });
};

ui.browseArchive.onclick = function () {
    setArchiveShown(!env.archiveShown);
};

ui.archiveClose.onclick = function () {
    setArchiveShown(false);
};

ui.archiveSearch.oninput = function () {
    renderArchiveList();
};

ui.archiveTs2068.onchange = function () {
    renderArchiveList();
};

/** @param {MouseEvent} e */
ui.archiveList.onclick = function (e) {
    const btn = itemButton(e.target);
    if (btn === null || env.archiveIndex === null) {
        return;
    }
    const index = Number(btn.dataset.index);
    if (index >= 0 && index < env.archiveIndex.length) {
        selectArchiveZip(env.archiveIndex[index].name);
    }
};

/** @param {MouseEvent} e */
ui.archiveMembers.onclick = function (e) {
    const btn = itemButton(e.target);
    if (btn === null || env.members === null || btn.dataset.member === undefined) {
        return;
    }
    env.members.open(btn.dataset.member);
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

ui.keyboardToggle.onchange = function () {
    setKeyboardShown(ui.keyboardToggle.checked);
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

window.onresize = function () {
    if (env.gfx !== null) {
        resizeScreen(env.gfx);
    }
};

// The header grows and shrinks with the archive panel and with status text
// wrapping, and the screen slot has to follow.
new ResizeObserver(function () {
    resizeScreen(env.gfx);
}).observe(ui.pageHeader);

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
    if (typingInField(e)) {
        if (e.key === "Escape" || e.code === "Escape") {
            setArchiveShown(false);
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
    if (typingInField(e)) {
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
            openLinkedTape();
        }
    });
}

/**
 * Insert the archive.org tape named in the page URL, as `?zip=` with an
 * optional `&file=` member. Runs once the ROMs are in, so LOAD "" lands at
 * the K cursor.
 */
function openLinkedTape() {
    const params = new URLSearchParams(window.location.search);
    const zip = params.get("zip");
    if (zip === null || zip === "") {
        return;
    }
    env.archiveZip = zip;
    const file = params.get("file");
    if (file !== null && file !== "") {
        loadArchiveMember(zip, file);
        return;
    }
    selectArchiveZip(zip);
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
    const file = input.files?.[0];
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
        // Setup machine and sound only once.
        if (env.sfx !== null) {
            setSoundStereo(env.sfx, ui.stereo.checked);
            setSoundRate(env.machine, env.sfx.context.sampleRate);
            enableSound(env.machine, true);
        }
        env.ready = true;
    }
    // Graphics context can be reinitialized multiple times.
    setCrt(env.gfx, ui.crt.checked);
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
    env.resetAt = performance.now();
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
 * Insert a TAP or TZX image. The format is sniffed, since archive names are
 * not always right.
 * @param {string} name
 * @param {ArrayBuffer} bytes
 */
function applyTapeBytes(name, bytes) {
    let parsed;
    if (isTzx(bytes)) {
        parsed = parseTzx(bytes);
    } else {
        parsed = parseTap(bytes);
    }
    if (parsed.err !== null) {
        setStatus(ui.tapeInfo, name + ": " + parsed.err, true);
        return;
    }
    insertTapeBlocks(env.machine, parsed.blocks);
    let hint = " Enter LOAD \"\".";
    if (ui.typeLoad.checked) {
        scheduleTypeLoad();
        hint = " Typing LOAD \"\".";
    }
    setStatus(ui.tapeInfo, name + ": " + parsed.blocks.length + " blocks." + hint, false);
}

// Type LOAD "" once the ROM has had time to reach the K cursor after a reset.
function scheduleTypeLoad() {
    clearTimeout(env.typeTimer);
    const wait = Math.max(0, env.resetAt + bootMs - performance.now());
    env.typeTimer = setTimeout(function () {
        typeLoad(env.kbd);
    }, wait);
}

/**
 * @param {string} name
 * @param {ArrayBuffer} bytes
 */
function openLocalZip(name, bytes) {
    const list = listZip(bytes);
    if (list.err !== null) {
        setStatus(ui.tapeInfo, name + ": " + list.err, true);
        return;
    }
    const entries = list.entries;
    const files = [];
    for (let i = 0; i < entries.length; i += 1) {
        if (!isJunk(entries[i].name)) {
            files.push({name: entries[i].name, size: entries[i].size});
        }
    }
    showMembers({
        title: name,
        files: files,
        open: function (member) {
            for (let i = 0; i < entries.length; i += 1) {
                if (entries[i].name === member) {
                    setStatus(mediaInfo(member), "Unpacking " + member + "...", false);
                    readZipEntry(bytes, entries[i], function (err, buf) {
                        if (err !== null) {
                            setStatus(mediaInfo(member), err, true);
                            return;
                        }
                        applyMediaBytes(member, buf);
                    });
                    return;
                }
            }
        },
        link: null,
    });
}

/** @param {boolean} shown */
function setArchiveShown(shown) {
    env.archiveShown = shown;
    if (shown) {
        ui.archivePanel.style.display = "";
        loadArchiveIndex();
        ui.archiveSearch.focus();
    } else {
        ui.archivePanel.style.display = "none";
        ui.archiveSearch.blur();
    }
}

function loadArchiveIndex() {
    if (env.archiveIndex !== null || env.archiveLoading) {
        return;
    }
    env.archiveLoading = true;
    setStatus(ui.archiveInfo, "Fetching the archive index...", false);
    fetchArchiveIndex(function (err, files) {
        env.archiveLoading = false;
        if (err !== null || files === null) {
            setStatus(ui.archiveInfo, err ?? "No archive index.", true);
            return;
        }
        env.archiveIndex = files;
        renderArchiveList();
    });
}

function renderArchiveList() {
    ui.archiveList.textContent = "";
    if (env.archiveIndex === null) {
        return;
    }
    const words = ui.archiveSearch.value.toLowerCase().split(/\s+/).filter(function (w) {
        return w !== "";
    });
    const frag = document.createDocumentFragment();
    let shown = 0;
    for (let i = 0; i < env.archiveIndex.length; i += 1) {
        const file = env.archiveIndex[i];
        if (ui.archiveTs2068.checked && isOtherMachine(file.name)) {
            continue;
        }
        const lower = file.name.toLowerCase();
        let match = true;
        for (let w = 0; w < words.length; w += 1) {
            if (!lower.includes(words[w])) {
                match = false;
                break;
            }
        }
        if (!match) {
            continue;
        }
        const btn = makeItem(file.name.replace(/\.zip$/i, ""), formatSize(file.size));
        btn.dataset.index = String(i);
        if (file.name === env.archiveZip) {
            btn.classList.add("selected");
        }
        frag.appendChild(btn);
        shown += 1;
    }
    ui.archiveList.appendChild(frag);
    setStatus(ui.archiveInfo, shown + " of " + env.archiveIndex.length + " titles.", false);
}

/** @param {string} zip */
function selectArchiveZip(zip) {
    env.archiveRequest += 1;
    const request = env.archiveRequest;
    env.archiveZip = zip;
    env.members = null;
    ui.archiveMembers.textContent = "";
    markSelected(ui.archiveList, "index", zip);
    setStatus(ui.archiveInfo, "Listing " + zip + "...", false);
    fetchZipListing(zip, function (err, files) {
        if (request !== env.archiveRequest) {
            return;
        }
        if (err !== null || files === null) {
            setStatus(ui.archiveInfo, err ?? "No listing.", true);
            return;
        }
        showMembers({
            title: zip,
            files: files,
            open: function (member) {
                loadArchiveMember(zip, member);
            },
            link: function (member) {
                return memberUrl(zip, member);
            },
        });
    });
}

/**
 * @param {string} zip
 * @param {string} member
 */
function loadArchiveMember(zip, member) {
    env.archiveRequest += 1;
    const request = env.archiveRequest;
    markSelected(ui.archiveMembers, "member", member);
    setStatus(mediaInfo(member), "Fetching " + member + "...", false);
    fetchZipMember(zip, member, function (err, buf) {
        if (request !== env.archiveRequest) {
            return;
        }
        if (err !== null || !(buf instanceof ArrayBuffer)) {
            setStatus(mediaInfo(member), err ?? "Empty download.", true);
            return;
        }
        applyMediaBytes(member, buf);
        const params = new URLSearchParams(window.location.search);
        params.set("zip", zip);
        params.set("file", member);
        history.replaceState(null, "", "?" + params.toString());
    });
}

/**
 * Insert a tape or a cartridge, by file name.
 * @param {string} name
 * @param {ArrayBuffer} bytes
 */
function applyMediaBytes(name, bytes) {
    if (isCartName(name)) {
        if (applyCart({name: name, bytes: bytes})) {
            env.cartInserted = true;
        }
        return;
    }
    applyTapeBytes(name, bytes);
}

/**
 * @param {string} name
 * @returns {HTMLElement}
 */
function mediaInfo(name) {
    if (isCartName(name)) {
        return ui.cartInfo;
    }
    return ui.tapeInfo;
}

/**
 * List the files of a ZIP and, when the choice is obvious, insert the
 * program: the only .tap, failing that the only .tzx, failing that the only
 * .dck.
 * @param {MemberSource} src
 */
function showMembers(src) {
    env.members = src;
    ui.archiveMembers.textContent = "";
    const frag = document.createDocumentFragment();
    const heading = document.createElement("div");
    heading.className = "archive-file";
    heading.textContent = src.title;
    frag.appendChild(heading);
    const taps = [];
    const tzxs = [];
    const dcks = [];
    for (let i = 0; i < src.files.length; i += 1) {
        const file = src.files[i];
        if (isTapeName(file.name) || isCartName(file.name)) {
            const btn = makeItem(file.name, formatSize(file.size));
            btn.dataset.member = file.name;
            frag.appendChild(btn);
            if (isCartName(file.name)) {
                dcks.push(file.name);
            } else if (/\.tap$/i.test(file.name)) {
                taps.push(file.name);
            } else {
                tzxs.push(file.name);
            }
            continue;
        }
        const row = document.createElement("div");
        row.className = "archive-file";
        if (src.link !== null) {
            const a = document.createElement("a");
            a.href = src.link(file.name);
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = file.name;
            row.appendChild(a);
        } else {
            row.textContent = file.name;
        }
        row.title = formatSize(file.size);
        frag.appendChild(row);
    }
    ui.archiveMembers.appendChild(frag);
    setStatus(ui.archiveInfo, src.files.length + " files in " + src.title, false);
    if (taps.length === 1) {
        src.open(taps[0]);
        return;
    }
    if (taps.length === 0 && tzxs.length === 1) {
        src.open(tzxs[0]);
        return;
    }
    if (taps.length + tzxs.length === 0 && dcks.length === 1) {
        src.open(dcks[0]);
        return;
    }
    if (taps.length + tzxs.length + dcks.length === 0) {
        setStatus(ui.archiveInfo, "No TAP, TZX or DCK in " + src.title + ".", true);
        return;
    }
    setStatus(ui.archiveInfo, "Choose a file to insert.", false);
    setArchiveShown(true);
}

/**
 * @param {string} text
 * @param {string} title
 * @returns {HTMLButtonElement}
 */
function makeItem(text, title) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "archive-item";
    btn.textContent = text;
    btn.title = title;
    return btn;
}

/**
 * @param {EventTarget | null} target
 * @returns {HTMLButtonElement | null}
 */
function itemButton(target) {
    if (!(target instanceof Element)) {
        return null;
    }
    const btn = target.closest("button.archive-item");
    if (btn instanceof HTMLButtonElement) {
        return btn;
    }
    return null;
}

/**
 * Highlight the item whose data attribute names `value`; `index` items are
 * matched through the archive index.
 * @param {HTMLElement} list
 * @param {string} key
 * @param {string} value
 */
function markSelected(list, key, value) {
    const items = list.querySelectorAll("button.archive-item");
    for (let i = 0; i < items.length; i += 1) {
        const btn = /** @type {HTMLElement} */ (items[i]);
        let name = btn.dataset[key];
        if (key === "index" && env.archiveIndex !== null && name !== undefined) {
            name = env.archiveIndex[Number(name)]?.name;
        }
        if (name === value) {
            btn.classList.add("selected");
        } else {
            btn.classList.remove("selected");
        }
    }
}

/**
 * Keys typed into the archive search box must not reach the emulator.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function typingInField(e) {
    const t = e.target;
    return t instanceof HTMLInputElement && (t.type === "search" || t.type === "text");
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
    setKeyboardShown(!env.keyboardShown);
}

/** @param {boolean} shown */
function setKeyboardShown(shown) {
    env.keyboardShown = shown;
    ui.keyboardToggle.checked = shown;
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

function leaveFullscreen() {
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
    if (env.gfx !== null) {
        resizeScreen(env.gfx);
    }
}
