import type { ReactNode } from "react";

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
import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";

import { ConnectedAccountCard } from "./connected-account-card";
import { sourceCardKey, sourceKey } from "./hosted-device-sync-settings-utils";

export function HostedDeviceSyncSettingsContent(props: {
  disconnectTarget: HostedDeviceSyncSettingsSource | null;
  isRefreshing: boolean;
  pendingActionKey: string | null;
  sources: HostedDeviceSyncSettingsSource[];
  onDisconnectTargetChange: (source: HostedDeviceSyncSettingsSource | null) => void;
  onRefresh: () => Promise<void>;
  onReconnect: (source: HostedDeviceSyncSettingsSource) => Promise<void>;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Wearables</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Review, refresh, or disconnect wearable sources.
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
          value="No connected wearables"
          meta="Connected wearable sources will appear here after setup."
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
              onDisconnectTargetChange={props.onDisconnectTargetChange}
              onReconnect={props.onReconnect}
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
  onDisconnectTargetChange: (source: HostedDeviceSyncSettingsSource | null) => void;
  onReconnect: (source: HostedDeviceSyncSettingsSource) => Promise<void>;
}) {
  const disconnectBusy = props.pendingActionKey === sourceKey(props.source, "disconnect");
  const reconnectBusy = props.pendingActionKey === sourceKey(props.source, "reconnect");
  const disconnectAction = props.source.secondaryAction?.kind === "disconnect" && props.source.connectionId
    ? props.source.secondaryAction
    : null;
  const reconnectAction = props.source.primaryAction?.kind === "reconnect" && props.source.connectSourceId
    ? props.source.primaryAction
    : null;
  const displayName = props.source.displayName
    ? `${props.source.providerLabel} - ${props.source.displayName}`
    : props.source.providerLabel;

  const timing = renderSourceTiming(props.source);

  return (
    <ConnectedAccountCard
      value={displayName}
      meta={timing}
      action={
        disconnectAction || reconnectAction ? (
          <div className="flex flex-wrap justify-end gap-2">
          {reconnectAction ? (
            <Button
              type="button"
              onClick={() => void props.onReconnect(props.source)}
              disabled={reconnectBusy}
              size="sm"
            >
              {reconnectBusy ? "Opening..." : reconnectAction.label}
            </Button>
          ) : null}
          {disconnectAction ? (
            <Button
              type="button"
              onClick={() => props.onDisconnectTargetChange(props.source)}
              disabled={disconnectBusy || reconnectBusy}
              size="sm"
              variant="outline"
            >
              {disconnectBusy ? "Disconnecting..." : disconnectAction.label}
            </Button>
          ) : null}
          </div>
        ) : null
      }
    />
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
            Murph will stop syncing new data. Your history is kept.
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

export function HostedDeviceSyncReconnectConsentDialog(props: {
  source: HostedDeviceSyncSettingsSource | null;
  onAccepted: (source: HostedDeviceSyncSettingsSource) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(props.source);

  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md gap-6 p-6 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {props.source ? `Before you reconnect ${props.source.providerLabel}` : "Before you reconnect"}
          </DialogTitle>
          <DialogDescription>
            Review Murph&apos;s current legal and health-data consent before continuing.
          </DialogDescription>
        </DialogHeader>
        {props.source ? (
          <HostedLegalConsentCard
            mode="compact"
            source="settings-device-sync"
            onAccepted={async () => {
              if (props.source) {
                await props.onAccepted(props.source);
              }
            }}
          />
        ) : null}
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
