"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { LoaderCircleIcon } from "lucide-react";

import { DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS } from "@murphai/device-syncd/callback-redirect";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import {
  describeDeviceSyncCallbackError,
} from "@/src/components/settings/hosted-device-sync-settings-utils";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { AuthButton } from "@/src/components/ui/auth-button";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { formatHostedDeviceSyncProviderLabel } from "@/src/lib/device-sync/settings-surface";

import { sortConnectSourcesByConnectionState } from "./connect-source-order";

type LogoAsset = {
  className: string;
  height: number;
  src: string;
  width: number;
};

type ConnectSource = {
  connectProvider?: string;
  connectTarget?: string;
  connected?: boolean;
  description: string;
  disconnectConnectionId?: string;
  id: string;
  logo: LogoAsset;
  name: string;
  requiresReconnect?: boolean;
};

type ConnectPageInitialLoadError = {
  message: string;
};

interface HostedDeviceSyncConnectResponse {
  authorizationUrl: string;
}

interface HostedDeviceSyncDisconnectResponse {
  warning?: { code: string; message: string };
}

export type ConnectCallbackInput = {
  connectTarget: string | null;
  connectSource: string | null;
  errorCode: string | null;
  provider: string | null;
  status: "connected" | "error";
} | null;

export type InitialDeviceConnectIntent = {
  claim: string;
  connectSource: string | null;
} | null;

const DEVICE_CONNECT_INTENT_CLAIM_PATTERN = /^dc_[A-Za-z0-9_-]{32}$/u;

type ConnectConsentRequest = {
  intentClaim?: string;
  source: ConnectSource;
};

type ConnectCallbackNotice = {
  kind: "error" | "success" | "warning";
  message: string;
  title: string;
} | null;

