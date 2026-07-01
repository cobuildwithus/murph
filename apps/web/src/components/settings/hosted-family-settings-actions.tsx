"use client";

import { Check, Copy, Loader2, Minus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
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

type PendingAction =
  | { id: string; kind: "cancel-invite"; label: string }
  | { id: string; kind: "remove-member"; label: string };

const DIALOG_CLASS =
  "max-w-md gap-6 border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7";

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
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [telegram, setTelegram] = useState("");
  const [email, setEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRemovingSeat, setIsRemovingSeat] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);

  const seatsFull = props.seats.remaining <= 0;
  const inviteWillAddSeat =
    props.billingActive && seatsFull && props.seats.billed < props.seats.max;
  const inviteDisabled = !props.billingActive || props.seats.used >= props.seats.max;
  const canRemoveSeat =
    props.billingActive &&
    props.seats.billed > props.seats.used &&
    props.seats.billed > props.seats.min;

  function resetInviteForm() {
    setLabel("");
    setPhone("");
    setTelegram("");
    setEmail("");
    setInviteError(null);
  }

  async function submitInvite() {
    if (!phone.trim() && !telegram.trim() && !email.trim() && !label.trim()) {
      setInviteError("Add a phone number, email, Telegram username, or name.");
      return;
    }
    setInviteError(null);
    setIsInviting(true);
    try {
      await requestHostedOnboardingJson({
        method: "POST",
        payload: {
          // Only authorize buying a seat when the dialog actually showed the
          // paid-seat cost, so a stale open-seat form never charges silently.
          addSeatIfNeeded: inviteWillAddSeat,
          targetEmail: email.trim() || undefined,
          targetLabel: label.trim() || undefined,
          targetPhoneNumber: phone.trim() || undefined,
          targetTelegramUsername: telegram.trim() || undefined,
        },
        url: "/api/settings/billing/family/invite",
      });
      setInviteOpen(false);
      resetInviteForm();
      router.refresh();
    } catch (error) {
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
    const link = invite.acceptUrl ?? invite.telegramInviteUrl;
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
              ? inviteWillAddSeat
                ? `No open seats. Inviting adds a paid seat at ${props.seatPrice}.`
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
          const link = invite.acceptUrl ?? invite.telegramInviteUrl;
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

      <Dialog open={inviteOpen} onOpenChange={(open) => { if (!open) { setInviteOpen(false); resetInviteForm(); } }}>
        <DialogContent className={DIALOG_CLASS}>
          <DialogHeader className="pr-10">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
              Invite a family member
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[#736a58]">
              They join from their own phone or Telegram. Their Murph stays private to them.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="family-invite-label">Name (optional)</Label>
              <Input
                id="family-invite-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Mom"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="family-invite-phone">Phone number</Label>
              <Input
                id="family-invite-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+1 555 000 1234"
                inputMode="tel"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="family-invite-email">Email (optional)</Label>
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="family-invite-telegram">Telegram username (optional)</Label>
              <Input
                id="family-invite-telegram"
                value={telegram}
                onChange={(event) => setTelegram(event.target.value)}
                placeholder="@username"
                autoComplete="off"
              />
            </div>
            <p className="text-xs leading-5 text-[#736a58]">
              Add a phone, email, or Telegram username so they can join.
            </p>
            {inviteWillAddSeat ? (
              <p
                role="status"
                className="rounded-lg border border-[#c4a882]/25 bg-[#fffcf6] p-3 text-xs leading-5 text-[#736a58]"
              >
                No open seats — inviting adds a paid seat at {props.seatPrice}.
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
              disabled={isInviting}
              className="w-full"
            >
              {isInviting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : inviteWillAddSeat ? (
                `Invite & add seat · ${props.seatPrice}`
              ) : (
                "Create invite"
              )}
            </Button>
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={() => { setInviteOpen(false); resetInviteForm(); }}
              disabled={isInviting}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
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
                ? `Remove ${pendingAction.label}? They keep their own Murph account and data, but sponsored access ends.`
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
