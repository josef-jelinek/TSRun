/**
 * @typedef {{
 *   row: number,
 *   bit: number,
 * }} KeyBit
 */

/**
 * One key of the onscreen board, as printed on the TS 2068. `label` is the
 * character on the cap, or the words of a word key such as ENTER with "\n"
 * between lines. `keyword` is printed on the cap under it, `sym` in its black
 * symbol-shift bar, and `up` and `down` on the case above and below the key.
 * `hue` is the colour name over a number key and `glyph` its block graphic.
 * `size` widens the key (w-enter, w-caps, w-space) and `face` restyles its cap
 * (word, word sym, bar).
 *
 * @typedef {{
 *   label: string,
 *   keyword?: string,
 *   sym?: string,
 *   up?: string,
 *   down?: string,
 *   hue?: string,
 *   glyph?: number,
 *   size?: string,
 *   face?: string,
 *   bits: KeyBit[],
 *   codes: string[],
 * }} KeySpec
 */

/**
 * A key on the board; `on` is whether it last showed as pressed.
 *
 * @typedef {{
 *   el: HTMLElement,
 *   bits: KeyBit[],
 *   on: boolean,
 * }} BoardKey
 */

/**
 * @typedef {{
 *   id: number,
 *   bits: KeyBit[],
 *   at: number,
 * }} PointerHold
 */

/**
 * @typedef {{
 *   bits: KeyBit[],
 *   until: number,
 * }} KeyPulse
 */

/**
 * @typedef {{
 *   keyMatrix: Uint8Array,
 *   hostHeld: string[],
 *   pointerHeld: PointerHold[],
 *   keys: BoardKey[],
 *   pulses: KeyPulse[],
 *   pulseRaf: number,
 * }} Keyboard
 */

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

/**
 * The board row by row, laid out after keyboard.png: the number row (with the
 * colour names above it), Q to P, A to ENTER, the shift row, and the space bar,
 * which spans X to SYMBL SHIFT.
 *
 * @type {KeySpec[][]}
 */
