/**
 * @callback OnDone
 * @param {string | null} err
 * @param {*} result
 */

/**
 * @param {string} url
 * @param {XMLHttpRequestResponseType} responseType
 * @param {OnDone} onDone
 */
export function httpGet(url, responseType, onDone) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = responseType;

    xhr.onload = function () {
        if (xhr.status !== 200 && xhr.status !== 0) {
            onDone("Could not load " + url + " (HTTP " + xhr.status + ").", null);
            return;
        }
        onDone(null, xhr.response);
    };

    xhr.onerror = function () {
        onDone("Could not load " + url + ".", null);
    };

    xhr.onabort = function () {
        onDone("Canceled loading " + url + ".", null);
    };

    try {
        xhr.send();
    } catch (ex) {
        let message = "error";
        if (ex instanceof Error) {
            message = ex.message;
        }
        onDone("Could not load " + url + ": " + message, null);
    }
}

/**
 * @param {File} file
 * @param {XMLHttpRequestResponseType} responseType
 * @param {OnDone} onDone
 */
export function readFile(file, responseType, onDone) {
    const reader = new FileReader();

    reader.onload = function () {
        switch (responseType) {
        case "arraybuffer":
            if (!(reader.result instanceof ArrayBuffer)) {
                onDone("Could not load " + file.name + ": empty read.", null);
                return;
            }
            break;
        case "text":
            if (typeof reader.result !== "string") {
                onDone("Could not load " + file.name + ": empty read.", null);
                return;
            }
            break;
        default:
            onDone("Could not load " + file.name + ": unsupported type.", null);
            return;
        }
        onDone(null, reader.result);
    };

    reader.onerror = function () {
        let message = "unknown read error";
        if (reader.error !== null && reader.error.message !== "") {
            message = reader.error.message;
        }
        onDone("Could not load " + file.name + ": " + message, null);
    };

    reader.onabort = function () {
        onDone("Canceled loading " + file.name + ".", null);
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
            onDone("Could not load " + file.name + ": unsupported type.", null);
            break;
        }
    } catch (ex) {
        let message = "error";
        if (ex instanceof Error) {
            message = ex.message;
        }
        onDone("Could not load " + file.name + ": " + message, null);
    }
}
