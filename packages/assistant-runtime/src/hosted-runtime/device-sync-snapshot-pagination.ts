import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PAGE_LIMIT,
  type HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

export interface HostedDeviceSyncRuntimeSnapshotReader {
  fetchSnapshot(
    input: Omit<HostedExecutionDeviceSyncRuntimeSnapshotRequest, "userId"> & {
      signal?: AbortSignal | null;
    },
  ): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
}

export async function fetchCompleteHostedDeviceSyncRuntimeSnapshot(input: {
  deviceSyncPort: HostedDeviceSyncRuntimeSnapshotReader;
  includeCredentialMaterial: boolean;
  provider?: string | null;
  signal?: AbortSignal | null;
  sourceProviderSlug?: string | null;
}): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse> {
  const connections: HostedExecutionDeviceSyncRuntimeSnapshotResponse["connections"] = [];
  const connectionIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: HostedExecutionDeviceSyncRuntimeSnapshotRequest["cursor"] = null;
  let firstPage: HostedExecutionDeviceSyncRuntimeSnapshotResponse | null = null;
  let providerConfigs: HostedExecutionDeviceSyncRuntimeSnapshotResponse["providerConfigs"];

  for (;;) {
    const isFirstPage = firstPage === null;
    const remaining = HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT
      - connections.length;
    if (remaining <= 0) {
      throw new TypeError(
        `Hosted device-sync connection authority exceeds the ${HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT}-connection hydration bound.`,
      );
    }
    const requestedPageLimit = Math.min(
      remaining,
      HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PAGE_LIMIT,
    );
    const page = await input.deviceSyncPort.fetchSnapshot({
      ...(cursor ? { cursor } : {}),
      includeCredentialMaterial: input.includeCredentialMaterial,
      // A reader-first rollout must still hydrate the legacy Web producer,
      // whose omitted limit means "return the complete snapshot" and whose
      // response has no nextCursor field. Once Web emits cursor presence, all
      // following pages carry an explicit protocol limit.
      ...(!isFirstPage ? { limit: requestedPageLimit } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.sourceProviderSlug
        ? { sourceProviderSlug: input.sourceProviderSlug }
        : {}),
    });
    const initialPage: HostedExecutionDeviceSyncRuntimeSnapshotResponse = firstPage ?? page;
    firstPage = initialPage;
    if (page.userId !== initialPage.userId) {
      throw new TypeError("Hosted device-sync snapshot pages changed member authority.");
    }
    if (
      JSON.stringify(page.capabilities ?? {})
      !== JSON.stringify(initialPage.capabilities ?? {})
    ) {
      throw new TypeError("Hosted device-sync snapshot pages changed runtime capabilities.");
    }
    const isLegacyFirstPage = isFirstPage && page.nextCursor === undefined;
    const admittedPageLimit = isLegacyFirstPage
      ? HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT
      : requestedPageLimit;
    if (page.connections.length > admittedPageLimit) {
      throw new TypeError(
        isLegacyFirstPage
          ? `Hosted device-sync connection authority exceeds the ${HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT}-connection hydration bound.`
          : `Hosted device-sync snapshot page exceeds the ${HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PAGE_LIMIT}-connection page bound.`,
      );
    }
    for (const connection of page.connections) {
      if (connectionIds.has(connection.connection.id)) {
        throw new TypeError("Hosted device-sync snapshot pagination repeated a connection.");
      }
      connectionIds.add(connection.connection.id);
      connections.push(connection);
    }
    providerConfigs = mergeHostedRuntimeProviderConfigs(
      providerConfigs,
      page.providerConfigs,
    );

    if (!isFirstPage && page.nextCursor === undefined) {
      throw new TypeError(
        "Hosted device-sync snapshot omitted its continuation cursor after pagination began.",
      );
    }
    const nextCursor = page.nextCursor ?? null;
    if (!nextCursor) {
      const {
        providerConfigs: _firstPageProviderConfigs,
        ...firstPageWithoutProviderConfigs
      } = initialPage;
      return {
        ...firstPageWithoutProviderConfigs,
        connections,
        ...(initialPage.nextCursor === undefined ? {} : { nextCursor: null }),
        ...(providerConfigs && Object.keys(providerConfigs).length > 0
          ? { providerConfigs }
          : {}),
      };
    }
    if (page.connections.length === 0) {
      throw new TypeError("Hosted device-sync snapshot pagination returned an empty continuing page.");
    }
    if (connections.length >= HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT) {
      throw new TypeError(
        `Hosted device-sync connection authority exceeds the ${HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_HYDRATION_LIMIT}-connection hydration bound.`,
      );
    }
    const cursorKey = `${nextCursor.createdAt}\n${nextCursor.id}`;
    if (seenCursors.has(cursorKey)) {
      throw new TypeError("Hosted device-sync snapshot pagination repeated a cursor.");
    }
    seenCursors.add(cursorKey);
    cursor = nextCursor;
  }
}

function mergeHostedRuntimeProviderConfigs(
  current: HostedExecutionDeviceSyncRuntimeSnapshotResponse["providerConfigs"],
  next: HostedExecutionDeviceSyncRuntimeSnapshotResponse["providerConfigs"],
): HostedExecutionDeviceSyncRuntimeSnapshotResponse["providerConfigs"] {
  if (!next) {
    return current;
  }
  const merged: Record<string, unknown> = { ...(current ?? {}) };
  for (const [provider, config] of Object.entries(next)) {
    const existing = merged[provider];
    if (existing && JSON.stringify(existing) !== JSON.stringify(config)) {
      throw new TypeError(
        `Hosted device-sync snapshot pages disagree on ${provider} application authority.`,
      );
    }
    merged[provider] = config;
  }
  return merged as HostedExecutionDeviceSyncRuntimeSnapshotResponse["providerConfigs"];
}
