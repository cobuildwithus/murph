import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { deviceSyncError } from "@murphai/device-syncd/public-ingress";
import type {
  DeviceSyncAccount,
  DeviceSyncProvider,
  DeviceSyncRestDiagnosticEndpoint,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/types";
import type { HostedBrowserDeviceSyncConnection } from "@/src/lib/device-sync/public-connection";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";

export const GET = withJsonError(async (request: Request) => {
  assertDeviceSyncDiagnosticRouteEnabled(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const url = new URL(request.url);
  const providerName = normalizeQueryString(url.searchParams.get("provider")) ?? "junction";
  if (providerName !== "junction") {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_PROVIDER_UNAVAILABLE",
      message: "Backfill diagnostics are currently available only for Junction connections.",
      httpStatus: 400,
      retryable: false,
    });
  }

  const connectionId = normalizeQueryString(url.searchParams.get("connectionId"));
  const timeseriesProbeDays = readTimeseriesProbeDays(url.searchParams.get("timeseriesDays"));
  const windowStart = normalizeQueryString(url.searchParams.get("windowStart"));
  const windowEnd = normalizeQueryString(url.searchParams.get("windowEnd"));
  const restProbe = readRestProbe(url.searchParams);
  const settings = await controlPlane.listConnections(auth.member.id);
  const candidates = settings.connections.filter((connection) =>
    connection.provider === providerName
    && (!connectionId || connection.id === connectionId)
  );
  const activeCandidates = candidates.filter((entry) => entry.status === "active");

  if (candidates.length === 0) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_CONNECTION_NOT_FOUND",
      message: "No matching device-sync connection was found for the signed-in member.",
      httpStatus: 404,
      retryable: false,
    });
  }

  if (activeCandidates.length === 0) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_CONNECTION_NOT_ACTIVE",
      message: "Backfill diagnostics require an active device-sync connection.",
      httpStatus: 409,
      retryable: false,
    });
  }

  if (!connectionId && activeCandidates.length > 1) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_CONNECTION_AMBIGUOUS",
      message: "Backfill diagnostics require a connection id when multiple active connections match.",
      httpStatus: 409,
      retryable: false,
    });
  }

  const connection = activeCandidates[0];
  const provider = controlPlane.registry.get(connection.provider);
  if (!provider) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_PROVIDER_UNAVAILABLE",
      message: "The selected device-sync provider is not available in this runtime.",
      httpStatus: 400,
      retryable: false,
    });
  }

  const durableAccount = await resolveDurableConnectionForBrowserConnection({
    browserConnection: connection,
    controlPlane,
    userId: auth.member.id,
  });
  if (!durableAccount) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_CONNECTION_UNRESOLVED",
      message: "The selected device-sync connection could not be resolved for local diagnostics.",
      httpStatus: 409,
      retryable: true,
    });
  }

  const storedAccount =
    await controlPlane.store.getStoredConnectionAccountForUser(auth.member.id, durableAccount.id);
  const diagnosticAccount = storedAccount
    ?? buildDiagnosticAccountFromDurableConnection(durableAccount, provider);
  const diagnoseBackfill = provider?.diagnostics?.diagnoseBackfill;
  const probeRest = provider?.diagnostics?.probeRest;

  if (!diagnosticAccount) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_ACCOUNT_UNAVAILABLE",
      message: "The selected device-sync connection is missing local diagnostic account material.",
      httpStatus: 409,
      retryable: true,
    });
  }

  if (!diagnoseBackfill) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_UNAVAILABLE",
      message: "This device-sync provider does not expose a backfill diagnostic.",
      httpStatus: 400,
      retryable: false,
    });
  }

  if (restProbe && !probeRest) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_REST_DIAGNOSTIC_UNAVAILABLE",
      message: "This device-sync provider does not expose a REST diagnostic probe.",
      httpStatus: 400,
      retryable: false,
    });
  }

  const now = new Date().toISOString();
  const diagnostic = await diagnoseBackfill({
    account: diagnosticAccount,
    now,
    timeseriesProbeDays,
    windowStart,
    windowEnd,
  });
  const restDiagnostic = restProbe && probeRest
    ? await probeRest({
        account: diagnosticAccount,
        endpoint: restProbe.endpoint,
        now,
        resource: restProbe.resource,
        sourceProviderSlug: restProbe.sourceProviderSlug,
        timeoutSeconds: restProbe.timeoutSeconds,
        windowStart,
        windowEnd,
      })
    : null;

  return jsonOk({
    generatedAt: diagnostic.generatedAt,
    ok: true,
    provider: diagnostic.provider,
    publicIngress: describeDiagnosticPublicIngress(controlPlane, provider),
    selectedConnection: {
      connectionMatchCount: candidates.length,
      lastErrorCode: connection.lastErrorCode ?? null,
      lastSyncCompletedAt: connection.lastSyncCompletedAt ?? null,
      lastSyncErrorAt: connection.lastSyncErrorAt ?? null,
      lastSyncStartedAt: connection.lastSyncStartedAt ?? null,
      lastWebhookAt: connection.lastWebhookAt ?? null,
      nextReconcileAt: connection.nextReconcileAt ?? null,
      provider: connection.provider,
      setupPhase: connection.setupPhase ?? null,
      status: connection.status,
    },
    webSourceProjection: settings.connectionSources
      .filter((source) => source.connectionId === connection.id)
      .map((source) => ({
        firstSeenAt: source.firstSeenAt,
        lastSeenAt: source.lastSeenAt,
        resourceCount: source.resourceCount,
        sourceProviderSlug: source.sourceProviderSlug,
        status: source.status,
      })),
    diagnostic: diagnostic.result,
    ...(restDiagnostic
      ? {
          restProbe: {
            generatedAt: restDiagnostic.generatedAt,
            provider: restDiagnostic.provider,
            result: restDiagnostic.result,
          },
        }
      : {}),
  });
});

