"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { HOSTED_PHONE_COUNTRY_OPTIONS } from "@/src/components/hosted-onboarding/hosted-phone-country-options";
import { usePhoneCountryCode } from "@/src/components/hosted-onboarding/phone-country-code-client-provider";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { PhoneNumberInput } from "@/src/components/ui/phone-number-input";
import { SegmentedControl } from "@/src/components/ui/segmented-control";
import type { HostedFamilyPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import {
  normalizeHostedEmailAddress,
  normalizeHostedTelegramUsernameForLookup,
} from "@/src/lib/hosted-onboarding/contact-normalization";
import { normalizePhoneNumberForCountry } from "@/src/lib/hosted-onboarding/phone";

import { toErrorMessage } from "./hosted-settings-sync-helpers";
import {
  HostedUsageTopUpDialog,
  type HostedUsageTopUpActivePurchase,
  type HostedUsageTopUpOffer,
  type HostedUsageTopUpReturn,
} from "./hosted-usage-top-up-dialog";

export interface FamilyManagerTier {
  name: string;
  planCode: HostedFamilyPlanCode;
  priceLabel: string;
  recurringAmountUsdCents: number;
}

export interface FamilyManagerMember {
  isOwner: boolean;
  joinedAtIso: string | null;
  label: string | null;
  memberId: string;
  pendingPlanCode: HostedFamilyPlanCode | null;
  planCode: HostedFamilyPlanCode;
}

export interface FamilyManagerInvite {
  acceptUrl: string | null;
  channel: string;
  expiresAtIso: string;
  id: string;
  planCode: HostedFamilyPlanCode;
  targetEmail: string | null;
  targetLabel: string | null;
  targetPhoneHint: string | null;
  targetTelegramUsername: string | null;
  telegramInviteUrl: string | null;
}

interface CreatedFamilyInvite {
  acceptUrl: string | null;
  id: string;
  planCode: HostedFamilyPlanCode;
  targetEmail?: string | null;
  targetLabel: string | null;
  targetPhoneHint: string | null;
  targetTelegramUsername?: string | null;
  telegramInviteUrl: string | null;
}

function inviteContacts(invite: FamilyManagerInvite): string[] {
  return [
    invite.targetEmail,
    invite.targetTelegramUsername ? `@${invite.targetTelegramUsername}` : null,
    invite.targetPhoneHint,
  ].filter((value): value is string => Boolean(value));
}

function inviteDisplayName(invite: FamilyManagerInvite): string {
  return invite.targetLabel ?? inviteContacts(invite)[0] ?? "Pending invite";
}

function inviteShareLink(invite: {
  acceptUrl: string | null;
  targetTelegramUsername?: string | null;
  telegramInviteUrl: string | null;
}): string | null {
  if (invite.targetTelegramUsername && invite.telegramInviteUrl) {
    return invite.telegramInviteUrl;
  }
  return invite.acceptUrl ?? invite.telegramInviteUrl;
}

type PendingAction =
  | { id: string; kind: "cancel-invite"; label: string }
  | { id: string; kind: "remove-member"; label: string }
  | {
      canRemove: boolean;
      from: HostedFamilyPlanCode;
      id: string;
      isOwner: boolean;
      kind: "change-plan";
      label: string;
      recovery?: true;
      targetLocked: boolean;
      to: HostedFamilyPlanCode;
    };

type InviteChannel = "imessage" | "email" | "telegram";

const INVITE_CHANNEL_OPTIONS: ReadonlyArray<{
  label: string;
  value: InviteChannel;
}> = [
  { label: "iMessage", value: "imessage" },
  { label: "Email", value: "email" },
  { label: "Telegram", value: "telegram" },
];
const DIALOG_CLASS =
  "max-w-md gap-6 border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7";
const DEFAULT_INVITE_PHONE_COUNTRY_CODE = "US";

function resolveInvitePhoneCountryOption(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? null;
  const option =
    (normalized
      ? HOSTED_PHONE_COUNTRY_OPTIONS.find((candidate) => candidate.code === normalized)
      : null)
    ?? HOSTED_PHONE_COUNTRY_OPTIONS.find(
      (candidate) => candidate.code === DEFAULT_INVITE_PHONE_COUNTRY_CODE,
    )
    ?? HOSTED_PHONE_COUNTRY_OPTIONS[0];
  if (!option) {
    throw new Error("Phone country options are empty.");
  }
  return option;
}

function resolveFamilyOwnerRecoveryAction(input: {
  billingActive: boolean;
  members: FamilyManagerMember[];
  tiers: FamilyManagerTier[];
}): Extract<PendingAction, { kind: "change-plan" }> | null {
  if (!input.billingActive) {
    return null;
  }
  const owner = input.members.find((member) => member.isOwner);
  if (!owner || owner.pendingPlanCode !== null) {
    return null;
  }
  const currentTier = input.tiers.find(
    (tier) => tier.planCode === owner.planCode,
  );
  if (!currentTier) {
    return null;
  }
  const targetTier = input.tiers
    .filter(
      (tier) => tier.recurringAmountUsdCents > currentTier.recurringAmountUsdCents,
    )
    .sort(
      (left, right) => left.recurringAmountUsdCents - right.recurringAmountUsdCents,
    )[0];
  if (!targetTier) {
    return null;
  }
  return {
    canRemove: false,
    from: owner.planCode,
    id: owner.memberId,
    isOwner: true,
    kind: "change-plan",
    label: "you",
    recovery: true,
    targetLocked: true,
    to: targetTier.planCode,
  };
}

export function HostedFamilyManager(props: {
  billingActive: boolean;
  invites: FamilyManagerInvite[];
  members: FamilyManagerMember[];
  plans: Record<HostedFamilyPlanCode, {
    active: number;
    billed: number;
    invited: number;
    remaining: number;
    used: number;
  }>;
  payerMemberId: string;
  seats: {
    active: number;
    billed: number;
    invited: number;
    max: number;
    min: number;
    remaining: number;
    used: number;
  };
  tiers: FamilyManagerTier[];
  usageTopUpActiveMemberId?: string | null;
  usageTopUpActivePurchase?: HostedUsageTopUpActivePurchase | null;
  usageTopUpOffers?: readonly HostedUsageTopUpOffer[];
  usageTopUpPurchaseReturn?: HostedUsageTopUpReturn | null;
  usageTopUpReturnMemberId?: string | null;
  usageRecoveryAvailable?: boolean;
  usageRecoveryInitialOpen?: boolean;
}) {
  const router = useRouter();
  const familyRecoveryAction = resolveFamilyOwnerRecoveryAction(props);
  const visibleFamilyRecoveryAction = props.usageRecoveryAvailable
    ? familyRecoveryAction
    : null;
  const [inviteOpen, setInviteOpen] = useState(false);
  const phoneCountryCodeHint = usePhoneCountryCode();
  const [phoneCountryCode, setPhoneCountryCode] = useState(() =>
    resolveInvitePhoneCountryOption(phoneCountryCodeHint).code
  );
  const [inviteChannel, setInviteChannel] = useState<InviteChannel>("imessage");
  const [invitePlanCode, setInvitePlanCode] = useState<HostedFamilyPlanCode>("pulse");
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [telegram, setTelegram] = useState("");
  const [email, setEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<CreatedFamilyInvite | null>(null);
  const [createdInviteCopied, setCreatedInviteCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(() =>
    props.usageRecoveryInitialOpen ? visibleFamilyRecoveryAction : null
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const returnedActiveMember = props.usageTopUpReturnMemberId
    ? props.members.find(
        (member) =>
          member.memberId === props.usageTopUpReturnMemberId &&
          member.memberId !== props.payerMemberId,
      ) ?? null
    : null;

  const invitePlan = props.tiers.find((tier) => tier.planCode === invitePlanCode)
    ?? props.tiers[0];
  if (!invitePlan) {
    throw new Error("Family tiers are empty.");
  }
  const invitePlanStatus = props.plans[invitePlan.planCode];
  const seatsFull = invitePlanStatus.remaining <= 0;
  const selectedPhoneCountry = useMemo(
    () => resolveInvitePhoneCountryOption(phoneCountryCode),
    [phoneCountryCode],
  );
  const normalizedPhone = useMemo(
    () => normalizePhoneNumberForCountry(phone, selectedPhoneCountry.dialCode),
    [phone, selectedPhoneCountry.dialCode],
  );
  const trimmedLabel = label.trim();
  const trimmedEmail = email.trim();
  const trimmedTelegram = telegram.trim();
  const normalizedEmail = normalizeHostedEmailAddress(email);
  const normalizedTelegram = normalizeHostedTelegramUsernameForLookup(telegram);
  const activeContactInput = (() => {
    if (inviteChannel === "imessage") {
      return phone.trim();
    }
    if (inviteChannel === "email") {
      return trimmedEmail;
    }
    return trimmedTelegram;
  })();
  const planCanGrow = props.billingActive && seatsFull && props.seats.billed < props.seats.max;
  // A paid seat can be added only when the server can reject an existing member
  // by verified phone/email before charging. Telegram usernames dedup invites,
  // but do not identify the member's provider user id.
  const hasAutoSeatIdentity =
    inviteChannel === "imessage"
      ? Boolean(normalizedPhone)
      : inviteChannel === "email"
        ? Boolean(normalizedEmail)
        : false;
  const activeContactInputNoun =
    inviteChannel === "imessage"
      ? "phone number"
      : inviteChannel === "email"
        ? "email"
        : "Telegram username";
  const inviteWillAddSeat = planCanGrow && hasAutoSeatIdentity;
  const inviteNeedsStableTargetForSeat = planCanGrow && !hasAutoSeatIdentity;
  const selectedTierUnavailable = seatsFull && !planCanGrow;
  const inviteSubmitDisabled =
    isInviting || inviteNeedsStableTargetForSeat || selectedTierUnavailable;
  const inviteDisabled = !props.billingActive || props.seats.used >= props.seats.max;
  const createdInviteHasContact = Boolean(
    createdInvite?.targetEmail ||
      createdInvite?.targetPhoneHint ||
      createdInvite?.targetTelegramUsername,
  );
  const familyRecoveryTargetTier = visibleFamilyRecoveryAction
    ? props.tiers.find(
        (tier) => tier.planCode === visibleFamilyRecoveryAction.to,
      ) ?? null
    : null;
  const familyRecoverySourceTier = visibleFamilyRecoveryAction
    ? props.tiers.find(
        (tier) => tier.planCode === visibleFamilyRecoveryAction.from,
      ) ?? null
    : null;
  const pendingTargetTier = pendingAction?.kind === "change-plan"
    ? props.tiers.find((tier) => tier.planCode === pendingAction.to) ?? null
    : null;
  const pendingSourceTier = pendingAction?.kind === "change-plan"
    ? props.tiers.find((tier) => tier.planCode === pendingAction.from) ?? null
    : null;
  const pendingPlanChangeDirection = pendingSourceTier && pendingTargetTier
    ? pendingTargetTier.recurringAmountUsdCents >
        pendingSourceTier.recurringAmountUsdCents
      ? "upgrade"
      : "downgrade"
    : null;

  function resetInviteForm() {
    setInviteChannel("imessage");
    setInvitePlanCode("pulse");
    setLabel("");
    setPhone("");
    setTelegram("");
    setEmail("");
    setInviteError(null);
    setCreatedInvite(null);
    setCreatedInviteCopied(false);
  }

  function changeInviteChannel(nextChannel: InviteChannel) {
    setInviteChannel(nextChannel);
    setInviteError(null);
  }

  async function submitInvite() {
    if (!activeContactInput && !trimmedLabel) {
      setInviteError("Add a name or a contact first.");
      return;
    }
    if (inviteChannel === "imessage" && phone.trim() && !normalizedPhone) {
      setInviteError(`Enter a valid phone number for ${selectedPhoneCountry.label}.`);
      return;
    }
    if (inviteChannel === "email" && trimmedEmail && !normalizedEmail) {
      setInviteError("Enter a valid email address.");
      return;
    }
    if (inviteChannel === "telegram" && trimmedTelegram && !normalizedTelegram) {
      setInviteError("Enter a valid Telegram username.");
      return;
    }
    setInviteError(null);
    setCreatedInvite(null);
    setCreatedInviteCopied(false);
    setIsInviting(true);
    try {
      const response = await requestHostedOnboardingJson<{
        invite: CreatedFamilyInvite;
      }>({
        method: "POST",
        payload: {
          // Only authorize buying a seat when the dialog actually showed the
          // paid-seat cost, so a stale open-seat form never charges silently.
          addSeatIfNeeded: inviteWillAddSeat,
          planCode: invitePlan.planCode,
          targetLabel: trimmedLabel || undefined,
          ...(inviteChannel === "imessage" && normalizedPhone
            ? { targetPhoneNumber: normalizedPhone }
            : {}),
          ...(inviteChannel === "email" && normalizedEmail ? { targetEmail: normalizedEmail } : {}),
          ...(inviteChannel === "telegram" && normalizedTelegram
            ? { targetTelegramUsername: normalizedTelegram }
            : {}),
        },
        url: "/api/settings/billing/family/invite",
      });
      setCreatedInvite({
        ...response.invite,
        targetEmail: inviteChannel === "email" ? normalizedEmail : null,
        targetPhoneHint:
          inviteChannel === "imessage" && normalizedPhone ? response.invite.targetPhoneHint : null,
        targetTelegramUsername: inviteChannel === "telegram" ? normalizedTelegram : null,
      });
      router.refresh();
    } catch (error) {
      // The seat was added but Stripe is still confirming: refresh so the new
      // seat shows, and keep the dialog open so the owner can resend in a moment.
      if (
        error instanceof HostedOnboardingApiError &&
        error.code === "HOSTED_FAMILY_SEAT_ADDED_SYNCING"
      ) {
        router.refresh();
      }
      setInviteError(toErrorMessage(error, "Could not create the invite right now."));
    } finally {
      setIsInviting(false);
    }
  }

  async function confirmPendingAction() {
    if (!pendingAction) {
      return;
    }
    setActionError(null);
    setActionNotice(null);
    setIsActing(true);
    try {
      const url = pendingAction.kind === "cancel-invite"
        ? `/api/settings/billing/family/invite/${encodeURIComponent(pendingAction.id)}`
        : `/api/settings/billing/family/members/${encodeURIComponent(pendingAction.id)}`;
      if (pendingAction.kind === "change-plan") {
        const response = await requestHostedOnboardingJson<{ syncing: boolean }>({
          method: "PATCH",
          payload: { planCode: pendingAction.to },
          url,
        });
        setActionNotice(
          response.syncing
            ? `${pendingAction.isOwner ? "Your plan" : `${pendingAction.label}'s plan`} is updating. Stripe is still syncing.`
            : `${pendingAction.isOwner ? "You are" : `${pendingAction.label} is`} now on ${pendingTargetTier?.name}.`,
        );
      } else {
        await requestHostedOnboardingJson({ method: "DELETE", url });
      }
      setPendingAction(null);
      router.refresh();
    } catch (error) {
      setActionError(
        toErrorMessage(
          error,
          pendingAction.kind === "cancel-invite"
            ? "Could not cancel that invite right now."
            : pendingAction.kind === "remove-member"
              ? "Could not remove that member right now."
            : pendingAction.kind === "change-plan"
                ? pendingAction.isOwner
                  ? "Could not change your tier right now."
                  : "Could not change that member's tier right now."
                : "Could not update your Family plan right now.",
        ),
      );
    } finally {
      setIsActing(false);
    }
  }

  async function copyInviteLink(invite: FamilyManagerInvite) {
    const link = inviteShareLink(invite);
    if (!link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(invite.id);
      window.setTimeout(() => setCopiedId((current) => (current === invite.id ? null : current)), 2_000);
    } catch {
      setCopiedId(null);
    }
  }

  async function copyCreatedInviteLink() {
    if (!createdInvite) {
      return;
    }
    const link = inviteShareLink(createdInvite);
    if (!link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCreatedInviteCopied(true);
      window.setTimeout(() => setCreatedInviteCopied(false), 2_000);
    } catch {
      setCreatedInviteCopied(false);
    }
  }

  function closeInviteDialog() {
    setInviteOpen(false);
    resetInviteForm();
  }

  return (
    <div className="flex flex-col gap-4">
      {visibleFamilyRecoveryAction && familyRecoverySourceTier && familyRecoveryTargetTier ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Get more included usage each month
            </p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Move your access from {familyRecoverySourceTier.name} to {familyRecoveryTargetTier.name}
              {" "}for more included usage each month. You can still add usage when you need it.
            </p>
          </div>
          <Button
            className="min-h-12 w-full sm:w-auto"
            onClick={() => setPendingAction(visibleFamilyRecoveryAction)}
            size="lg"
            type="button"
          >
            Upgrade to {familyRecoveryTargetTier.name}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              {props.members.length} {props.members.length === 1 ? "family member" : "family members"}
            </p>
            <p className="text-xs text-muted-foreground">
              Manage each person&apos;s Pulse, Edge, or Max access directly.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => {
              resetInviteForm();
              setInviteOpen(true);
            }}
            disabled={inviteDisabled}
          >
            Invite member
          </Button>
        </div>
        {actionNotice ? (
          <p role="status" className="text-xs leading-tight text-muted-foreground">
            {actionNotice}
          </p>
        ) : null}
      </div>

      <div className="min-w-0">
        <table className="w-full text-sm md:table-fixed">
          <thead className="sr-only">
            <tr>
              <th>Member</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody className="grid gap-3 md:table-row-group md:divide-y md:divide-border">
            {props.members.map((member) => {
              const isRetry = member.pendingPlanCode !== null;
              const currentTierIndex = props.tiers.findIndex(
                (tier) => tier.planCode === member.planCode,
              );
              const targetPlanCode = member.pendingPlanCode
                ?? props.tiers[currentTierIndex + 1]?.planCode
                ?? props.tiers[currentTierIndex - 1]?.planCode;
              const targetTier = props.tiers.find(
                (tier) => tier.planCode === targetPlanCode,
              );

              return (
                <tr
                  key={member.memberId}
                  className="grid grid-cols-2 gap-x-3 gap-y-4 rounded-xl border border-border bg-background p-4 md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0"
                >
                  <td className="col-span-2 block min-w-0 md:table-cell md:py-3 md:pr-3">
                    <div className="truncate font-medium text-foreground">
                      {member.isOwner ? "You" : member.label ?? "Family member"}
                    </div>
                    {!member.isOwner && member.joinedAtIso ? (
                      <div className="text-xs text-muted-foreground">
                        Joined {formatFamilyDate(member.joinedAtIso)}
                      </div>
                    ) : null}
                  </td>
                  <td className="block align-top md:table-cell md:py-3 md:pr-3">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground md:hidden">
                      Plan
                    </span>
                    <Badge variant="outline">
                      {props.tiers.find((tier) => tier.planCode === member.planCode)?.name}
                    </Badge>
                  </td>
                  <td className="block align-top md:table-cell md:py-3 md:pr-3">
                    <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground md:hidden">
                      Status
                    </span>
                    <Badge variant={member.pendingPlanCode ? "secondary" : member.isOwner ? "outline" : "default"}>
                      {member.pendingPlanCode
                        ? `Updating to ${props.tiers.find((tier) => tier.planCode === member.pendingPlanCode)?.name}`
                        : member.isOwner ? "Owner" : "Active"}
                    </Badge>
                  </td>
                  <td className="col-span-2 block text-right align-top md:table-cell md:py-3">
                    <div className="flex w-full items-center gap-2 md:inline-flex md:w-auto md:gap-1">
                      {targetTier ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11 flex-1 rounded-xl border border-foreground/15 bg-background text-sm font-medium md:min-h-0 md:flex-none md:rounded-lg md:border-transparent md:bg-transparent md:text-[0.8rem]"
                          aria-label={isRetry
                            ? member.isOwner
                              ? `Retry updating your plan to ${targetTier.name}`
                              : `Retry updating ${member.label ?? "this family member"}'s plan to ${targetTier.name}`
                            : member.isOwner
                              ? "Manage your plan"
                              : `Manage ${member.label ?? "this family member"}'s plan`}
                          disabled={isActing}
                          onClick={() => setPendingAction({
                            canRemove: !member.isOwner && !isRetry,
                            from: member.planCode,
                            id: member.memberId,
                            isOwner: member.isOwner,
                            kind: "change-plan",
                            label: member.isOwner ? "you" : member.label ?? "this family member",
                            targetLocked: isRetry,
                            to: targetTier.planCode,
                          })}
                        >
                          {isRetry ? "Retry update" : "Manage"}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}

            {props.invites.map((invite) => {
          const link = inviteShareLink(invite);
          const secondary = invite.targetLabel ? inviteContacts(invite)[0] ?? null : null;
          return (
            <tr
              key={invite.id}
              className="grid grid-cols-2 gap-x-3 gap-y-4 rounded-xl border border-border bg-background p-4 md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0"
            >
              <td className="col-span-2 block min-w-0 md:table-cell md:py-3 md:pr-3">
                <div className="truncate font-medium text-foreground">
                  {inviteDisplayName(invite)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {secondary ? (
                    <>
                      <span className="break-all">{secondary}</span> ·{" "}
                    </>
                  ) : null}
                  Expires {formatFamilyDate(invite.expiresAtIso)}
                </div>
              </td>
              <td className="block align-top md:table-cell md:py-3 md:pr-3">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground md:hidden">
                  Plan
                </span>
                <Badge variant="outline">
                  {props.tiers.find((tier) => tier.planCode === invite.planCode)?.name}
                </Badge>
              </td>
              <td className="block align-top md:table-cell md:py-3 md:pr-3">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground md:hidden">
                  Status
                </span>
                <Badge variant="secondary">Pending</Badge>
              </td>
              <td className="col-span-2 block text-right align-top md:table-cell md:py-3">
                <div className="flex w-full items-center gap-2 md:inline-flex md:w-auto md:gap-1">
                  {link ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 flex-1 rounded-xl border border-foreground/15 bg-background text-sm font-medium md:min-h-0 md:flex-none md:rounded-lg md:border-transparent md:bg-transparent md:text-[0.8rem]"
                      onClick={() => void copyInviteLink(invite)}
                    >
                      {copiedId === invite.id ? (
                        <>
                          <Check className="size-3.5" aria-hidden="true" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" aria-hidden="true" /> Copy link
                        </>
                      )}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 flex-1 rounded-xl border border-foreground/15 bg-background text-sm font-medium md:min-h-0 md:flex-none md:rounded-lg md:border-transparent md:bg-transparent md:text-[0.8rem]"
                    onClick={() =>
                      setPendingAction({
                        id: invite.id,
                        kind: "cancel-invite",
                        label: invite.targetLabel ?? "this invite",
                      })
                    }
                  >
                    Cancel
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
        </tbody>
      </table>
      </div>

      {returnedActiveMember ? (
        <HostedUsageTopUpDialog
          activePurchase={
            props.usageTopUpActiveMemberId === returnedActiveMember.memberId
              ? props.usageTopUpActivePurchase
              : null
          }
          checkoutUrl={`/api/settings/billing/family/members/${encodeURIComponent(returnedActiveMember.memberId)}/usage-credit/checkout`}
          deferTerminalRefreshUntilClose
          offers={[]}
          payerMemberId={props.payerMemberId}
          purchaseReturn={props.usageTopUpPurchaseReturn}
          scope="family"
          targetLabel={returnedActiveMember.label ?? "your family member"}
        />
      ) : null}

      {[props.usageTopUpActiveMemberId, props.usageTopUpReturnMemberId]
        .filter((memberId, index, memberIds): memberId is string => Boolean(
          memberId
          && !props.members.some((member) => member.memberId === memberId)
          && memberIds.indexOf(memberId) === index,
        ))
        .map((memberId) => {
          const activePurchase = props.usageTopUpActiveMemberId === memberId
            ? props.usageTopUpActivePurchase ?? null
            : null;
          return (
            <div
              key={memberId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <p className="text-sm text-muted-foreground">
                Review an unfinished checkout for a former family member. It
                cannot be paid here.
              </p>
              <HostedUsageTopUpDialog
                activePurchase={activePurchase}
                checkoutUrl={`/api/settings/billing/family/members/${encodeURIComponent(memberId)}/usage-credit/checkout`}
                deferTerminalRefreshUntilClose
                offers={[]}
                payerMemberId={props.payerMemberId}
                purchaseReturn={
                  props.usageTopUpReturnMemberId === memberId
                    ? props.usageTopUpPurchaseReturn
                    : null
                }
                scope="family"
                targetLabel="a former family member"
              />
            </div>
          );
        })}

      {!props.billingActive ? (
        <p
          role="status"
          className="rounded-lg border border-[#c4a882]/25 bg-[#fffcf6] p-3 text-sm text-[#736a58]"
        >
          Billing is still activating. Your family members get access once payment is confirmed.
        </p>
      ) : null}

      <Dialog open={inviteOpen} onOpenChange={(open) => { if (!open) { closeInviteDialog(); } }}>
        <DialogContent className={DIALOG_CLASS}>
          <DialogHeader className="pr-10">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
              {createdInvite ? "Invite created" : "Invite a family member"}
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#736a58]">
              {createdInvite
                ? "Copy the link and send it to them yourself."
                : "You'll get a link to send them yourself. Murph won't message them."}
            </DialogDescription>
          </DialogHeader>

          {createdInvite ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-[#c4a882]/25 bg-[#f5f0e8] p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="size-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#2d3436]">
                      Send this invite to {createdInvite.targetLabel ?? createdInvite.targetPhoneHint ?? "your family member"}.
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#736a58]">
                      {createdInviteHasContact
                        ? "Only they can use this invite."
                        : "Anyone with this link can join."}
                    </p>
                  </div>
                </div>
              </div>
              <Button
                type="button"
                size="xl"
                onClick={() => void copyCreatedInviteLink()}
                disabled={!inviteShareLink(createdInvite)}
                className="w-full"
              >
                {createdInviteCopied ? (
                  <>
                    <Check className="size-4" aria-hidden="true" /> Copied invite link
                  </>
                ) : (
                  <>
                    <Copy className="size-4" aria-hidden="true" /> Copy invite link
                  </>
                )}
              </Button>
              <Button type="button" size="xl" variant="ghost" onClick={closeInviteDialog} className="w-full">
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="family-invite-label">Name</Label>
                  <Input
                    id="family-invite-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Mom"
                    autoComplete="off"
                    autoFocus
                    className="h-12 text-base"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Access</Label>
                  <SegmentedControl
                    aria-label="Family member tier"
                    options={props.tiers.map((tier) => ({
                      label: `${tier.name} · ${tier.priceLabel}`,
                      value: tier.planCode,
                    }))}
                    value={invitePlanCode}
                    onValueChange={setInvitePlanCode}
                    className="border-[#c4a882]/25 bg-[#f5f0e8]"
                    itemClassName="h-auto min-h-12 whitespace-normal py-1.5 leading-tight text-[#736a58] hover:bg-[#fffcf6]/70 hover:text-[#2d3436] aria-pressed:bg-[#fffcf6] aria-pressed:text-[#2d3436] aria-pressed:shadow-none"
                  />
                </div>

                <SegmentedControl
                  aria-label="Invite by"
                  options={INVITE_CHANNEL_OPTIONS}
                  value={inviteChannel}
                  onValueChange={changeInviteChannel}
                  className="border-[#c4a882]/25 bg-[#f5f0e8]"
                  itemClassName="text-[#736a58] hover:bg-[#fffcf6]/70 hover:text-[#2d3436] aria-pressed:bg-[#fffcf6] aria-pressed:text-[#2d3436] aria-pressed:shadow-none"
                />

                {inviteChannel === "imessage" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="family-invite-phone">Phone number</Label>
                    <PhoneNumberInput
                      id="family-invite-phone"
                      autoComplete="off"
                      inputName="family-invite-phone"
                      options={HOSTED_PHONE_COUNTRY_OPTIONS}
                      selectedCountry={selectedPhoneCountry}
                      value={phone}
                      onCountryChange={setPhoneCountryCode}
                      onPhoneNumberChange={setPhone}
                    />
                  </div>
                ) : null}
                {inviteChannel === "email" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="family-invite-email">Email</Label>
                    <Input
                      id="family-invite-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="mom@example.com"
                      inputMode="email"
                      autoComplete="off"
                    />
                  </div>
                ) : null}
                {inviteChannel === "telegram" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="family-invite-telegram">Telegram username</Label>
                    <Input
                      id="family-invite-telegram"
                      value={telegram}
                      onChange={(event) => setTelegram(event.target.value)}
                      placeholder="@username"
                      autoComplete="off"
                    />
                  </div>
                ) : null}
                {selectedTierUnavailable ? (
                  <p role="status" className="text-xs leading-5 text-[#736a58]">
                    No open {invitePlan.name} seats. Choose a tier with an open seat or free one first.
                  </p>
                ) : inviteNeedsStableTargetForSeat ? (
                  <p role="status" className="text-xs leading-5 text-[#736a58]">
                    {inviteChannel === "telegram"
                      ? `Use iMessage or Email to add a paid ${invitePlan.name} seat, or change Family capacity first.`
                      : activeContactInput
                      ? `Enter a valid ${activeContactInputNoun} to invite. It adds a paid ${invitePlan.name} seat at ${invitePlan.priceLabel}.`
                      : `Add a contact to invite. It adds a paid ${invitePlan.name} seat at ${invitePlan.priceLabel}.`}
                  </p>
                ) : !activeContactInput ? (
                  <p className="text-xs leading-5 text-[#736a58]">
                    No contact? Anyone with the link can join.
                  </p>
                ) : null}
              </div>

              {inviteError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive [overflow-wrap:anywhere]"
                >
                  {inviteError}
                </p>
              ) : null}

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  size="xl"
                  onClick={() => void submitInvite()}
                  disabled={inviteSubmitDisabled}
                  className="w-full"
                >
                  {isInviting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : inviteWillAddSeat ? (
                    `Create invite & add ${invitePlan.name} · ${invitePlan.priceLabel}`
                  ) : (
                    "Create invite"
                  )}
                </Button>
                <Button
                  type="button"
                  size="xl"
                  variant="ghost"
                  onClick={closeInviteDialog}
                  disabled={isInviting}
                  className="w-full"
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pendingAction !== null} onOpenChange={(open) => {
        if (!open && !isActing) {
          setPendingAction(null);
          setActionError(null);
        }
      }}>
        <DialogContent className={DIALOG_CLASS} showCloseButton={!isActing}>
          <DialogHeader className="pr-10">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
              {pendingAction?.kind === "remove-member"
                ? "Remove family member"
                : pendingAction?.kind === "change-plan"
                  ? pendingAction.recovery
                    ? "Upgrade your Family access"
                    : pendingAction.isOwner ? "Manage your plan" : `Manage ${pendingAction.label}`
                  : "Cancel invite"}
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#736a58]">
              {pendingAction?.kind === "remove-member"
                ? `Remove ${pendingAction.label}? They keep their own Murph account and data, but their access through your Family plan ends.`
                : pendingAction?.kind === "change-plan"
                  ? pendingAction.recovery
                    ? `Move your Family access from ${pendingSourceTier?.name} to ${pendingTargetTier?.name} at ${pendingTargetTier?.priceLabel}. ${pendingTargetTier?.name} includes more usage each month.`
                    : pendingPlanChangeDirection === "upgrade"
                      ? `Upgrade ${pendingAction.isOwner ? "your plan" : pendingAction.label} from ${pendingSourceTier?.name} to ${pendingTargetTier?.name} at ${pendingTargetTier?.priceLabel}. The prorated difference will appear on your next invoice.`
                      : `Downgrade ${pendingAction.isOwner ? "your plan" : pendingAction.label} from ${pendingSourceTier?.name} to ${pendingTargetTier?.name} at ${pendingTargetTier?.priceLabel}. Any prorated credit will apply to your next invoice.`
                  : `Cancel the invite for ${pendingAction?.label ?? "this person"}? The invite link stops working.`}
            </DialogDescription>
          </DialogHeader>

          {pendingAction?.kind === "change-plan" && !pendingAction.targetLocked ? (
            <div className="flex flex-col gap-1.5">
              <Label>Access</Label>
              <SegmentedControl
                aria-label="New Family member tier"
                options={props.tiers
                  .filter((tier) => tier.planCode !== pendingAction.from)
                  .map((tier) => ({
                    label: `${tier.name} · ${tier.priceLabel}`,
                    value: tier.planCode,
                  }))}
                value={pendingAction.to}
                onValueChange={(to) => setPendingAction({
                  ...pendingAction,
                  to,
                })}
                className="border-[#c4a882]/25 bg-[#f5f0e8]"
                itemClassName="h-auto min-h-12 whitespace-normal py-1.5 leading-tight text-[#736a58] hover:bg-[#fffcf6]/70 hover:text-[#2d3436] aria-pressed:bg-[#fffcf6] aria-pressed:text-[#2d3436] aria-pressed:shadow-none"
              />
            </div>
          ) : null}

          {actionError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive [overflow-wrap:anywhere]"
            >
              {actionError}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="xl"
              variant={pendingAction?.kind === "remove-member" || pendingAction?.kind === "cancel-invite"
                ? "destructive"
                : "default"}
              onClick={() => void confirmPendingAction()}
              disabled={isActing}
              className="w-full"
            >
              {isActing
                ? "Working..."
                : pendingAction?.kind === "remove-member"
                  ? "Remove member"
                  : pendingAction?.kind === "change-plan"
                    ? `${pendingPlanChangeDirection === "upgrade" ? "Upgrade" : "Downgrade"} to ${pendingTargetTier?.name}`
                      : "Cancel invite"}
            </Button>
            {pendingAction?.kind === "change-plan" ? (
              <HostedUsageTopUpDialog
                key={pendingAction.id}
                activePurchase={
                  props.usageTopUpActiveMemberId === pendingAction.id &&
                  returnedActiveMember?.memberId !== pendingAction.id
                    ? props.usageTopUpActivePurchase
                    : null
                }
                checkoutUrl={`/api/settings/billing/family/members/${encodeURIComponent(pendingAction.id)}/usage-credit/checkout`}
                deferTerminalRefreshUntilClose={
                  pendingAction.id !== props.payerMemberId
                }
                offers={props.usageTopUpActivePurchase ? [] : props.usageTopUpOffers ?? []}
                payerMemberId={props.payerMemberId}
                purchaseReturn={
                  props.usageTopUpReturnMemberId === pendingAction.id &&
                  returnedActiveMember?.memberId !== pendingAction.id
                    ? props.usageTopUpPurchaseReturn
                    : null
                }
                scope="family"
                targetLabel={pendingAction.label}
                triggerClassName="w-full"
                triggerLabel={pendingAction.recovery ? "Add usage" : undefined}
                triggerSize="xl"
                triggerVariant={pendingAction.recovery ? "outline" : "secondary"}
              />
            ) : null}
            {pendingAction?.kind === "change-plan" && pendingAction.canRemove ? (
              <Button
                type="button"
                size="xl"
                variant="destructive"
                onClick={() => {
                  setActionError(null);
                  setPendingAction({
                    id: pendingAction.id,
                    kind: "remove-member",
                    label: pendingAction.label,
                  });
                }}
                disabled={isActing}
                className="w-full"
              >
                Remove from Family
              </Button>
            ) : null}
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={() => { setPendingAction(null); setActionError(null); }}
              disabled={isActing}
              className="w-full"
            >
              {pendingAction?.kind === "change-plan"
                ? "Not now"
                : "Keep"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatFamilyDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "soon";
  }
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}
