import {httpGet} from "./io.js";

// The Timex Sinclair Software Archive on archive.org. Programs are stored as
// one ZIP per title. The ZIP bytes themselves come from storage servers
// without CORS headers, but archive.org unpacks members on request at
// download/<item>/<zip>/<member>, and that path (and the ZIP listing page at
// download/<item>/<zip>/) does allow cross-origin reads. So the browser never
// needs to inflate anything: it lists the ZIP, then fetches the .tap or .tzx.

export const archiveItem = "timex-sinclair-software-archive";
export const archivePage = "https://archive.org/details/" + archiveItem;
const metadataUrl = "https://archive.org/metadata/" + archiveItem + "/files";
const downloadBase = "https://archive.org/download/" + archiveItem + "/";

/**
 * @typedef {{
 *   name: string,
 *   size: number,
 * }} ArchiveFile
 */

/**
 * The ZIP files of the archive item, sorted by name.
 * @param {function(string | null, ArchiveFile[] | null): void} onDone
 */
export function fetchArchiveIndex(onDone) {
    httpGet(metadataUrl, "json", function (err, json) {
        if (err !== null) {
            onDone(err, null);
            return;
        }
        const list = json?.result;
        if (!Array.isArray(list)) {
            onDone("Unexpected archive.org metadata.", null);
            return;
        }
        /** @type {ArchiveFile[]} */
        const files = [];
        for (let i = 0; i < list.length; i += 1) {
            const f = list[i];
            if (typeof f?.name !== "string" || !/\.zip$/i.test(f.name)) {
                continue;
            }
            files.push({name: f.name, size: Number(f.size) || 0});
        }
        files.sort(function (a, b) {
            return a.name.localeCompare(b.name, "en", {sensitivity: "base", numeric: true});
        });
        onDone(null, files);
    });
}

/**
 * @param {string} zip
 * @returns {string}
 */
export function zipUrl(zip) {
    return downloadBase + encodeURIComponent(zip);
}

/**
 * @param {string} zip
 * @param {string} member
 * @returns {string}
 */
export function memberUrl(zip, member) {
    return zipUrl(zip) + "/" + encodeURIComponent(member);
}

/**
 * The files inside one ZIP, from the archive.org listing page.
 * @param {string} zip
 * @param {function(string | null, ArchiveFile[] | null): void} onDone
 */
export function fetchZipListing(zip, onDone) {
    httpGet(zipUrl(zip) + "/", "document", function (err, doc) {
        if (err !== null) {
            onDone(err, null);
            return;
        }
        if (!(doc instanceof Document)) {
            onDone("Unexpected archive.org listing for " + zip + ".", null);
            return;
        }
        /** @type {ArchiveFile[]} */
        const files = [];
        const rows = doc.querySelectorAll("table.archext tr");
        for (let r = 0; r < rows.length; r += 1) {
            const cells = rows[r].querySelectorAll("td");
            const link = rows[r].querySelector("td a");
            if (link === null || cells.length === 0) {
                continue;
            }
            const name = link.textContent ?? "";
            if (name === "" || name.endsWith("/") || isJunk(name)) {
                continue;
            }
            const size = parseInt(cells[cells.length - 1].textContent ?? "", 10);
            files.push({name: name, size: Number.isFinite(size) ? size : 0});
        }
        onDone(null, files);
    });
}

/**
 * @param {string} zip
 * @param {string} member
 * @param {import("./io.js").OnDone} onDone
 */
export function fetchZipMember(zip, member, onDone) {
    httpGet(memberUrl(zip, member), "arraybuffer", onDone);
}

/**
 * macOS resource forks and other hidden files that ZIPs often carry.
 * @param {string} name
 * @returns {boolean}
 */
export function isJunk(name) {
    const parts = name.split("/");
    for (let i = 0; i < parts.length; i += 1) {
        if (parts[i] === "__MACOSX" || parts[i].startsWith(".")) {
            return true;
        }
    }
    return false;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isTapeName(name) {
    return /\.(tap|tzx)$/i.test(name);
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isCartName(name) {
    return /\.dck$/i.test(name);
}

/**
 * Titles tagged for a machine other than the TS 2068.
 * @param {string} name
 * @returns {boolean}
 */
export function isOtherMachine(name) {
    return /\((TS1000|TS1500|ZX81|ZX Spectrum|T\/S 1000)\)/i.test(name);
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatSize(n) {
    if (n < 10240) {
        return n + " B";
    }
    if (n < 10485760) {
        return Math.round(n / 1024) + " KB";
    }
    return Math.round(n / 1048576) + " MB";
}
