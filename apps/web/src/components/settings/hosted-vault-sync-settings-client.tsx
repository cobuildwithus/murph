"use client";

import { useState } from "react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import type { HostedVaultSyncSessionView } from "@/src/lib/vault-sync/shared";

import { ConnectedAccountCard } from "./connected-account-card";

interface HostedVaultSyncSessionsResponse {
  ok: true;
  sessions: HostedVaultSyncSessionView[];
}

interface HostedVaultSyncCreateResponse {
  ok: true;
  pairingCode: string;
  session: HostedVaultSyncSessionView;
}

export function HostedVaultSyncSettingsClient(props: {
  authenticated: boolean;
  initialError: string | null;
  initialSessions: HostedVaultSyncSessionView[];
}) {
  const [sessions, setSessions] = useState(props.initialSessions);
  const [error, setError] = useState<string | null>(props.initialError);
  const [pending, setPending] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);

  const latest = sessions[0] ?? null;

  async function refreshSessions() {
    setRefreshPending(true);
    setError(null);
    try {
      const response = await requestHostedOnboardingJson<HostedVaultSyncSessionsResponse>({
        url: "/api/settings/vault-sync/sessions",
      });
      setSessions(response.sessions);
    } catch (requestError) {
      setError(requestError instanceof HostedOnboardingApiError
        ? requestError.message
        : "Could not refresh vault sync sessions right now.");
    } finally {
      setRefreshPending(false);
    }
  }

  async function startSync() {
    setPending(true);
    setError(null);
    try {
      const response = await requestHostedOnboardingJson<HostedVaultSyncCreateResponse>({
        method: "POST",
        payload: {},
        url: "/api/settings/vault-sync/sessions",
      });
      setSessions((current) => [response.session, ...current.filter((entry) => entry.id !== response.session.id)]);
    } catch (requestError) {
      setError(requestError instanceof HostedOnboardingApiError
        ? requestError.message
        : "Could not start vault sync right now.");
    } finally {
      setPending(false);
    }
  }

  if (!props.authenticated) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <ConnectedAccountCard
        label="Sync local vault"
        value="Local-to-hosted import"
        meta="Adds missing local records while preserving hosted data."
        action={
          <>
            <Button disabled={pending || refreshPending} onClick={startSync} type="button">
              {pending ? "Starting..." : "Start sync"}
            </Button>
            <Button disabled={pending || refreshPending} onClick={() => void refreshSessions()} type="button" variant="outline">
              {refreshPending ? "Refreshing..." : "Refresh"}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {latest?.agentCommand ? (
          <div className="rounded-lg bg-muted p-3">
            <p className="mb-2 text-xs text-muted-foreground">Run this locally from your vault machine:</p>
            <code className="block overflow-x-auto whitespace-pre rounded-md bg-background p-3 font-mono text-xs ring-1 ring-foreground/10">
              {latest.agentCommand}
            </code>
          </div>
        ) : latest ? (
          <p className="text-sm text-muted-foreground">
            Latest sync session: <span className="font-medium text-foreground">{latest.status}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
