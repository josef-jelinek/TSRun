import {httpGet} from "./io.js";

export const homeRomSize = 16384;
export const exRomSize = 8192;
const maxShaderSize = 65536;

/**
 * Load the display vertex and fragment shader sources.
 *
 * @param {function(string | null, import("./screen.js").Shaders | null): void} onDone
 */
export function loadShaders(onDone) {
    const shaders = ["", ""];
    let done = false;
    /** @type {((function(): void) | null)[]} */
    const aborts = [null, null];
    aborts[0] = getShader(0, "screen.vert.glsl");
    if (done) { // in a case getShader errs synchronously
        return;
    }
    aborts[1] = getShader(1, "screen.frag.glsl");

    /**
     * @param {number} slot
     * @param {string} url
     */
    function getShader(slot, url) {
        return httpGet(
            url,
            "text",
            maxShaderSize,
            function (err, text) {
                if (done) {
                    return;
                }
                if (err !== null || typeof text !== "string" || text === "") {
                    done = true;
                    aborts[0]?.();
                    aborts[1]?.();
                    onDone("Failed to load \"" + url + "\"", null);
                    return;
                }
                shaders[slot] = text;
                if (shaders[0] !== "" && shaders[1] !== "") {
                    onDone(null, {vert: shaders[0], frag: shaders[1]});
                }
            },
        );
    }
}

/**
 * Fetch HOME (`<name>-0.rom`, 16K) and EXROM (`<name>-1.rom`, 8K). Empty
 * `name` uses `ts2068`. Invalid names fail synchronously and return no abort.
 *
 * @param {string} name
 * @param {function(string[] | null, string[] | null, ArrayBuffer[] | null): void} onDone
 * @returns {(function(): void) | null} abort
 */
export function loadStartupRoms(name, onDone) {
    if (name === "") {
        name = "ts2068";
    }
    if (!/^[A-Za-z0-9]+$/.test(name)) {
        const err = "Invalid ROM name.";
        onDone([err, err], null, null);
        return null; // synchronous onDone, no abort
    }

    let pending = 2;
    /** @type {[string | null, string | null]} */
    const errs = [null, null];
    const names = [name + "-0.rom", name + "-1.rom"];
    const roms = [new ArrayBuffer(0), new ArrayBuffer(0)];
    const aborts = [
        getRom(0, "roms/" + names[0], homeRomSize),
        getRom(1, "roms/" + names[1], exRomSize),
    ];

    return abort;

    /**
     * @param {number} slot
     * @param {string} url
     * @param {number} byteLength
     */
    function getRom(slot, url, byteLength) {
        return httpGet(
            url,
            "arraybuffer",
            byteLength,
            function (err, buf) {
                if (err !== null) {
                    abort();
                    errs[slot] = err;
                } else if (!(buf instanceof ArrayBuffer) || buf.byteLength !== byteLength) {
                    abort();
                    const s = "Expected " + byteLength + ", got " + (buf?.byteLength ?? 0) + " bytes.";
                    errs[slot] = "Could not load \"" + url + "\": " + s;
                } else {
                    roms[slot] = buf;
                }
                pending -= 1;
                if (pending === 0) {
                    if (errs[0] !== null || errs[1] !== null) {
                        onDone([errs[0] ?? "", errs[1] ?? ""], null, null);
                        return;
                    }
                    onDone(null, names, roms);
                }
            },
        );
    }

    function abort() {
        aborts[0]?.();
        aborts[1]?.();
    }
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