const boardRows = [
    [
        {label: "1", up: "EDIT", hue: "BLUE", glyph: 1, sym: "!", down: "DEF FN", bits: [key1], codes: ["Digit1", "Numpad1"]},
        {label: "2", up: "CAPS LOCK", hue: "RED", glyph: 2, sym: "@", down: "FN", bits: [key2], codes: ["Digit2", "Numpad2"]},
        {label: "3", up: "TRUE VIDEO", hue: "MAGENTA", glyph: 3, sym: "#", down: "LINE", bits: [key3], codes: ["Digit3", "Numpad3"]},
        {label: "4", up: "INV. VIDEO", hue: "GREEN", glyph: 4, sym: "$", down: "OPEN #", bits: [key4], codes: ["Digit4", "Numpad4"]},
        {label: "5", up: "\u2190", hue: "CYAN", glyph: 5, sym: "%", down: "CLOSE #", bits: [key5], codes: ["Digit5", "Numpad5"]},
        {label: "6", up: "\u2193", hue: "YELLOW", glyph: 6, sym: "&", down: "MOVE", bits: [key6], codes: ["Digit6", "Numpad6"]},
        {label: "7", up: "\u2191", hue: "WHITE", glyph: 7, sym: "'", down: "ERASE", bits: [key7], codes: ["Digit7", "Numpad7"]},
        {label: "8", up: "\u2192", glyph: 8, sym: "(", down: "POINT", bits: [key8], codes: ["Digit8", "Numpad8"]},
        {label: "9", up: "GRAPHICS", sym: ")", down: "CAT", bits: [key9], codes: ["Digit9", "Numpad9"]},
        {label: "0", up: "DELETE", hue: "BLACK", sym: "_", down: "FORMAT", bits: [key0], codes: ["Digit0", "Numpad0"]},
    ],
    [
        {label: "Q", up: "SIN", keyword: "PLOT", sym: "<=", down: "ASN", bits: [keyQ], codes: ["KeyQ"]},
        {label: "W", up: "COS", keyword: "DRAW", sym: "<>", down: "ACS", bits: [keyW], codes: ["KeyW"]},
        {label: "E", up: "TAN", keyword: "REM", sym: ">=", down: "ATN", bits: [keyE], codes: ["KeyE"]},
        {label: "R", up: "INT", keyword: "RUN", sym: "<", down: "VERIFY", bits: [keyR], codes: ["KeyR"]},
        {label: "T", up: "RND", keyword: "RAND", sym: ">", down: "MERGE", bits: [keyT], codes: ["KeyT"]},
        {label: "Y", up: "STR$", keyword: "RETRN", sym: "AND", down: "[", bits: [keyY], codes: ["KeyY"]},
        {label: "U", up: "CHR$", keyword: "IF", sym: "OR", down: "]", bits: [keyU], codes: ["KeyU"]},
        {label: "I", up: "CODE", keyword: "INPUT", sym: "AT", down: "IN", bits: [keyI], codes: ["KeyI"]},
        {label: "O", up: "PEEK", keyword: "POKE", sym: ";", down: "OUT", bits: [keyO], codes: ["KeyO"]},
        {label: "P", up: "TAB", keyword: "PRINT", sym: "\"", down: "RESET", bits: [keyP], codes: ["KeyP"]},
    ],
    [
        {label: "A", up: "READ", keyword: "NEW", sym: "STOP", down: "FREE", bits: [keyA], codes: ["KeyA"]},
        {label: "S", up: "RESTORE", keyword: "SAVE", sym: "NOT", down: "STICK", bits: [keyS], codes: ["KeyS"]},
        {label: "D", up: "DATA", keyword: "DIM", sym: "STEP", down: "\\", bits: [keyD], codes: ["KeyD"]},
        {label: "F", up: "SGN", keyword: "FOR", sym: "TO", down: "ON ERR", bits: [keyF], codes: ["KeyF"]},
        {label: "G", up: "ABS", keyword: "GOTO", sym: "THEN", down: "SOUND", bits: [keyG], codes: ["KeyG"]},
        {label: "H", up: "SQR", keyword: "GOSUB", sym: "\u2191", down: "CIRCLE", bits: [keyH], codes: ["KeyH"]},
        {label: "J", up: "VAL", keyword: "LOAD", sym: "-", down: "VAL$", bits: [keyJ], codes: ["KeyJ"]},
        {label: "K", up: "LEN", keyword: "LIST", sym: "+", down: "SCREEN$", bits: [keyK], codes: ["KeyK"]},
        {label: "L", up: "USR", keyword: "LET", sym: "=", down: "ATTR", bits: [keyL], codes: ["KeyL"]},
        {label: "ENTER", size: "w-enter", face: "word", bits: [keyEnter], codes: ["Enter", "NumpadEnter"]},
    ],
    [
        {label: "CAPS\nSHIFT", size: "w-caps", face: "word", bits: [cs], codes: ["ShiftLeft"]},
        {label: "Z", up: "LN", keyword: "COPY", sym: ":", down: "BEEP", bits: [keyZ], codes: ["KeyZ"]},
        {label: "X", up: "EXP", keyword: "CLEAR", sym: "\u00A3", down: "INK", bits: [keyX], codes: ["KeyX"]},
        {label: "C", up: "LPRINT", keyword: "CONT", sym: "?", down: "PAPER", bits: [keyC], codes: ["KeyC"]},
        {label: "V", up: "LLIST", keyword: "CLS", sym: "/", down: "FLASH", bits: [keyV], codes: ["KeyV"]},
        {label: "B", up: "BIN", keyword: "BORDR", sym: "*", down: "BRIGHT", bits: [keyB], codes: ["KeyB"]},
        {label: "N", up: "INKEY$", keyword: "NEXT", sym: ",", down: "OVER", bits: [keyN], codes: ["KeyN"]},
        {label: "M", up: "PI", keyword: "PAUSE", sym: ".", down: "INVERSE", bits: [keyM], codes: ["KeyM"]},
        {label: "SYMBL\nSHIFT", face: "word sym", bits: [ss], codes: ["ControlLeft", "ControlRight"]},
        {label: "BREAK", face: "word", bits: [cs, keySpace], codes: ["Escape"]},
        {label: "CAPS\nSHIFT", size: "w-caps", face: "word", bits: [cs], codes: ["ShiftRight"]},
    ],
    [
        {label: "", size: "w-space", face: "bar", bits: [keySpace], codes: ["Space"]},
    ],
];

/** @type {Object<string, KeyBit[]>} */
const hostBits = {};
for (let r = 0; r < boardRows.length; r += 1) {
    const row = boardRows[r];
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

const minPointerHoldMs = 50;
// The smallest board the resize grip can make, in CSS pixels of height.
const minFaceHeight = 100;

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
        keys: [],
        pulses: [],
        pulseRaf: 0,
    };
    el.oncontextmenu = function (e) {
        e.preventDefault();
    };
    window.addEventListener("pointerup", function (e) {
        releasePointerSoon(kbd, e.pointerId);
    }, true);
    window.addEventListener("pointercancel", function (e) {
        releasePointer(kbd, e.pointerId);
        syncKeys(kbd);
    }, true);
    const face = el.querySelector(".keyboard-face");
    if (face !== null) {
        buildBoard(kbd, face);
    }
    syncKeys(kbd);
    return kbd;
}

