import type { HostedDeviceConnectionSource } from "./prisma-store";

export const HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE =
  "SOURCE_DISCONNECT_IN_PROGRESS";
export const HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE =
  "SOURCE_USER_DISCONNECTED";

const HOSTED_SOURCE_DISCONNECT_FENCE_CODES = new Set([
  HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE,
]);

export function isHostedSourceDisconnectFenced(
  source: Pick<HostedDeviceConnectionSource, "lastErrorCode">,
): boolean {
  return source.lastErrorCode !== null
    && HOSTED_SOURCE_DISCONNECT_FENCE_CODES.has(source.lastErrorCode);
}
