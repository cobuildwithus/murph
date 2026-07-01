"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { HostedVaultShareProjectionKind } from "@murphai/hosted-execution/vault-share";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { toErrorMessage } from "@/src/components/settings/hosted-settings-sync-helpers";
import { Button } from "@/src/components/ui/button";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

export interface GroupJoinPermissionDisplay {
  description: string;
  label: string;
  projectionKind: HostedVaultShareProjectionKind;
}

export function GroupJoinSignInButton() {
  const [open, setOpen] = useState(false);

  function handleCompleted(_payload: HostedPrivyCompletionPayload) {
    navigateHostedAuthRedirect(readCurrentGroupJoinPath());
  }

  return (
    <>
      <Button type="button" size="xl" onClick={() => setOpen(true)}>
        Sign in to join
      </Button>
      <AuthDialog
        open={open}
        onCompleted={handleCompleted}
        onOpenChange={setOpen}
        requireLaunchConsentOnCompletion
        title="Sign in to join this Murph group"
        description="Create or open your private Murph account, then we'll bring you back here."
      />
    </>
  );
}

export function GroupJoinAcceptForm(props: {
  activeVaultShareProjectionKinds: readonly HostedVaultShareProjectionKind[];
  alreadyActiveMember: boolean;
  joinCode: string;
  permissions: readonly GroupJoinPermissionDisplay[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<HostedVaultShareProjectionKind>>(
    () => new Set(props.alreadyActiveMember ? props.activeVaultShareProjectionKinds : []),
  );
  const [status, setStatus] = useState<"idle" | "submitting" | "joined">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedVaultShareProjectionKinds = useMemo(
    () => props.permissions
      .map((permission) => permission.projectionKind)
      .filter((projectionKind) => selected.has(projectionKind)),
    [props.permissions, selected],
  );

  function togglePermission(projectionKind: HostedVaultShareProjectionKind) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(projectionKind)) {
        next.delete(projectionKind);
      } else {
        next.add(projectionKind);
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
        payload: { selectedVaultShareProjectionKinds },
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
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-foreground">
          {props.alreadyActiveMember ? "Your group permissions are saved." : "You're in this Murph group."}
        </p>
        <Button type="button" size="xl" onClick={() => router.push("/home")}>
          Open Murph
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {props.permissions.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground">
              Optional permissions requested by this group
            </h2>
            <p className="text-sm text-muted-foreground">
              You can join either way. You can change these choices later from this link.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {props.permissions.map((permission) => {
              const checked = selected.has(permission.projectionKind);
              return (
                <label key={permission.projectionKind} className="flex gap-3 rounded-xl border border-border p-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0"
                    checked={checked}
                    onChange={() => togglePermission(permission.projectionKind)}
                  />
                  <span className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-foreground">{permission.label}</span>
                    <span className="text-sm leading-5 text-muted-foreground">
                      {permission.description}
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
            ? "Saving..."
            : props.alreadyActiveMember
              ? "Save group permissions"
              : selectedVaultShareProjectionKinds.length > 0
                ? "Join group"
                : "Join group without sharing"}
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

function readCurrentGroupJoinPath(): string {
  if (typeof window === "undefined") {
    return "/home";
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
