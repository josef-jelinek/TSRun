// The following frame sizes are duplicated in canvas setup and machine.js.
const frameW = 640;
const frameH = 240;
const viewW = 640;
const viewH = 480;

/**
 * @typedef {{
 *   vert: string,
 *   frag: string,
 * }} Shaders
 */

/**
 * The program and texture stay bound for the life of the context, so drawScreen
 * only needs the context itself.
 * @typedef {{
 *   gl: WebGL2RenderingContext,
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

/** @param {Gfx | null} gfx */
export function resizeScreen(gfx) {
    if (gfx === null) {
        return;
    }
    const gl = gfx.gl;
    const canvas = /** @type {HTMLCanvasElement} */ (gl.canvas);
    const workspace = canvas.parentElement;
    let scale = 1;
    if (workspace !== null) {
        const fitX = Math.floor(workspace.clientWidth / viewW);
        const fitY = Math.floor(workspace.clientHeight / viewH);
        scale = Math.max(1, Math.min(fitX, fitY));
    }
    const width = viewW * scale;
    const height = viewH * scale;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
}

/**
 * @param {Gfx | null} gfx
 * @param {Uint8Array} pixels
 */
export function drawScreen(gfx, pixels) {
    if (gfx === null) {
        return;
    }
    const gl = gfx.gl;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frameW, frameH, gl.RED_INTEGER, gl.UNSIGNED_BYTE, pixels);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.useProgram(program);
    gl.uniform1i(texLoc, 0);
    gl.viewport(0, 0, frameW, frameH);
    return {gl};
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
