"use client";

import { Button } from "@/src/components/ui/button";
import type {
  MemberOwnedProviderSetupPresentation,
  MemberOwnedProviderSetupView,
} from "@/src/lib/device-sync/provider-setup/types";

export function MemberOwnedProviderSetup({
  actionAvailable = true,
  connected,
  controlsInert = false,
  pending,
  presentation,
  setup,
  onAction,
  onCancel,
}: {
  actionAvailable?: boolean;
  connected: boolean;
  controlsInert?: boolean;
  pending: boolean;
  presentation: MemberOwnedProviderSetupPresentation;
  setup: MemberOwnedProviderSetupView | null;
  onAction: () => void;
  onCancel?: () => void;
}) {
  const effective: MemberOwnedProviderSetupDisplay = setup
    ?? (connected ? buildDisconnectFirstView(presentation) : buildPendingView(presentation));
  const actionLabel = pending
    ? "Working…"
    : effective.action === "none"
      ? null
      : presentation.actionLabels[effective.action];
  const complete = effective.connected || effective.status === "connected";
  const showSetupAction = !complete
    && effective.action !== "none"
    && actionLabel
    && actionAvailable
    && effective.action !== "disconnect_first";
  const showCancel = !complete
    && (
      effective.status === "authorized"
      || effective.status === "browser_setup"
      || effective.status === "capturing"
      || effective.status === "canceling"
    )
    && Boolean(onCancel);
  const showActions = showSetupAction || showCancel;

  return (
    <div
      data-member-owned-provider-setup
      className="flex w-full flex-col gap-3"
    >
      <div aria-live="polite" className="min-w-0">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {complete ? "Connected" : resolveStatusLabel(effective.status)}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-pretty text-foreground">
          {complete
            ? `${presentation.providerName} is connected through your private provider application.`
            : effective.message}
        </p>
        {(effective.status === "pending" || effective.status === "canceled") ? (
          <p className="mt-2 text-xs leading-relaxed text-pretty text-muted-foreground">
            {presentation.developerAccessDisclosure}
          </p>
        ) : null}
        {effective.applicationRevision ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Private application revision {effective.applicationRevision}
            {effective.status === "oauth_ready" || effective.status === "oauth_in_progress"
              ? ` · ${presentation.readOnlyAccessLabel}`
              : null}
          </p>
        ) : null}
      </div>

      {showActions ? (
        <div className="flex flex-wrap justify-end gap-2">
          {showCancel ? (
            <Button
              type="button"
              variant="secondary"
              disabled={controlsInert || pending}
              aria-label={`${presentation.cancelSetupLabel} for ${presentation.providerName}`}
              onClick={onCancel}
            >
              {presentation.cancelSetupLabel}
            </Button>
          ) : null}
          {showSetupAction ? (
            <Button
              type="button"
              disabled={controlsInert || pending}
              aria-label={`${actionLabel} for ${presentation.providerName}`}
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function buildPendingView(
  presentation: MemberOwnedProviderSetupPresentation,
): MemberOwnedProviderSetupDisplay {
  return {
    action: "authorize",
    applicationRevision: null,
    connected: false,
    message: presentation.messages.pending,
    provider: presentation.provider,
    status: "pending",
    updatedAt: new Date(0).toISOString(),
  };
}

function buildDisconnectFirstView(
  presentation: MemberOwnedProviderSetupPresentation,
): MemberOwnedProviderSetupDisplay {
  return {
    action: "disconnect_first",
    applicationRevision: null,
    connected: false,
    message: presentation.messages.disconnect_first,
    provider: presentation.provider,
    status: "disconnect_first",
    updatedAt: new Date(0).toISOString(),
  };
}

type MemberOwnedProviderSetupDisplay = Omit<
  MemberOwnedProviderSetupView,
  "setupId"
>;

function resolveStatusLabel(
  status: MemberOwnedProviderSetupView["status"],
): string {
  switch (status) {
    case "pending":
      return "Ready to set up";
    case "authorized":
      return "Authorized";
    case "browser_setup":
      return "Murph is setting up";
    case "capturing":
      return "Sealing credentials";
    case "canceling":
      return "Canceling safely";
    case "oauth_ready":
      return "Ready for consent";
    case "oauth_in_progress":
      return "Consent in progress";
    case "connected":
      return "Connected";
    case "disconnect_first":
      return "Disconnect first";
    case "deletion_pending":
      return "Removing private app";
    case "canceled":
      return "Canceled";
    case "deleted":
      return "Deleted";
  }
}
