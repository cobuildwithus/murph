"use client";

import { usePrivy, useUser } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "@/src/components/settings/hosted-device-sync-settings-time";
import {
  formatHostedDeviceSyncProviderLabel,
  type HostedDeviceSyncSettingsResponse,
  type HostedDeviceSyncSettingsSource,
} from "@/src/lib/device-sync/settings-surface";

interface HostedDeviceSyncConnectResponse {
  authorizationUrl: string;
}

interface HostedDeviceSyncDisconnectResponse {
  warning?: { code: string; message: string };
}

export function HostedDeviceSyncSettings() {
  return <HostedDeviceSyncSettingsInner />;
}

function HostedDeviceSyncSettingsInner() {
  const { authenticated, ready } = usePrivy();
  const { user } = useUser();
  const [sources, setSources] = useState<HostedDeviceSyncSettingsSource[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<HostedDeviceSyncSettingsSource | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const canManageSources = ready && authenticated && Boolean(user);
  const isLoadingAuthenticatedUser = ready && authenticated && !user;
  const disconnectPending = disconnectTarget
    ? pendingActionKey === sourceKey(disconnectTarget, "disconnect")
    : false;

  const loadSources = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const response = await requestHostedOnboardingJson<HostedDeviceSyncSettingsResponse>({
        url: "/api/settings/device-sync",
      });
      setSources(response.sources);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not load your wearable sources right now."));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }

    if (!authenticated) {
      setSources([]);
      setIsLoading(false);
      return;
    }

    if (!user) {
      setIsLoading(true);
      return;
    }

    void loadSources("initial");
  }, [authenticated, loadSources, ready, user]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const status = url.searchParams.get("deviceSyncStatus");

    if (!status) {
      return;
    }

    const provider = formatHostedDeviceSyncProviderLabel(url.searchParams.get("deviceSyncProvider") ?? "source");
    const errorCode = url.searchParams.get("deviceSyncError");

    if (status === "connected") {
      setSuccessMessage(`Connected ${provider}. Murph will keep this quiet in the background.`);
      setWarningMessage(null);
      setErrorMessage(null);
      void loadSources();
    } else if (status === "error") {
      setErrorMessage(describeDeviceSyncCallbackError(provider, errorCode));
      setSuccessMessage(null);
    }

    url.searchParams.delete("deviceSyncStatus");
    url.searchParams.delete("deviceSyncProvider");
    url.searchParams.delete("deviceSyncConnectionId");
    url.searchParams.delete("deviceSyncError");
    url.searchParams.delete("deviceSyncErrorMessage");
    window.history.replaceState({}, "", url.toString());
  }, [loadSources]);

  async function handleConnect(source: HostedDeviceSyncSettingsSource) {
    setPendingActionKey(sourceKey(source, "connect"));
    setErrorMessage(null);
    setSuccessMessage(null);
    setWarningMessage(null);

    try {
      const result = await requestHostedOnboardingJson<HostedDeviceSyncConnectResponse>({
        method: "POST",
        payload: {
          returnTo: "/settings",
        },
        url: `/api/settings/device-sync/providers/${encodeURIComponent(source.provider)}/connect`,
      });
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, `We could not start the ${source.providerLabel} connection right now.`));
      setPendingActionKey(null);
    }
  }

  async function handleDisconnectConfirmed() {
    const source = disconnectTarget;

    if (!source?.connectionId) {
      setDisconnectTarget(null);
      return;
    }

    if (pendingActionKey === sourceKey(source, "disconnect")) {
      return;
    }

    setPendingActionKey(sourceKey(source, "disconnect"));
    setErrorMessage(null);
    setSuccessMessage(null);
    setWarningMessage(null);

    try {
      const result = await requestHostedOnboardingJson<HostedDeviceSyncDisconnectResponse>({
        method: "POST",
        url: `/api/settings/device-sync/connections/${encodeURIComponent(source.connectionId)}/disconnect`,
      });
      setDisconnectTarget(null);
      setSuccessMessage(`Disconnected ${source.providerLabel}. Your earlier history stays in place.`);

      if (result.warning?.message) {
        setWarningMessage(
          `Murph cleared the local connection, but ${source.providerLabel} did not confirm revocation cleanly: ${result.warning.message}`,
        );
      }

      await loadSources();
    } catch (error) {
      setErrorMessage(toErrorMessage(error, `We could not disconnect ${source.providerLabel} right now.`));
    } finally {
      setPendingActionKey(null);
    }
  }

  return (
    <div className="space-y-5">
      {successMessage ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
          <AlertTitle>Wearable source updated</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {warningMessage ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTitle>Small warning</AlertTitle>
          <AlertDescription>{warningMessage}</AlertDescription>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to update wearable sources</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!ready || isLoadingAuthenticatedUser ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>Checking your session</AlertTitle>
          <AlertDescription>
            Checking your Privy session before we show wearable sources.
          </AlertDescription>
        </Alert>
      ) : !authenticated ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTitle>Sign in first</AlertTitle>
          <AlertDescription>
            Open your latest Murph invite or sign-in flow in this browser first. We need your Privy session before we
            can manage wearable sources on your account.
          </AlertDescription>
        </Alert>
      ) : !canManageSources ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>Loading your profile</AlertTitle>
          <AlertDescription>
            Loading your hosted profile before we show wearable sources.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight text-stone-900">Wearable sources</h2>
                <p className="text-sm leading-relaxed text-stone-500">
                  Connect Garmin, Oura, or WHOOP here. Murph keeps this lightweight: connect once, reconnect only when
                  access expires, and disconnect any time.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void loadSources()}
                disabled={isRefreshing || isLoading}
                variant="outline"
                size="lg"
              >
                {isRefreshing ? "Refreshing..." : "Refresh status"}
              </Button>
            </div>
          </div>

          <Alert className="border-stone-200 bg-stone-50">
            <AlertTitle>Quiet by default</AlertTitle>
            <AlertDescription>
              Murph will usually tell you only whether a source is connected, whether it has synced recently, and
              whether a quick reconnect would help. Past history stays in place if you disconnect.
            </AlertDescription>
          </Alert>

          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Card key={`device-sync-skeleton-${index}`} className="shadow-sm">
                  <CardHeader className="space-y-3">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-64" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <div className="grid gap-3 md:grid-cols-3">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : sources.length === 0 ? (
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg text-stone-900">No wearable providers are enabled here yet</CardTitle>
                <CardDescription className="text-sm leading-relaxed text-stone-500">
                  This hosted environment is not currently configured for Garmin, Oura, or WHOOP. When a provider is
                  enabled, it will show up here as a quiet source you can connect when you want.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="space-y-4">
              {sources.map((source) => {
                const connectBusy = pendingActionKey === sourceKey(source, "connect");
                const disconnectBusy = pendingActionKey === sourceKey(source, "disconnect");
                return (
                  <Card key={sourceCardKey(source)} className="shadow-sm">
                    <CardHeader className="gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <CardTitle className="text-xl text-stone-900">
                            {source.providerLabel}
                            {source.displayName ? (
                              <span className="text-base font-normal text-stone-500"> — {source.displayName}</span>
                            ) : null}
                          </CardTitle>
                          <CardDescription className="text-sm text-stone-500">{source.headline}</CardDescription>
                        </div>
                        <Badge className={badgeClasses(source.tone)} variant="outline">
                          {source.statusLabel}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-sm leading-relaxed text-stone-700">{source.detail}</p>
                        <p className="text-sm leading-relaxed text-stone-500">{source.guidance}</p>
                      </div>

                      <dl className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 md:grid-cols-3">
                        <TimestampStat
                          emptyLabel="No successful sync yet"
                          label="Last successful sync"
                          value={source.lastSuccessfulSyncAt}
                        />
                        <TimestampStat
                          emptyLabel="No recent activity yet"
                          label="Last activity"
                          value={source.lastActivityAt}
                        />
                        <TimestampStat
                          emptyLabel="Nothing scheduled yet"
                          label="Next background check"
                          value={source.nextReconcileAt}
                        />
                      </dl>

                      <div className="flex flex-wrap gap-3">
                        {source.primaryAction ? (
                          <Button
                            type="button"
                            onClick={() => void handleConnect(source)}
                            disabled={connectBusy || disconnectBusy}
                            size="lg"
                          >
                            {connectBusy ? `${source.primaryAction.label}...` : source.primaryAction.label}
                          </Button>
                        ) : null}
                        {source.secondaryAction?.kind === "disconnect" && source.connectionId ? (
                          <Button
                            type="button"
                            onClick={() => setDisconnectTarget(source)}
                            disabled={connectBusy || disconnectBusy}
                            variant="outline"
                            size="lg"
                          >
                            {disconnectBusy ? "Disconnecting..." : source.secondaryAction.label}
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <Dialog open={Boolean(disconnectTarget)} onOpenChange={(open) => {
        if (!open && !disconnectPending) {
          setDisconnectTarget(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Disconnect {disconnectTarget?.providerLabel ?? "source"}?
            </DialogTitle>
            <DialogDescription>
              Murph will stop pulling new data from this source. Your earlier history stays in place, and you can
              reconnect later if you want fresh updates again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDisconnectTarget(null)}
              disabled={disconnectPending}
            >
              Keep it connected
            </Button>
            <Button
              type="button"
              onClick={() => void handleDisconnectConfirmed()}
              disabled={disconnectPending}
            >
              {disconnectPending ? "Disconnecting..." : "Disconnect source"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function sourceCardKey(source: HostedDeviceSyncSettingsSource): string {
  return source.connectionId ?? `${source.provider}:available`;
}

function sourceKey(source: HostedDeviceSyncSettingsSource, action: "connect" | "disconnect"): string {
  return `${sourceCardKey(source)}:${action}`;
}

function badgeClasses(tone: HostedDeviceSyncSettingsSource["tone"]): string {
  switch (tone) {
    case "attention":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "calm":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "muted":
    default:
      return "border-stone-200 bg-stone-50 text-stone-600";
  }
}

function TimestampStat(input: {
  emptyLabel: string;
  label: string;
  value: string | null;
}) {
  return (
    <div className="space-y-1">
      <dt className="font-semibold text-stone-500">{input.label}</dt>
      <dd>
        {input.value ? (
          <time dateTime={input.value} title={formatAbsoluteTime(input.value)}>
            {formatRelativeTime(input.value)}
          </time>
        ) : (
          input.emptyLabel
        )}
      </dd>
    </div>
  );
}

function describeDeviceSyncCallbackError(providerLabel: string, errorCode: string | null): string {
  switch (errorCode) {
    case "OAUTH_CALLBACK_REJECTED":
      return `${providerLabel} was not connected this time. You can try again whenever you're ready.`;
    case "OAUTH_STATE_INVALID":
      return `${providerLabel} gave us an expired or invalid return from the last attempt. Start a fresh connection and try again.`;
    default:
      return `We could not finish connecting ${providerLabel}. Try again when you're ready.`;
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}
