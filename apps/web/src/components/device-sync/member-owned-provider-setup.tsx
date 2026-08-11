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
}: {
  actionAvailable?: boolean;
  connected: boolean;
  controlsInert?: boolean;
  pending: boolean;
  presentation: MemberOwnedProviderSetupPresentation;
  setup: MemberOwnedProviderSetupView | null;
  onAction: () => void;
}) {
  const effective = setup ?? buildPendingView(presentation);
  const actionLabel = pending
    ? "Working…"
    : effective.action === "none"
      ? null
      : presentation.actionLabels[effective.action];
  const complete = connected || effective.connected || effective.status === "connected";

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
      <div aria-live="polite" className="min-w-0">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {complete ? "Connected" : resolveStatusLabel(effective.status)}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-pretty text-foreground">
          {complete
            ? `${presentation.providerName} is connected through your private provider application.`
            : effective.message}
        </p>
        {effective.applicationRevision ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Private application revision {effective.applicationRevision}
            {effective.status === "oauth_ready" || effective.status === "oauth_in_progress"
              ? ` · ${presentation.readOnlyAccessLabel}`
              : null}
          </p>
        ) : null}
      </div>

      {!complete && actionLabel && actionAvailable ? (
        <Button
          type="button"
          disabled={controlsInert || pending || effective.action === "disconnect_first"}
          aria-label={`${actionLabel} for ${presentation.providerName}`}
          className="self-end"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function buildPendingView(
  presentation: MemberOwnedProviderSetupPresentation,
): MemberOwnedProviderSetupView {
  return {
    action: "start",
    applicationRevision: null,
    connected: false,
    message: presentation.messages.pending,
    provider: presentation.provider,
    status: "pending",
    updatedAt: new Date(0).toISOString(),
  };
}

function resolveStatusLabel(
  status: MemberOwnedProviderSetupView["status"],
): string {
  switch (status) {
    case "pending":
      return "Ready to set up";
    case "working":
      return "Murph is working";
    case "inspection_required":
      return "Safe recovery";
    case "waiting_for_user":
      return "Your action needed";
    case "provider_prerequisite":
      return "Provider prerequisite";
    case "repair_required":
      return "Repair available";
    case "retryable_failure":
      return "Progress saved";
    case "oauth_ready":
      return "Ready for consent";
    case "oauth_in_progress":
      return "Consent in progress";
    case "connected":
      return "Connected";
    case "disconnect_first":
      return "Disconnect first";
    case "provider_conflict":
      return "Protected provider app";
    case "deletion_pending":
      return "Removing private app";
    case "canceled":
      return "Canceled";
    case "deleted":
      return "Deleted";
  }
}
