/**
 * @typedef {{
 *   row: number,
 *   bit: number,
 * }} KeyBit
 */

/**
 * @typedef {{
 *   label: string,
 *   keyword: string,
 *   bits: KeyBit[],
 *   codes: string[],
 *   wide?: boolean,
 * }} OverlayKeySpec
 */

/**
 * @typedef {{
 *   el: HTMLButtonElement,
 *   bits: KeyBit[],
 * }} OverlayKey
 */

/**
 * @typedef {{
 *   id: number,
 *   bits: KeyBit[],
 * }} PointerHold
 */

/**
 * @typedef {{
 *   keyMatrix: Uint8Array,
 *   hostHeld: string[],
 *   pointerHeld: PointerHold[],
 *   scriptHeld: KeyBit[],
 *   scriptId: number,
 *   overlayKeys: OverlayKey[],
 * }} Keyboard
 */

// How long a scripted key is held and then released, in ms. The ROM needs a
// key stable for a few interrupts, and it must not stay long enough to repeat.
const scriptKeyMs = 100;

const cs = {row: 0, bit: 0};
const keyZ = {row: 0, bit: 1};
const keyX = {row: 0, bit: 2};
const keyC = {row: 0, bit: 3};
const keyV = {row: 0, bit: 4};
const keyA = {row: 1, bit: 0};
const keyS = {row: 1, bit: 1};
const keyD = {row: 1, bit: 2};
const keyF = {row: 1, bit: 3};
const keyG = {row: 1, bit: 4};
const keyQ = {row: 2, bit: 0};
const keyW = {row: 2, bit: 1};
const keyE = {row: 2, bit: 2};
const keyR = {row: 2, bit: 3};
const keyT = {row: 2, bit: 4};
const key1 = {row: 3, bit: 0};
const key2 = {row: 3, bit: 1};
const key3 = {row: 3, bit: 2};
const key4 = {row: 3, bit: 3};
const key5 = {row: 3, bit: 4};
const key0 = {row: 4, bit: 0};
const key9 = {row: 4, bit: 1};
const key8 = {row: 4, bit: 2};
const key7 = {row: 4, bit: 3};
const key6 = {row: 4, bit: 4};
const keyP = {row: 5, bit: 0};
const keyO = {row: 5, bit: 1};
const keyI = {row: 5, bit: 2};
const keyU = {row: 5, bit: 3};
const keyY = {row: 5, bit: 4};
const keyEnter = {row: 6, bit: 0};
const keyL = {row: 6, bit: 1};
const keyK = {row: 6, bit: 2};
const keyJ = {row: 6, bit: 3};
const keyH = {row: 6, bit: 4};
const keySpace = {row: 7, bit: 0};
const ss = {row: 7, bit: 1};
const keyM = {row: 7, bit: 2};
const keyN = {row: 7, bit: 3};
const keyB = {row: 7, bit: 4};

/** @type {OverlayKeySpec[][]} */
const overlayRows = [
    [
        {label: "1", keyword: "EDIT", bits: [key1], codes: ["Digit1", "Numpad1"]},
        {label: "2", keyword: "CAPS", bits: [key2], codes: ["Digit2", "Numpad2"]},
        {label: "3", keyword: "TRUE", bits: [key3], codes: ["Digit3", "Numpad3"]},
        {label: "4", keyword: "INV", bits: [key4], codes: ["Digit4", "Numpad4"]},
        {label: "5", keyword: "\u2190", bits: [key5], codes: ["Digit5", "Numpad5"]},
        {label: "6", keyword: "\u2193", bits: [key6], codes: ["Digit6", "Numpad6"]},
        {label: "7", keyword: "\u2191", bits: [key7], codes: ["Digit7", "Numpad7"]},
        {label: "8", keyword: "\u2192", bits: [key8], codes: ["Digit8", "Numpad8"]},
        {label: "9", keyword: "GRAPH", bits: [key9], codes: ["Digit9", "Numpad9"]},
        {label: "0", keyword: "DELETE", bits: [key0], codes: ["Digit0", "Numpad0"]},
    ],
    [
        {label: "Q", keyword: "PLOT", bits: [keyQ], codes: ["KeyQ"]},
        {label: "W", keyword: "DRAW", bits: [keyW], codes: ["KeyW"]},
        {label: "E", keyword: "REM", bits: [keyE], codes: ["KeyE"]},
        {label: "R", keyword: "RUN", bits: [keyR], codes: ["KeyR"]},
        {label: "T", keyword: "RAND", bits: [keyT], codes: ["KeyT"]},
        {label: "Y", keyword: "RETURN", bits: [keyY], codes: ["KeyY"]},
        {label: "U", keyword: "IF", bits: [keyU], codes: ["KeyU"]},
        {label: "I", keyword: "INPUT", bits: [keyI], codes: ["KeyI"]},
        {label: "O", keyword: "POKE", bits: [keyO], codes: ["KeyO"]},
        {label: "P", keyword: "PRINT", bits: [keyP], codes: ["KeyP"]},
    ],
    [
        {label: "A", keyword: "NEW", bits: [keyA], codes: ["KeyA"]},
        {label: "S", keyword: "SAVE", bits: [keyS], codes: ["KeyS"]},
        {label: "D", keyword: "DIM", bits: [keyD], codes: ["KeyD"]},
        {label: "F", keyword: "FOR", bits: [keyF], codes: ["KeyF"]},
        {label: "G", keyword: "GOTO", bits: [keyG], codes: ["KeyG"]},
        {label: "H", keyword: "GOSUB", bits: [keyH], codes: ["KeyH"]},
        {label: "J", keyword: "LOAD", bits: [keyJ], codes: ["KeyJ"]},
        {label: "K", keyword: "LIST", bits: [keyK], codes: ["KeyK"]},
        {label: "L", keyword: "LET", bits: [keyL], codes: ["KeyL"]},
        {label: "ENTER", keyword: "", bits: [keyEnter], codes: ["Enter", "NumpadEnter"]},
    ],
    [
        {label: "CAPS", keyword: "", bits: [cs], codes: ["ShiftLeft"]},
        {label: "Z", keyword: "COPY", bits: [keyZ], codes: ["KeyZ"]},
        {label: "X", keyword: "CLEAR", bits: [keyX], codes: ["KeyX"]},
        {label: "C", keyword: "CONT", bits: [keyC], codes: ["KeyC"]},
        {label: "V", keyword: "CLS", bits: [keyV], codes: ["KeyV"]},
        {label: "B", keyword: "BORDER", bits: [keyB], codes: ["KeyB"]},
        {label: "N", keyword: "NEXT", bits: [keyN], codes: ["KeyN"]},
        {label: "M", keyword: "PAUSE", bits: [keyM], codes: ["KeyM"]},
        {label: "SYM", keyword: "", bits: [ss], codes: ["ControlLeft", "ControlRight"]},
        {label: "BREAK", keyword: "", bits: [cs, keySpace], codes: ["Escape"]},
        {label: "CAPS", keyword: "", bits: [cs], codes: ["ShiftRight"]},
    ],
    [
        {label: "SPACE", keyword: "", bits: [keySpace], codes: ["Space"], wide: true},
    ],
];

