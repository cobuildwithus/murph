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
}): string | null {
  return buildDeviceSyncCallbackRedirectLocation(input.returnTo, (destination) => {
    destination.searchParams.set("deviceSyncStatus", "connected");
    destination.searchParams.set("deviceSyncProvider", input.provider);
  });
}

export function buildDeviceSyncCallbackErrorRedirectLocation(input: {
  returnTo: string | null;
  provider: string;
  errorCode: string;
}): string | null {
  return buildDeviceSyncCallbackRedirectLocation(input.returnTo, (destination) => {
    destination.searchParams.set("deviceSyncStatus", "error");
    destination.searchParams.set("deviceSyncProvider", input.provider);
    destination.searchParams.set("deviceSyncError", input.errorCode);
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
