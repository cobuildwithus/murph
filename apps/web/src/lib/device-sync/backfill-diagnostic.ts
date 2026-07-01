import "server-only";

import { deviceSyncError } from "@murphai/device-syncd/errors";
import type {
  DeviceSyncAccount,
  DeviceSyncProvider,
  DeviceSyncRestDiagnosticEndpoint,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/types";

import {
  createHostedDeviceSyncControlPlane,
  type HostedDeviceSyncControlPlane,
} from "./control-plane";
import {
  toHostedBrowserDeviceSyncConnectionSource,
  type HostedBrowserDeviceSyncConnectionSource,
} from "./browser-connection-source";
import {
  toHostedBrowserDeviceSyncConnection,
  type HostedBrowserDeviceSyncConnection,
} from "./public-connection";
import { createHostedDeviceSyncRegistry } from "./providers";
import { sha256Hex } from "./shared";

export interface HostedDeviceSyncBackfillRestProbe {
  endpoint: DeviceSyncRestDiagnosticEndpoint;
  resource: string | null;
  sourceProviderSlug: string | null;
  timeoutSeconds: number | null;
}

export interface HostedDeviceSyncBackfillDiagnosticInput {
  connectionId?: string | null;
  controlPlane: HostedDeviceSyncControlPlane;
  memberId: string;
  providerName?: string | null;
  restProbe?: HostedDeviceSyncBackfillRestProbe | null;
  timeseriesProbeDays?: number;
  windowEnd?: string | null;
  windowStart?: string | null;
}

export interface HostedDeviceSyncBackfillDiagnosticResponse {
  diagnostic: Record<string, unknown>;
  generatedAt: string;
  ok: true;
  provider: string;
  publicIngress: {
    baseUrl: string;
    externalReachability: PublicIngressReachability;
    providerAcceptsWebhooks: boolean;
    providerSupportsWebhookAdmin: boolean;
    source: string;
    webhookPath: string | null;
    webhookUrl: string | null;
  };
  restProbe?: {
    generatedAt: string;
    provider: string;
    result: Record<string, unknown>;
  };
  selectedConnection: {
    connectionMatchCount: number;
    externalAccountIdHash: string;
    lastErrorCode: string | null;
    lastSyncCompletedAt: string | null;
    lastSyncErrorAt: string | null;
    lastSyncStartedAt: string | null;
    lastWebhookAt: string | null;
    nextReconcileAt: string | null;
    provider: string;
    setupPhase: string | null;
    status: string;
  };
  webSourceProjection: Array<{
    firstSeenAt: string;
    lastSeenAt: string;
    resourceCount: number;
    sourceKey: string;
    status: string;
  }>;
}

export async function runHostedDeviceSyncBackfillDiagnostic(
  input: HostedDeviceSyncBackfillDiagnosticInput,
): Promise<HostedDeviceSyncBackfillDiagnosticResponse> {
  const providerName = input.providerName ?? "junction";
  if (providerName !== "junction") {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_PROVIDER_UNAVAILABLE",
      message: "Backfill diagnostics are currently available only for Junction connections.",
      httpStatus: 400,
      retryable: false,
    });
  }

  const connectionId = normalizeQueryString(input.connectionId ?? null);
  const connectionEntries = await listDiagnosticConnectionEntries({
    controlPlane: input.controlPlane,
    memberId: input.memberId,
  });
  const candidates = connectionEntries.filter((entry) =>
    entry.browserConnection.provider === providerName
    && (!connectionId || entry.browserConnection.id === connectionId)
  );
  const activeCandidates = candidates.filter((entry) =>
    entry.browserConnection.status === "active"
  );

  if (candidates.length === 0) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_CONNECTION_NOT_FOUND",
      message: "No matching device-sync connection was found for the requested member.",
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

  const selectedEntry = activeCandidates[0];
  const connection = selectedEntry.browserConnection;
  const connectionSources = selectedEntry.browserConnectionSources;
  const restProbeSourceProviderSlug = normalizeQueryString(input.restProbe?.sourceProviderSlug ?? null);
  if (
    restProbeSourceProviderSlug
    && !connectionSources.some((source) => source.sourceProviderSlug === restProbeSourceProviderSlug)
  ) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_SOURCE_PROVIDER_NOT_FOUND",
      message: "The selected device-sync connection does not expose the requested source provider for diagnostics.",
      httpStatus: 409,
      retryable: false,
    });
  }

  const provider = createHostedDeviceSyncRegistry(process.env).get(connection.provider);
  if (!provider) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_PROVIDER_UNAVAILABLE",
      message: "The selected device-sync provider is not available in this runtime.",
      httpStatus: 400,
      retryable: false,
    });
  }

  const durableAccount = selectedEntry.durableConnection;
  if (!durableAccount) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_DIAGNOSTIC_CONNECTION_UNRESOLVED",
      message: "The selected device-sync connection could not be resolved for diagnostics.",
      httpStatus: 409,
      retryable: true,
    });
  }

  const storedAccount =
    await input.controlPlane.store.getStoredConnectionAccountForUser(input.memberId, durableAccount.id);
  const diagnosticAccount = storedAccount
    ?? buildDiagnosticAccountFromDurableConnection(durableAccount, provider);
  const diagnoseBackfill = provider.diagnostics?.diagnoseBackfill;
  const probeRest = provider.diagnostics?.probeRest;

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

  if (input.restProbe && !probeRest) {
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
    timeseriesProbeDays: input.timeseriesProbeDays,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  });
  const restDiagnostic = input.restProbe && probeRest
    ? await probeRest({
        account: diagnosticAccount,
        endpoint: input.restProbe.endpoint,
        now,
        resource: input.restProbe.resource,
        sourceProviderSlug: restProbeSourceProviderSlug,
        timeoutSeconds: input.restProbe.timeoutSeconds,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
      })
    : null;

  return {
    generatedAt: diagnostic.generatedAt,
    ok: true,
    provider: diagnostic.provider,
    publicIngress: describeDiagnosticPublicIngress(input.controlPlane, provider),
    selectedConnection: {
      connectionMatchCount: candidates.length,
      externalAccountIdHash: sha256Hex(diagnosticAccount.externalAccountId),
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
    webSourceProjection: describeDiagnosticWebSourceProjection(connectionSources),
    diagnostic: redactDiagnosticProviderIdentifiers(diagnostic.result),
    ...(restDiagnostic
      ? {
          restProbe: {
            generatedAt: restDiagnostic.generatedAt,
            provider: restDiagnostic.provider,
            result: redactDiagnosticProviderIdentifiers(restDiagnostic.result),
          },
        }
      : {}),
  };
}

