// How large a plausible file is. A response is buffered whole before anything
// can look at it, so these are what a fetch is stopped at rather than what a
// parse rejects: a tape or cartridge image runs to a few hundred KB, and an
// archive holding several of them is still small.
export const maxMediaSize = 8388608;
export const maxZipSize = 33554432;

/**
 * macOS resource forks and other hidden files that ZIPs often carry.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isHiddenName(name) {
    return /(?:^|\/)(?:__MACOSX(?:\/|$)|\.)/.test(name);
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isZipName(name) {
    return /\.zip$/i.test(name);
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
