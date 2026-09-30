// The following frame sizes are duplicated in canvas setup and machine.js.
const frameW = 640;
const frameH = 240;
const viewW = 640;
const viewH = 480;

// The camcorder-style caption shown while paused: PAUSE in a 5x7 dot font,
// then the two pause bars. "#" is a dot, rows run top to bottom, and a glyph
// of spaces is a gap.
const pauseCaption = [
    ["#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "],
    [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
    ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
    [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
    ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
    ["  ", "  ", "  ", "  ", "  ", "  ", "  "],
    ["##  ##", "##  ##", "##  ##", "##  ##", "##  ##", "##  ##", "##  ##"],
];
// Each dot is 1 pixel wide (2 hi-res frame columns) and 1 line tall, and the
// caption with its edge fits in the 24-line top border, clear of the active
// screen area below it.
const dotCols = 2;
const dotRows = 1;
const captionX = 40;
const captionY = 8;
const captionInk = 15;
const captionEdge = 0;
const pauseDots = captionDots(pauseCaption);

/**
 * @typedef {{
 *   vert: string,
 *   frag: string,
 * }} Shaders
 */

/**
 * The program and texture stay bound for the life of the context, so drawScreen
 * only needs the context itself. `pixelRatio` is the device pixel ratio the
 * canvas was last fitted for.
 *
 * @typedef {{
 *   gl: WebGL2RenderingContext,
 *   crtOn: boolean,
 *   crtLoc: WebGLUniformLocation,
 *   pixelRatio: number,
 * }} Gfx
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Shaders} shaders
 * @param {function(string | null, Gfx | null): void} onGfx
 */
export function initScreen(canvas, shaders, onGfx) {

    canvas.addEventListener("webglcontextlost", function (e) {
        e.preventDefault();
        onGfx("WebGL2 context lost", null);
    });

    canvas.addEventListener("webglcontextrestored", function () {
        console.info("WebGL2 context restored");
        initGfx();
    });

    initGfx();

    function initGfx() {
        const gfx = createGfx(canvas, shaders.vert, shaders.frag);
        if (gfx === null) {
            onGfx("Failed to create WebGL2 context", null);
            return;
        }
        resizeScreen(gfx);
        onGfx(null, gfx);
    }
}

/**
 * @param {Gfx} gfx
 * @param {boolean} on
 */
export function setCrt(gfx, on) {
    gfx.crtOn = on;
    gfx.gl.uniform1i(gfx.crtLoc, Number(gfx.crtOn));
    const canvas = /** @type {HTMLCanvasElement} */ (gfx.gl.canvas);
    if (gfx.crtOn) {
        canvas.classList.add("crt");
    } else {
        canvas.classList.remove("crt");
    }
    resizeScreen(gfx);
}

/** @param {Gfx} gfx */
export function resizeScreen(gfx) {
    const canvas = /** @type {HTMLCanvasElement} */ (gfx.gl.canvas);
    const workspace = canvas.parentElement;
    const pixelRatio = window.devicePixelRatio;
    gfx.pixelRatio = pixelRatio;
    // Fit the content box so padding on the slot stays around the canvas.
    let slotW = viewW;
    let slotH = viewH;
    if (workspace !== null) {
        const style = getComputedStyle(workspace);
        const padX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
        const padY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
        slotW = workspace.clientWidth;
        slotH = workspace.clientHeight;
        if (Number.isFinite(padX)) {
            slotW -= padX;
        }
        if (Number.isFinite(padY)) {
            slotH -= padY;
        }
    }
    // Both modes fill the largest 4:3 area of the slot.
    let width = slotW;
    let height = Math.floor(width * viewH / viewW);
    if (height > slotH) {
        height = slotH;
        width = Math.floor(height * viewW / viewH);
    }
    width = Math.max(width, 1);
    height = Math.max(height, 1);
    // The buffer matches the physical display pixels. Without the CRT filter
    // the shader then takes the nearest frame pixel for each display pixel, so
    // pixel edges stay sharp at any size, with pixel sizes differing by at
    // most one display pixel. The filter renders at least one buffer pixel per
    // CSS pixel and is smoothed when the page is zoomed out.
    let bufferRatio = pixelRatio;
    if (gfx.crtOn) {
        bufferRatio = Math.max(pixelRatio, 1);
    }
    const bufferWidth = Math.max(Math.round(width * bufferRatio), 1);
    const bufferHeight = Math.max(Math.round(height * bufferRatio), 1);
    canvas.style.width = (bufferWidth / bufferRatio) + "px";
    canvas.style.height = (bufferHeight / bufferRatio) + "px";
    if (canvas.width !== bufferWidth) {
        canvas.width = bufferWidth;
    }
    if (canvas.height !== bufferHeight) {
        canvas.height = bufferHeight;
    }
    gfx.gl.viewport(0, 0, bufferWidth, bufferHeight);
}

/**
 * @param {Gfx} gfx
 * @param {Uint8Array} pixels
 */
export function drawScreen(gfx, pixels) {
    // A browser zoom or a move to another monitor changes the pixel ratio
    // without resizing the slot, so nothing else would refit the canvas.
    if (gfx.pixelRatio !== window.devicePixelRatio) {
        resizeScreen(gfx);
    }
    const gl = gfx.gl;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frameW, frameH, gl.RED_INTEGER, gl.UNSIGNED_BYTE, pixels);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * Draw the paused caption into a frame the way a camcorder lays it over the
 * picture: white dots with a black edge. It goes into the pixels rather than
 * over the canvas, so the display filter treats it like the rest of the image.
 *
 * @param {Uint8Array} pixels one palette index per pixel, frameW by frameH
 */
export function stampPause(pixels) {
    for (let i = 0; i < pauseDots.length; i += 2) {
        const col = captionX + pauseDots[i] * dotCols;
        const row = captionY + pauseDots[i + 1] * dotRows;
        fillRect(pixels, col - 2, row - 1, dotCols + 4, dotRows + 2, captionEdge);
    }
    for (let i = 0; i < pauseDots.length; i += 2) {
        const col = captionX + pauseDots[i] * dotCols;
        const row = captionY + pauseDots[i + 1] * dotRows;
        fillRect(pixels, col, row, dotCols, dotRows, captionInk);
    }
}

/**
 * The dots of a caption as flat x, y pairs in dot units, with one dot of
 * space between glyphs.
 *
 * @param {string[][]} glyphs
 * @returns {number[]}
 */
function captionDots(glyphs) {
    /** @type {number[]} */
    const dots = [];
    let x = 0;
    for (const glyph of glyphs) {
        for (let y = 0; y < glyph.length; y += 1) {
            for (let i = 0; i < glyph[y].length; i += 1) {
                if (glyph[y][i] === "#") {
                    dots.push(x + i, y);
                }
            }
        }
        x += glyph[0].length + 1;
    }
    return dots;
}

/**
 * @param {Uint8Array} pixels
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} color
 */
function fillRect(pixels, x, y, w, h, color) {
    const x0 = Math.max(x, 0);
    const x1 = Math.min(x + w, frameW);
    const y1 = Math.min(y + h, frameH);
    for (let row = Math.max(y, 0); row < y1; row += 1) {
        pixels.fill(color, row * frameW + x0, row * frameW + x1);
    }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} vertGLSL
 * @param {string} fragGLSL
 * @returns {Gfx | null}
 */
function createGfx(canvas, vertGLSL, fragGLSL) {
    const gl = canvas.getContext("webgl2", {alpha: false, antialias: false});
    if (gl === null) {
        return null;
    }
    const program = createProgram(gl, vertGLSL, fragGLSL);
    if (program === null) {
        return null;
    }
    const tex = gl.createTexture();
    if (tex === null) {
        return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, frameW, frameH, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, null);
    const texLoc = gl.getUniformLocation(program, "u_tex");
    if (texLoc === null) {
        return null;
    }
    const crtLoc = gl.getUniformLocation(program, "u_crt");
    if (crtLoc === null) {
        return null;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.useProgram(program);
    gl.uniform1i(texLoc, 0);
    gl.uniform1i(crtLoc, 0);
    gl.viewport(0, 0, frameW, frameH);
    return {gl, crtOn: false, crtLoc, pixelRatio: 0};
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {string} vertGLSL
 * @param {string} fragGLSL
 * @returns {WebGLProgram | null}
 */
function createProgram(gl, vertGLSL, fragGLSL) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    if (vs === null) {
        return null;
    }
    gl.shaderSource(vs, vertGLSL);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (fs === null) {
        return null;
    }
    gl.shaderSource(fs, fragGLSL);
    gl.compileShader(fs);
    const p = gl.createProgram();
    if (p === null) {
        return null;
    }
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error((gl.getProgramInfoLog(p) ?? "").replace(/\0/g, "\n").trim());
        gl.deleteProgram(p);
        return null;
    }
    return p;
}
