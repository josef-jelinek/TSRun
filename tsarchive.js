import {httpGet} from "./io.js";
import {isHiddenName, maxMediaSize} from "./media.js";

// A file list or a ZIP listing page, neither of which is media.
const maxListingSize = 4194304;

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
 * Machine compatibility derived only from recognizable filename tags.
 *
 * @typedef {"ts2068" | "other" | "unknown"} ArchiveMachine
 */

/**
 * The ZIP files of the archive item, sorted by name.
 *
 * @param {function(string | null, ArchiveFile[] | null): void} onDone
 */
export function fetchArchiveIndex(onDone) {
    httpGet(metadataUrl, "json", maxListingSize, function (err, json) {
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
            if (typeof f?.name !== "string" || f.source !== "original" || !/\.zip$/i.test(f.name)) {
                continue;
            }
            let size = Number(f.size);
            if (!Number.isFinite(size) || size < 0) {
                size = 0;
            }
            files.push({name: f.name, size});
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
 * Direct download of one ZIP member. Each path segment is encoded so a
 * member in a subfolder stays a real slash in the URL; archive.org will
 * not unpack `%2F`.
 *
 * @param {string} zip
 * @param {string} member
 * @returns {string}
 */
export function memberUrl(zip, member) {
    const parts = member.split("/");
    let encoded = "";
    for (let i = 0; i < parts.length; i += 1) {
        if (i > 0) {
            encoded += "/";
        }
        encoded += encodeURIComponent(parts[i]);
    }
    return zipUrl(zip) + "/" + encoded;
}

/**
 * CORS URL for a TAP, TZX, or DCK named by `index.html?url=` as this
 * archive's ZIP plus a `#member` fragment. archive.org does not allow
 * reading the ZIP bytes cross-origin, but it does unpack members.
 *
 * @param {URL} url
 * @param {string} member
 * @returns {string | null}
 */
export function unpackedMemberUrl(url, member) {
    if (member === "") {
        return null;
    }
    if (url.hostname !== "archive.org" && url.hostname !== "www.archive.org") {
        return null;
    }
    let path = url.pathname;
    try {
        path = decodeURIComponent(path);
    } catch {
        return null;
    }
    const prefix = "/download/" + archiveItem + "/";
    if (!path.startsWith(prefix) || !/\.zip$/i.test(path)) {
        return null;
    }
    const zip = path.slice(prefix.length);
    if (zip === "" || zip.includes("/")) {
        return null;
    }
    return memberUrl(zip, member);
}

/**
 * The files inside one ZIP, from the archive.org listing page.
 *
 * @param {string} zip
 * @param {function(string | null, ArchiveFile[] | null): void} onDone
 * @returns {(function(): void) | null} abort
 */
export function fetchZipListing(zip, onDone) {
    return httpGet(zipUrl(zip) + "/", "document", maxListingSize, function (err, doc) {
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
            if (name === "" || name.endsWith("/") || isHiddenName(name)) {
                continue;
            }
            let size = Number.parseInt(cells[cells.length - 1].textContent ?? "", 10);
            if (!Number.isFinite(size) || size < 0) {
                size = 0;
            }
            files.push({name, size});
        }
        onDone(null, files);
    });
}

/**
 * @param {string} zip
 * @param {string} member
 * @param {import("./io.js").OnDone} onDone
 * @returns {(function(): void) | null} abort
 */
export function fetchZipMember(zip, member, onDone) {
    return httpGet(memberUrl(zip, member), "arraybuffer", maxMediaSize, onDone);
}

/**
 * Classify recognized machine tags while leaving untagged titles available.
 * A TS 2068 tag takes precedence when a title also names another machine.
 *
 * @param {string} name
 * @returns {ArchiveMachine}
 */
export function detectMachine(name) {
    if (/\((?:TS|T\/S)?\s*-?\s*\(?2068\b/i.test(name)) {
        return "ts2068";
    }
    // TS1000 / TS1500 share the ZX81 as a family and are not TS2068 titles.
    if (/\((?:TS|T\/S)?\s*-?\s*\(?(?:1000|1500)\b/i.test(name)) {
        return "other";
    }
    if (/\((?:ZX81|ZX Spectrum|PC-?8300)\b/i.test(name)) {
        return "other";
    }
    return "unknown";
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
