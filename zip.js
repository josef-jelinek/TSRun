// Minimal ZIP reader: central directory listing and single-entry extraction,
// with the entry name decoded and the extracted bytes checked against the
// CRC-32 the directory carries. Deflate is done by the browser's
// DecompressionStream, so no library is needed. ZIP64, multi-disk and encrypted
// archives are refused, as is any compression method other than stored and
// deflate.

const eocdSig = 0x06054B50;
const centralSig = 0x02014B50;
const localSig = 0x04034B50;
const digitalSig = 0x05054B50;
const eocdHeaderSize = 22;
const centralHeaderSize = 46;
const localHeaderSize = 30;
const digitalHeaderSize = 6;
const maxComment = 0xFFFF;
const encryptedFlag = 0x0001;
const utf8Flag = 0x0800;
const zip64U16 = 0xFFFF;
const zip64U32 = 0xFFFFFFFF;

const utf8Decoder = new TextDecoder("utf-8");
const utf8Strict = new TextDecoder("utf-8", {fatal: true});

// CP437 bytes 0x80 to 0xFF as Unicode, the code page an entry name falls back
// to. Escaped rather than written out so that every source file stays plain
// ASCII, in rows of 16 bytes starting at 0x80.
const cp437High =
    "\u00C7\u00FC\u00E9\u00E2\u00E4\u00E0\u00E5\u00E7\u00EA\u00EB\u00E8\u00EF\u00EE\u00EC\u00C4\u00C5" +
    "\u00C9\u00E6\u00C6\u00F4\u00F6\u00F2\u00FB\u00F9\u00FF\u00D6\u00DC\u00A2\u00A3\u00A5\u20A7\u0192" +
    "\u00E1\u00ED\u00F3\u00FA\u00F1\u00D1\u00AA\u00BA\u00BF\u2310\u00AC\u00BD\u00BC\u00A1\u00AB\u00BB" +
    "\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510" +
    "\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567" +
    "\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580" +
    "\u03B1\u00DF\u0393\u03C0\u03A3\u03C3\u00B5\u03C4\u03A6\u0398\u03A9\u03B4\u221E\u03C6\u03B5\u2229" +
    "\u2261\u00B1\u2265\u2264\u2320\u2321\u00F7\u2248\u00B0\u2219\u00B7\u221A\u207F\u00B2\u25A0\u00A0";

// Byte steps of the reflected CRC-32 polynomial, which is the only integrity
// check the format carries for entry data.
const crcTable = new Uint32Array(256);

for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) {
        if ((c & 1) !== 0) {
            c = 0xEDB88320 ^ (c >>> 1);
        } else {
            c = c >>> 1;
        }
    }
    crcTable[i] = c;
}

/**
 * @typedef {{
 *   name: string,
 *   size: number,
 *   method: number,
 *   compSize: number,
 *   crc: number,
 *   encrypted: boolean,
 *   offset: number,
 * }} ZipEntry
 *
 * @typedef {{err: string, entries: null} | {err: null, entries: ZipEntry[]}} ZipList
 */

/**
 * List the archive contents from the central directory, dropping the records
 * that only name a directory. Anything unsupported is reported as an error
 * string rather than thrown, so a caller can treat the file as something else.
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {ZipList}
 */