export function assertDeviceSyncDiagnosticRouteEnabled(request: Request): void {
  const url = new URL(request.url);
  const host = normalizeDiagnosticHostname(url.hostname);
  const explicitlyEnabled = process.env.DEVICE_SYNC_BACKFILL_DIAGNOSTIC_ENABLED === "true";
  const allowLocalBypass =
    process.env.NODE_ENV !== "production" && isLoopbackHostname(host);

  if (explicitlyEnabled || allowLocalBypass) {
    return;
  }

  throw deviceSyncError({
    code: "DEVICE_SYNC_DIAGNOSTIC_ROUTE_DISABLED",
    message: "Device-sync backfill diagnostics are not enabled for this runtime.",
    httpStatus: 404,
    retryable: false,
  });
}

export function normalizeQueryString(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function readTimeseriesProbeDays(value: string | null): number | undefined {
  const normalized = normalizeQueryString(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function readRestProbe(searchParams: URLSearchParams): HostedDeviceSyncBackfillRestProbe | null {
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
    && endpoint !== "devices"
    && endpoint !== "providers"
    && endpoint !== "introspect_resources"
    && endpoint !== "historical_pull"
    && endpoint !== "matrix"
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
    || normalized === "device"
    || normalized === "devices"
    || normalized === "historical_pull"
    || normalized === "historical-pull"
    || normalized === "history"
    || normalized === "introspect_resources"
    || normalized === "introspect-resources"
    || normalized === "matrix"
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
    if (normalized === "device") {
      return "devices";
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
    message: "REST diagnostics require restProbe to be providers, devices, matrix, summary, timeseries, resources, historical_pull, refresh, or auto.",
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

interface DiagnosticWebSourceProjectionInput {
  firstSeenAt: string;
  lastSeenAt: string;
  resourceCount: number;
  sourceProviderSlug: string;
  status: string;
}

function describeDiagnosticWebSourceProjection(
  sources: readonly DiagnosticWebSourceProjectionInput[],
): Array<{
  firstSeenAt: string;
  lastSeenAt: string;
  resourceCount: number;
  sourceKey: string;
  status: string;
}> {
  const sourceKeys = new Map(
    [...new Set(sources.map((source) => source.sourceProviderSlug))]
      .sort((left, right) => left.localeCompare(right))
      .map((slug, index) => [slug, formatDiagnosticSourceKey(index)] as const),
  );

  return sources.map((source) => ({
    firstSeenAt: source.firstSeenAt,
    lastSeenAt: source.lastSeenAt,
    resourceCount: source.resourceCount,
    sourceKey: sourceKeys.get(source.sourceProviderSlug) ?? "source_unknown",
    status: source.status,
  }));
}

async function listDiagnosticConnectionEntries(input: {
  controlPlane: HostedDeviceSyncControlPlane;
  memberId: string;
}): Promise<Array<{
  browserConnection: HostedBrowserDeviceSyncConnection;
  browserConnectionSources: HostedBrowserDeviceSyncConnectionSource[];
  durableConnection: PublicDeviceSyncAccount;
}>> {
  const durableConnections = await input.controlPlane.store.listConnectionsForUser(input.memberId);

  return Promise.all(
    durableConnections.map(async (durableConnection) => {
      const browserConnection = toHostedBrowserDeviceSyncConnection(
        durableConnection,
        input.controlPlane.env.routingIndexKey,
      );
      const sources = await input.controlPlane.store.listConnectionSources(durableConnection.id);

      return {
        browserConnection,
        browserConnectionSources: sources.map((source) =>
          toHostedBrowserDeviceSyncConnectionSource(source, browserConnection.id)
        ),
        durableConnection,
      };
    }),
  );
}

function redactDiagnosticProviderIdentifiers(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactDiagnosticValue(value, new Map());
  return isDiagnosticRecord(redacted) ? redacted : {};
}

function redactDiagnosticValue(value: unknown, sourceKeys: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticValue(entry, sourceKeys));
  }

  if (!isDiagnosticRecord(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "sourceProviderSlug") {
      const sourceSlug = normalizeQueryString(typeof entry === "string" ? entry : null);
      redacted.sourceKey = sourceSlug ? readDiagnosticSourceKey(sourceKeys, sourceSlug) : null;
      continue;
    }

    if (key === "sourceProviderSlugs" && Array.isArray(entry)) {
      const slugs = entry
        .map((candidate) => normalizeQueryString(typeof candidate === "string" ? candidate : null))
        .filter((candidate): candidate is string => Boolean(candidate));
      redacted.sourceCount = slugs.length;
      redacted.sourceKeys = slugs.map((slug) => readDiagnosticSourceKey(sourceKeys, slug));
      continue;
    }

    if (key === "resourceCountsBySourceProvider" && isDiagnosticRecord(entry)) {
      redacted.resourceCountsBySource = Object.entries(entry).map(([sourceSlug, count]) => ({
        resourceCount: count,
        sourceKey: readDiagnosticSourceKey(sourceKeys, sourceSlug),
      }));
      continue;
    }

    if (key === "availableResourcesBySourceProvider" && isDiagnosticRecord(entry)) {
      redacted.availableResourcesBySource = Object.entries(entry).map(([sourceSlug, resources]) => ({
        resources,
        sourceKey: readDiagnosticSourceKey(sourceKeys, sourceSlug),
      }));
      continue;
    }

    if (isDiagnosticSourceListKey(key) && Array.isArray(entry)) {
      redacted[key] = entry
        .map((candidate) => redactDiagnosticSourcePath(candidate, sourceKeys))
        .filter((candidate): candidate is string => Boolean(candidate));
      continue;
    }

    redacted[key] = redactDiagnosticValue(entry, sourceKeys);
  }

  return redacted;
}

function isDiagnosticSourceListKey(key: string): boolean {
  return key === "failedSources"
    || key === "inProgressSources"
    || key === "refreshedSources";
}

function redactDiagnosticSourcePath(value: unknown, sourceKeys: Map<string, string>): string | null {
  const normalized = normalizeQueryString(typeof value === "string" ? value : null);
  if (!normalized) {
    return null;
  }

  const [sourceSlug, ...rest] = normalized.split(".");
  const sourceKey = readDiagnosticSourceKey(sourceKeys, sourceSlug ?? "source");
  return rest.length > 0 ? `${sourceKey}.${rest.join(".")}` : sourceKey;
}

function readDiagnosticSourceKey(sourceKeys: Map<string, string>, sourceSlug: string): string {
  const existing = sourceKeys.get(sourceSlug);
  if (existing) {
    return existing;
  }

  const sourceKey = formatDiagnosticSourceKey(sourceKeys.size);
  sourceKeys.set(sourceSlug, sourceKey);
  return sourceKey;
}

function formatDiagnosticSourceKey(index: number): string {
  return `source_${index + 1}`;
}

function isDiagnosticRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PublicIngressReachability =
  | "invalid"
  | "loopback"
  | "private_network"
  | "public_http"
  | "public_https";

function describeDiagnosticPublicIngress(
  controlPlane: HostedDeviceSyncControlPlane,
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

export function createHostedDeviceSyncDiagnosticControlPlane(request: Request): HostedDeviceSyncControlPlane {
  return createHostedDeviceSyncControlPlane(request);
}
