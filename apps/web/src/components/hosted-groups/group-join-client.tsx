"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  buildHostedVaultShareProjectionScopeKey,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { groupJoinPermissionsForDisplay } from "@/src/components/hosted-groups/group-join-permission-groups";
import { toErrorMessage } from "@/src/components/settings/hosted-settings-sync-helpers";
import { Button } from "@/src/components/ui/button";
import {
  buildGroupJoinPostAuthReturnPath,
  type GroupJoinPostJoinDestination,
} from "@/src/lib/hosted-groups/group-join-handoff";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { cn } from "@/src/lib/utils";

export interface GroupJoinPermissionDisplay {
  description: string;
  label: string;
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

export function GroupJoinSignInButton() {
  const [open, setOpen] = useState(true);

  function handleCompleted(payload: HostedPrivyCompletionPayload) {
    navigateHostedAuthRedirect(buildGroupJoinPostAuthReturnPath({
      currentPath: readCurrentGroupJoinPath(),
      payload,
    }));
  }

  return (
    <>
      <Button type="button" size="xl" onClick={() => setOpen(true)}>
        Continue to join
      </Button>
      <AuthDialog
        open={open}
        onCompleted={handleCompleted}
        onOpenChange={setOpen}
        requireLaunchConsentOnCompletion
        title="Continue to join this Murph group"
        description="Create or open your private Murph account, then we'll bring you back here."
      />
    </>
  );
}

export function GroupJoinLegalConsentGate({
  initialStatus,
}: {
  initialStatus: HostedConsentStatus | null;
}) {
  const router = useRouter();

  function refreshRoute() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <HostedLegalConsentCard
        acceptedPendingLabel="Continuing..."
        initialStatus={initialStatus}
        mode="compact"
        onAccepted={refreshRoute}
        onRequirementChange={(required) => {
          if (!required) {
            refreshRoute();
          }
        }}
        preferredScope="launch.legal"
        source="group-join"
      />
      <Link
        href="/home"
        className="inline-flex min-h-10 items-center justify-center text-center text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Not now
      </Link>
    </div>
  );
}

export function GroupJoinAcceptForm(props: {
  activeVaultShareProjectionScopes: readonly HostedVaultShareProjectionScope[];
  alreadyActiveMember: boolean;
  expectedMembershipId: string | null;
  groupName: string;
  joinCode: string;
  permissions: readonly GroupJoinPermissionDisplay[];
  postJoinDestination: GroupJoinPostJoinDestination;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(
      props.alreadyActiveMember
        ? props.activeVaultShareProjectionScopes.map(buildHostedVaultShareProjectionScopeKey)
        : props.permissions.map((permission) => permission.projectionScopeKey),
    ),
  );
  const [status, setStatus] = useState<"idle" | "submitting" | "joined">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedVaultShareProjectionScopes = useMemo(
    () => props.permissions
      .filter((permission) => selected.has(permission.projectionScopeKey))
      .map((permission) => permission.projectionScope),
    [props.permissions, selected],
  );

  const permissionGroups = useMemo(
    () => groupJoinPermissionsForDisplay(props.permissions),
    [props.permissions],
  );

  function togglePermissionGroup(scopeKeys: readonly string[]) {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = scopeKeys.every((scopeKey) => next.has(scopeKey));
      for (const scopeKey of scopeKeys) {
        if (allSelected) {
          next.delete(scopeKey);
        } else {
          next.add(scopeKey);
        }
      }
      return next;
    });
  }

  async function submit() {
    setErrorMessage(null);
    setStatus("submitting");
    try {
      await requestHostedOnboardingJson({
        method: "POST",
        payload: {
          expectedMembershipId: props.expectedMembershipId,
          selectedVaultShareProjectionScopes,
        },
        url: `/api/groups/join/${encodeURIComponent(props.joinCode)}/accept`,
      });
      setStatus("joined");
    } catch (error) {
      setStatus("idle");
      setErrorMessage(toErrorMessage(error, "Could not join this group right now."));
    }
  }

  if (status === "joined") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="size-6" strokeWidth={2.5} />
        </div>
        <p className="text-base font-medium text-foreground">
          {props.alreadyActiveMember ? "Your sharing is updated." : `You're in ${props.groupName}.`}
        </p>
        <Button
          type="button"
          size="xl"
          onClick={() => router.push(props.postJoinDestination)}
          className="w-full"
        >
          Open Murph
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {props.permissions.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Optional sharing
            </span>
            <p className="text-[13px] leading-5 text-muted-foreground">
              Uncheck anything you don&apos;t want to share. Join either way. Change anytime.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            {permissionGroups.map((group) => {
              const checked = group.scopeKeys.every((scopeKey) => selected.has(scopeKey));
              return (
                <label
                  key={group.key}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    checked
                      ? "border-primary bg-primary/[0.06]"
                      : "border-border bg-card hover:border-primary/40",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => togglePermissionGroup(group.scopeKeys)}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/50",
                    )}
                  >
                    {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">{group.label}</span>
                    <span className="text-[13px] leading-5 text-muted-foreground">
                      {group.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="xl"
          onClick={() => void submit()}
          disabled={status === "submitting"}
        >
          {status === "submitting"
            ? props.alreadyActiveMember
              ? "Saving..."
              : "Joining..."
            : props.alreadyActiveMember
              ? "Save changes"
              : "Join group"}
        </Button>
        {errorMessage ? (
          <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function GroupJoinLeaveButton(props: {
  groupName: string;
  joinCode: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function leaveGroup() {
    const confirmed = window.confirm(
      `Leave ${props.groupName}? This ends your Murph membership and future sharing. `
      + "Murph queues its shared copies for cleanup, but this won't remove you from "
      + "the iMessage chat or erase past messages, provider history, backups, or "
      + "copies already held outside Murph.",
    );
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);
    setSubmitting(true);
    try {
      await requestHostedOnboardingJson({
        method: "POST",
        url: `/api/groups/join/${encodeURIComponent(props.joinCode)}/leave`,
      });
      router.push("/home");
    } catch (error) {
      setSubmitting(false);
      setErrorMessage(toErrorMessage(error, "Could not leave this group right now."));
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <Button
        type="button"
        size="lg"
        variant="link"
        onClick={() => void leaveGroup()}
        disabled={submitting}
        className="w-full text-destructive hover:text-destructive"
      >
        {submitting ? "Leaving..." : "Leave group"}
      </Button>
      {errorMessage ? (
        <p role="alert" className="text-center text-sm text-destructive [overflow-wrap:anywhere]">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function readCurrentGroupJoinPath(): string {
  if (typeof window === "undefined") {
    return "/home";
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
