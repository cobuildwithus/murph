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

/**
 * Exact-source admission for companion payloads.
 *
 * A missing row remains admissible for the first provider event. Once the
 * source has a canonical row, only a connected, unfenced row can admit new
 * source-attributed work. This lets a source-specific disconnect govern every
 * native ingress lane without making the shared Junction parent authoritative.
 */
export function isHostedConnectionSourceAdmitted(
  sources: readonly Pick<
    HostedDeviceConnectionSource,
    "lastErrorCode" | "sourceProviderSlug" | "status"
  >[],
  sourceProviderSlug: string,
): boolean {
  const matchingSources = sources.filter(
    (source) => source.sourceProviderSlug === sourceProviderSlug,
  );

  return matchingSources.length === 0
    || matchingSources.some(
      (source) => source.status === "connected" && !isHostedSourceDisconnectFenced(source),
    );
}
