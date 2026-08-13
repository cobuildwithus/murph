import { DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS } from "@murphai/device-syncd/callback-redirect";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { formatHostedDeviceSyncProviderLabel } from "@/src/lib/device-sync/settings-surface";

import type {
  ConnectCallbackInput,
  ConnectCallbackNotice,
  ConnectSource,
  InitialDeviceConnectIntent,
} from "./connect-page-types";

interface HostedDeviceSyncConnectResponse {
  authorizationUrl: string;
}

const DEVICE_CONNECT_INTENT_CLAIM_PATTERN = /^dc_[A-Za-z0-9_-]{32}$/u;

export function filterConnectSourcesForSearch(
  sources: readonly ConnectSource[],
  search: string,
): ConnectSource[] {
  const normalizedSearch = search.trim().toLowerCase();

  if (normalizedSearch.length === 0) {
    return [...sources];
  }

  return sources.filter((source) =>
    [source.id, source.name, source.description]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch),
  );
}

export function isHostedDeviceConnectIntentUnavailableError(
  error: unknown,
): error is HostedOnboardingApiError {
  const code = readHostedOnboardingErrorCode(error);
  return code?.startsWith("HOSTED_DEVICE_CONNECT_INTENT_") === true;
}

export function isHostedWhoopDirectConnectCapReachedError(error: unknown): boolean {
  return readHostedOnboardingErrorCode(error) === "WHOOP_DIRECT_CONNECT_CAP_REACHED";
}

export function resolveCallbackSourceId(
  input: ConnectCallbackInput,
  sources: readonly ConnectSource[],
): string | null {
  if (!input) {
    return null;
  }

  return findCallbackSource({
    connectSource: input.connectSource,
    connectTarget: input.connectTarget,
    provider: input.provider,
    sources,
  })?.id ?? null;
}

export function markCallbackConnectedSource(
  sources: readonly ConnectSource[],
  sourceId: string | null,
): readonly ConnectSource[] {
  if (!sourceId) {
    return sources;
  }

  return sources.map((source) => source.id === sourceId ? { ...source, connected: true } : source);
}

export function markLocallyDisconnectedSources(
  sources: readonly ConnectSource[],
  disconnectedConnectionIds: ReadonlySet<string>,
  disconnectedSourceIds: ReadonlySet<string> = new Set(),
): readonly ConnectSource[] {
  if (disconnectedConnectionIds.size === 0 && disconnectedSourceIds.size === 0) {
    return sources;
  }

  return sources.map((source) => {
    const connectionId = source.disconnectConnectionId;
    if (
      !disconnectedSourceIds.has(source.id)
      && (!connectionId || !disconnectedConnectionIds.has(connectionId))
    ) {
      return source;
    }

    const {
      connected,
      connectProvider,
      disconnectConnectionId,
      disconnectScope,
      disconnectSourceProviderSlug,
      recoveryKind,
      requiresReconnect,
      ...locallyDisconnectedSource
    } = source;
    void connected;
    void connectProvider;
    void disconnectConnectionId;
    void disconnectScope;
    void disconnectSourceProviderSlug;
    void recoveryKind;
    void requiresReconnect;

    return {
      ...locallyDisconnectedSource,
    };
  });
}

export function createConnectCallbackNotice(
  input: ConnectCallbackInput,
  sources: readonly ConnectSource[],
): ConnectCallbackNotice {
  if (!input) {
    return null;
  }

  const sourceLabel = resolveCallbackSourceLabel({
    connectSource: input.connectSource,
    connectTarget: input.connectTarget,
    provider: input.provider,
    sources,
  });

  if (input.status === "connected") {
    return {
      kind: "success",
      title: "Device connected",
      message: `Connected ${sourceLabel}.`,
    };
  }

  // Error callbacks are taken straight from query params, so only a catalog
  // source and a recognizable code shape may reach the prefilled support mail.
  // Anything else is unverified text and is dropped rather than quoted back.
  const catalogSource = findCallbackSource({
    connectSource: input.connectSource,
    connectTarget: input.connectTarget,
    provider: input.provider,
    sources,
  });

  return {
    errorCode: normalizeConnectCallbackErrorReference(input.errorCode),
    kind: "error",
    sourceLabel: catalogSource?.name ?? null,
    title: "Unable to finish connection",
    message: describeDeviceSyncCallbackError(sourceLabel, input.errorCode),
  };
}

const CONNECT_CALLBACK_ERROR_REFERENCE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/u;

