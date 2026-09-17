import {httpGet} from "./io.js";

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
 * Fetch HOME (`<name>-0.rom`) and EXROM (`<name>-1.rom`). Empty `name` uses
 * `ts2068`. Invalid names fail synchronously and return no abort. Sizes are
 * the machine's HOME and EXROM lengths, supplied by the caller so this
 * module does not depend on the emulator core.
 *
 * Both slots are always reported, each with its own error or its own buffer.
 * A slot that arrived intact is handed over even when the other one failed or
 * the load was aborted, so cancelling mid-flight cannot throw away a ROM that
 * was already in hand.
 *
 * @param {string} name
 * @param {number} homeSize
 * @param {number} exSize
 * @param {function([string | null, string | null], [string, string], [ArrayBuffer | null, ArrayBuffer | null]): void} onDone
 * @returns {(function(): void) | null} abort
 */
export function loadStartupRoms(name, homeSize, exSize, onDone) {
    if (name === "") {
        name = "ts2068";
    }
    if (!/^[A-Za-z0-9]+$/.test(name)) {
        const err = "Invalid ROM name.";
        onDone([err, err], ["", ""], [null, null]);
        return null; // synchronous onDone, no abort
    }

    let pending = 2;
    let done = false;
    /** @type {[string | null, string | null]} */
    const errs = [null, null];
    /** @type {[string, string]} */
    const names = [name + "-0.rom", name + "-1.rom"];
    /** @type {[ArrayBuffer | null, ArrayBuffer | null]} */
    const roms = [null, null];
    /** @type {((function(): void) | null)[]} */
    const aborts = [null, null];
    aborts[0] = getRom(0, "roms/" + names[0], homeSize);
    if (done) { // in a case getRom errs synchronously
        return null;
    }
    aborts[1] = getRom(1, "roms/" + names[1], exSize);

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
                if (done) {
                    return;
                }
                let slotErr = err;
                if (slotErr === null && (!(buf instanceof ArrayBuffer) || buf.byteLength !== byteLength)) {
                    const s = "Expected " + byteLength + ", got " + (buf?.byteLength ?? 0) + " bytes.";
                    slotErr = "Could not load \"" + url + "\": " + s;
                }
                if (slotErr !== null) {
                    // One half of a ROM set is not a set, so stop the sibling.
                    // Whatever it already delivered still goes out below.
                    errs[slot] = slotErr;
                    done = true;
                    abort();
                    cancelUnsettled();
                    onDone(errs, names, roms);
                    return;
                }
                roms[slot] = buf;
                pending -= 1;
                if (pending === 0) {
                    done = true;
                    onDone(errs, names, roms);
                }
            },
        );
    }

    function abort() {
        aborts[0]?.();
        aborts[1]?.();
    }

    /**
     * A slot left with neither a buffer nor an error was stopped part way
     * through, either by the sibling failing or by the caller aborting. Name
     * that, so no caller can read a blank slot as a success.
     */
    function cancelUnsettled() {
        if (errs[0] === null && roms[0] === null) {
            errs[0] = "Could not load \"roms/" + names[0] + "\": Canceled.";
        }
        if (errs[1] === null && roms[1] === null) {
            errs[1] = "Could not load \"roms/" + names[1] + "\": Canceled.";
        }
    }
}
