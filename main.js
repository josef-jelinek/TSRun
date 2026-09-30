import {
    insertDock,
    ejectDock,
    setHomeRom,
    setExRom,
} from "./machine.js";

import {readFile} from "./io.js";
import {loadMediaUrl} from "./load.js";
import {isTapeName, isCartName} from "./media.js";

import {
    createHost,
    showError,
    showInfo,
    resetSystem,
    refreshTapeStatus,
    refreshCartStatus,
    loadTape,
    unloadTape,
    autoloadTapeIfEnabled,
} from "./host.js";

const ui = {
    initInfo:         /** @type {HTMLElement} */       (document.getElementById("init-info")),
    soundInfo:        /** @type {HTMLElement} */       (document.getElementById("sound-info")),
    startupFileInfo:  /** @type {HTMLElement} */       (document.getElementById("startup-file-info")),
    paused:           /** @type {HTMLInputElement} */  (document.getElementById("paused")),
    loadTape:         /** @type {HTMLButtonElement} */ (document.getElementById("load-tape")),
    fileTape:         /** @type {HTMLInputElement} */  (document.getElementById("file-tape")),
    auto:             /** @type {HTMLInputElement} */  (document.getElementById("auto")),
    playTape:         /** @type {HTMLButtonElement} */ (document.getElementById("play-tape")),
    rewTape:          /** @type {HTMLButtonElement} */ (document.getElementById("rew-tape")),
    ffTape:           /** @type {HTMLButtonElement} */ (document.getElementById("ff-tape")),
    playTapeLabel:    /** @type {HTMLElement} */       (document.getElementById("play-tape-label")),
    tapeInfo:         /** @type {HTMLElement} */       (document.getElementById("tape-info")),
    recorder:         /** @type {HTMLElement} */       (document.getElementById("recorder")),
    tapeLabel:        /** @type {HTMLElement} */       (document.getElementById("tape-label")),
    tapeCounter:      /** @type {HTMLElement} */       (document.getElementById("tape-counter")),
    tapeTotal:        /** @type {HTMLElement} */       (document.getElementById("tape-total")),
    printout:         /** @type {HTMLElement} */       (document.getElementById("printout")),
    printoutName:     /** @type {HTMLElement} */       (document.getElementById("printout-name")),
    printoutSummary:  /** @type {HTMLElement} */       (document.getElementById("printout-summary")),
    printoutRows:     /** @type {HTMLElement} */       (document.getElementById("printout-rows")),
    tapeBlocks:       /** @type {HTMLTableSectionElement} */ (document.getElementById("tape-blocks")),
    joy1Info:         /** @type {HTMLElement} */       (document.getElementById("joy1-info")),
    joy2Info:         /** @type {HTMLElement} */       (document.getElementById("joy2-info")),
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
    muted:            /** @type {HTMLInputElement} */  (document.getElementById("muted")),
    fullscreenToggle: /** @type {HTMLButtonElement} */ (document.getElementById("fullscreen-toggle")),
    turbo:            /** @type {HTMLInputElement} */  (document.getElementById("turbo")),
};

const query = new URLSearchParams(window.location.search);

/**
 * @type {{
 *   abortLoadStartupFile: (function(): void) | null,
 *   startupFileName:      string | null,
 *   startupFileBytes:     ArrayBuffer | null,
 * }}
 */
const page = {
    abortLoadStartupFile: null,
    startupFileName:      null,
    startupFileBytes:     null,
};

const host = createHost(ui, {
    query,
    onRomsReady: function () {
        if (page.startupFileName !== null && page.startupFileBytes !== null) {
            applyStartupFile(page.startupFileName, page.startupFileBytes);
        }
    },
    onRomSlot: function (slot, romName, err) {
        let infoEl = ui.rom0Info;
        if (slot === 1) {
            infoEl = ui.rom1Info;
        }
        if (err !== null) {
            showError(infoEl, err);
            return;
        }
        showInfo(infoEl, romName);
    },
});