/** @type {Object<string, KeyBit[]>} */
const hostBits = {};
for (let r = 0; r < overlayRows.length; r += 1) {
    const row = overlayRows[r];
    for (let k = 0; k < row.length; k += 1) {
        const spec = row[k];
        for (let c = 0; c < spec.codes.length; c += 1) {
            hostBits[spec.codes[c]] = spec.bits;
        }
    }
}
hostBits.Backspace = [cs, key0];
hostBits.Delete = [cs, key0];
hostBits.ArrowLeft = [cs, key5];
hostBits.ArrowDown = [cs, key6];
hostBits.ArrowUp = [cs, key7];
hostBits.ArrowRight = [cs, key8];
hostBits.Tab = [cs, key1];
hostBits.Period = [ss, keyM];
hostBits.NumpadDecimal = [ss, keyM];
hostBits.Comma = [ss, keyN];
hostBits.Semicolon = [ss, keyO];
hostBits.Quote = [ss, keyP];
hostBits.Minus = [ss, keyJ];
hostBits.NumpadSubtract = [ss, keyJ];
hostBits.Equal = [ss, keyL];
hostBits.Slash = [ss, keyV];
hostBits.NumpadDivide = [ss, keyV];
hostBits.NumpadAdd = [ss, keyK];
hostBits.NumpadMultiply = [ss, keyB];

/**
 * @param {HTMLElement} el
 * @param {Uint8Array} keyMatrix
 * @returns {Keyboard}
 */
export function initKeyboard(el, keyMatrix) {
    const kbd = {
        keyMatrix,
        hostHeld: [],
        pointerHeld: [],
        scriptHeld: [],
        scriptId: 0,
        overlayKeys: [],
    };
    for (let r = 0; r < overlayRows.length; r += 1) {
        const rowEl = document.createElement("div");
        rowEl.className = "keyboard-row";
        const row = overlayRows[r];
        for (let k = 0; k < row.length; k += 1) {
            rowEl.appendChild(makeKey(kbd, row[k]));
        }
        el.appendChild(rowEl);
    }
    syncKeys(kbd);
    return kbd;
}

/**
 * @param {Keyboard} kbd
 * @param {KeyboardEvent} e
 */
export function handleKeyDown(kbd, e) {
    if (hostBits[e.code] === undefined) {
        return;
    }
    e.preventDefault();
    if (e.repeat) {
        return;
    }
    holdHost(kbd, e.code);
    syncKeys(kbd);
}

/**
 * @param {Keyboard} kbd
 * @param {KeyboardEvent} e
 */
export function handleKeyUp(kbd, e) {
    if (hostBits[e.code] === undefined) {
        return;
    }
    e.preventDefault();
    releaseHost(kbd, e.code);
    syncKeys(kbd);
}

/** @param {Keyboard} kbd */
export function handleBlur(kbd) {
    kbd.hostHeld.length = 0;
    kbd.pointerHeld.length = 0;
    syncKeys(kbd);
}

