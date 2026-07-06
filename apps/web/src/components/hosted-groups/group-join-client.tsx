"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { HostedVaultShareProjectionKind } from "@murphai/hosted-execution/vault-share";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { toErrorMessage } from "@/src/components/settings/hosted-settings-sync-helpers";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

export interface GroupJoinPermissionDisplay {
  description: string;
  label: string;
  projectionKind: HostedVaultShareProjectionKind;
}

export function GroupJoinSignInButton() {
  const [open, setOpen] = useState(false);

  function handleCompleted() {
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
  groupName: string;
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
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="size-6" strokeWidth={2.5} />
        </div>
        <p className="text-base font-medium text-foreground">
          {props.alreadyActiveMember ? "Your sharing is updated." : `You're in ${props.groupName}.`}
        </p>
        <Button type="button" size="xl" onClick={() => router.push("/home")} className="w-full">
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
              You can join either way, and change this anytime from this link.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            {props.permissions.map((permission) => {
              const checked = selected.has(permission.projectionKind);
              return (
                <label
                  key={permission.projectionKind}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors",
                    checked
                      ? "border-primary bg-primary/[0.06]"
                      : "border-border bg-card hover:border-primary/40",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => togglePermission(permission.projectionKind)}
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
                    <span className="text-sm font-semibold text-foreground">{permission.label}</span>
                    <span className="text-[13px] leading-5 text-muted-foreground">
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
            ? props.alreadyActiveMember
              ? "Saving..."
              : "Joining..."
            : props.alreadyActiveMember
              ? "Save changes"
              : `Join ${props.groupName}`}
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