function normalizeConnectCallbackErrorReference(errorCode: string | null): string | null {
  return errorCode && CONNECT_CALLBACK_ERROR_REFERENCE_PATTERN.test(errorCode)
    ? errorCode
    : null;
}

export function stripConnectCallbackParams() {
  if (typeof window === "undefined" || typeof window.location.href !== "string") {
    return;
  }

  const url = new URL(window.location.href);

  for (const key of DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS) {
    url.searchParams.delete(key);
  }
  url.searchParams.delete("connectSource");
  url.searchParams.delete("connectTarget");
  window.history?.replaceState?.({}, "", url.toString());
}

export function stripDeviceConnectIntentParams() {
  if (typeof window === "undefined" || typeof window.location.href !== "string") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("deviceConnectIntent");
  url.searchParams.delete("connectProvider");
  url.searchParams.delete("connectSource");
  const hashParams = readDeviceConnectIntentHashParams(url.hash);
  if (hashParams) {
    hashParams.delete("deviceConnectIntent");
    hashParams.delete("connectProvider");
    hashParams.delete("connectSource");
    url.hash = hashParams.toString();
  }
  window.history?.replaceState?.({}, "", url.toString());
}

export async function requestConnectionAuthorizationUrl(
  source: ConnectSource,
  options: { intentClaim?: string } = {},
): Promise<string> {
  const selectorPayload = options.intentClaim ? undefined : buildConnectTargetSelectorPayload(source);
  const result = await requestHostedOnboardingJson<HostedDeviceSyncConnectResponse>({
    ...(options.intentClaim
      ? {
          headers: {
            accept: "application/json",
          },
        }
      : {}),
    method: "POST",
    ...(selectorPayload ? { payload: selectorPayload } : {}),
    url: options.intentClaim
      ? `/device/connect/${encodeURIComponent(options.intentClaim)}`
      : `/api/connect-sources/${encodeURIComponent(source.id)}/start`,
  });

  return readConnectAuthorizationUrl(result);
}

export function readDeviceConnectIntentFromCurrentLocation(): InitialDeviceConnectIntent {
  if (typeof window === "undefined") {
    return null;
  }

  const hashParams = readDeviceConnectIntentHashParams(window.location.hash);
  return hashParams ? readDeviceConnectIntentParams(hashParams) : null;
}

export function resolveInitialConnectIntentPresentation(
  input: InitialDeviceConnectIntent,
  sources: readonly ConnectSource[],
): { actionError: { message: string; sourceId: string } | null; notice: ConnectCallbackNotice } | null {
  if (!input?.claim) {
    return null;
  }

  const source = findInitialConnectIntentSource(input, sources);
  if (!source) {
    return {
      actionError: null,
      notice: {
        kind: "error",
        title: "Unable to start connection",
        message: "This connection link does not match an available source.",
      },
    };
  }

  if (source.connected && !source.requiresReconnect) {
    return {
      actionError: null,
      notice: {
        kind: "success",
        title: "Device already connected",
        message: `${source.name} is already connected.`,
      },
    };
  }

  return null;
}

export function resolveConnectIntentRedirectSource(
  intent: InitialDeviceConnectIntent,
  sources: readonly ConnectSource[],
  authenticated: boolean,
): ConnectSource | null {
  if (!authenticated || !intent?.claim) {
    return null;
  }

  const source = resolveConnectIntentStartSource(intent, sources);
  return source?.memberOwnedSetupProvider ? null : source;
}

export function resolveMemberOwnedConnectIntentSource(
  intent: InitialDeviceConnectIntent,
  sources: readonly ConnectSource[],
  authenticated: boolean,
): ConnectSource | null {
  if (!authenticated || !intent?.claim) {
    return null;
  }

  const source = resolveConnectIntentStartSource(intent, sources);
  return source?.memberOwnedSetupProvider ? source : null;
}

export function resolveConnectIntentStartSource(
  intent: InitialDeviceConnectIntent,
  sources: readonly ConnectSource[],
): ConnectSource | null {
  const source = findInitialConnectIntentSource(intent, sources);
  // A connection-reset source must not auto-start a plain connect: the existing
  // connection has to be disconnected first.
  if (
    !source
    || (source.connected && !source.requiresReconnect)
    || source.recoveryKind === "connection_reset"
  ) {
    return null;
  }

  return source;
}

function readHostedOnboardingErrorCode(error: unknown): string | null {
  if (error instanceof HostedOnboardingApiError) {
    return error.code;
  }

  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  return typeof error.code === "string" ? error.code : null;
}

