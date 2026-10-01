"use client";

import { RefreshCwIcon, SearchIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import type { HostedOpsJunctionSourceStatus } from "@/src/lib/hosted-ops/device-sync-diagnostic-types";

interface JunctionRecoveryPanelProps {
  memberId: string;
  sourceProvider: string;
  selectedSource: HostedOpsJunctionSourceStatus | null;
  response: Record<string, unknown> | null;
  error: string | null;
  pending: "refresh" | "status" | null;
  disabled: boolean;
  onRefresh: () => void;
  onCheckStatus: () => void;
}

export function JunctionRecoveryPanel(props: JunctionRecoveryPanelProps) {
  const status = props.selectedSource?.status ?? "unknown";
  return (
    <section aria-label="Junction recovery" aria-busy={props.pending !== null} className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-lg font-semibold">Selected source: {props.sourceProvider}</h3>
        <Badge variant={status === "error" ? "destructive" : "outline"}>{status}</Badge>
        {props.selectedSource?.errorCode ? (
          <span className="break-all font-mono text-xs text-muted-foreground">{props.selectedSource.errorCode}</span>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Last data received: {props.selectedSource?.lastDataAt
          ? new Date(props.selectedSource.lastDataAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })
          : "No receipt recorded"}
      </p>
      <p className="text-sm text-muted-foreground">
        Retry asks Junction to refresh all connected sources for this account.
        Source status is checked afterward; a connected status alone does not confirm fresh data.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={props.disabled || status === "disconnected"} onClick={props.onRefresh} type="button" size="lg" variant="outline">
          <RefreshCwIcon data-icon="inline-start" />
          {props.pending === "refresh" ? "Retrying…" : "Retry Junction sync"}
        </Button>
        <Button disabled={props.disabled} onClick={props.onCheckStatus} type="button" size="lg" variant="outline">
          <SearchIcon data-icon="inline-start" />
          {props.pending === "status" ? "Checking…" : "Check status"}
        </Button>
      </div>
      <div aria-live="polite" className="text-sm">
        {props.pending ? <p>{props.pending === "refresh" ? "Requesting refresh and checking source status…" : "Checking source status without requesting another refresh…"}</p> : null}
        {props.response ? (
          <Alert variant={props.response.ok === false ? "destructive" : "default"}>
            <AlertDescription>{describeRefreshResponse(props.response)}</AlertDescription>
          </Alert>
        ) : null}
        {props.error ? <Alert variant="destructive"><AlertDescription>{props.error}</AlertDescription></Alert> : null}
      </div>
      <p className="break-all font-mono text-xs text-muted-foreground">Member: {props.memberId}</p>
    </section>
  );
}

function describeRefreshResponse(response: Record<string, unknown>): string {
  switch (response.errorCode) {
    case "JUNCTION_REFRESH_NO_CONNECTED_SOURCES":
      return "Junction reported no connected sources. No sources were refreshed. Ask Junction to restore the connection or have the member reconnect.";
    case "JUNCTION_REFRESH_NO_SOURCES":
      return "Junction did not report any sources refreshed or in progress. Recovery is not confirmed.";
    case "JUNCTION_API_REQUEST_TIMEOUT":
      return "The refresh request timed out. Its outcome is unknown. Check status before requesting another refresh.";
  }
  if (response.ok !== true) {
    return `Junction refresh failed (${typeof response.errorCode === "string" ? response.errorCode : "unknown error"}). Check source status before trying again.`;
  }
  const count = (value: unknown) => typeof value === "number" ? value : 0;
  return `Junction reports ${count(response.refreshedSourceCount)} resources refreshed, ${count(response.inProgressSourceCount)} in progress, and ${count(response.failedSourceCount)} failed across this account. Check the selected source status above.`;
}
