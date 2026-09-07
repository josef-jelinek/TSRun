/**
 * @callback OnDone
 * @param {string | null} err
 * @param {*} result
 */

/**
 * @param {string} url
 * @param {XMLHttpRequestResponseType} responseType
 * @param {number} maxBytes
 * @param {OnDone} onDone
 * @returns {(function(): void) | null} abort
 */
export function httpGet(url, responseType, maxBytes, onDone) {
    const errLead = "Could not load \"" + url + "\"";
    /** @type {XMLHttpRequest | null} */
    let xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = responseType;

    xhr.onprogress = function (e) {
        if (xhr !== null) {
            if ((Number.isFinite(e.total) && e.total > maxBytes) || (Number.isFinite(e.loaded) && e.loaded > maxBytes)) {
                const r = xhr;
                xhr = null; // set to null before abort as onabort is called immediately
                r.abort();
                onDone(errLead + ": Response is larger than " + maxBytes + " bytes.", null);
            }
        }
    };

    xhr.onload = function () {
        if (xhr !== null) {
            const status = xhr.status;
            const response = xhr.response;
            xhr = null;
            if (status !== 200 && status !== 0) {
                onDone(errLead + " (HTTP " + status + ").", null);
                return;
            }
            onDone(null, response);
        }
    };

    xhr.onerror = function () {
        if (xhr !== null) {
            xhr = null;
            onDone(errLead + ".", null);
        }
    };

    xhr.onabort = function () {
        if (xhr !== null) {
            xhr = null;
            onDone(errLead + ": Canceled.", null);
        }
    };

    try {
        xhr.send();
    } catch (ex) {
        xhr = null;
        if (ex instanceof Error) {
            onDone(errLead + ": " + ex.message, null);
        } else {
            onDone(errLead + ".", null);
        }
        return null; // synchronous onDone, no abort
    }

    return function () {
        if (xhr !== null) {
            xhr.abort();
        }
    };
}

/**
 * @param {File} file
 * @param {XMLHttpRequestResponseType} responseType
 * @param {OnDone} onDone
 */
export function readFile(file, responseType, onDone) {
    const errLead = "Could not load \"" + file.name + "\"";
    const reader = new FileReader();

    reader.onload = function () {
        switch (responseType) {
        case "arraybuffer":
            if (!(reader.result instanceof ArrayBuffer)) {
                onDone(errLead + ": Empty read.", null);
                return;
            }
            onDone(null, reader.result);
            return;
        case "text":
            if (typeof reader.result !== "string") {
                onDone(errLead + ": Empty read.", null);
                return;
            }
            onDone(null, reader.result);
            return;
        default:
            onDone(errLead + ": Unsupported type.", null);
            return;
        }
    };

    reader.onerror = function () {
        if (reader.error !== null && reader.error.message !== "") {
            onDone(errLead + ": " + reader.error.message, null);
        } else {
            onDone(errLead + ".", null);
        }
    };

    reader.onabort = function () {
        onDone(errLead + ": Canceled.", null);
    };

    try {
        switch (responseType) {
        case "arraybuffer":
            reader.readAsArrayBuffer(file);
            break;
        case "text":
            reader.readAsText(file);
            break;
        default:
            onDone(errLead + ": Unsupported type.", null);
            break;
        }
    } catch (ex) {
        if (ex instanceof Error) {
            onDone(errLead + ": " + ex.message, null);
        } else {
            onDone(errLead + ".", null);
        }
    }
}
