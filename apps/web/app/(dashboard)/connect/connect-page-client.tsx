"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

import { DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS } from "@murphai/device-syncd/callback-redirect";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import {
  describeDeviceSyncCallbackError,
} from "@/src/components/settings/hosted-device-sync-settings-utils";
import { HostedSettingsSessionState } from "@/src/components/settings/hosted-settings-session-state";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { formatHostedDeviceSyncProviderLabel } from "@/src/lib/device-sync/settings-surface";

type LogoAsset = {
  className: string;
  height: number;
  src: string;
  width: number;
};

type ConnectSource = {
  connectTarget?: string;
  connected?: boolean;
  description: string;
  id: string;
  logo: LogoAsset;
  name: string;
};

type ConnectPageInitialLoadError = {
  message: string;
};

interface HostedDeviceSyncConnectResponse {
  authorizationUrl: string;
}

export type ConnectCallbackInput = {
  connectTarget: string | null;
  errorCode: string | null;
  provider: string | null;
  status: "connected" | "error";
} | null;

type ConnectCallbackNotice = {
  kind: "error" | "success";
  message: string;
} | null;

export function ConnectSourcesGrid({
  authenticated = true,
  initialCallback = null,
  initialLoadError = null,
  sources,
}: {
  authenticated?: boolean;
  initialCallback?: ConnectCallbackInput;
  initialLoadError?: ConnectPageInitialLoadError | null;
  sources: readonly ConnectSource[];
}) {
  const [notice, setNotice] = useState<ConnectCallbackNotice>(() =>
    createConnectCallbackNotice(initialCallback, sources),
  );
  const [search, setSearch] = useState("");
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    message: string;
    sourceId: string;
  } | null>(null);
  const [consentRetrySource, setConsentRetrySource] = useState<ConnectSource | null>(null);
  const filteredSources = useMemo(
    () => filterConnectSourcesForSearch(sources, search),
    [search, sources],
  );
  const hasInitialCallback = Boolean(initialCallback);

  useEffect(() => {
    if (hasInitialCallback) {
      stripConnectCallbackParams();
    }
  }, [hasInitialCallback]);

  async function startConnection(source: ConnectSource) {
    if (!source.connectTarget || !authenticated) {
      return;
    }

    setPendingSourceId(source.id);
    setActionError(null);
    setNotice(null);
    setConsentRetrySource(null);

    try {
      const result = await requestHostedOnboardingJson<HostedDeviceSyncConnectResponse>({
        method: "POST",
        payload: {
          returnTo: `/connect?connectTarget=${encodeURIComponent(source.connectTarget)}`,
        },
        url: `/api/settings/device-sync/providers/${encodeURIComponent(source.connectTarget)}/connect`,
      });
      window.location.assign(readConnectAuthorizationUrl(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection could not be started.";
      setActionError({
        message,
        sourceId: source.id,
      });
      setConsentRetrySource(
        error instanceof HostedOnboardingApiError && error.code === "HOSTED_CONSENT_REQUIRED"
          ? source
          : null,
      );
      setPendingSourceId(null);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      {!authenticated ? (
        <HostedSettingsSessionState
          authenticated={authenticated}
          signedOutDescription="Sign in to connect your health data sources."
        />
      ) : null}

      {initialLoadError?.message ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load connected sources</AlertTitle>
          <AlertDescription>{initialLoadError.message}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        notice.kind === "success" ? (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
            <AlertTitle>Source connected</AlertTitle>
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Unable to finish connection</AlertTitle>
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )
      ) : null}

      {consentRetrySource ? (
        <HostedLegalConsentCard
          mode="compact"
          preferredScope="feature.connected-health-source"
          source="connect-page"
          onAccepted={async () => {
            await startConnection(consentRetrySource);
          }}
        />
      ) : null}

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Sources
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {filteredSources.length} of {sources.length} sources
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
              errorMessage={actionError?.sourceId === source.id ? actionError.message : null}
              pending={pendingSourceId === source.id}
              source={source}
              onStartConnection={startConnection}
            />
          ))}
        </div>
      )}
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
  source,
  onStartConnection,
}: {
  authenticated: boolean;
  errorMessage: string | null;
  pending: boolean;
  source: ConnectSource;
  onStartConnection: (source: ConnectSource) => Promise<void>;
}) {
  const isAvailable = Boolean(source.connectTarget);
  const canStart = authenticated && isAvailable;

  return (
    <div className="relative box-border flex min-w-0 w-full max-w-full flex-col justify-between overflow-hidden rounded-xl border border-border/50 bg-[rgba(255,252,246,0.9)] p-5">
      <div className="absolute top-4 right-4">
        <SourceStatusDot connected={source.connected} sourceName={source.name} />
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

      {source.connected ? (
        <div className="mt-auto flex h-10 items-center">
          <span className="text-sm font-medium text-foreground">Connected</span>
        </div>
      ) : (
        <div className="mt-auto flex flex-col items-start gap-2">
          <Button
            type="button"
            disabled={!canStart || pending}
            aria-label={isAvailable
              ? authenticated
                ? `Connect ${source.name}`
                : `Sign in to connect ${source.name}`
              : `${source.name} connection is not available yet`}
            onClick={() => void onStartConnection(source)}
          >
            {pending ? "Opening..." : isAvailable ? authenticated ? "Connect" : "Sign in first" : "Not available"}
          </Button>
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

function resolveCallbackSourceLabel(input: {
  connectTarget: string | null;
  provider: string | null;
  sources: readonly ConnectSource[];
}): string {
  const target = normalizeConnectKey(input.connectTarget);
  const provider = normalizeConnectKey(input.provider);
  const source = input.sources.find((candidate) => {
    const sourceTarget = normalizeConnectKey(candidate.connectTarget);
    const sourceId = normalizeConnectKey(candidate.id);
    return Boolean(
      (target && (sourceTarget === target || sourceId === target))
      || (provider && (sourceTarget === provider || sourceId === provider)),
    );
  });

  if (source) {
    return source.name;
  }

  return formatHostedDeviceSyncProviderLabel(input.provider ?? "source");
}

function createConnectCallbackNotice(
  input: ConnectCallbackInput,
  sources: readonly ConnectSource[],
): ConnectCallbackNotice {
  if (!input) {
    return null;
  }

  const sourceLabel = resolveCallbackSourceLabel({
    connectTarget: input.connectTarget,
    provider: input.provider,
    sources,
  });

  if (input.status === "connected") {
    return {
      kind: "success",
      message: `Connected ${sourceLabel}.`,
    };
  }

  return {
    kind: "error",
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
  url.searchParams.delete("connectTarget");
  window.history?.replaceState?.({}, "", url.toString());
}

function normalizeConnectKey(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

  return normalized || null;
}

function SourceStatusDot({
  connected = false,
  sourceName,
}: {
  connected?: boolean;
  sourceName: string;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        data-connection-state={connected ? "connected" : "idle"}
        className={
          connected
            ? "block size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]"
            : "block size-2.5 rounded-full bg-stone-300 shadow-[0_0_0_3px_rgba(120,113,108,0.12)]"
        }
      />
      <span className="sr-only">
        {sourceName} {connected ? "connected" : "not connected"}
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