export function ConnectSourcesGrid({
  authenticated = true,
  initialCallback = null,
  initialConnectIntent = null,
  initialLoadError = null,
  sources,
}: {
  authenticated?: boolean;
  initialCallback?: ConnectCallbackInput;
  initialConnectIntent?: InitialDeviceConnectIntent;
  initialLoadError?: ConnectPageInitialLoadError | null;
  sources: readonly ConnectSource[];
}) {
  const [notice, setNotice] = useState<ConnectCallbackNotice>(() =>
    createConnectCallbackNotice(initialCallback, sources),
  );
  const [search, setSearch] = useState("");
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [pendingDisconnectSourceId, setPendingDisconnectSourceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    message: string;
    sourceId: string;
  } | null>(null);
  const [consentRequest, setConsentRequest] = useState<ConnectConsentRequest | null>(null);
  const [disconnectSource, setDisconnectSource] = useState<ConnectSource | null>(null);
  const [disconnectedConnectionIds, setDisconnectedConnectionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [locationConnectIntent] = useState<InitialDeviceConnectIntent>(() => (
    initialConnectIntent ? null : readDeviceConnectIntentFromCurrentLocation()
  ));
  const [initialConnectIntentDismissed, setInitialConnectIntentDismissed] = useState(false);
  const initialConnectIntentAuthOpenedRef = useRef(false);
  const initialConnectIntentAttemptedRef = useRef(false);
  const { openAuthDialog } = useAuth();
  const callbackConnectedSourceId = initialCallback?.status === "connected"
    ? resolveCallbackSourceId(initialCallback, sources)
    : null;
  const displaySources = useMemo(
    () => sortConnectSourcesByConnectionState(
      markLocallyDisconnectedSources(
        markCallbackConnectedSource(sources, callbackConnectedSourceId),
        disconnectedConnectionIds,
      ),
    ),
    [callbackConnectedSourceId, disconnectedConnectionIds, sources],
  );
  const filteredSources = useMemo(
    () => filterConnectSourcesForSearch(displaySources, search),
    [displaySources, search],
  );
  const hasInitialCallback = Boolean(initialCallback);
  const activeConnectIntent = initialConnectIntent ?? locationConnectIntent;
  const initialConnectIntentPresentation = useMemo(
    () => initialConnectIntentDismissed || !authenticated
      ? null
      : resolveInitialConnectIntentPresentation(activeConnectIntent, displaySources),
    [activeConnectIntent, authenticated, displaySources, initialConnectIntentDismissed],
  );
  const visibleNotice = notice ?? initialConnectIntentPresentation?.notice ?? null;
  const visibleActionError = actionError ?? initialConnectIntentPresentation?.actionError ?? null;
  // When this load carries a connect intent that the effect below will auto-redirect, show a
  // pending-redirect dialog. Seeded on mount and cleared only if that redirect attempt fails.
  const [connectIntentRedirectName, setConnectIntentRedirectName] = useState<string | null>(
    () => resolveConnectIntentRedirectSource(activeConnectIntent, displaySources, authenticated)?.name
      ?? null,
  );

  useEffect(() => {
    if (hasInitialCallback) {
      stripConnectCallbackParams();
    }
  }, [hasInitialCallback]);

  useEffect(() => {
    if (
      authenticated
      || initialConnectIntentAuthOpenedRef.current
      || !activeConnectIntent?.claim
    ) {
      return;
    }

    const source = resolveConnectIntentStartSource(activeConnectIntent, displaySources);
    if (!source) {
      return;
    }

    initialConnectIntentAuthOpenedRef.current = true;
    openAuthDialog();
  }, [activeConnectIntent, authenticated, displaySources, openAuthDialog]);

  const startConnection = useCallback(async (
    source: ConnectSource,
    options: { intentClaim?: string } = {},
  ) => {
    if (!authenticated || (!options.intentClaim && !source.connectTarget)) {
      return;
    }

    setInitialConnectIntentDismissed(true);
    setPendingSourceId(source.id);
    setActionError(null);
    setNotice(null);
    setConsentRequest(null);

    try {
      const authorizationUrl = await requestConnectionAuthorizationUrl(source, options);
      window.location.assign(authorizationUrl);
    } catch (error) {
      if (isHostedConsentRequiredError(error)) {
        setConsentRequest({
          ...(options.intentClaim ? { intentClaim: options.intentClaim } : {}),
          source,
        });
        setPendingSourceId(null);
        return;
      }

      const message = error instanceof Error ? error.message : "Connection could not be started.";
      setActionError({
        message,
        sourceId: source.id,
      });
      setPendingSourceId(null);
    }
  }, [authenticated]);

  useEffect(() => {
    if (
      initialConnectIntentAttemptedRef.current
      || !authenticated
      || !activeConnectIntent?.claim
    ) {
      return;
    }

    initialConnectIntentAttemptedRef.current = true;
    stripDeviceConnectIntentParams();

    const source = resolveConnectIntentRedirectSource(activeConnectIntent, displaySources, authenticated);
    if (!source) {
      return;
    }

    let cancelled = false;
    void requestConnectionAuthorizationUrl(source, { intentClaim: activeConnectIntent.claim })
      .then((authorizationUrl) => {
        if (cancelled) {
          return;
        }

        setInitialConnectIntentDismissed(true);
        window.location.assign(authorizationUrl);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setConnectIntentRedirectName(null);
        setInitialConnectIntentDismissed(true);
        if (isHostedConsentRequiredError(error)) {
          setConsentRequest({
            intentClaim: activeConnectIntent.claim,
            source,
          });
          return;
        }

        const message = error instanceof Error ? error.message : "Connection could not be started.";
        setActionError({
          message,
          sourceId: source.id,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeConnectIntent, authenticated, displaySources]);

  async function disconnectConnection(source: ConnectSource) {
    const connectionId = source.disconnectConnectionId?.trim();
    if (!connectionId || pendingDisconnectSourceId || pendingSourceId === source.id) {
      return;
    }

    setPendingDisconnectSourceId(source.id);
    setActionError(null);
    setNotice(null);

    try {
      const result = await requestHostedOnboardingJson<HostedDeviceSyncDisconnectResponse>({
        method: "POST",
        url: `/api/settings/device-sync/connections/${encodeURIComponent(connectionId)}/disconnect`,
      });
      setDisconnectSource(null);
      setDisconnectedConnectionIds((current) => new Set([...current, connectionId]));
      setNotice({
        kind: result.warning?.message ? "warning" : "success",
        title: "Source disconnected",
        message: result.warning?.message
          ? `Disconnected ${source.name}. Your history is still saved. The provider did not fully confirm, so check that account if you want access removed there too.`
          : `Disconnected ${source.name}. Your history is still saved.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `We could not disconnect ${source.name} right now.`;
      setActionError({
        message,
        sourceId: source.id,
      });
    } finally {
      setPendingDisconnectSourceId(null);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      {initialLoadError?.message ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load connected sources</AlertTitle>
          <AlertDescription>{initialLoadError.message}</AlertDescription>
        </Alert>
      ) : null}

      {visibleNotice ? (
        visibleNotice.kind === "success" ? (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
            <AlertTitle>{visibleNotice.title}</AlertTitle>
            <AlertDescription>{visibleNotice.message}</AlertDescription>
          </Alert>
        ) : visibleNotice.kind === "warning" ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTitle>{visibleNotice.title}</AlertTitle>
            <AlertDescription>{visibleNotice.message}</AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Unable to finish connection</AlertTitle>
            <AlertDescription>{visibleNotice.message}</AlertDescription>
          </Alert>
        )
      ) : null}

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Sources
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {filteredSources.length} of {displaySources.length} sources
          </p>
        </div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search sources"
          aria-label="Search sources"
          className="w-full sm:w-64"
        />
      </div>

      {filteredSources.length === 0 ? (
        <Alert>
          <AlertTitle>No sources matched</AlertTitle>
          <AlertDescription>
            Try a different search to get back to the full source list.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {filteredSources.map((source) => (
            <SourceCard
              key={source.id}
              authenticated={authenticated}
              errorMessage={visibleActionError?.sourceId === source.id ? visibleActionError.message : null}
              pending={pendingSourceId === source.id}
              pendingDisconnect={pendingDisconnectSourceId === source.id}
              source={source}
              onDisconnectTargetChange={setDisconnectSource}
              onStartConnection={startConnection}
            />
          ))}
        </div>
      )}

      <ConnectConsentDialog
        source={consentRequest?.source ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setConsentRequest(null);
          }
        }}
        onAccepted={async (source) => {
          await startConnection(source, {
            ...(consentRequest?.intentClaim
              ? { intentClaim: consentRequest.intentClaim }
              : {}),
          });
        }}
      />

      <ConnectDisconnectDialog
        errorMessage={disconnectSource && actionError?.sourceId === disconnectSource.id
          ? actionError.message
          : null}
        pending={Boolean(disconnectSource && pendingDisconnectSourceId === disconnectSource.id)}
        source={disconnectSource}
        onConfirm={disconnectConnection}
        onOpenChange={(open) => {
          if (!open && !pendingDisconnectSourceId) {
            setDisconnectSource(null);
          }
        }}
      />

      <ConnectRedirectDialog sourceName={connectIntentRedirectName} />

    </section>
  );
}

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

function SourceCard({
  authenticated,
  errorMessage,
  pending,
  pendingDisconnect,
  source,
  onDisconnectTargetChange,
  onStartConnection,
}: {
  authenticated: boolean;
  errorMessage: string | null;
  pending: boolean;
  pendingDisconnect: boolean;
  source: ConnectSource;
  onDisconnectTargetChange: (source: ConnectSource | null) => void;
  onStartConnection: (source: ConnectSource) => Promise<void>;
}) {
  const isAvailable = Boolean(source.connectTarget);
  const canStart = authenticated && isAvailable;
  const canDisconnect = authenticated && Boolean(source.disconnectConnectionId);
  const actionLabel = source.requiresReconnect ? "Reconnect" : "Connect";

  return (
    <div className="relative box-border flex min-w-0 w-full max-w-full flex-col justify-between overflow-hidden rounded-xl border border-border/50 bg-[rgba(255,252,246,0.9)] p-5">
      <div className="absolute top-4 right-4">
        <SourceStatusDot
          connected={source.connected}
          requiresReconnect={source.requiresReconnect}
          sourceName={source.name}
        />
      </div>

      <div className="mb-5 flex h-14 min-w-0 items-center">
        <SourceLogo source={source} />
      </div>

      <div className="mb-5 min-w-0">
        <h2 className="font-serif text-lg font-semibold text-foreground">
          {source.name}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {source.description}
        </p>
      </div>

      {source.connected && !source.requiresReconnect ? (
        <div className="mt-auto flex flex-col gap-2">
          {canDisconnect ? (
            <button
              type="button"
              aria-label={`Disconnect ${source.name}`}
              disabled={pendingDisconnect}
              onClick={() => onDisconnectTargetChange(source)}
              className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline self-start"
            >
              {pendingDisconnect ? "Disconnecting..." : "Disconnect"}
            </button>
          ) : null}
          {errorMessage ? (
            <p role="alert" className="text-xs leading-snug text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-auto flex flex-col items-start gap-2">
          {source.requiresReconnect ? (
            <p className="max-w-[22rem] text-sm leading-relaxed text-destructive">
              Please reconnect {source.name} to resume syncing.
            </p>
          ) : null}
          {!authenticated ? (
            <AuthButton aria-label={`Sign in to connect ${source.name}`}>
              Sign in
            </AuthButton>
          ) : (
            <Button
              type="button"
              disabled={!canStart || pending}
              aria-label={isAvailable
                ? `${actionLabel} ${source.name}`
                : `${source.name} connection is not available yet`}
              onClick={() => void onStartConnection(source)}
            >
              {pending ? "Opening..." : isAvailable ? actionLabel : "Not available"}
            </Button>
          )}
          {errorMessage ? (
            <p role="alert" className="text-xs leading-snug text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function readConnectAuthorizationUrl(response: HostedDeviceSyncConnectResponse): string {
  if (typeof response.authorizationUrl !== "string" || !response.authorizationUrl.trim()) {
    throw new Error("Connection could not be started.");
  }

  const url = new URL(response.authorizationUrl);
  if (url.protocol !== "https:") {
    throw new Error("Connection could not be started.");
  }

  return response.authorizationUrl;
}

function isHostedConsentRequiredError(error: unknown): boolean {
  return readHostedOnboardingErrorCode(error) === "HOSTED_CONSENT_REQUIRED";
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

function resolveCallbackSourceId(
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

function markCallbackConnectedSource(
  sources: readonly ConnectSource[],
  sourceId: string | null,
): readonly ConnectSource[] {
  if (!sourceId) {
    return sources;
  }

  return sources.map((source) => source.id === sourceId ? { ...source, connected: true } : source);
}

function markLocallyDisconnectedSources(
  sources: readonly ConnectSource[],
  disconnectedConnectionIds: ReadonlySet<string>,
): readonly ConnectSource[] {
  if (disconnectedConnectionIds.size === 0) {
    return sources;
  }

  return sources.map((source) => {
    const connectionId = source.disconnectConnectionId;
    if (!connectionId || !disconnectedConnectionIds.has(connectionId)) {
      return source;
    }

    return {
      description: source.description,
      id: source.id,
      logo: source.logo,
      name: source.name,
      ...(source.connectTarget ? { connectTarget: source.connectTarget } : {}),
    };
  });
}

function createConnectCallbackNotice(
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

  return {
    kind: "error",
    title: "Unable to finish connection",
    message: describeDeviceSyncCallbackError(sourceLabel, input.errorCode),
  };
}

function stripConnectCallbackParams() {
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

function stripDeviceConnectIntentParams() {
  if (typeof window === "undefined" || typeof window.location.href !== "string") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("deviceConnectIntent");
  url.searchParams.delete("connectSource");
  const hashParams = readDeviceConnectIntentHashParams(url.hash);
  if (hashParams) {
    hashParams.delete("deviceConnectIntent");
    hashParams.delete("connectSource");
    url.hash = hashParams.toString();
  }
  window.history?.replaceState?.({}, "", url.toString());
}

async function requestConnectionAuthorizationUrl(
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

function buildConnectTargetSelectorPayload(source: ConnectSource): Record<string, string> | undefined {
  if (!source.connectProvider && !source.connectTarget) {
    return undefined;
  }

  return {
    ...(source.connectProvider ? { provider: source.connectProvider } : {}),
    ...(source.connectTarget ? { connectTarget: source.connectTarget } : {}),
  };
}

function readDeviceConnectIntentFromCurrentLocation(): InitialDeviceConnectIntent {
  if (typeof window === "undefined") {
    return null;
  }

  const hashParams = readDeviceConnectIntentHashParams(window.location.hash);
  return hashParams ? readDeviceConnectIntentParams(hashParams) : null;
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

  return {
    claim,
    connectSource: requestedSource,
  };
}

function resolveInitialConnectIntentPresentation(
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

// Single source of truth for "this connect intent will auto-redirect, to this source".
// Both the redirect effect and the pending-redirect dialog rely on this verdict.
function resolveConnectIntentRedirectSource(
  intent: InitialDeviceConnectIntent,
  sources: readonly ConnectSource[],
  authenticated: boolean,
): ConnectSource | null {
  if (!authenticated || !intent?.claim) {
    return null;
  }

  return resolveConnectIntentStartSource(intent, sources);
}

function resolveConnectIntentStartSource(
  intent: InitialDeviceConnectIntent,
  sources: readonly ConnectSource[],
): ConnectSource | null {
  const source = findInitialConnectIntentSource(intent, sources);
  if (!source || (source.connected && !source.requiresReconnect)) {
    return null;
  }

  return source;
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

function SourceStatusDot({
  connected = false,
  requiresReconnect = false,
  sourceName,
}: {
  connected?: boolean;
  requiresReconnect?: boolean;
  sourceName: string;
}) {
  const state = requiresReconnect ? "needs-access" : connected ? "connected" : "idle";

  return (
    <>
      <span
        aria-hidden="true"
        data-connection-state={state}
        className={
          requiresReconnect
            ? "block size-2.5 rounded-full bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]"
            : connected
            ? "block size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]"
            : "block size-2.5 rounded-full bg-stone-300 shadow-[0_0_0_3px_rgba(120,113,108,0.12)]"
        }
      />
      <span className="sr-only">
        {sourceName} {requiresReconnect ? "needs reconnect" : connected ? "connected" : "not connected"}
      </span>
    </>
  );
}

function SourceLogo({ source }: { source: ConnectSource }) {
  return (
    <Image
      src={source.logo.src}
      alt=""
      width={source.logo.width}
      height={source.logo.height}
      className={source.logo.className}
    />
  );
}

function ConnectConsentDialog({
  source,
  onAccepted,
  onOpenChange,
}: {
  onAccepted: (source: ConnectSource) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  source: ConnectSource | null;
}) {
  const open = Boolean(source);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-6 p-6 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {source ? `Before you connect ${source.name}` : "Before you connect"}
          </DialogTitle>
          <DialogDescription>
            Review Murph&apos;s current legal and health-data consent before continuing.
          </DialogDescription>
        </DialogHeader>
        {source ? (
          <HostedLegalConsentCard
            mode="compact"
            source="connect-page"
            onAccepted={async () => {
              await onAccepted(source);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConnectDisconnectDialog({
  errorMessage,
  pending,
  source,
  onConfirm,
  onOpenChange,
}: {
  errorMessage: string | null;
  pending: boolean;
  source: ConnectSource | null;
  onConfirm: (source: ConnectSource) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-6 p-6 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            Disconnect {source?.name ?? "source"}?
          </DialogTitle>
          <DialogDescription>
            Murph will stop syncing new data from this connection. Your history is kept.
          </DialogDescription>
        </DialogHeader>
        {errorMessage ? (
          <p role="alert" className="text-sm leading-relaxed text-destructive">
            {errorMessage}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="xl"
            onClick={() => {
              if (source) {
                void onConfirm(source);
              }
            }}
            disabled={pending}
            className="w-full"
          >
            {pending ? "Disconnecting..." : "Disconnect"}
          </Button>
          <Button type="button" size="xl" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending} className="w-full">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConnectRedirectDialog({ sourceName }: { sourceName: string | null }) {
  return (
    <Dialog open={Boolean(sourceName)}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-5 p-6 md:p-7">
        <DialogHeader className="items-center text-center">
          <span
            aria-hidden="true"
            className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted"
          >
            <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
          </span>
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {sourceName ? `Connecting ${sourceName}` : "Connecting"}
          </DialogTitle>
          <DialogDescription>
            Hang tight — we&apos;re taking you to {sourceName ?? "your source"} to finish setting up
            the connection. This only takes a moment.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
