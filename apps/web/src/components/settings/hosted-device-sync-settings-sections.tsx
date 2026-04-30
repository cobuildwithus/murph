import type { ReactNode } from "react";

import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "@/src/components/settings/hosted-device-sync-settings-time";
import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";

import { ConnectedAccountCard } from "./connected-account-card";
import { badgeClasses, sourceCardKey, sourceKey } from "./hosted-device-sync-settings-utils";

export function HostedDeviceSyncSettingsContent(props: {
  disconnectTarget: HostedDeviceSyncSettingsSource | null;
  isRefreshing: boolean;
  pendingActionKey: string | null;
  sources: HostedDeviceSyncSettingsSource[];
  onConnect: (source: HostedDeviceSyncSettingsSource) => Promise<void>;
  onDisconnectTargetChange: (source: HostedDeviceSyncSettingsSource | null) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Wearables</h2>
            <p className="text-sm leading-relaxed text-stone-500">
              Connect, refresh, or disconnect wearable sources.
            </p>
          </div>
          <Button type="button" onClick={() => void props.onRefresh()} disabled={props.isRefreshing} variant="outline">
            {props.isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {props.sources.length === 0 ? (
        <ConnectedAccountCard
          label="Wearables"
          value="No sources available"
          meta="Wearable integrations will appear here once they're enabled for your account."
          variant="empty"
        />
      ) : (
        <div className="flex flex-col gap-3">
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

export function HostedDeviceSyncSettingsStatusCard(props: {
  actionLabel?: string | null;
  description: string;
  disabled?: boolean;
  title: string;
  onAction?: (() => Promise<void>) | undefined;
}) {
  return (
    <ConnectedAccountCard
      value={props.title}
      meta={props.description}
      variant="empty"
      action={
        props.actionLabel && props.onAction ? (
          <Button type="button" onClick={() => void props.onAction?.()} disabled={props.disabled} variant="outline">
            {props.disabled ? "Refreshing..." : props.actionLabel}
          </Button>
        ) : null
      }
    />
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
  const displayName = props.source.displayName
    ? `${props.source.providerLabel} - ${props.source.displayName}`
    : props.source.providerLabel;

  return (
    <ConnectedAccountCard
      label={props.source.headline}
      value={displayName}
      meta={<SourceMeta source={props.source} />}
      action={
        <>
          <Badge className={badgeClasses(props.source.tone)} variant="outline">
            {props.source.statusLabel}
          </Badge>
          {props.source.primaryAction ? (
            <Button
              type="button"
              onClick={() => void props.onConnect(props.source)}
              disabled={connectBusy || disconnectBusy}
              size="sm"
            >
              {connectBusy ? `${props.source.primaryAction.label}...` : props.source.primaryAction.label}
            </Button>
          ) : null}
          {props.source.secondaryAction?.kind === "disconnect" && props.source.connectionId ? (
            <Button
              type="button"
              onClick={() => props.onDisconnectTargetChange(props.source)}
              disabled={connectBusy || disconnectBusy}
              size="sm"
              variant="outline"
            >
              {disconnectBusy ? "Disconnecting..." : props.source.secondaryAction.label}
            </Button>
          ) : null}
        </>
      }
    />
  );
}

function SourceMeta(props: { source: HostedDeviceSyncSettingsSource }) {
  const timing = renderSourceTiming(props.source);

  return (
    <span className="flex flex-col gap-1">
      <span>{props.source.detail}</span>
      {timing}
      <UpstreamSources source={props.source} />
    </span>
  );
}

function UpstreamSources(props: { source: HostedDeviceSyncSettingsSource }) {
  if (props.source.upstreamSources.length === 0) {
    return null;
  }

  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {props.source.upstreamSources.map((source, index) => (
        <span
          key={`${source.providerLabel}:${source.status}:${source.resourceCount}:${index}`}
          className="inline-flex max-w-full min-w-0 items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground"
        >
          <span className="min-w-0 max-w-full truncate [overflow-wrap:anywhere]">{source.providerLabel}</span>
          {source.resourceCount > 0 ? (
            <span className="shrink-0">{formatResourceCount(source.resourceCount)}</span>
          ) : null}
          <span className="shrink-0 text-muted-foreground/80">{formatUpstreamSourceStatus(source.status)}</span>
        </span>
      ))}
    </span>
  );
}

function formatResourceCount(count: number): string {
  return `${count} ${count === 1 ? "resource" : "resources"}`;
}

function formatUpstreamSourceStatus(status: HostedDeviceSyncSettingsSource["upstreamSources"][number]["status"]): string {
  switch (status) {
    case "connected":
      return "connected";
    case "error":
      return "needs attention";
    case "unavailable":
      return "unavailable";
  }

  return status;
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
            Murph will stop syncing new data. Your history is kept, and you can reconnect any time.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.disconnectPending}>
            Keep it connected
          </Button>
          <Button type="button" onClick={() => void props.onConfirm()} disabled={props.disconnectPending}>
            {props.disconnectPending ? "Disconnecting..." : "Disconnect"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function renderSourceTiming(source: HostedDeviceSyncSettingsSource): ReactNode {
  if (source.lastSuccessfulSyncAt) {
    return (
      <span>
        Last sync{" "}
        <time dateTime={source.lastSuccessfulSyncAt} title={formatAbsoluteTime(source.lastSuccessfulSyncAt)}>
          {formatRelativeTime(source.lastSuccessfulSyncAt)}
        </time>
      </span>
    );
  }

  if (source.lastActivityAt) {
    return (
      <span>
        Last activity{" "}
        <time dateTime={source.lastActivityAt} title={formatAbsoluteTime(source.lastActivityAt)}>
          {formatRelativeTime(source.lastActivityAt)}
        </time>
      </span>
    );
  }

  if (source.nextReconcileAt) {
    return (
      <span>
        Next check{" "}
        <time dateTime={source.nextReconcileAt} title={formatAbsoluteTime(source.nextReconcileAt)}>
          {formatRelativeTime(source.nextReconcileAt)}
        </time>
      </span>
    );
  }

  return null;
}