/**
 * Type LOAD "" and Enter at the K cursor: J is the LOAD keyword, and " is
 * Symbol Shift + P.
 * @param {Keyboard} kbd
 */
export function typeLoad(kbd) {
    typeChords(kbd, [[keyJ], [ss, keyP], [ss, keyP], [keyEnter]]);
}

/**
 * Press the chords one after another through the key matrix, as if typed.
 * A new sequence cancels one still running.
 * @param {Keyboard} kbd
 * @param {KeyBit[][]} chords
 */
function typeChords(kbd, chords) {
    kbd.scriptId += 1;
    const id = kbd.scriptId;
    let i = 0;
    press();

    function press() {
        if (id !== kbd.scriptId) {
            return;
        }
        if (i >= chords.length) {
            return;
        }
        kbd.scriptHeld = chords[i];
        syncKeys(kbd);
        setTimeout(release, scriptKeyMs);
    }

    function release() {
        if (id !== kbd.scriptId) {
            return;
        }
        kbd.scriptHeld = [];
        syncKeys(kbd);
        i += 1;
        setTimeout(press, scriptKeyMs);
    }
}

/**
 * @param {Keyboard} kbd
 * @param {OverlayKeySpec} spec
 * @returns {HTMLButtonElement}
 */
function makeKey(kbd, spec) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "keyboard-key";
    if (spec.wide === true) {
        btn.classList.add("wide");
    }
    if (spec.keyword !== "") {
        const kw = document.createElement("span");
        kw.className = "keyword";
        kw.textContent = spec.keyword;
        btn.appendChild(kw);
    }
    const lab = document.createElement("span");
    lab.className = "label";
    lab.textContent = spec.label;
    btn.appendChild(lab);
    const rec = {el: btn, bits: spec.bits};
    kbd.overlayKeys.push(rec);
    btn.onpointerdown = function (e) {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        holdPointer(kbd, e.pointerId, spec.bits);
        btn.setPointerCapture(e.pointerId);
        syncKeys(kbd);
    };
    btn.onpointerup = function (e) {
        releasePointer(kbd, e.pointerId);
        syncKeys(kbd);
    };
    btn.onpointercancel = function (e) {
        releasePointer(kbd, e.pointerId);
        syncKeys(kbd);
    };
    return btn;
}

/** @param {Keyboard} kbd */
function syncKeys(kbd) {
    for (let i = 0; i < 8; i += 1) {
        kbd.keyMatrix[i] = 0x1F;
    }
    for (let i = 0; i < kbd.hostHeld.length; i += 1) {
        pressBits(kbd, hostBits[kbd.hostHeld[i]]);
    }
    for (let i = 0; i < kbd.pointerHeld.length; i += 1) {
        pressBits(kbd, kbd.pointerHeld[i].bits);
    }
    pressBits(kbd, kbd.scriptHeld);
    paintOverlay(kbd);
}

/**
 * @param {Keyboard} kbd
 * @param {KeyBit[] | undefined} bits
 */
function pressBits(kbd, bits) {
    if (bits !== undefined) {
        for (let i = 0; i < bits.length; i += 1) {
            const row = bits[i].row;
            const bit = bits[i].bit;
            kbd.keyMatrix[row] = kbd.keyMatrix[row] & ~(1 << bit);
        }
    }
}

/** @param {Keyboard} kbd */
function paintOverlay(kbd) {
    for (let i = 0; i < kbd.overlayKeys.length; i += 1) {
        const k = kbd.overlayKeys[i];
        let on = true;
        for (let b = 0; b < k.bits.length; b += 1) {
            const bit = k.bits[b];
            if ((kbd.keyMatrix[bit.row] & (1 << bit.bit)) !== 0) {
                on = false;
                break;
            }
        }
        if (on) {
            k.el.classList.add("on");
        } else {
            k.el.classList.remove("on");
        }
    }
}

/**
 * @param {Keyboard} kbd
 * @param {string} code
 */
function holdHost(kbd, code) {
    for (let i = 0; i < kbd.hostHeld.length; i += 1) {
        if (kbd.hostHeld[i] === code) {
            return;
        }
    }
    kbd.hostHeld.push(code);
}

/**
 * @param {Keyboard} kbd
 * @param {string} code
 */
function releaseHost(kbd, code) {
    for (let i = 0; i < kbd.hostHeld.length; i += 1) {
        if (kbd.hostHeld[i] === code) {
            kbd.hostHeld.splice(i, 1);
            return;
        }
    }
}

/**
 * @param {Keyboard} kbd
 * @param {number} id
 * @param {KeyBit[]} bits
 */
function holdPointer(kbd, id, bits) {
    for (let i = 0; i < kbd.pointerHeld.length; i += 1) {
        if (kbd.pointerHeld[i].id === id) {
            return;
        }
    }
    kbd.pointerHeld.push({id, bits});
}

/**
 * @param {Keyboard} kbd
 * @param {number} id
 */
function releasePointer(kbd, id) {
    for (let i = 0; i < kbd.pointerHeld.length; i += 1) {
        if (kbd.pointerHeld[i].id === id) {
            kbd.pointerHeld.splice(i, 1);
            return;
        }
    }
}