function assertDeviceSyncDiagnosticRouteEnabled(request: Request): void {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const explicitlyEnabled = process.env.DEVICE_SYNC_BACKFILL_DIAGNOSTIC_ENABLED === "true";

  if (explicitlyEnabled || host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return;
  }

  throw deviceSyncError({
    code: "DEVICE_SYNC_DIAGNOSTIC_ROUTE_DISABLED",
    message: "Device-sync backfill diagnostics are not enabled for this runtime.",
    httpStatus: 404,
    retryable: false,
  });
}

function normalizeQueryString(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readTimeseriesProbeDays(value: string | null): number | undefined {
  const normalized = normalizeQueryString(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function readRestProbe(
  searchParams: URLSearchParams,
): {
  endpoint: DeviceSyncRestDiagnosticEndpoint;
  resource: string | null;
  sourceProviderSlug: string | null;
  timeoutSeconds: number | null;
} | null {
  const requestedProbe =
    normalizeQueryString(searchParams.get("restProbe"))
    ?? normalizeQueryString(searchParams.get("junctionRestProbe"));

  if (!requestedProbe) {
    return null;
  }

  const endpoint = normalizeRestProbeEndpoint(requestedProbe);
  const resource = normalizeQueryString(searchParams.get("resource"));
  const sourceProviderSlug =
    normalizeQueryString(searchParams.get("sourceProvider"))
    ?? normalizeQueryString(searchParams.get("sourceProviderSlug"))
    ?? normalizeQueryString(searchParams.get("source"));
  const timeoutSeconds = readRestProbeTimeoutSeconds(
    searchParams.get("timeoutSeconds") ?? searchParams.get("timeout"),
  );

  if (
    endpoint !== "auto"
    && endpoint !== "providers"
    && endpoint !== "introspect_resources"
    && endpoint !== "historical_pull"
    && endpoint !== "refresh"
    && !resource
  ) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_REST_DIAGNOSTIC_RESOURCE_REQUIRED",
      message: "REST diagnostics require a resource for summary or timeseries probes.",
      httpStatus: 400,
      retryable: false,
    });
  }

  return {
    endpoint,
    resource,
    sourceProviderSlug,
    timeoutSeconds,
  };
}

function normalizeRestProbeEndpoint(value: string): DeviceSyncRestDiagnosticEndpoint {
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return "auto";
  }

  if (
    normalized === "auto"
    || normalized === "historical_pull"
    || normalized === "historical-pull"
    || normalized === "history"
    || normalized === "introspect_resources"
    || normalized === "introspect-resources"
    || normalized === "providers"
    || normalized === "refresh"
    || normalized === "refresh_user_data"
    || normalized === "refresh-user-data"
    || normalized === "resources"
    || normalized === "summary"
    || normalized === "timeseries"
    || normalized === "user_refresh"
    || normalized === "user-refresh"
  ) {
    if (normalized === "historical-pull" || normalized === "history") {
      return "historical_pull";
    }
    if (normalized === "introspect-resources" || normalized === "resources") {
      return "introspect_resources";
    }
    if (
      normalized === "refresh_user_data"
      || normalized === "refresh-user-data"
      || normalized === "user_refresh"
      || normalized === "user-refresh"
    ) {
      return "refresh";
    }
    return normalized as DeviceSyncRestDiagnosticEndpoint;
  }

  throw deviceSyncError({
    code: "DEVICE_SYNC_REST_DIAGNOSTIC_ENDPOINT_INVALID",
    message: "REST diagnostics require restProbe to be providers, summary, timeseries, resources, historical_pull, refresh, or auto.",
    httpStatus: 400,
    retryable: false,
  });
}

