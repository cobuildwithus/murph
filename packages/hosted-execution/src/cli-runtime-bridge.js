import { parseHostedExecutionDeviceSyncConnectLinkResponse } from "@murphai/device-syncd/hosted-runtime";
import { z } from "zod";
export const HOSTED_RUNTIME_PROCESS_ENV = "MURPH_HOSTED_RUNTIME_PROCESS";
export const HOSTED_CLI_BRIDGE_URL_ENV = "MURPH_HOSTED_CLI_BRIDGE_URL";
export const HOSTED_CLI_BRIDGE_TOKEN_ENV = "MURPH_HOSTED_CLI_BRIDGE_TOKEN";
export const HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH = "/device/connect-link";
export const HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT_MS = 10_000;
export const HOSTED_CLI_BRIDGE_ENV_NAMES = [
    HOSTED_RUNTIME_PROCESS_ENV,
    HOSTED_CLI_BRIDGE_URL_ENV,
    HOSTED_CLI_BRIDGE_TOKEN_ENV,
];
export const HOSTED_CLI_BRIDGE_SECRET_ENV_NAMES = [
    HOSTED_CLI_BRIDGE_TOKEN_ENV,
];
export const HOSTED_CLI_LOCAL_DAEMON_ENV_DENYLIST = [
    "DEVICE_SYNC_BASE_URL",
    "DEVICE_SYNC_CONTROL_TOKEN",
    "DEVICE_SYNC_SECRET",
    "DEVICE_SYNC_STATE_DB_PATH",
];
const hostedCliDeviceConnectLinkRequestSchema = z.object({
    connectTarget: z.string().trim().min(1),
    returnTo: z.string().trim().min(1).nullable().optional(),
}).strict();
export class HostedCliBridgeRequestError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "HostedCliBridgeRequestError";
        this.code = code;
    }
}
export function isHostedRuntimeProcessEnv(env) {
    return env[HOSTED_RUNTIME_PROCESS_ENV]?.trim() === "1";
}
export function readHostedCliBridgeEnv(env) {
    if (!isHostedRuntimeProcessEnv(env)) {
        return null;
    }
    const url = normalizeHostedCliBridgeEnvValue(env[HOSTED_CLI_BRIDGE_URL_ENV]);
    const token = normalizeHostedCliBridgeEnvValue(env[HOSTED_CLI_BRIDGE_TOKEN_ENV]);
    if (!url && !token) {
        return null;
    }
    if (!url || !token) {
        throw new Error("Hosted CLI bridge configuration is incomplete.");
    }
    validateHostedCliBridgeUrl(url);
    return {
        runtimeProcess: true,
        token,
        url,
    };
}
export function parseHostedCliDeviceConnectLinkRequest(value) {
    return hostedCliDeviceConnectLinkRequestSchema.parse(value);
}
export async function requestHostedCliDeviceConnectLink(input) {
    const fetchImpl = input.fetchImpl ?? fetch;
    const signal = AbortSignal.timeout(input.timeoutMs ?? HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT_MS);
    let response;
    try {
        response = await fetchImpl(new URL(HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH, ensureTrailingSlash(input.bridge.url)), {
            body: JSON.stringify({
                connectTarget: input.connectTarget,
                ...(input.returnTo ? { returnTo: input.returnTo } : {}),
            }),
            headers: {
                authorization: `Bearer ${input.bridge.token}`,
                "content-type": "application/json",
            },
            method: "POST",
            signal,
        });
    }
    catch (error) {
        throw createHostedCliBridgeTransportError(error, signal);
    }
    let payload;
    try {
        payload = await readHostedCliBridgeJsonResponse(response);
    }
    catch (error) {
        if (isHostedCliBridgeTransportError(error, signal)) {
            throw createHostedCliBridgeTransportError(error, signal);
        }
        throw error;
    }
    if (!response.ok) {
        const error = readHostedCliBridgeError(payload);
        throw new HostedCliBridgeRequestError(error.code, error.message);
    }
    return parseHostedExecutionDeviceSyncConnectLinkResponse(payload);
}
function createHostedCliBridgeTransportError(error, signal) {
    if (signal.aborted || getHostedCliBridgeErrorName(error) === "TimeoutError") {
        return new HostedCliBridgeRequestError("HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT", "Hosted CLI bridge request timed out.", { cause: error });
    }
    return new HostedCliBridgeRequestError("HOSTED_CLI_BRIDGE_REQUEST_FAILED", "Hosted CLI bridge request failed.", { cause: error });
}
function isHostedCliBridgeTransportError(error, signal) {
    return signal.aborted
        || getHostedCliBridgeErrorName(error) === "TimeoutError"
        || error instanceof TypeError;
}
function getHostedCliBridgeErrorName(error) {
    if (!error || typeof error !== "object") {
        return null;
    }
    const name = Reflect.get(error, "name");
    return typeof name === "string" ? name : null;
}
function readHostedCliBridgeError(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {
            code: "HOSTED_CLI_BRIDGE_REQUEST_FAILED",
            message: "Hosted CLI bridge request failed.",
        };
    }
    const error = value.error;
    if (!error || typeof error !== "object" || Array.isArray(error)) {
        return {
            code: "HOSTED_CLI_BRIDGE_REQUEST_FAILED",
            message: "Hosted CLI bridge request failed.",
        };
    }
    const code = error.code;
    const message = error.message;
    return {
        code: typeof code === "string" && code.trim() ? code.trim() : "HOSTED_CLI_BRIDGE_REQUEST_FAILED",
        message: typeof message === "string" && message.trim()
            ? message.trim()
            : "Hosted CLI bridge request failed.",
    };
}
async function readHostedCliBridgeJsonResponse(response) {
    const text = await response.text();
    if (!text.trim()) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error("Hosted CLI bridge returned invalid JSON.");
    }
}
function normalizeHostedCliBridgeEnvValue(value) {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}
function ensureTrailingSlash(value) {
    return value.endsWith("/") ? value : `${value}/`;
}
function validateHostedCliBridgeUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error("Hosted CLI bridge URL must be an absolute URL.");
    }
    if (url.protocol !== "http:") {
        throw new Error("Hosted CLI bridge URL must use http.");
    }
    if (!isLoopbackHost(url.hostname)) {
        throw new Error("Hosted CLI bridge URL must use loopback host.");
    }
}
function isLoopbackHost(hostname) {
    const normalized = hostname.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
    return normalized === "127.0.0.1"
        || normalized === "::1"
        || normalized === "localhost";
}
//# sourceMappingURL=cli-runtime-bridge.js.map