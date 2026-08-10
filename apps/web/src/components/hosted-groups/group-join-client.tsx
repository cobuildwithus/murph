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
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import {
  JoinInviteSignOutButtonIsland,
} from "@/src/components/hosted-onboarding/join-invite-islands";
import { groupJoinPermissionsForDisplay } from "@/src/components/hosted-groups/group-join-permission-groups";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { toErrorMessage } from "@/src/components/settings/hosted-settings-sync-helpers";
import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  buildGroupJoinPostAuthReturnPath,
  type GroupJoinPostJoinDestination,
} from "@/src/lib/hosted-groups/group-join-handoff";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

const GROUP_JOIN_RETURN_LABEL = "Back to Murph";
const GROUP_JOIN_SETUP_LABEL = "Finish setting up Murph";

export interface GroupJoinPermissionDisplay {
  description: string;
  label: string;
  legacyProjectionScope?: HostedVaultShareProjectionScope;
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

export function GroupJoinSignInButton(input: {
  inviteCode?: string | null;
}) {
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
        inviteCode={input.inviteCode}
        // A group-join invite reached by cold outreach is phone-bound: the
        // provisional member was created from an inbound text, and
        // authentication-service resolves that invite to the phone method and
        // rejects a Privy identity without one. Offering Telegram or email here
        // would let someone finish an entire sign-in that cannot complete.
        {...(input.inviteCode ? { methods: ["phone"] as const } : {})}
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
  notNowHref,
}: {
  initialStatus: HostedConsentStatus | null;
  notNowHref: GroupJoinPostJoinDestination;
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
        href={notNowHref}
        className="inline-flex min-h-10 items-center justify-center text-center text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Not now
      </Link>
    </div>
  );
}

export function GroupJoinSuccess(props: {
  alreadyActiveMember: boolean;
  groupName: string;
  postJoinContactOption: MurphContactOption | null;
  postJoinDestination: GroupJoinPostJoinDestination;
}) {
  const returnLabel = props.postJoinDestination === "/join"
    ? GROUP_JOIN_SETUP_LABEL
    : GROUP_JOIN_RETURN_LABEL;

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Check className="size-6" strokeWidth={2.5} />
      </div>
      <p className="text-base font-medium text-foreground" role="status">
        {props.alreadyActiveMember ? "Your sharing is updated." : `You're in ${props.groupName}.`}
      </p>
      {props.postJoinContactOption ? (
        <MurphContactLink
          actionLabel={returnLabel}
          className={buttonVariants({ className: "w-full", size: "xl" })}
          option={props.postJoinContactOption}
        >
          {returnLabel}
        </MurphContactLink>
      ) : (
        <Button
          render={<Link href={props.postJoinDestination} />}
          nativeButton={false}
          size="xl"
          className="w-full"
        >
          {returnLabel}
        </Button>
      )}
    </div>
  );
}

