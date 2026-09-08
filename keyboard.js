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
 * }} OverlayKeySpec
 */

/**
 * @typedef {{
 *   el: HTMLElement,
 *   bits: KeyBit[],
 * }} OverlayKey
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
 *   overlayKeys: OverlayKey[],
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
        {label: "SPACE", keyword: "", bits: [keySpace], codes: ["Space"]},
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

const keyArtW = 533;
const keyArtH = 191;
const hitW = 43;
const hitH = 36;
const keyGap = 1;
const keyRowTop = [7, 44, 81, 118, 155];
const keyRowLeft = [14, 36, 47, 14, 113];
const minPointerHoldMs = 50;

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
        overlayKeys: [],
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
        for (let r = 0; r < overlayRows.length; r += 1) {
            const row = overlayRows[r];
            const widths = rowWidths(r);
            let x = keyRowLeft[r];
            const y = keyRowTop[r];
            for (let k = 0; k < row.length; k += 1) {
                const w = widths[k];
                face.appendChild(makeHit(kbd, row[k], x, y, w, hitH));
                x += w + keyGap;
            }
        }
        setKeyboardScale(el, 1);
    }
    syncKeys(kbd);
    return kbd;
}

/**
 * 1 is one image pixel per CSS pixel.
 *
 * @param {HTMLElement} el
 * @param {number} scale
 */
export function setKeyboardScale(el, scale) {
    const face = el.querySelector(".keyboard-face");
    if (!(face instanceof HTMLElement)) {
        return;
    }
    let s = scale;
    if (s < 0.25) {
        s = 0.25;
    }
    if (s > 8) {
        s = 8;
    }
    face.style.width = (keyArtW * s) + "px";
}

/**
 * Set scale from a vertical drag of the bar above the keyboard.
 *
 * @param {HTMLElement} keyboardEl
 * @param {HTMLElement} splitEl
 * @param {number} clientY
 */
export function scaleKeyboardFromY(keyboardEl, splitEl, clientY) {
    const parent = keyboardEl.parentElement;
    if (parent === null) {
        return;
    }
    const parentRect = parent.getBoundingClientRect();
    const splitRect = splitEl.getBoundingClientRect();
    const style = getComputedStyle(keyboardEl);
    const padTop = Number.parseFloat(style.paddingTop);
    const padBot = Number.parseFloat(style.paddingBottom);
    let padY = 0;
    if (Number.isFinite(padTop)) {
        padY += padTop;
    }
    if (Number.isFinite(padBot)) {
        padY += padBot;
    }
    const minRemain = 80;
    const minH = keyArtH * 0.25;
    let imgH = parentRect.bottom - clientY - splitRect.height - padY;
    const maxH = parentRect.height - minRemain - splitRect.height - padY;
    imgH = Math.min(Math.max(imgH, minH), Math.max(minH, maxH));
    setKeyboardScale(keyboardEl, imgH / keyArtH);
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
    for (let i = 0; i < kbd.overlayKeys.length; i += 1) {
        kbd.overlayKeys[i].el.classList.remove("hover");
    }
    if (kbd.pulseRaf !== 0) {
        cancelAnimationFrame(kbd.pulseRaf);
        kbd.pulseRaf = 0;
    }
    syncKeys(kbd);
}

/**
 * Pixel widths of keys in overlayRows[r], left to right.
 *
 * @param {number} r
 * @returns {number[]}
 */
function rowWidths(r) {
    switch (r) {
    case 0:
    case 1:
        return [hitW, hitW, hitW, hitW, hitW, hitW, hitW, hitW, hitW, hitW];
    case 2:
        return [hitW, hitW, hitW, hitW, hitW, hitW, hitW, hitW, hitW, 76];
    case 3:
        return [54, hitW, hitW, hitW, hitW, hitW, hitW, hitW, hitW, hitW, 54];
    default:
        return [307];
    }
}

/**
 * @param {Keyboard} kbd
 * @param {OverlayKeySpec} spec
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {HTMLElement}
 */
function makeHit(kbd, spec, x, y, w, h) {
    const hit = document.createElement("div");
    hit.className = "keyboard-hit";
    hit.style.left = (x * 100 / keyArtW) + "%";
    hit.style.top = (y * 100 / keyArtH) + "%";
    hit.style.width = (w * 100 / keyArtW) + "%";
    hit.style.height = (h * 100 / keyArtH) + "%";
    kbd.overlayKeys.push({el: hit, bits: spec.bits});
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
