"use client";

import { Check, Copy, Loader2, Minus } from "lucide-react";
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
import {
  normalizeHostedEmailAddress,
  normalizeHostedTelegramUsernameForLookup,
} from "@/src/lib/hosted-onboarding/contact-normalization";
import { normalizePhoneNumberForCountry } from "@/src/lib/hosted-onboarding/shared";
import { cn } from "@/src/lib/utils";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

export interface FamilyManagerMember {
  isOwner: boolean;
  joinedAtIso: string | null;
  label: string | null;
  memberId: string;
}

export interface FamilyManagerInvite {
  acceptUrl: string | null;
  channel: string;
  expiresAtIso: string;
  id: string;
  targetEmail: string | null;
  targetLabel: string | null;
  targetPhoneHint: string | null;
  targetTelegramUsername: string | null;
  telegramInviteUrl: string | null;
}

interface CreatedFamilyInvite {
  acceptUrl: string | null;
  id: string;
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
  | { id: string; kind: "remove-member"; label: string };

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

export function HostedFamilyStartButton(props: {
  block?: boolean;
  label: string;
  variant?: "default" | "secondary";
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function startCheckout() {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const response = await requestHostedOnboardingJson<{
        alreadyActive: boolean;
        url: string | null;
      }>({
        method: "POST",
        url: "/api/settings/billing/family/checkout",
      });
      if (response.url) {
        window.location.assign(response.url);
        return;
      }
      if (response.alreadyActive) {
        window.location.reload();
        return;
      }
      setIsSubmitting(false);
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(toErrorMessage(error, "Could not start the Family plan right now."));
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", props.block ? "items-stretch" : "items-start")}>
      <Button
        type="button"
        variant={props.variant ?? "default"}
        onClick={() => void startCheckout()}
        disabled={isSubmitting}
        className={props.block ? "w-full" : undefined}
      >
        {isSubmitting ? "Opening Stripe..." : props.label}
      </Button>
      {errorMessage ? (
        <p role="alert" className="max-w-xs text-xs leading-tight text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export function HostedFamilyManager(props: {
  billingActive: boolean;
  invites: FamilyManagerInvite[];
  members: FamilyManagerMember[];
  seatPrice: string;
  seats: {
    active: number;
    billed: number;
    invited: number;
    max: number;
    min: number;
    remaining: number;
    used: number;
  };
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const phoneCountryCodeHint = usePhoneCountryCode();
  const [phoneCountryCode, setPhoneCountryCode] = useState(() =>
    resolveInvitePhoneCountryOption(phoneCountryCodeHint).code
  );
  const [inviteChannel, setInviteChannel] = useState<InviteChannel>("imessage");
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [telegram, setTelegram] = useState("");
  const [email, setEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<CreatedFamilyInvite | null>(null);
  const [createdInviteCopied, setCreatedInviteCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRemovingSeat, setIsRemovingSeat] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);

  const seatsFull = props.seats.remaining <= 0;
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
  // A seat is only auto-added for invites the server can dedup on retry, so the
  // paid CTA and addSeatIfNeeded flag require a contact on the active channel.
  const hasStableTarget =
    inviteChannel === "imessage"
      ? Boolean(normalizedPhone)
      : inviteChannel === "email"
        ? Boolean(normalizedEmail)
        : Boolean(normalizedTelegram);
  const activeContactInputNoun =
    inviteChannel === "imessage"
      ? "phone number"
      : inviteChannel === "email"
        ? "email"
        : "Telegram username";
  const inviteWillAddSeat = planCanGrow && hasStableTarget;
  const inviteNeedsStableTargetForSeat = planCanGrow && !hasStableTarget;
  const inviteSubmitDisabled = isInviting || inviteNeedsStableTargetForSeat;
  const inviteDisabled = !props.billingActive || props.seats.used >= props.seats.max;
  const canRemoveSeat =
    props.billingActive &&
    props.seats.billed > props.seats.used &&
    props.seats.billed > props.seats.min;
  const createdInviteHasContact = Boolean(
    createdInvite?.targetEmail ||
      createdInvite?.targetPhoneHint ||
      createdInvite?.targetTelegramUsername,
  );

  function resetInviteForm() {
    setInviteChannel("imessage");
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
    setIsActing(true);
    try {
      const url =
        pendingAction.kind === "cancel-invite"
          ? `/api/settings/billing/family/invite/${encodeURIComponent(pendingAction.id)}`
          : `/api/settings/billing/family/members/${encodeURIComponent(pendingAction.id)}`;
      await requestHostedOnboardingJson({ method: "DELETE", url });
      setPendingAction(null);
      router.refresh();
    } catch (error) {
      setActionError(
        toErrorMessage(
          error,
          pendingAction.kind === "cancel-invite"
            ? "Could not cancel that invite right now."
            : "Could not remove that member right now.",
        ),
      );
    } finally {
      setIsActing(false);
    }
  }

  async function removeEmptySeat() {
    if (!canRemoveSeat) {
      return;
    }
    setSeatError(null);
    setIsRemovingSeat(true);
    try {
      await requestHostedOnboardingJson({
        method: "PATCH",
        payload: {
          seatCount: props.seats.billed - 1,
        },
        url: "/api/settings/billing/family/seats",
      });
      router.refresh();
    } catch (error) {
      setSeatError(toErrorMessage(error, "Could not remove a Family seat right now."));
    } finally {
      setIsRemovingSeat(false);
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-medium text-foreground">
              {props.seats.used} of {props.seats.billed} paid seats
            </span>
            <SeatPips max={props.seats.billed} used={props.seats.used} />
          </div>
          <p className="text-xs text-muted-foreground">
            {seatsFull
              ? planCanGrow
                ? `No open seats. Inviting with a contact adds a paid seat at ${props.seatPrice}.`
                : "All seats are full. Remove a member or cancel an invite to free one."
              : `${props.seats.remaining} paid ${props.seats.remaining === 1 ? "seat" : "seats"} open`}
          </p>
          <p className="text-xs text-muted-foreground">
            Family supports {props.seats.min} to {props.seats.max} people.
          </p>
          {seatError ? (
            <p role="alert" className="max-w-sm text-xs leading-tight text-destructive">
              {seatError}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canRemoveSeat ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void removeEmptySeat()}
              disabled={isRemovingSeat}
            >
              {isRemovingSeat ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Minus className="size-4" aria-hidden="true" />
              )}
              Remove empty seat
            </Button>
          ) : null}
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
      </div>

      <table className="w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th>Member</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
        {props.members.map((member) => (
          <tr key={member.memberId}>
            <td className="py-3 pr-3">
              <div className="truncate font-medium text-foreground">
                {member.isOwner ? "You" : member.label ?? "Family member"}
              </div>
              {!member.isOwner && member.joinedAtIso ? (
                <div className="text-xs text-muted-foreground">
                  Joined {formatFamilyDate(member.joinedAtIso)}
                </div>
              ) : null}
            </td>
            <td className="py-3 pr-3 align-top">
              <Badge variant={member.isOwner ? "outline" : "default"}>
                {member.isOwner ? "Owner" : "Active"}
              </Badge>
            </td>
            <td className="py-3 text-right align-top">
              {member.isOwner ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setPendingAction({
                      id: member.memberId,
                      kind: "remove-member",
                      label: member.label ?? "this family member",
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </td>
          </tr>
        ))}

        {props.invites.map((invite) => {
          const link = inviteShareLink(invite);
          const secondary = invite.targetLabel ? inviteContacts(invite)[0] ?? null : null;
          return (
            <tr key={invite.id}>
              <td className="py-3 pr-3">
                <div className="truncate font-medium text-foreground">
                  {inviteDisplayName(invite)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {secondary ? `${secondary} · ` : ""}Expires {formatFamilyDate(invite.expiresAtIso)}
                </div>
              </td>
              <td className="py-3 pr-3 align-top">
                <Badge variant="secondary">Pending</Badge>
              </td>
              <td className="py-3 text-right align-top">
                <div className="inline-flex items-center gap-1">
                  {link ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
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
                {inviteNeedsStableTargetForSeat ? (
                  <p role="status" className="text-xs leading-5 text-[#736a58]">
                    {activeContactInput
                      ? `Enter a valid ${activeContactInputNoun} to invite. It adds a paid seat at ${props.seatPrice}.`
                      : `Add a contact to invite. It adds a paid seat at ${props.seatPrice}.`}
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
                    `Create invite & add seat · ${props.seatPrice}`
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

      <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) { setPendingAction(null); setActionError(null); } }}>
        <DialogContent className={DIALOG_CLASS}>
          <DialogHeader className="pr-10">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
              {pendingAction?.kind === "remove-member" ? "Remove family member" : "Cancel invite"}
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#736a58]">
              {pendingAction?.kind === "remove-member"
                ? `Remove ${pendingAction.label}? They keep their own Murph account and data, but their access through your Family plan ends.`
                : `Cancel the invite for ${pendingAction?.label ?? "this person"}? The invite link stops working.`}
            </DialogDescription>
          </DialogHeader>

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
              variant="destructive"
              onClick={() => void confirmPendingAction()}
              disabled={isActing}
              className="w-full"
            >
              {isActing
                ? "Working..."
                : pendingAction?.kind === "remove-member"
                  ? "Remove member"
                  : "Cancel invite"}
            </Button>
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={() => { setPendingAction(null); setActionError(null); }}
              disabled={isActing}
              className="w-full"
            >
              Keep
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SeatPips({ max, used }: { max: number; used: number }) {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: max }).map((_, index) => (
        <span
          key={index}
          className={cn("size-1.5 rounded-full", index < used ? "bg-primary" : "bg-border")}
        />
      ))}
    </span>
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