export function listZip(bytes) {
    const u8 = new Uint8Array(bytes);
    const eocd = findEocd(u8);
    if (eocd < 0) {
        return {err: "Not a ZIP file.", entries: null};
    }
    const disk = u16(u8, eocd + 4);
    const directoryDisk = u16(u8, eocd + 6);
    const diskEntries = u16(u8, eocd + 8);
    const count = u16(u8, eocd + 10);
    const directorySize = u32(u8, eocd + 12);
    let i = u32(u8, eocd + 16);
    if (count === zip64U16 || directorySize === zip64U32 || i === zip64U32) {
        return {err: "ZIP64 archives are not supported.", entries: null};
    }
    // A ZIP64 archive marks the disk fields with 0xFFFF as well, which is not a
    // disk this reader can find and so is rejected here rather than above.
    if (disk !== 0 || directoryDisk !== 0 || diskEntries !== count) {
        return {err: "Multi-disk ZIP archives are not supported.", entries: null};
    }
    const directoryEnd = i + directorySize;
    if (directoryEnd > eocd) {
        return {err: "Damaged ZIP directory.", entries: null};
    }
    const entries = [];
    for (let n = 0; n < count; n += 1) {
        if (i + centralHeaderSize > directoryEnd || u32(u8, i) !== centralSig) {
            return {err: "Damaged ZIP directory.", entries: null};
        }
        const flags = u16(u8, i + 8);
        const method = u16(u8, i + 10);
        const crc = u32(u8, i + 16);
        const compSize = u32(u8, i + 20);
        const size = u32(u8, i + 24);
        const nameLen = u16(u8, i + 28);
        const extraLen = u16(u8, i + 30);
        const commentLen = u16(u8, i + 32);
        const entryDisk = u16(u8, i + 34);
        const offset = u32(u8, i + 42);
        const next = i + centralHeaderSize + nameLen + extraLen + commentLen;
        if (next > directoryEnd) {
            return {err: "Damaged ZIP directory.", entries: null};
        }
        if (compSize === zip64U32 || size === zip64U32 || offset === zip64U32) {
            return {err: "ZIP64 archives are not supported.", entries: null};
        }
        if (entryDisk !== 0) {
            return {err: "Multi-disk ZIP archives are not supported.", entries: null};
        }
        const encrypted = (flags & encryptedFlag) !== 0;
        const utf8 = (flags & utf8Flag) !== 0;
        const nameAt = i + centralHeaderSize;
        const name = decodeName(u8.subarray(nameAt, nameAt + nameLen), utf8);
        if (!name.endsWith("/")) {
            entries.push({name, size, method, compSize, crc, encrypted, offset});
        }
        i = next;
    }
    // The count and the size have to describe the same directory. Records left
    // over would be entries this listing hides, and the only thing the format
    // allows after the last one is the optional digital signature record.
    if (i !== directoryEnd) {
        const sigEnd = i + digitalHeaderSize + u16(u8, i + 4);
        if (u32(u8, i) !== digitalSig || sigEnd !== directoryEnd) {
            return {err: "Damaged ZIP directory.", entries: null};
        }
    }
    return {err: null, entries};
}

/**
 * Extract one listed entry. Stored data is copied out as is, deflated data goes
 * through DecompressionStream, whose Promise is confined to this module and
 * reported to the caller as an onDone callback. Encryption is rejected per
 * entry, so one encrypted file does not make the rest of the archive unusable,
 * and either header marking the entry counts, since the directory is the record
 * a reader is meant to trust and a local header can disagree with it.
 * Nothing larger than entry.size is ever held, but that size comes from the
 * archive, so a caller reading an untrusted file should check it beforehand.
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @param {ZipEntry} entry
 * @param {import("./io.js").OnDone} onDone
 */
export function readZipEntry(bytes, entry, onDone) {
    const u8 = new Uint8Array(bytes);
    const i = entry.offset;
    if (i + localHeaderSize > u8.length || u32(u8, i) !== localSig) {
        onDone("Damaged ZIP entry " + entry.name + ".", null);
        return;
    }
    if (entry.encrypted || (u16(u8, i + 6) & encryptedFlag) !== 0) {
        onDone("ZIP entry " + entry.name + " is encrypted.", null);
        return;
    }
    const start = i + localHeaderSize + u16(u8, i + 26) + u16(u8, i + 28);
    const end = start + entry.compSize;
    if (end > u8.length) {
        onDone("Truncated ZIP entry " + entry.name + ".", null);
        return;
    }
    const comp = u8.subarray(start, end);
    if (entry.method === 0) {
        const err = entryFail(entry, comp);
        if (err !== null) {
            onDone(err, null);
            return;
        }
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
        onDone(inflateError(entry.name, ex), null);
        return;
    }
    readInflated(entry, stream.getReader(), [], 0, onDone);
}

/**
 * Find the end-of-central-directory record. It sits at the end of the file
 * apart from a comment of up to 64K, so the scan runs backwards. A record whose
 * comment reaches exactly to the end of the file is preferred, because the
 * signature can also occur inside compressed data; a record whose comment stops
 * short is kept as a fallback for archives with bytes appended after it. A
 * comment that runs past the end of the file describes a record that cannot be
 * there, so those are not candidates at all. What the record says about the
 * directory is left to the caller, which can tell a ZIP64 placeholder from a
 * damaged offset and report the two differently.
 *
 * @param {Uint8Array} u8
 * @returns {number}
 */
