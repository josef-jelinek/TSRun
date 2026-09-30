import {
    insertDock,
    ejectDock,
    cartInfo,
} from "./machine.js";

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

import {handleBlur} from "./keyboard.js";

import {
    createHost,
    applySwitchParamValue,
    showError,
    showInfo,
    resetSystem,
    loadTape,
    refreshCartStatus,
    autoloadTapeIfEnabled,
} from "./host.js";

/**
 * A listing row: what it shows, what activating it does, and the name it acts
 * on. `size` is the formatted size, or "" for rows without one.
 *
 * @typedef {{
 *   label: string,
 *   size: string,
 *   action: "up" | "letter" | "zip" | "file",
 *   name: string,
 * }} BrowserRow
 */

// The narrowest the catalog grip makes the catalog, which is the recorder's
// width so the column across from it still holds the recorder, and what the
// grip leaves the TV.
const minCatalogWidth = 290;
const minTvWidth = 320;

const ui = {
    catalog:          /** @type {HTMLElement} */       (document.getElementById("catalog")),
    archivePathDir:   /** @type {HTMLElement} */       (document.getElementById("archive-path-dir")),
    archivePathFile:  /** @type {HTMLElement} */       (document.getElementById("archive-path-file")),
    archiveInfo:      /** @type {HTMLElement} */       (document.getElementById("archive-info")),
    loadFile:         /** @type {HTMLButtonElement} */ (document.getElementById("load-file")),
    loadFileVerb:     /** @type {HTMLElement} */       (document.getElementById("load-file-verb")),
    loadFileKind:     /** @type {HTMLElement} */       (document.getElementById("load-file-kind")),
    saveFile:         /** @type {HTMLButtonElement} */ (document.getElementById("save-file")),
    tsrunLink:        /** @type {HTMLAnchorElement} */ (document.getElementById("tsrun-link")),
    archiveQuery:     /** @type {HTMLInputElement} */  (document.getElementById("archive-query")),
    ts2068:           /** @type {HTMLInputElement} */  (document.getElementById("ts2068")),
    archiveList:      /** @type {HTMLElement} */       (document.getElementById("archive-list")),
    split:            /** @type {HTMLElement} */       (document.getElementById("split")),
    initInfo:         /** @type {HTMLElement} */       (document.getElementById("init-info")),
    soundInfo:        /** @type {HTMLElement} */       (document.getElementById("sound-info")),
    paused:           /** @type {HTMLInputElement} */  (document.getElementById("paused")),
    tapeInfo:         /** @type {HTMLElement} */       (document.getElementById("tape-info")),
    auto:             /** @type {HTMLInputElement} */  (document.getElementById("auto")),
    playTape:         /** @type {HTMLButtonElement} */ (document.getElementById("play-tape")),
    rewTape:          /** @type {HTMLButtonElement} */ (document.getElementById("rew-tape")),
    ffTape:           /** @type {HTMLButtonElement} */ (document.getElementById("ff-tape")),
    playTapeLabel:    /** @type {HTMLElement} */       (document.getElementById("play-tape-label")),
    recorder:         /** @type {HTMLElement} */       (document.getElementById("recorder")),
    tapeLabel:        /** @type {HTMLElement} */       (document.getElementById("tape-label")),
    tapeCounter:      /** @type {HTMLElement} */       (document.getElementById("tape-counter")),
    tapeTotal:        /** @type {HTMLElement} */       (document.getElementById("tape-total")),
    printout:         /** @type {HTMLElement} */       (document.getElementById("printout")),
    printoutName:     /** @type {HTMLElement} */       (document.getElementById("printout-name")),
    printoutSummary:  /** @type {HTMLElement} */       (document.getElementById("printout-summary")),
    printoutRows:     /** @type {HTMLElement} */       (document.getElementById("printout-rows")),
    tapeBlocks:       /** @type {HTMLTableSectionElement} */ (document.getElementById("tape-blocks")),
    cartInfo:         /** @type {HTMLElement} */       (document.getElementById("cart-info")),
    joy1Info:         /** @type {HTMLElement} */       (document.getElementById("joy1-info")),
    joy2Info:         /** @type {HTMLElement} */       (document.getElementById("joy2-info")),
    reset:            /** @type {HTMLButtonElement} */ (document.getElementById("reset")),
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

const host = createHost(ui, {
    query,
    onKeyDown: function (e) {
        if (!host.screenOnly && document.activeElement === ui.archiveList) {
            if (isListNavKey(e.code)) {
                e.preventDefault();
                if (!e.repeat || e.code !== "Enter") {
                    onListKey(e.code);
                }
            }
            return true;
        }
        if (!host.screenOnly && document.activeElement === ui.archiveQuery) {
            if (isSearchListNavKey(e.code)) {
                e.preventDefault();
                if (e.code === "Enter") {
                    if (!e.repeat) {
                        activateRow();
                        ui.archiveList.focus();
                    }
                    return true;
                }
                onListKey(e.code);
            }
            return true;
        }
        if (!isEmulatorFocused()) {
            return true;
        }
        return false;
    },
    onKeyUp: function (e) {
        if (!host.screenOnly && document.activeElement === ui.archiveList && isListNavKey(e.code)) {
            e.preventDefault();
            return true;
        }
        if (!host.screenOnly && document.activeElement === ui.archiveQuery && isSearchListNavKey(e.code)) {
            e.preventDefault();
            return true;
        }
        return false;
    },
    onScreenOnly: function (on) {
        if (on) {
            ui.screen.focus();
        }
    },
});

applySwitchParamValue(ui.ts2068, query.get("ts2068") ?? "");

ui.loadFile.onclick = function () {
    activateRow();
    ui.archiveList.focus();
};

ui.saveFile.onclick = function () {
    saveCursorFile();
    ui.archiveList.focus();
};

ui.archiveQuery.oninput = function () {
    applyArchiveFilter();
};

ui.ts2068.onchange = function () {
    applyArchiveFilter();
};

// A click on a TV, recorder, or case control hands the keys back to the
// emulator; the catalog keeps its own focus.
document.onclick = function (/** @type {MouseEvent} */ e) {
    const target = e.target;
    if (!(target instanceof Element) || ui.catalog.contains(target)) {
        return;
    }
    if (target.closest(".tv-btn, .pk, .kc") !== null) {
        ui.screen.focus();
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
    applySplitSize(e.clientX);
};

ui.split.onpointermove = function (/** @type {PointerEvent} */ e) {
    if (!ui.split.hasPointerCapture(e.pointerId)) {
        return;
    }
    applySplitSize(e.clientX);
};

ui.split.onpointerup = function (/** @type {PointerEvent} */ e) {
    endSplit(e.pointerId);
};

ui.split.onpointercancel = function (/** @type {PointerEvent} */ e) {
    endSplit(e.pointerId);
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

ui.screen.onblur = function () {
    handleBlur(host.kbd);
};

showListMessage("Loading...");
fetchArchiveIndex(function (err, files) {
    if (err !== null) {
        showListMessage(err);
        showError(ui.archiveInfo, err);
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

/**
 * Set the catalog width from the grip on its right edge. Both desk columns take
 * the width, so the TV stays centred over the keyboard; the TV keeps at least
 * minTvWidth. The layout change refits the screen through its observer.
 *
 * @param {number} pointerX
 */
function applySplitSize(pointerX) {
    const style = getComputedStyle(document.body);
    const padX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const gap = Number.parseFloat(style.columnGap);
    let content = document.body.clientWidth;
    if (Number.isFinite(padX)) {
        content -= padX;
    }
    if (Number.isFinite(gap)) {
        content -= 2 * gap;
    }
    const max = (content - minTvWidth) / 2;
    let size = pointerX - ui.catalog.getBoundingClientRect().left;
    size = Math.min(Math.max(size, minCatalogWidth), Math.max(minCatalogWidth, max));
    document.body.style.setProperty("--side", size + "px");
    document.body.style.cursor = "col-resize";
}

/** @param {number} pointerId */
function endSplit(pointerId) {
    if (ui.split.hasPointerCapture(pointerId)) {
        ui.split.releasePointerCapture(pointerId);
    }
    document.body.classList.remove("splitting");
    document.body.style.cursor = "";
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
        items.push({label: "..", size: "", action: "up", name: ""});
    }
    if (browser.level === "zip") {
        for (let i = 0; i < browser.zipFiles.length; i += 1) {
            const f = browser.zipFiles[i];
            items.push({
                label: f.name,
                size: formatSize(f.size),
                action: "file",
                name: f.name,
            });
        }
    } else if (searching) {
        for (let i = 0; i < zips.length; i += 1) {
            const z = zips[i];
            items.push({
                label: z.name,
                size: formatSize(z.size),
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
                    size: "",
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
                    label: z.name,
                    size: formatSize(z.size),
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
        const item = items[i];
        /** @type {"" | "path"} */
        let rowClass = "";
        if (item.action === "file") {
            rowClass = "path";
        }
        const row = makeRow(item.label, item.size, rowClass);
        row.dataset.index = String(i);
        if (item.action === "file" && (isTapeName(item.name) || isCartName(item.name))) {
            row.classList.add("media");
        }
        ui.archiveList.appendChild(row);
    }
    if (browser.abortListing !== null) {
        ui.archiveList.appendChild(makeRow("Loading...", "", "note"));
    } else if (items.length === 0) {
        ui.archiveList.appendChild(makeRow("No files.", "", "note"));
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
 * Header path, Load, Save, and Open in TSRun follow the list cursor, including
 * a highlighted row that has not been opened yet. The Load key names what it
 * would do with that row, like Open zip or Load tzx, and is disabled on a
 * file it cannot load.
 */
function refreshPath() {
    let dir = "";
    let file = "";
    let media = false;
    let canSave = false;
    let loadVerb = "LOAD";
    let loadKind = "File";
    let zip = "";
    let member = "";
    let slash = -1;
    const item = browser.items[browser.cursor];
    if (item !== undefined) {
        switch (item.action) {
        case "up":
            loadVerb = "OPEN";
            loadKind = "Parent";
            switch (browser.level) {
            case "zip":
                file = browser.zip;
                zip = browser.zip;
                canSave = zip !== "";
                break;
            case "letter":
                file = browser.letter;
                break;
            }
            break;
        case "letter":
            file = item.name;
            loadVerb = "OPEN";
            loadKind = "Group";
            break;
        case "zip":
            file = item.name;
            zip = item.name;
            canSave = true;
            loadVerb = "OPEN";
            loadKind = "Zip";
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
            canSave = true;
            if (media) {
                loadKind = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
            }
            break;
        }
    }
    if (file === "") {
        file = "\u00A0";
    }
    ui.archivePathDir.textContent = dir;
    ui.archivePathFile.textContent = file;
    ui.archivePathFile.classList.toggle("media", media);
    if (media) {
        ui.tsrunLink.href = "index.html?url=" + encodeURIComponent(zipUrl(zip) + "#" + member);
        ui.tsrunLink.removeAttribute("aria-disabled");
    } else {
        ui.tsrunLink.removeAttribute("href");
        ui.tsrunLink.setAttribute("aria-disabled", "true");
    }
    ui.loadFileVerb.textContent = loadVerb;
    ui.loadFileKind.textContent = loadKind;
    ui.loadFile.disabled = loadVerb === "LOAD" && !media;
    ui.saveFile.disabled = !canSave;
}

function saveCursorFile() {
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
            showError(ui.archiveInfo, err);
            goUp();
            return;
        }
        if (files === null) {
            showError(ui.archiveInfo, "No files in " + zip + ".");
            goUp();
            return;
        }
        showInfo(ui.archiveInfo, "");
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
        showError(ui.archiveInfo, "\"" + name + "\" is not a TAP, TZX, or DCK.");
        return;
    }
    if (browser.abortMember !== null) {
        browser.abortMember();
        browser.abortMember = null;
    }
    // Progress and errors show where the file is going: the recorder or the dock.
    let infoEl = ui.tapeInfo;
    if (isCartName(name)) {
        infoEl = ui.cartInfo;
    }
    showInfo(infoEl, "Loading " + name + "...");
    browser.abortMember = fetchZipMember(zip, name, function (err, buf) {
        browser.abortMember = null;
        if (err !== null) {
            showError(infoEl, err);
            return;
        }
        if (!(buf instanceof ArrayBuffer)) {
            showError(infoEl, "Could not load " + name + ".");
            return;
        }
        rememberMemberBytes(zip, name, buf);
        applyArchiveFile(name, buf);
    });
}

/**
 * @param {string} name
 * @param {ArrayBuffer} bytes
 */
function applyArchiveFile(name, bytes) {
    // The recorder and the dock show the file name without its folders.
    const shortName = name.slice(name.lastIndexOf("/") + 1);
    if (isTapeName(name)) {
        const hadCart = cartInfo(host.machine).hasCart;
        ejectDock(host.machine);
        if (hadCart) {
            refreshCartStatus(host, "", null);
        }
        if (loadTape(host, shortName, bytes) !== null) {
            if (hadCart) {
                resetSystem(host);
            }
            return;
        }
        if (autoloadTapeIfEnabled(host)) {
            return;
        }
        if (hadCart) {
            resetSystem(host);
        }
        return;
    }
    if (isCartName(name)) {
        const dockErr = insertDock(host.machine, bytes);
        if (dockErr !== null) {
            refreshCartStatus(host, "", dockErr);
            return;
        }
        resetSystem(host);
        refreshCartStatus(host, shortName, null);
        return;
    }
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
    ui.archiveList.replaceChildren(makeRow(text, "", "note"));
}

/**
 * A listing row. A "path" row, a member inside a ZIP, lays out right to left
 * so a long path is shortened at its start, keeping the file name in view; its
 * folder reads dimmer than the name. A "note" row is a message and wraps. The
 * inner span keeps the text itself left to right, and the size reads dimmer.
 *
 * @param {string} label
 * @param {string} size
 * @param {"" | "path" | "note"} rowClass
 * @returns {HTMLElement}
 */
function makeRow(label, size, rowClass) {
    const row = document.createElement("div");
    row.className = "archive-row";
    if (rowClass !== "") {
        row.classList.add(rowClass);
    }
    const text = document.createElement("span");
    let name = label;
    const slash = label.lastIndexOf("/");
    if (rowClass === "path" && slash >= 0) {
        const dir = document.createElement("span");
        dir.className = "dir";
        dir.textContent = label.slice(0, slash + 1);
        text.appendChild(dir);
        name = label.slice(slash + 1);
    }
    text.append(name);
    if (size !== "") {
        const sizeEl = document.createElement("span");
        sizeEl.className = "size";
        sizeEl.textContent = " (" + size + ")";
        text.appendChild(sizeEl);
    }
    row.appendChild(text);
    return row;
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
