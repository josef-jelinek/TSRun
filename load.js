import {httpGet} from "./io.js";
import {unpackedMemberUrl} from "./tsarchive.js";
import {isHiddenName, isZipName, isTapeName, isCartName, maxMediaSize, maxZipSize} from "./media.js";
import {listZip, readZipEntry} from "./zip.js";

/**
 * Fetch a TAP, TZX, DCK, or ZIP from an http(s) URL. A ZIP fragment names the
 * member; archive.org ZIPs that cannot be read cross-origin are rewritten to
 * the unpacked member URL.
 *
 * @param {string} urlParam
 * @param {function(string | null, string | null, ArrayBuffer | null): void} onDone
 * @returns {(function(): void) | null} abort
 */
export function loadMediaUrl(urlParam, onDone) {
    /** @type {URL | null} */
    let url = null;
    try {
        url = new URL(urlParam, window.location.href);
    } catch {
        onDone("Invalid startup file URL.", null, null);
        return null; // synchronous onDone, no abort
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        onDone("A startup file protocol must be http(s).", null, null);
        return null; // synchronous onDone, no abort
    }
    const zip = isZipName(url.pathname);
    if (!zip && !isTapeName(url.pathname) && !isCartName(url.pathname)) {
        onDone("Unsupported startup file type: " + url.pathname + ".", null, null);
        return null; // synchronous onDone, no abort
    }
    // Serializing a URL escapes a space and everything non-ASCII, so the
    // fragment read back here is encoded again whatever the parameter held, and
    // what a ZIP calls the entry has to be decoded out of it. A name carrying a
    // literal percent is not encoded at all and decoding it throws, so it
    // stands as written.
    let member = url.hash.slice(1);
    try {
        member = decodeURIComponent(member);
    } catch {
        // Not percent-encoded after all.
    }
    let name = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    let maxBytes = maxMediaSize;
    let loadZip = zip;
    // The fragment is not sent; fetch the ZIP path, or the unpacked member
    // when this is an archive.org ZIP that cannot be read cross-origin.
    let requestUrl = url.origin + url.pathname + url.search;
    const unpacked = unpackedMemberUrl(url, member);
    if (unpacked !== null) {
        if (!isTapeName(member) && !isCartName(member)) {
            onDone("ZIP entry " + member + " is not a TAP, TZX, or DCK.", null, null);
            return null; // synchronous onDone, no abort
        }
        requestUrl = unpacked;
        loadZip = false;
        name = member;
    } else if (zip) {
        maxBytes = maxZipSize;
    }
    let done = false; // mostly to prevent non-abortable unzip to trigger post-abort callback
    const abort = httpGet(
        requestUrl,
        "arraybuffer",
        maxBytes,
        function (err, buf) {
            if (done) {
                return;
            }
            if (err !== null) {
                done = true;
                onDone(err, null, null);
                return;
            }
            if (!(buf instanceof ArrayBuffer)) {
                done = true;
                onDone("Could not load " + requestUrl + ": empty response.", null, null);
                return;
            }
            if (!loadZip) {
                done = true;
                onDone(null, name, buf);
                return;
            }
            extractFromZip(
                member,
                buf,
                function (err, name, bytes) {
                    if (done) {
                        return;
                    }
                    done = true;
                    onDone(err, name, bytes);
                },
            );
        },
    );

    if (abort === null) {
        return null; // synchronous onDone, no abort
    }

    return function () {
        if (done) {
            return;
        }
        done = true;
        abort();
        onDone("Aborted.", null, null);
    };
}

/**
 * Select and extract one loadable file from a ZIP bytes.
 *
 * @param {string} member
 * @param {ArrayBuffer} bytes
 * @param {function(string | null, string | null, ArrayBuffer | null): void} onDone
 */
function extractFromZip(member, bytes, onDone) {
    const listing = listZip(bytes);
    if (listing.err !== null) {
        onDone(listing.err, null, null);
        return;
    }

    let selected = null;
    if (member !== "") {
        for (const entry of listing.entries) {
            if (entry.name === member) {
                selected = entry;
                break;
            }
        }
        if (selected === null) {
            onDone("ZIP entry " + member + " does not exist.", null, null);
            return;
        }
        if (!isTapeName(selected.name) && !isCartName(selected.name)) {
            onDone("ZIP entry " + selected.name + " is not a TAP, TZX, or DCK.", null, null);
            return;
        }
        if (selected.size > maxMediaSize) {
            onDone("ZIP entry " + selected.name + " is too large to load.", null, null);
            return;
        }
    } else {
        const usable = [];
        for (const entry of listing.entries) {
            const supported = isTapeName(entry.name) || isCartName(entry.name);
            const readable = entry.method === 0 || entry.method === 8 && typeof DecompressionStream !== "undefined";
            if (!isHiddenName(entry.name) && supported && !entry.encrypted && readable && entry.size <= maxMediaSize) {
                usable.push(entry);
            }
        }
        if (usable.length === 0) {
            onDone("ZIP file has no usable TAP, TZX, or DCK entries.", null, null);
            return;
        }
        selected = usable[0];
        for (const s of usable) {
            if (s.name < selected.name) {
                selected = s;
            }
        }
    }

    readZipEntry(
        bytes,
        selected,
        function (err, buf) {
            if (err !== null) {
                onDone(err, null, null);
                return;
            }
            if (!(buf instanceof ArrayBuffer)) {
                onDone("Could not extract ZIP entry " + selected.name + ".", null, null);
                return;
            }
            onDone(null, selected.name, buf);
        },
    );
}
