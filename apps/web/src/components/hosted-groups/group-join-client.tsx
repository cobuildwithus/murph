"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  buildHostedVaultShareProjectionScopeKey,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import {
  JoinInviteSignOutButtonIsland,
} from "@/src/components/hosted-onboarding/join-invite-islands";
import {
  groupJoinPermissionsForDisplay,
  type GroupJoinPermissionGroup,
} from "@/src/components/hosted-groups/group-join-permission-groups";
import {
  LINK_PAGE_GOLD,
  LINK_PAGE_LINK_CLASS,
  LINK_PAGE_NIGHT_TOKENS,
  LINK_PAGE_PILL_CLASS,
  LinkPageError,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
  linkPageHeadline,
} from "@/src/components/link-page/link-page-shell";
import { LinkPageSignInScreen } from "@/src/components/link-page/link-page-sign-in";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { toErrorMessage } from "@/src/components/settings/hosted-settings-sync-helpers";
import { Button } from "@/src/components/ui/button";
import {
  buildGroupJoinPostAuthReturnPath,
  type GroupJoinPostJoinDestination,
} from "@/src/lib/hosted-groups/group-join-handoff";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import type { HostedAuthenticationCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

const GROUP_JOIN_RETURN_LABEL = "Back to Murph";
const GROUP_JOIN_SETUP_LABEL = "Finish setting up Murph";
// A member's short list leaves Clear all out; a long one keeps the one-tap exit.
const GROUP_JOIN_LONG_LIST_LENGTH = 12;
const GROUP_JOIN_PEOPLE_TONES = ["#5A6E32", "#8B5D3F", "#B4935A", "#6B7F86"];

export interface GroupJoinPermissionDisplay {
  description: string;
  label: string;
  legacyProjectionScope?: HostedVaultShareProjectionScope;
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

export function GroupJoinSignIn(input: {
  detail: string;
  inviteCode?: string | null;
  memberCount: number;
  title: string;
}) {
  function handleCompleted(payload: HostedAuthenticationCompletionPayload) {
    navigateHostedAuthRedirect(buildGroupJoinPostAuthReturnPath({
      currentPath: readCurrentGroupJoinPath(),
      payload,
    }));
  }

  return (
    <LinkPageSignInScreen
      detail={input.detail}
      inviteCode={input.inviteCode}
      // A group-join invite reached by cold outreach is phone-bound: the
      // provisional member was created from an inbound text, and
      // authentication-service resolves that invite to the phone method and
      // rejects an account without a verified phone. Offering Telegram or email here
      // would let someone finish an entire sign-in that cannot complete.
      {...(input.inviteCode ? { methods: ["phone"] as const } : {})}
      onCompleted={handleCompleted}
      title={input.title}
    >
      <GroupJoinPeople memberCount={input.memberCount} />
    </LinkPageSignInScreen>
  );
}

export function GroupJoinLegalConsentGate({
  detail,
  initialStatus,
  leaveAction,
  notNowHref,
  title,
}: {
  detail: string;
  initialStatus: HostedConsentStatus | null;
  leaveAction?: ReactNode;
  notNowHref: GroupJoinPostJoinDestination;
  title: string;
}) {
  const router = useRouter();

  function refreshRoute() {
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col" style={LINK_PAGE_NIGHT_TOKENS}>
      <LinkPageScreen
        actions={
          <>
            <Link className={LINK_PAGE_LINK_CLASS} href={notNowHref}>
              Not now
            </Link>
            {leaveAction}
          </>
        }
        announceDetail={false}
        detail={detail}
        title={title}
      >
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
      </LinkPageScreen>
    </div>
  );
}

export function GroupJoinSuccess(props: {
  alreadyActiveMember: boolean;
  groupName: string;
  memberCount: number;
  postJoinContactOption: MurphContactOption | null;
  postJoinDestination: GroupJoinPostJoinDestination;
}) {
  const returnLabel = props.postJoinDestination === "/join"
    ? GROUP_JOIN_SETUP_LABEL
    : GROUP_JOIN_RETURN_LABEL;

  return (
    <LinkPageScreen
      actions={
        props.postJoinContactOption ? (
          <MurphContactLink
            actionLabel={returnLabel}
            className={LINK_PAGE_PILL_CLASS}
            option={props.postJoinContactOption}
          >
            {returnLabel}
          </MurphContactLink>
        ) : (
          <Link className={LINK_PAGE_PILL_CLASS} href={props.postJoinDestination}>
            {returnLabel}
          </Link>
        )
      }
      title={
        props.alreadyActiveMember
          ? "Your sharing is updated."
          : linkPageHeadline(`You're in ${props.groupName}`)
      }
    >
      {props.alreadyActiveMember ? null : (
        <GroupJoinPeople joined memberCount={props.memberCount} />
      )}
    </LinkPageScreen>
  );
}

export function GroupJoinAcceptForm(props: {
  activeVaultShareProjectionScopes: readonly HostedVaultShareProjectionScope[];
  alreadyActiveMember: boolean;
  expectedMembershipId: string | null;
  /** The sentence for a group with nothing to choose. */
  detail: string;
  groupName: string;
  inviteCode?: string | null;
  joinCode: string;
  leaveAction?: ReactNode;
  memberCount: number;
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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  const hasChoices = permissionGroups.length > 0;
  const showClearAll = !props.alreadyActiveMember
    || permissionGroups.length > GROUP_JOIN_LONG_LIST_LENGTH;
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
        memberCount={props.memberCount}
        postJoinContactOption={props.postJoinContactOption}
        postJoinDestination={props.postJoinDestination}
      />
    );
  }

  if (inviteMismatch) {
    return <GroupJoinInviteMismatchRecovery />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={LINK_PAGE_NIGHT_TOKENS}>
      <LinkPageScreen
        actions={
          <>
            {errorMessage ? <LinkPageError>{errorMessage}</LinkPageError> : null}
            <LinkPagePill
              disabled={status === "submitting"}
              onClick={() => void submit()}
            >
              {status === "submitting"
                ? props.alreadyActiveMember
                  ? "Saving..."
                  : "Joining..."
                : props.alreadyActiveMember
                  ? "Save changes"
                  : "Join group"}
            </LinkPagePill>
            {/* Leave group takes the quiet place, unless setup is still owed. */}
            {props.leaveAction && props.postJoinDestination !== "/join" ? null : (
              <Link className={LINK_PAGE_LINK_CLASS} href={props.postJoinDestination}>
                {secondaryLabel}
              </Link>
            )}
            {props.leaveAction}
          </>
        }
        announceDetail={false}
        detail={
          hasChoices ? (
            <>
              {props.alreadyActiveMember
                ? "Uncheck to stop sharing."
                : "The last 90 days of what you pick."}{" "}
              <Button
                className="relative font-semibold text-[#FFFCF6] underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3"
                onClick={() => setDetailsOpen(true)}
                size="unstyled"
                type="button"
                variant="unstyled"
              >
                Details
              </Button>
            </>
          ) : props.detail
        }
        fill={hasChoices}
        title={linkPageHeadline(
          props.alreadyActiveMember
            ? `You're in ${props.groupName}`
            : `Join ${props.groupName}`,
        )}
      >
        {hasChoices ? (
          <>
            <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 px-0.5 pt-2">
              <p
                aria-live="polite"
                className="text-sm font-semibold leading-5 text-[#FFFCF6]/60 tabular-nums"
              >
                Sharing {selectedPermissionGroupCount} of {permissionGroups.length}
              </p>
              {showClearAll ? (
                <Button
                  className="min-h-10 shrink-0 rounded-lg px-0.5 text-sm font-semibold text-[#FFFCF6]"
                  disabled={status === "submitting" || selectedPermissionGroupCount === 0}
                  onClick={() => setSelected(() => new Set())}
                  size="unstyled"
                  type="button"
                  variant="unstyled"
                >
                  Clear all
                </Button>
              ) : null}
            </div>
            <div
              aria-label="Sharing choices"
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain rounded-[18px] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              role="region"
              tabIndex={0}
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
                    className="shrink-0 overflow-hidden rounded-[18px] bg-[#2A2622] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring"
                  >
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-[15px]">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => togglePermissionGroup(
                          group.scopeKeys,
                          group.legacyScopeKeys,
                        )}
                      />
                      <span className="min-w-0 flex-1 break-words text-[17px] font-semibold leading-[22px]">
                        {group.label}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-[26px] shrink-0 items-center justify-center rounded-full",
                          checked
                            ? "bg-[#FFFCF6] text-[#2D3436]"
                            : "border-[1.5px] border-[#FFFCF6]/35",
                        )}
                      >
                        {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <GroupJoinPeople memberCount={props.memberCount} />
        )}
      </LinkPageScreen>
      <GroupJoinDetailsDrawer
        choices={permissionGroups}
        onOpenChange={setDetailsOpen}
        open={detailsOpen}
      />
    </div>
  );
}