function findEocd(u8) {
    const lowest = Math.max(0, u8.length - eocdHeaderSize - maxComment);
    let found = -1;
    for (let i = u8.length - eocdHeaderSize; i >= lowest; i -= 1) {
        if (u32(u8, i) === eocdSig) {
            const commentEnd = i + eocdHeaderSize + u16(u8, i + 20);
            if (commentEnd === u8.length) {
                return i;
            }
            if (commentEnd < u8.length && found < 0) {
                found = i;
            }
        }
    }
    return found;
}

/**
 * Decode an entry name. Bit 11 of the general purpose flags promises UTF-8 and
 * the format specifies CP437 without it, but writers that emit UTF-8 and leave
 * the bit clear are common, so bytes that decode cleanly as UTF-8 are taken as
 * UTF-8 either way. Only bytes that cannot be UTF-8 fall back to the code page,
 * where every byte means something and nothing can fail.
 *
 * @param {Uint8Array} raw
 * @param {boolean} utf8
 * @returns {string}
 */
function decodeName(raw, utf8) {
    if (utf8) {
        return utf8Decoder.decode(raw);
    }
    try {
        return utf8Strict.decode(raw);
    } catch {
        let name = "";
        for (let i = 0; i < raw.length; i += 1) {
            if (raw[i] < 0x80) {
                name += String.fromCharCode(raw[i]);
            } else {
                name += cp437High[raw[i] - 0x80];
            }
        }
        return name;
    }
}

/**
 * Collect the inflated stream one chunk at a time, stopping as soon as the
 * output passes the size the directory promised. Buffering the whole stream
 * first would let a small archive that understates its entry size inflate to
 * any amount of memory before the length is ever checked. Recursing through the
 * read callback is the loop; each step resumes in a later microtask.
 *
 * @param {ZipEntry} entry
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {Uint8Array[]} chunks
 * @param {number} total
 * @param {import("./io.js").OnDone} onDone
 */
function readInflated(entry, reader, chunks, total, onDone) {
    reader.read().then(
        function (res) {
            if (res.done) {
                const buf = new Uint8Array(total);
                let at = 0;
                for (const chunk of chunks) {
                    buf.set(chunk, at);
                    at += chunk.length;
                }
                const err = entryFail(entry, buf);
                if (err !== null) {
                    onDone(err, null);
                    return;
                }
                onDone(null, buf.buffer);
                return;
            }
            if (total + res.value.length > entry.size) {
                // The stream is being abandoned, so a cancel that fails has
                // nothing left to affect and is swallowed rather than left to
                // surface as an unhandled rejection.
                reader.cancel().catch(function () {});
                const err = "ZIP entry " + entry.name + " inflates past " + entry.size + " bytes.";
                onDone(err, null);
                return;
            }
            chunks.push(res.value);
            readInflated(entry, reader, chunks, total + res.value.length, onDone);
        },
        function (ex) {
            onDone(inflateError(entry.name, ex), null);
        },
    );
}

/**
 * A deflate failure arrives either as a throw from the constructor or as a
 * stream rejection, and neither is guaranteed to carry an Error with a message.
 *
 * @param {string} name
 * @param {*} ex
 * @returns {string}
 */
function inflateError(name, ex) {
    let err = "Could not inflate " + name;
    if (ex instanceof Error && ex.message !== "") {
        err += ": " + ex.message;
    }
    return err;
}

/**
 * Check extracted bytes against the length and the checksum the directory
 * promised, returning null when they agree. Damage that happens to preserve the
 * length, in stored data or in a deflate stream, is only visible in the CRC.
 * This runs on the bytes where they already are, so a caller can decide whether
 * the entry is worth copying out before spending the memory on it.
 *
 * @param {ZipEntry} entry
 * @param {Uint8Array} data
 * @returns {string | null}
 */
function entryFail(entry, data) {
    if (data.length !== entry.size) {
        return "ZIP entry " + entry.name + " has " + data.length + " bytes, not " + entry.size + ".";
    }
    if (crc32(data) !== entry.crc) {
        return "ZIP entry " + entry.name + " fails its CRC check.";
    }
    return null;
}

/**
 * The standard ZIP CRC-32, reflected in and out with a complemented start and
 * end, run a byte at a time off the table.
 *
 * @param {Uint8Array} data
 * @returns {number}
 */
function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i += 1) {
        crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
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
 * The top byte is scaled rather than shifted, so sizes and offsets above 2G
 * stay positive instead of turning into a negative signed result.
 *
 * @param {Uint8Array} u8
 * @param {number} i
 * @returns {number}
 */
function u32(u8, i) {
    return (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16)) + u8[i + 3] * 0x1000000;
}