export function GroupJoinAcceptForm(props: {
  activeVaultShareProjectionScopes: readonly HostedVaultShareProjectionScope[];
  alreadyActiveMember: boolean;
  expectedMembershipId: string | null;
  groupName: string;
  inviteCode?: string | null;
  joinCode: string;
  permissions: readonly GroupJoinPermissionDisplay[];
  postJoinContactOption: MurphContactOption | null;
  postJoinDestination: GroupJoinPostJoinDestination;
}) {
  const router = useRouter();
  const initialSelectedScopeKeys = useMemo(
    () =>
      props.alreadyActiveMember
        ? props.activeVaultShareProjectionScopes.map(buildHostedVaultShareProjectionScopeKey)
        : props.permissions.map((permission) => permission.projectionScopeKey),
    [props.alreadyActiveMember, props.activeVaultShareProjectionScopes, props.permissions],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedScopeKeys),
  );
  const [status, setStatus] = useState<"idle" | "submitting" | "joined">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inviteMismatch, setInviteMismatch] = useState(false);
  const selectedVaultShareProjectionScopes = useMemo(
    () => props.permissions.flatMap((permission) => {
      const selectedScopes: HostedVaultShareProjectionScope[] = [];
      if (selected.has(permission.projectionScopeKey)) {
        selectedScopes.push(permission.projectionScope);
      }
      if (
        permission.legacyProjectionScope
        && selected.has(buildHostedVaultShareProjectionScopeKey(
          permission.legacyProjectionScope,
        ))
      ) {
        selectedScopes.push(permission.legacyProjectionScope);
      }
      return selectedScopes;
    }),
    [props.permissions, selected],
  );

  const permissionGroups = useMemo(
    () => groupJoinPermissionsForDisplay(
      props.permissions,
      new Set(initialSelectedScopeKeys),
    ),
    [props.permissions, initialSelectedScopeKeys],
  );
  const usesScrollablePermissionReview = permissionGroups.length > 12;
  const selectedPermissionGroupCount = permissionGroups.reduce(
    (count, group) => (
      group.scopeKeys.every((scopeKey) => selected.has(scopeKey))
      || group.legacyScopeKeys.some((scopeKey) => selected.has(scopeKey))
        ? count + 1
        : count
    ),
    0,
  );
  const secondaryLabel = props.postJoinDestination === "/join"
    ? GROUP_JOIN_SETUP_LABEL
    : props.alreadyActiveMember
      ? "Go home"
      : "Not now";

  function togglePermissionGroup(
    scopeKeys: readonly string[],
    legacyScopeKeys: readonly string[],
  ) {
    setSelected((current) => {
      const next = new Set(current);
      const active = scopeKeys.every((scopeKey) => next.has(scopeKey))
        || legacyScopeKeys.some((scopeKey) => next.has(scopeKey));
      for (const scopeKey of [...scopeKeys, ...legacyScopeKeys]) {
        next.delete(scopeKey);
      }
      if (!active) {
        for (const scopeKey of scopeKeys) {
          next.add(scopeKey);
        }
      }
      return next;
    });
  }

  function upgradeLegacyPermissionGroup(
    scopeKeys: readonly string[],
    legacyScopeKeys: readonly string[],
  ) {
    setSelected((current) => {
      const next = new Set(current);
      for (const scopeKey of legacyScopeKeys) {
        next.delete(scopeKey);
      }
      for (const scopeKey of scopeKeys) {
        next.add(scopeKey);
      }
      return next;
    });
  }

  async function submit() {
    setErrorMessage(null);
    setInviteMismatch(false);
    setStatus("submitting");
    try {
      await requestHostedOnboardingJson({
        method: "POST",
        payload: {
          expectedMembershipId: props.expectedMembershipId,
          ...(props.inviteCode ? { inviteCode: props.inviteCode } : {}),
          selectedVaultShareProjectionScopes,
        },
        url: `/api/groups/join/${encodeURIComponent(props.joinCode)}/accept`,
      });
    } catch (error) {
      setStatus("idle");
      if (
        props.inviteCode
        && error instanceof HostedOnboardingApiError
        && error.code === "AUTH_INVITE_MISMATCH"
      ) {
        setInviteMismatch(true);
        return;
      }
      setErrorMessage(toErrorMessage(error, "Could not join this group right now."));
      return;
    }

    setStatus("joined");
    if (props.postJoinDestination === "/join") {
      router.replace(props.postJoinDestination);
    }
  }

  if (status === "joined") {
    return (
      <GroupJoinSuccess
        alreadyActiveMember={props.alreadyActiveMember}
        groupName={props.groupName}
        postJoinContactOption={props.postJoinContactOption}
        postJoinDestination={props.postJoinDestination}
      />
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
            {usesScrollablePermissionReview ? (
              <div className="flex min-h-10 items-center justify-between gap-3">
                <p
                  aria-live="polite"
                  className="text-[12px] leading-5 text-muted-foreground tabular-nums"
                >
                  {selectedPermissionGroupCount} of {permissionGroups.length} choices selected. Scroll to review every choice.
                </p>
                <Button
                  className="min-h-10 shrink-0 px-2 text-xs text-muted-foreground"
                  disabled={status === "submitting" || selectedPermissionGroupCount === 0}
                  onClick={() => setSelected(() => new Set())}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Clear optional sharing
                </Button>
              </div>
            ) : null}
          </div>
          <div
            aria-label={usesScrollablePermissionReview ? "Sharing choices" : undefined}
            className={cn(
              "flex flex-col gap-2.5",
              usesScrollablePermissionReview
                ? "max-h-[26rem] overflow-y-auto overscroll-contain rounded-xl pr-1"
                : null,
            )}
            role={usesScrollablePermissionReview ? "region" : undefined}
            tabIndex={usesScrollablePermissionReview ? 0 : undefined}
          >
            {permissionGroups.map((group) => {
              const currentSelected = group.scopeKeys.every((scopeKey) =>
                selected.has(scopeKey)
              );
              const legacySelected = !currentSelected && group.legacyScopeKeys.some(
                (scopeKey) => selected.has(scopeKey),
              );
              const checked = currentSelected || legacySelected;
              return (
                <div
                  key={group.key}
                  className={cn(
                    "shrink-0 overflow-hidden rounded-xl border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    checked
                      ? "border-primary bg-primary/[0.06]"
                      : "border-border bg-card hover:border-primary/40",
                  )}
                >
                  <label className="flex cursor-pointer gap-3 p-3.5">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => togglePermissionGroup(
                        group.scopeKeys,
                        group.legacyScopeKeys,
                      )}
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
                        {legacySelected
                          ? "Currently shares one daily value only. Source names and recorded times are not shared."
                          : group.description}
                      </span>
                    </span>
                  </label>
                  {legacySelected ? (
                    <div className="flex flex-col items-stretch gap-2 border-t border-primary/15 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-xs leading-4 text-muted-foreground">
                        Add source names and recorded times.
                      </span>
                      <Button
                        className="w-full shrink-0 sm:w-auto"
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => upgradeLegacyPermissionGroup(
                          group.scopeKeys,
                          group.legacyScopeKeys,
                        )}
                      >
                        Include source details
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {inviteMismatch ? (
          <GroupJoinInviteMismatchRecovery />
        ) : (
          <>
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
          </>
        )}
      </div>
      <Link
        href={props.postJoinDestination}
        className="inline-flex min-h-10 items-center justify-center text-center text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {secondaryLabel}
      </Link>
    </div>
  );
}

export function GroupJoinInviteMismatchRecovery() {
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/40 p-4"
      role="alert"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">
          Use the invited phone number
        </p>
        <p className="text-sm leading-5 text-muted-foreground">
          This browser is signed into a different Murph account. Sign out, then
          verify the phone number that received this invite.
        </p>
      </div>
      <JoinInviteSignOutButtonIsland idleLabel="Sign out and continue" />
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
