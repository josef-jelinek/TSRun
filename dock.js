const dckPageSize = 8192;
const dckBankDock = 0;
const dckBankExrom = 254;
const dckBankHome = 255;

/**
 * @typedef {{
 *   kind: number,
 *   data: Uint8Array | null,
 * }} DckChunk
 */

/**
 * @typedef {{
 *   bank: number,
 *   chunks: DckChunk[],
 * }} DckBlock
 */

/**
 * @typedef {{err: string, blocks: null} | {err: null, blocks: DckBlock[]}} DckParse
 */

/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {DckParse}
 */
export function parseDck(bytes) {
    const u8 = new Uint8Array(bytes);
    const blocks = [];
    let i = 0;
    while (i < u8.length) {
        if (i + 9 > u8.length) {
            return {err: "Truncated DCK header.", blocks: null};
        }
        const bank = u8[i];
        if (bank !== dckBankDock && bank !== dckBankExrom && bank !== dckBankHome) {
            return {err: "Unknown DCK bank " + bank + ".", blocks: null};
        }
        const kinds = [];
        let pages = 0;
        for (let c = 0; c < 8; c += 1) {
            const kind = u8[i + 1 + c];
            if (kind > 3) {
                return {err: "Unknown DCK page type " + kind + ".", blocks: null};
            }
            kinds.push(kind);
            if (kind === 2 || kind === 3) {
                pages += 1;
            }
        }
        i += 9;
        if (i + pages * dckPageSize > u8.length) {
            return {err: "Truncated DCK page.", blocks: null};
        }
        const chunks = [];
        for (let c = 0; c < 8; c += 1) {
            const kind = kinds[c];
            let data = null;
            if (kind === 1) {
                data = new Uint8Array(dckPageSize);
            } else if (kind === 2 || kind === 3) {
                data = new Uint8Array(u8.subarray(i, i + dckPageSize));
                i += dckPageSize;
            }
            chunks.push({kind, data});
        }
        blocks.push({bank, chunks});
    }
    if (blocks.length === 0) {
        return {err: "DCK has no blocks.", blocks: null};
    }
    return {err: null, blocks};
}