/**
 * The drawn height of the board, 0 while the keyboard is hidden.
 *
 * @param {HTMLElement} el
 * @returns {number}
 */
export function faceHeight(el) {
    const face = el.querySelector(".keyboard-face");
    if (face === null) {
        return 0;
    }
    return face.getBoundingClientRect().height;
}

/**
 * Resize the board to a height, keeping its shape; CSS keeps the width within
 * the case. The board does not go below the height the rest of the case needs
 * anyway: past that the case stops getting shorter, so a smaller board would
 * give nothing back to the screen. It is also kept to minFaceHeight..maxHeight.
 *
 * @param {HTMLElement} el the keyboard element, the board's column in the case
 * @param {number} height
 * @param {number} maxHeight
 */
export function setFaceHeight(el, height, maxHeight) {
    const face = el.querySelector(".keyboard-face");
    if (!(face instanceof HTMLElement)) {
        return;
    }
    const rect = face.getBoundingClientRect();
    if (rect.height <= 0) {
        return;
    }
    const ratio = rect.width / rect.height;
    // With the board at its smallest, the column's height is what the other
    // parts of the case hold it at.
    face.style.width = (minFaceHeight * ratio) + "px";
    const floor = Math.max(el.getBoundingClientRect().height, minFaceHeight);
    const h = Math.min(Math.max(height, floor), Math.max(floor, maxHeight));
    face.style.width = (h * ratio) + "px";
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
    kbd.pulses.length = 0;
    for (let i = 0; i < kbd.keys.length; i += 1) {
        kbd.keys[i].el.classList.remove("hover");
    }
    if (kbd.pulseRaf !== 0) {
        cancelAnimationFrame(kbd.pulseRaf);
        kbd.pulseRaf = 0;
    }
    syncKeys(kbd);
}

/**
 * Build the colour band and the key rows into the board element.
 *
 * @param {Keyboard} kbd
 * @param {Element} face
 */
function buildBoard(kbd, face) {
    const band = document.createElement("div");
    band.className = "kb-band";
    for (const spec of boardRows[0]) {
        const hue = document.createElement("span");
        const name = spec.hue ?? "";
        if (name !== "") {
            hue.className = "c-" + name.toLowerCase();
        }
        hue.textContent = name;
        band.appendChild(hue);
    }
    face.appendChild(band);
    for (let r = 0; r < boardRows.length; r += 1) {
        const row = document.createElement("div");
        row.className = "kb-row r" + (r + 1);
        for (const spec of boardRows[r]) {
            row.appendChild(makeKey(kbd, spec));
        }
        face.appendChild(row);
    }
}

/**
 * One key: the legend above, the cap, and the legend below. The whole cell
 * takes the pointer, so the gaps between caps are not dead.
 *
 * @param {Keyboard} kbd
 * @param {KeySpec} spec
 * @returns {HTMLElement}
 */
