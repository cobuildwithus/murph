"use client";

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
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "@/src/components/settings/hosted-device-sync-settings-time";
import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";

import { badgeClasses, sourceCardKey, sourceKey } from "./hosted-device-sync-settings-utils";

export function HostedDeviceSyncSettingsContent(props: {
  disconnectTarget: HostedDeviceSyncSettingsSource | null;
  isLoading: boolean;
  isRefreshing: boolean;
  pendingActionKey: string | null;
  sources: HostedDeviceSyncSettingsSource[];
  onConnect: (source: HostedDeviceSyncSettingsSource) => Promise<void>;
  onDisconnectTargetChange: (source: HostedDeviceSyncSettingsSource | null) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
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
          <Button type="button" onClick={() => void props.onRefresh()} disabled={props.isRefreshing || props.isLoading} variant="outline" size="lg">
            {props.isRefreshing ? "Refreshing..." : "Refresh status"}
          </Button>
        </div>
      </div>

      <Alert className="border-stone-200 bg-stone-50">
        <AlertTitle>Quiet by default</AlertTitle>
        <AlertDescription>
          Murph will usually tell you only whether a source is connected, whether it has synced recently, and whether a
          quick reconnect would help. Past history stays in place if you disconnect.
        </AlertDescription>
      </Alert>

      {props.isLoading ? (
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
      ) : props.sources.length === 0 ? (
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
          {props.sources.map((source) => (
            <HostedDeviceSyncSourceCard
              key={sourceCardKey(source)}
              disconnectPending={props.disconnectTarget ? props.pendingActionKey === sourceKey(props.disconnectTarget, "disconnect") : false}
              pendingActionKey={props.pendingActionKey}
              source={source}
              onConnect={props.onConnect}
              onDisconnectTargetChange={props.onDisconnectTargetChange}
            />
          ))}
        </div>
      )}
    </>
  );
}

function HostedDeviceSyncSourceCard(props: {
  disconnectPending: boolean;
  pendingActionKey: string | null;
  source: HostedDeviceSyncSettingsSource;
  onConnect: (source: HostedDeviceSyncSettingsSource) => Promise<void>;
  onDisconnectTargetChange: (source: HostedDeviceSyncSettingsSource | null) => void;
}) {
  const connectBusy = props.pendingActionKey === sourceKey(props.source, "connect");
  const disconnectBusy = props.pendingActionKey === sourceKey(props.source, "disconnect");

  return (
    <Card className="shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-xl text-stone-900">
              {props.source.providerLabel}
              {props.source.displayName ? (
                <span className="text-base font-normal text-stone-500"> {"—"} {props.source.displayName}</span>
              ) : null}
            </CardTitle>
            <CardDescription className="text-sm text-stone-500">{props.source.headline}</CardDescription>
          </div>
          <Badge className={badgeClasses(props.source.tone)} variant="outline">
            {props.source.statusLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm leading-relaxed text-stone-700">{props.source.detail}</p>
          <p className="text-sm leading-relaxed text-stone-500">{props.source.guidance}</p>
        </div>

        <dl className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 md:grid-cols-3">
          <TimestampStat emptyLabel="No successful sync yet" label="Last successful sync" value={props.source.lastSuccessfulSyncAt} />
          <TimestampStat emptyLabel="No recent activity yet" label="Last activity" value={props.source.lastActivityAt} />
          <TimestampStat emptyLabel="Nothing scheduled yet" label="Next background check" value={props.source.nextReconcileAt} />
        </dl>

        <div className="flex flex-wrap gap-3">
          {props.source.primaryAction ? (
            <Button
              type="button"
              onClick={() => void props.onConnect(props.source)}
              disabled={connectBusy || disconnectBusy}
              size="lg"
            >
              {connectBusy ? `${props.source.primaryAction.label}...` : props.source.primaryAction.label}
            </Button>
          ) : null}
          {props.source.secondaryAction?.kind === "disconnect" && props.source.connectionId ? (
            <Button
              type="button"
              onClick={() => props.onDisconnectTargetChange(props.source)}
              disabled={connectBusy || disconnectBusy}
              variant="outline"
              size="lg"
            >
              {disconnectBusy ? "Disconnecting..." : props.source.secondaryAction.label}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function HostedDeviceSyncDisconnectDialog(props: {
  disconnectPending: boolean;
  disconnectTarget: HostedDeviceSyncSettingsSource | null;
  onConfirm: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(props.disconnectTarget)} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {props.disconnectTarget?.providerLabel ?? "source"}?</DialogTitle>
          <DialogDescription>
            Murph will stop pulling new data from this source. Your earlier history stays in place, and you can
            reconnect later if you want fresh updates again.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.disconnectPending}>
            Keep it connected
          </Button>
          <Button type="button" onClick={() => void props.onConfirm()} disabled={props.disconnectPending}>
            {props.disconnectPending ? "Disconnecting..." : "Disconnect source"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
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