function readRestProbeTimeoutSeconds(value: string | null): number | null {
  const normalized = normalizeQueryString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? Math.max(5, Math.min(60, parsed)) : null;
}

type PublicIngressReachability =
  | "invalid"
  | "loopback"
  | "private_network"
  | "public_http"
  | "public_https";

function describeDiagnosticPublicIngress(
  controlPlane: ReturnType<typeof createHostedDeviceSyncControlPlane>,
  provider: DeviceSyncProvider,
): {
  baseUrl: string;
  externalReachability: PublicIngressReachability;
  providerAcceptsWebhooks: boolean;
  providerSupportsWebhookAdmin: boolean;
  source: string;
  webhookPath: string | null;
  webhookUrl: string | null;
} {
  const webhookPath = provider.descriptor.webhook?.path ?? null;

  return {
    baseUrl: controlPlane.publicIngressBaseUrl,
    externalReachability: classifyPublicIngressReachability(controlPlane.publicIngressBaseUrl),
    providerAcceptsWebhooks: Boolean(webhookPath),
    providerSupportsWebhookAdmin: Boolean(provider.descriptor.webhook?.supportsAdmin),
    source: controlPlane.publicIngressBaseUrlSource,
    webhookPath,
    webhookUrl: buildDiagnosticWebhookUrl(controlPlane.publicIngressBaseUrl, webhookPath),
  };
}

function buildDiagnosticWebhookUrl(baseUrl: string, webhookPath: string | null): string | null {
  if (!webhookPath) {
    return null;
  }

  try {
    const normalizedBase = baseUrl.replace(/\/+$/u, "");
    const normalizedPath = webhookPath.replace(/^\/+/u, "");
    return new URL(`${normalizedBase}/${normalizedPath}`).toString();
  } catch {
    return null;
  }
}

function classifyPublicIngressReachability(baseUrl: string): PublicIngressReachability {
  try {
    const url = new URL(baseUrl);
    const hostname = normalizeDiagnosticHostname(url.hostname);

    if (isLoopbackHostname(hostname)) {
      return "loopback";
    }

    if (isPrivateNetworkHostname(hostname)) {
      return "private_network";
    }

    if (url.protocol === "https:") {
      return "public_https";
    }

    if (url.protocol === "http:") {
      return "public_http";
    }

    return "invalid";
  } catch {
    return "invalid";
  }
}

function normalizeDiagnosticHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.startsWith("127.");
}

function isPrivateNetworkHostname(hostname: string): boolean {
  if (hostname.endsWith(".local")) {
    return true;
  }

  const octets = hostname.split(".");
  if (octets.length !== 4) {
    return false;
  }

  if (octets.some((octet) => !/^\d+$/u.test(octet))) {
    return false;
  }

  const numbers = octets.map((octet) => Number.parseInt(octet, 10));
  if (numbers.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = numbers;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

async function resolveDurableConnectionForBrowserConnection(input: {
  browserConnection: HostedBrowserDeviceSyncConnection;
  controlPlane: ReturnType<typeof createHostedDeviceSyncControlPlane>;
  userId: string;
}): Promise<PublicDeviceSyncAccount | null> {
  const durableConnections = await input.controlPlane.store.listConnectionsForUser(input.userId);

  return durableConnections.find((candidate) =>
    candidate.provider === input.browserConnection.provider
    && input.controlPlane.connections.createBrowserConnectionId(candidate.id)
      === input.browserConnection.id
  ) ?? null;
}

function buildDiagnosticAccountFromDurableConnection(
  account: PublicDeviceSyncAccount | null,
  provider: DeviceSyncProvider | undefined,
): DeviceSyncAccount | null {
  if (!account || !provider) {
    return null;
  }

  const credentialPolicy = provider.credentialPolicy;
  if (credentialPolicy?.kind !== "provider_config") {
    return null;
  }

  return {
    ...account,
    credential: {
      kind: "provider_config",
      credentialMetadata: {},
      providerConfigKey: credentialPolicy.providerConfigKey,
    },
    disconnectGeneration: 0,
  };
}