function makeKey(kbd, spec) {
    const hit = document.createElement("div");
    hit.className = "k";
    if (spec.size !== undefined) {
        hit.classList.add(spec.size);
    }
    const cap = document.createElement("span");
    cap.className = "cap";
    if (spec.face !== undefined) {
        cap.className = "cap " + spec.face;
        cap.textContent = spec.label;
    } else {
        const label = document.createElement("b");
        label.textContent = spec.label;
        cap.appendChild(label);
        if (spec.glyph !== undefined) {
            const glyph = document.createElement("span");
            glyph.className = "g g" + spec.glyph;
            cap.appendChild(glyph);
        }
        const keyword = document.createElement("em");
        keyword.textContent = spec.keyword ?? "";
        cap.appendChild(keyword);
        const sym = document.createElement("i");
        sym.textContent = spec.sym ?? "";
        cap.appendChild(sym);
    }
    if (spec.face === "bar") {
        hit.appendChild(cap);
    } else {
        const up = document.createElement("span");
        up.className = "up";
        up.textContent = spec.up ?? "";
        const down = document.createElement("span");
        down.className = "dn";
        down.textContent = spec.down ?? "";
        hit.appendChild(up);
        hit.appendChild(cap);
        hit.appendChild(down);
    }
    kbd.keys.push({el: hit, bits: spec.bits, on: false});
    hit.oncontextmenu = function (e) {
        e.preventDefault();
    };
    hit.addEventListener("touchstart", function (e) {
        e.preventDefault();
    }, {passive: false});
    hit.addEventListener("touchend", function (e) {
        e.preventDefault();
    }, {passive: false});
    // pointerdown for a tap is often delayed; pointerenter is not.
    hit.onpointerenter = function (e) {
        if (isCompatMouse(e)) {
            return;
        }
        if (isContactPointer(e)) {
            holdPointer(kbd, e.pointerId, spec.bits);
            syncKeys(kbd);
            return;
        }
        if (e.pointerType === "mouse") {
            hit.classList.add("hover");
        }
    };
    hit.onpointerleave = function (e) {
        hit.classList.remove("hover");
        releasePointerSoon(kbd, e.pointerId);
    };
    hit.onpointerdown = function (e) {
        if (isCompatMouse(e)) {
            return;
        }
        if (e.pointerType === "mouse" && e.button !== 0) {
            return;
        }
        e.preventDefault();
        holdPointer(kbd, e.pointerId, spec.bits);
        if (e.pointerType === "mouse") {
            hit.setPointerCapture(e.pointerId);
        }
        syncKeys(kbd);
    };
    hit.onpointerup = function (e) {
        releasePointerSoon(kbd, e.pointerId);
    };
    hit.onpointercancel = function (e) {
        releasePointer(kbd, e.pointerId);
        syncKeys(kbd);
    };
    hit.onlostpointercapture = function (e) {
        releasePointerSoon(kbd, e.pointerId);
    };
    return hit;
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
    paintOverlay(kbd);
    for (let i = 0; i < kbd.pulses.length; i += 1) {
        pressBits(kbd, kbd.pulses[i].bits);
    }
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

/**
 * Show each key pressed while all its matrix bits are down, touching the DOM
 * only for keys that change.
 *
 * @param {Keyboard} kbd
 */
function paintOverlay(kbd) {
    for (let i = 0; i < kbd.keys.length; i += 1) {
        const k = kbd.keys[i];
        let on = true;
        for (let b = 0; b < k.bits.length; b += 1) {
            const bit = k.bits[b];
            if ((kbd.keyMatrix[bit.row] & (1 << bit.bit)) !== 0) {
                on = false;
                break;
            }
        }
        if (on !== k.on) {
            k.on = on;
            k.el.classList.toggle("on", on);
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
        const p = kbd.pointerHeld[i];
        if (p.id === id) {
            p.bits = bits;
            p.at = Date.now();
            return;
        }
    }
    kbd.pointerHeld.push({id, bits, at: Date.now()});
}

/**
 * Drop the visual hold immediately. If the tap was shorter than a frame
 * or two, keep the matrix bits down via pulses so the machine still samples.
 *
 * @param {Keyboard} kbd
 * @param {number} id
 */
function releasePointerSoon(kbd, id) {
    for (let i = 0; i < kbd.pointerHeld.length; i += 1) {
        const p = kbd.pointerHeld[i];
        if (p.id !== id) {
            continue;
        }
        const remain = minPointerHoldMs - (Date.now() - p.at);
        if (remain > 0) {
            kbd.pulses.push({bits: p.bits, until: Date.now() + remain});
            watchPulses(kbd);
        }
        kbd.pointerHeld.splice(i, 1);
        syncKeys(kbd);
        return;
    }
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

/** @param {Keyboard} kbd */
function watchPulses(kbd) {
    if (kbd.pulseRaf !== 0) {
        return;
    }
    kbd.pulseRaf = requestAnimationFrame(function tick() {
        kbd.pulseRaf = 0;
        const now = Date.now();
        let expired = 0;
        for (let i = kbd.pulses.length - 1; i >= 0; i -= 1) {
            if (kbd.pulses[i].until <= now) {
                kbd.pulses.splice(i, 1);
                expired += 1;
            }
        }
        if (expired !== 0) {
            syncKeys(kbd);
        }
        if (kbd.pulses.length !== 0) {
            kbd.pulseRaf = requestAnimationFrame(tick);
        }
    });
}

/**
 * Finger or stylus contact, including touchscreens that report an empty
 * pointerType. Compatibility mouse events from a touch are not contact.
 *
 * @param {PointerEvent} e
 * @returns {boolean}
 */
function isContactPointer(e) {
    if (isCompatMouse(e)) {
        return false;
    }
    if (e.pointerType === "mouse") {
        if (e.buttons !== 0) {
            return true;
        }
        if (e.width > 1 || e.height > 1) {
            return true;
        }
        return false;
    }
    if (e.pointerType === "pen") {
        return e.buttons !== 0;
    }
    return true;
}

/**
 * @param {PointerEvent} e
 * @returns {boolean}
 */
function isCompatMouse(e) {
    if (e.pointerType !== "mouse") {
        return false;
    }
    return eventFromTouch(e);
}

/**
 * @param {Event} e
 * @returns {boolean}
 */
function eventFromTouch(e) {
    const rec = /** @type {{sourceCapabilities?: {firesTouchEvents: boolean} | null}} */ (e);
    const caps = rec.sourceCapabilities;
    if (caps === undefined || caps === null) {
        return false;
    }
    return caps.firesTouchEvents;
}
