// Minimal ZIP reader: central directory listing and single-entry extraction.
// Deflate is done by the browser's DecompressionStream, so no library is
// needed. ZIP64 and encryption are not supported.

const eocdSig = 0x06054B50;
const centralSig = 0x02014B50;
const localSig = 0x04034B50;
const eocdSize = 22;
const maxComment = 0xFFFF;

/**
 * @typedef {{
 *   name: string,
 *   size: number,
 *   method: number,
 *   compSize: number,
 *   offset: number,
 * }} ZipEntry
 */

/**
 * @typedef {{err: string, entries: null} | {err: null, entries: ZipEntry[]}} ZipList
 */

/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {boolean}
 */
export function isZip(bytes) {
    const u8 = new Uint8Array(bytes);
    return u8.length >= 4 && u32(u8, 0) === localSig;
}

/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {ZipList}
 */
export function listZip(bytes) {
    const u8 = new Uint8Array(bytes);
    const eocd = findEocd(u8);
    if (eocd < 0) {
        return {err: "Not a ZIP file.", entries: null};
    }
    const count = u16(u8, eocd + 10);
    let i = u32(u8, eocd + 16);
    if (count === 0xFFFF || i === 0xFFFFFFFF) {
        return {err: "ZIP64 archives are not supported.", entries: null};
    }
    const entries = [];
    for (let n = 0; n < count; n += 1) {
        if (i + 46 > u8.length || u32(u8, i) !== centralSig) {
            return {err: "Damaged ZIP directory.", entries: null};
        }
        const method = u16(u8, i + 10);
        const compSize = u32(u8, i + 20);
        const size = u32(u8, i + 24);
        const nameLen = u16(u8, i + 28);
        const extraLen = u16(u8, i + 30);
        const commentLen = u16(u8, i + 32);
        const offset = u32(u8, i + 42);
        if (i + 46 + nameLen > u8.length) {
            return {err: "Damaged ZIP directory.", entries: null};
        }
        const name = new TextDecoder("utf-8").decode(u8.subarray(i + 46, i + 46 + nameLen));
        if (!name.endsWith("/")) {
            entries.push({name, size, method, compSize, offset});
        }
        i += 46 + nameLen + extraLen + commentLen;
    }
    return {err: null, entries: entries};
}

/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @param {ZipEntry} entry
 * @param {import("./io.js").OnDone} onDone
 */
export function readZipEntry(bytes, entry, onDone) {
    const u8 = new Uint8Array(bytes);
    const i = entry.offset;
    if (i + 30 > u8.length || u32(u8, i) !== localSig) {
        onDone("Damaged ZIP entry " + entry.name + ".", null);
        return;
    }
    const start = i + 30 + u16(u8, i + 26) + u16(u8, i + 28);
    const end = start + entry.compSize;
    if (end > u8.length) {
        onDone("Truncated ZIP entry " + entry.name + ".", null);
        return;
    }
    const comp = u8.subarray(start, end);
    if (entry.method === 0) {
        onDone(null, comp.slice().buffer);
        return;
    }
    if (entry.method !== 8) {
        onDone("ZIP entry " + entry.name + " uses unsupported compression " + entry.method + ".", null);
        return;
    }
    if (typeof DecompressionStream === "undefined") {
        onDone("This browser cannot inflate ZIP entries.", null);
        return;
    }
    let stream;
    try {
        stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    } catch (ex) {
        onDone("Could not inflate " + entry.name + ": " + errorText(ex), null);
        return;
    }
    new Response(stream).arrayBuffer().then(
        function (buf) {
            if (buf.byteLength !== entry.size) {
                onDone("ZIP entry " + entry.name + " inflated to " + buf.byteLength + " bytes, expected " + entry.size + ".", null);
                return;
            }
            onDone(null, buf);
        },
        function (ex) {
            onDone("Could not inflate " + entry.name + ": " + errorText(ex), null);
        },
    );
}

/**
 * @param {Uint8Array} u8
 * @returns {number}
 */
function findEocd(u8) {
    const lowest = Math.max(0, u8.length - eocdSize - maxComment);
    for (let i = u8.length - eocdSize; i >= lowest; i -= 1) {
        if (u32(u8, i) === eocdSig) {
            return i;
        }
    }
    return -1;
}

/**
 * @param {Uint8Array} u8
 * @param {number} i
 * @returns {number}
 */
function u16(u8, i) {
    return u8[i] | (u8[i + 1] << 8);
}

/**
 * @param {Uint8Array} u8
 * @param {number} i
 * @returns {number}
 */
function u32(u8, i) {
    return (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16)) + u8[i + 3] * 0x1000000;
}

/**
 * @param {*} ex
 * @returns {string}
 */
function errorText(ex) {
    if (ex instanceof Error) {
        return ex.message;
    }
    return "error";
}