export function GroupJoinInviteMismatchRecovery() {
  return (
    <LinkPageScreen
      actions={
        <JoinInviteSignOutButtonIsland
          className={LINK_PAGE_PILL_CLASS}
          idleLabel="Sign out and continue"
          size="unstyled"
          variant="unstyled"
        />
      }
      detail="This browser is signed into a different Murph account. Sign out, then verify the phone number that received this invite."
      title="Use the invited phone number."
    />
  );
}

export function GroupJoinLeaveButton(props: {
  groupName: string;
  joinCode: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function leaveGroup() {
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
    <>
      <LinkPageLink
        className="text-base"
        disabled={submitting}
        onClick={() => {
          setErrorMessage(null);
          setOpen(true);
        }}
      >
        Leave group
      </LinkPageLink>
      <GroupJoinLeaveDrawer
        errorMessage={errorMessage}
        groupName={props.groupName}
        onConfirm={() => void leaveGroup()}
        onOpenChange={setOpen}
        open={open}
        submitting={submitting}
      />
    </>
  );
}

export function GroupJoinDetailsDrawer({
  choices,
  onOpenChange,
  open,
}: {
  choices: readonly Pick<GroupJoinPermissionGroup, "description" | "key" | "label">[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <DialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <GroupJoinDrawer
        detail="Your name and what you pick from the last 90 days, in the chat and the Murph app. Everything else stays private."
        title="What they’ll see"
      >
        <dl
          aria-label="What each choice shares"
          className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-lg outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          role="region"
          tabIndex={0}
        >
          {choices.map((choice) => (
            <div className="flex flex-col gap-px" key={choice.key}>
              <dt className="text-base font-semibold leading-[22px]">{choice.label}</dt>
              <dd className="text-[15px] font-medium leading-5 text-[#FFFCF6]/60 [overflow-wrap:anywhere]">
                {choice.description}
              </dd>
            </div>
          ))}
        </dl>
        <footer className="flex shrink-0 flex-col items-center">
          <DialogPrimitive.Close render={<LinkPageLink className="text-base" />}>
            Done
          </DialogPrimitive.Close>
        </footer>
      </GroupJoinDrawer>
    </DialogPrimitive.Root>
  );
}

export function GroupJoinLeaveDrawer({
  errorMessage = null,
  groupName,
  onConfirm,
  onOpenChange,
  open,
  submitting = false,
}: {
  errorMessage?: string | null;
  groupName: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  submitting?: boolean;
}) {
  return (
    <AlertDialogPrimitive.Root
      onOpenChange={(next) => {
        if (!submitting) {
          onOpenChange(next);
        }
      }}
      open={open}
    >
      <GroupJoinDrawer
        detail="Sharing stops and Murph starts cleaning up its copies. You stay in the iMessage chat, and past messages, backups, and copies outside Murph aren’t erased."
        title={`Leave ${groupName}?`}
      >
        <footer className="flex shrink-0 flex-col items-center gap-1.5">
          {errorMessage ? <LinkPageError>{errorMessage}</LinkPageError> : null}
          <LinkPagePill
            className="bg-[#2A2622] text-[#E27B6E]"
            disabled={submitting}
            onClick={onConfirm}
          >
            {submitting ? "Leaving..." : "Leave group"}
          </LinkPagePill>
          <DialogPrimitive.Close
            disabled={submitting}
            render={<LinkPageLink className="text-base" />}
          >
            Stay
          </DialogPrimitive.Close>
        </footer>
      </GroupJoinDrawer>
    </AlertDialogPrimitive.Root>
  );
}

function GroupJoinDrawer({
  children,
  detail,
  title,
}: {
  children: ReactNode;
  detail: string;
  title: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 isolate z-50 bg-[#0B0A08]/70 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
      <DialogPrimitive.Popup
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] w-auto flex-col gap-4 rounded-t-[28px] bg-[#1F1C19] px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-7 text-[#FFFCF6] duration-150 outline-none data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:pb-7"
        data-component="group-join-drawer"
        style={LINK_PAGE_NIGHT_TOKENS}
      >
        <header className="flex shrink-0 flex-col gap-2 text-left">
          <DialogPrimitive.Title className="text-balance font-serif text-[30px] font-semibold leading-[34px] tracking-[-0.01em]">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-pretty text-base font-medium leading-[22px] text-[#FFFCF6]/60">
            {detail}
          </DialogPrimitive.Description>
        </header>
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

/** The people in the group and a place for you, filled once you've joined. */
function GroupJoinPeople({
  joined = false,
  memberCount,
}: {
  joined?: boolean;
  memberCount: number;
}) {
  return (
    <div aria-hidden="true" className="flex items-center justify-center">
      {GROUP_JOIN_PEOPLE_TONES.slice(0, memberCount).map((tone, index) => (
        <span
          className={cn(
            "size-[68px] shrink-0 rounded-full border-4 border-[#1C1915]",
            index > 0 && "-ml-5",
          )}
          key={tone}
          style={{ background: tone }}
        />
      ))}
      <span
        className={cn(
          "flex size-[68px] shrink-0 items-center justify-center rounded-full text-[15px] leading-5",
          memberCount > 0 && (joined ? "-ml-5" : "-ml-4"),
          joined
            ? "border-4 border-[#1C1915] font-bold text-[#3B2A12]"
            : "border-2 border-dashed border-[#FFFCF6]/50 bg-[#1C1915] font-semibold",
        )}
        style={joined ? { background: LINK_PAGE_GOLD } : undefined}
      >
        You
      </span>
    </div>
  );
}

function readCurrentGroupJoinPath(): string {
  if (typeof window === "undefined") {
    return "/home";
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