ui.loadTape.onclick = function () {
    ui.fileTape.click();
};

ui.fileTape.onchange = function () {
    const file = ui.fileTape.files?.[0];
    ui.fileTape.value = "";
    if (file === undefined) {
        return;
    }
    cancelStartupFile();
    unloadTape(host);
    // Triggering multiple concurrent file reads is too unlikely to guard against.
    readFile(file, "arraybuffer", function (err, buf) {
        if (err !== null) {
            refreshTapeStatus(host, err);
            return;
        }
        if (loadTape(host, file.name, buf) !== null) {
            return;
        }
        showInfo(ui.startupFileInfo, "");
        autoloadTapeIfEnabled(host);
    });
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
    cancelStartupFile();
    ejectDock(host.machine);
    refreshCartStatus(host, "", null);
    // Triggering multiple concurrent file reads is too unlikely to guard against.
    readFile(file, "arraybuffer", function (err, buf) {
        if (err !== null) {
            refreshCartStatus(host, "", err);
            return;
        }
        const dockErr = insertDock(host.machine, buf);
        if (dockErr !== null) {
            refreshCartStatus(host, "", dockErr);
            return;
        }
        resetSystem(host);
        refreshCartStatus(host, file.name, null);
        showInfo(ui.startupFileInfo, "");
    });
};

ui.ejectCart.onclick = function () {
    ejectDock(host.machine);
    resetSystem(host);
    refreshCartStatus(host, "", null);
};

ui.loadRom0.onclick = function () {
    ui.fileRom0.click();
};

ui.fileRom0.onchange = function () {
    pickRom(setHomeRom, ui.fileRom0, ui.rom0Info);
};

ui.loadRom1.onclick = function () {
    ui.fileRom1.click();
};

ui.fileRom1.onchange = function () {
    pickRom(setExRom, ui.fileRom1, ui.rom1Info);
};

const startupFileUrl = query.get("url") ?? "";
if (startupFileUrl !== "") {
    page.abortLoadStartupFile = loadMediaUrl(
        startupFileUrl,
        function (err, name, bytes) {
            page.abortLoadStartupFile = null;
            if (err !== null) {
                showError(ui.startupFileInfo, err);
                return;
            }
            if (host.abortLoadRoms === null && name !== null && bytes !== null) {
                applyStartupFile(name, bytes);
                return;
            }
            // remember the file data until roms are ready
            page.startupFileName = name;
            page.startupFileBytes = bytes;
        },
    );
}

function cancelStartupFile() {
    if (page.abortLoadStartupFile !== null) {
        page.abortLoadStartupFile();
        page.abortLoadStartupFile = null;
    }
    page.startupFileName = null;
    page.startupFileBytes = null;
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
        if (loadTape(host, name, bytes) !== null) {
            return;
        }
        autoloadTapeIfEnabled(host);
        return;
    }
    if (isCartName(name)) {
        const dockErr = insertDock(host.machine, bytes);
        if (dockErr !== null) {
            refreshCartStatus(host, "", dockErr);
            return;
        }
        resetSystem(host);
        refreshCartStatus(host, name, null);
        return;
    }
    showError(ui.startupFileInfo, "Unsupported startup file type: " + name + ".");
}

/**
 * @param {function(import("./machine.js").Machine, ArrayBuffer | Uint8Array): string | null} setRom
 * @param {HTMLInputElement} input
 * @param {HTMLElement} infoEl
 */
function pickRom(setRom, input, infoEl) {
    if (host.abortLoadRoms !== null) {
        host.abortLoadRoms();
        host.abortLoadRoms = null;
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
        if (!(buf instanceof ArrayBuffer)) {
            showError(infoEl, "Empty read.");
            return;
        }
        const romErr = setRom(host.machine, buf);
        if (romErr !== null) {
            showError(infoEl, romErr);
            return;
        }
        resetSystem(host);
        showInfo(infoEl, file.name);
    });
}
