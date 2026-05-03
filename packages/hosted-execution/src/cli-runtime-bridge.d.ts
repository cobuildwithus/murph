import { z } from "zod";
export declare const HOSTED_RUNTIME_PROCESS_ENV = "MURPH_HOSTED_RUNTIME_PROCESS";
export declare const HOSTED_CLI_BRIDGE_URL_ENV = "MURPH_HOSTED_CLI_BRIDGE_URL";
export declare const HOSTED_CLI_BRIDGE_TOKEN_ENV = "MURPH_HOSTED_CLI_BRIDGE_TOKEN";
export declare const HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH = "/device/connect-link";
export declare const HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT_MS = 10000;
export declare const HOSTED_CLI_BRIDGE_ENV_NAMES: readonly ["MURPH_HOSTED_RUNTIME_PROCESS", "MURPH_HOSTED_CLI_BRIDGE_URL", "MURPH_HOSTED_CLI_BRIDGE_TOKEN"];
export declare const HOSTED_CLI_BRIDGE_SECRET_ENV_NAMES: readonly ["MURPH_HOSTED_CLI_BRIDGE_TOKEN"];
export declare const HOSTED_CLI_LOCAL_DAEMON_ENV_DENYLIST: readonly ["DEVICE_SYNC_BASE_URL", "DEVICE_SYNC_CONTROL_TOKEN", "DEVICE_SYNC_SECRET", "DEVICE_SYNC_STATE_DB_PATH"];
declare const hostedCliDeviceConnectLinkRequestSchema: z.ZodObject<{
    connectTarget: z.ZodString;
    returnTo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type HostedCliDeviceConnectLinkRequest = z.infer<typeof hostedCliDeviceConnectLinkRequestSchema>;
export interface HostedCliDeviceConnectLinkResponse {
    authorizationUrl: string;
    expiresAt: string;
    provider: string;
    providerLabel: string;
}
export interface HostedCliBridgeClientConfig {
    token: string;
    url: string;
}
export interface HostedCliBridgeEnvConfig extends HostedCliBridgeClientConfig {
    runtimeProcess: true;
}
export declare class HostedCliBridgeRequestError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: {
        cause?: unknown;
    });
}
export declare function isHostedRuntimeProcessEnv(env: Readonly<Record<string, string | undefined>>): boolean;
export declare function readHostedCliBridgeEnv(env: Readonly<Record<string, string | undefined>>): HostedCliBridgeEnvConfig | null;
export declare function parseHostedCliDeviceConnectLinkRequest(value: unknown): HostedCliDeviceConnectLinkRequest;
export declare function requestHostedCliDeviceConnectLink(input: {
    bridge: HostedCliBridgeClientConfig;
    connectTarget: string;
    fetchImpl?: typeof fetch;
    returnTo?: string | null;
    timeoutMs?: number;
}): Promise<HostedCliDeviceConnectLinkResponse>;
export {};
//# sourceMappingURL=cli-runtime-bridge.d.ts.map