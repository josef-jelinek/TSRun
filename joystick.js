// The TS 2068 joystick ports are five plain switch contacts, so a host gamepad
// is reduced to the same thing: a direction is closed past a deadzone or when
// the matching d-pad button is down, and every action button is the one fire
// contact the machine can report. Contacts are active low, as on the connector.
const joyUp = 0;
const joyDown = 1;
const joyLeft = 2;
const joyRight = 3;
const joyFire = 7;
const joyIdle = 0xFF;

// Standard Gamepad mapping. A pad reporting some other mapping is read the same
// way, since its axes are usually still the left stick even when the button
// numbering is not the standard one.
const padUp = 12;
const padDown = 13;
const padLeft = 14;
const padRight = 15;
const padFireFirst = 0;
const padFireLast = 7;
const padAxisX = 0;
const padAxisY = 1;
// How far an analog stick travels before it counts as a closed contact.
const padDeadzone = 0.5;

/**
 * @param {Uint8Array} joystick one active-low contact byte per stick
 */
export function initJoysticks(joystick) {
    joystick[0] = joyIdle;
    joystick[1] = joyIdle;
}

/**
 * Read the host gamepads into the two contact bytes. The Gamepad API only hands
 * out snapshots, so this polls rather than listening, and the caller does it
 * once per animation frame. The first two connected pads become player 1 and
 * player 2 whichever slots they occupy, so one pad always drives player 1.
 *
 * @param {Uint8Array} joystick
 */
export function pollJoysticks(joystick) {
    joystick[0] = joyIdle;
    joystick[1] = joyIdle;
    if (typeof navigator.getGamepads !== "function") {
        return;
    }
    const pads = navigator.getGamepads();
    let stick = 0;
    for (let i = 0; i < pads.length && stick < 2; i += 1) {
        const pad = pads[i];
        if (pad === null || !pad.connected) {
            continue;
        }
        joystick[stick] = padContacts(pad);
        stick += 1;
    }
}

/**
 * @param {Gamepad} pad
 * @returns {number}
 */
function padContacts(pad) {
    const axisX = padAxis(pad, padAxisX);
    const axisY = padAxis(pad, padAxisY);
    let bits = joyIdle;
    if (axisY <= -padDeadzone || padPressed(pad, padUp)) {
        bits &= ~(1 << joyUp);
    }
    if (axisY >= padDeadzone || padPressed(pad, padDown)) {
        bits &= ~(1 << joyDown);
    }
    if (axisX <= -padDeadzone || padPressed(pad, padLeft)) {
        bits &= ~(1 << joyLeft);
    }
    if (axisX >= padDeadzone || padPressed(pad, padRight)) {
        bits &= ~(1 << joyRight);
    }
    for (let b = padFireFirst; b <= padFireLast; b += 1) {
        if (padPressed(pad, b)) {
            bits &= ~(1 << joyFire);
            break;
        }
    }
    return bits;
}

/**
 * @param {Gamepad} pad
 * @param {number} index
 * @returns {boolean}
 */
function padPressed(pad, index) {
    if (index >= pad.buttons.length) {
        return false;
    }
    return pad.buttons[index].pressed;
}

/**
 * @param {Gamepad} pad
 * @param {number} index
 * @returns {number}
 */
function padAxis(pad, index) {
    if (index >= pad.axes.length) {
        return 0;
    }
    return pad.axes[index];
}