function describeDeviceSyncCallbackError(providerLabel: string, errorCode: string | null): string {
  switch (errorCode) {
    case "OAUTH_CALLBACK_REJECTED":
      return `${providerLabel} was not connected this time. You can try again whenever you're ready.`;
    case "OAUTH_STATE_INVALID":
      return `${providerLabel} gave us an expired or invalid return from the last attempt. Start a fresh connection and try again.`;
    case "CALLBACK_PROOF_INVALID":
      return `That return link did not match the browser you started in, so nothing was connected. Start ${providerLabel} again from this page.`;
    case "CALLBACK_SESSION_REQUIRED":
      return `You were signed out before ${providerLabel} finished connecting. Log in, then start the connection again.`;
    default:
      return `We could not finish connecting ${providerLabel}. Try again when you're ready.`;
  }
}

function resolveCallbackSourceLabel(input: {
  connectSource: string | null;
  connectTarget: string | null;
  provider: string | null;
  sources: readonly ConnectSource[];
}): string {
  const source = findCallbackSource(input);

  if (source) {
    return source.name;
  }

  const providerLabel = formatHostedDeviceSyncProviderLabel(input.provider ?? "source");
  return providerLabel === "Wearable source" ? "your wearable source" : providerLabel;
}

function findCallbackSource(input: {
  connectSource: string | null;
  connectTarget: string | null;
  provider: string | null;
  sources: readonly ConnectSource[];
}): ConnectSource | null {
  const source = normalizeConnectSourceId(input.connectSource);
  const target = normalizeConnectKey(input.connectTarget);
  const provider = normalizeConnectKey(input.provider);

  return input.sources.find((candidate) => {
    const sourceTarget = normalizeConnectKey(candidate.connectTarget);
    const sourceId = normalizeConnectKey(candidate.id);
    const normalizedSourceId = normalizeConnectSourceId(candidate.id);

    return Boolean(
      (source && normalizedSourceId === source)
      || (target && (sourceTarget === target || sourceId === target))
      || (provider && (sourceTarget === provider || sourceId === provider)),
    );
  }) ?? null;
}

function readConnectAuthorizationUrl(response: HostedDeviceSyncConnectResponse): string {
  if (typeof response.authorizationUrl !== "string" || !response.authorizationUrl.trim()) {
    throw new Error("Connection could not be started.");
  }

  const url = new URL(response.authorizationUrl, window.location.origin);
  if (url.protocol !== "https:") {
    throw new Error("Connection could not be started.");
  }

  return response.authorizationUrl;
}

function buildConnectTargetSelectorPayload(source: ConnectSource): Record<string, string> | undefined {
  if (!source.connectProvider && !source.connectTarget) {
    return undefined;
  }

  return {
    ...(source.connectProvider ? { provider: source.connectProvider } : {}),
    ...(source.connectTarget ? { connectTarget: source.connectTarget } : {}),
  };
}

function readDeviceConnectIntentHashParams(hash: string | undefined): URLSearchParams | null {
  const fragment = typeof hash === "string" && hash.startsWith("#")
    ? hash.slice(1)
    : hash;

  if (!fragment) {
    return null;
  }

  const params = new URLSearchParams(fragment);
  return params.has("deviceConnectIntent") ? params : null;
}

function readDeviceConnectIntentParams(params: URLSearchParams): InitialDeviceConnectIntent {
  const claim = params.get("deviceConnectIntent");
  if (!claim || !DEVICE_CONNECT_INTENT_CLAIM_PATTERN.test(claim)) {
    return null;
  }

  const requestedSource = normalizeConnectSourceId(params.get("connectSource"));
  const connectProvider = normalizeConnectKey(params.get("connectProvider"));

  return {
    claim,
    ...(connectProvider ? { connectProvider } : {}),
    connectSource: requestedSource,
  };
}

function findInitialConnectIntentSource(
  input: InitialDeviceConnectIntent,
  sources: readonly ConnectSource[],
): ConnectSource | null {
  if (!input?.connectSource) {
    return null;
  }

  const sourceId = normalizeConnectSourceId(input.connectSource);
  if (!sourceId) {
    return null;
  }

  return sources.find((source) => normalizeConnectSourceId(source.id) === sourceId) ?? null;
}

function normalizeConnectKey(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

  return normalized || null;
}

function normalizeConnectSourceId(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized || null;
}
