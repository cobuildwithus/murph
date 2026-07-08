const DEVICE_SYNC_CALLBACK_PROTOCOLS = new Set<string>(["http:", "https:"]);

export const DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS = [
  "deviceSyncStatus",
  "deviceSyncProvider",
  // Hosted web used to append a browser-facing connection id here.
  "deviceSyncConnectionId",
  // Local control-plane flows previously used account ids here.
  "deviceSyncAccountId",
  "deviceSyncError",
  "deviceSyncErrorMessage",
] as const;

export function buildDeviceSyncCallbackSuccessRedirectLocation(input: {
  returnTo: string | null;
  provider: string;
  connectSourceId?: string | null;
  connectTarget?: string | null;
}): string | null {
  return buildDeviceSyncCallbackRedirectLocation(input.returnTo, (destination) => {
    destination.searchParams.set("deviceSyncStatus", "connected");
    destination.searchParams.set("deviceSyncProvider", input.provider);
    appendConnectSourceParams(destination, input);
  });
}

/**
 * Validates and normalizes a stored returnTo for redirects that must not
 * assert a connection outcome, such as replayed callback deliveries. Stale
 * deviceSync callback params are stripped so the destination renders
 * connection truth from the store.
 */
export function buildDeviceSyncCallbackReturnLocation(returnTo: string | null): string | null {
  return buildDeviceSyncCallbackRedirectLocation(returnTo, () => {});
}

export function buildDeviceSyncCallbackErrorRedirectLocation(input: {
  returnTo: string | null;
  provider: string;
  connectSourceId?: string | null;
  connectTarget?: string | null;
  errorCode: string;
}): string | null {
  return buildDeviceSyncCallbackRedirectLocation(input.returnTo, (destination) => {
    destination.searchParams.set("deviceSyncStatus", "error");
    destination.searchParams.set("deviceSyncProvider", input.provider);
    destination.searchParams.set("deviceSyncError", input.errorCode);
    appendConnectSourceParams(destination, input);
  });
}

function buildDeviceSyncCallbackRedirectLocation(
  returnTo: string | null,
  mutate: (destination: URL) => void,
): string | null {
  const destination = parseDeviceSyncCallbackRedirectDestination(returnTo);

  if (!destination) {
    return null;
  }

  resetDeviceSyncCallbackParams(destination);
  mutate(destination);
  return destination.toString();
}

function parseDeviceSyncCallbackRedirectDestination(returnTo: string | null): URL | null {
  if (!returnTo) {
    return null;
  }

  try {
    const destination = new URL(returnTo);
    return DEVICE_SYNC_CALLBACK_PROTOCOLS.has(destination.protocol) ? destination : null;
  } catch {
    return null;
  }
}

function resetDeviceSyncCallbackParams(destination: URL): void {
  for (const key of DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS) {
    destination.searchParams.delete(key);
  }
}

function appendConnectSourceParams(
  destination: URL,
  input: {
    connectSourceId?: string | null;
    connectTarget?: string | null;
  },
): void {
  const connectSource = normalizeCallbackParam(input.connectSourceId);
  const connectTarget = normalizeCallbackParam(input.connectTarget);

  if (connectSource) {
    destination.searchParams.set("connectSource", connectSource);
  }
  if (connectTarget) {
    destination.searchParams.set("connectTarget", connectTarget);
  }
}

function normalizeCallbackParam(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}
