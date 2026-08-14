"use client";

import {
  FamilyInviteScreen,
  type FamilyInviteView,
} from "@/src/components/family/family-invite-screen";
import type {
  FamilyInviteWebAcceptInitialState,
} from "@/src/components/family/family-invite-accept-client";
import { JoinInviteCenteredShell } from "@/src/components/hosted-onboarding/join-invite-shell";
import type { HostedFamilyInviteAcceptanceView } from "@/src/lib/hosted-onboarding/family-plan";

// A synthetic Messages deep link. The live page builds this from the invitee's
// existing Murph line (or a configured fallback); here it only needs to render
// as an href on the inert "Continue in Messages" button.
const DESIGN_MESSAGES_HREF =
  "sms:+15555550100&body=Join%20Murph%20Family%20hinv_design_preview";

const DESIGN_TELEGRAM_INVITE_URL =
  "https://t.me/withmurph_bot?start=hinv_design_preview";

// Pending, active, seat-available invite bound to a phone number — the common
// case for a brand-new sponsored member who got the link by text.
const BASE_PENDING_VIEW: HostedFamilyInviteAcceptanceView = {
  groupActive: true,
  groupDisplayName: "The Ridgeline crew",
  inviteCode: "hinv_design_preview",
  isEmailBound: false,
  isPhoneBound: true,
  isTelegramBound: false,
  messagesRecipientPhone: null,
  planCode: "pulse",
  seatAvailable: true,
  status: "pending",
  targetLabel: null,
  telegramInviteUrl: null,
  webAcceptable: true,
};

const EMAIL_BOUND_VIEW: HostedFamilyInviteAcceptanceView = {
  ...BASE_PENDING_VIEW,
  isEmailBound: true,
  isPhoneBound: false,
};

const TELEGRAM_ONLY_VIEW: HostedFamilyInviteAcceptanceView = {
  ...BASE_PENDING_VIEW,
  isPhoneBound: false,
  isTelegramBound: true,
  telegramInviteUrl: DESIGN_TELEGRAM_INVITE_URL,
  webAcceptable: false,
};

export function FamilyInviteJoinStudy() {
  return (
    <div
      className="flex flex-col gap-8"
      data-design-study="family-invite-join"
      id="family-invite-join"
    >
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        The production <code>/family/accept/[inviteCode]</code> page a sponsored
        member lands on. The eyebrow, three privacy promises, and copy are fixed;
        the call to action changes with how the invite was sent and whether the
        visitor is already signed in. Preview only — accept, sign-in, and channel
        buttons are inert here.
      </p>

      <div
        className="overflow-hidden rounded-3xl border border-border"
        data-design-state="full-page-phone-bound"
        inert
      >
        <JoinInviteCenteredShell>
          <FamilyInviteScreen
            authenticated={false}
            messagesAcceptHref={DESIGN_MESSAGES_HREF}
            view={BASE_PENDING_VIEW}
          />
        </JoinInviteCenteredShell>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <InviteStatePreview
          label="Signed in · accept in one tap"
          state="signed-in-accept"
          authenticated
          messagesAcceptHref={DESIGN_MESSAGES_HREF}
          view={BASE_PENDING_VIEW}
        />
        <InviteStatePreview
          label="Signed in · unfinished owner setup blocks joining"
          state="signed-in-draft-conflict"
          authenticated
          view={BASE_PENDING_VIEW}
          webAcceptInitialState="draft_conflict"
        />
        <InviteStatePreview
          label="Email invite · sign in to join"
          state="email-bound-sign-in"
          view={EMAIL_BOUND_VIEW}
        />
        <InviteStatePreview
          label="Telegram invite · continue in Telegram"
          state="telegram-only"
          view={TELEGRAM_ONLY_VIEW}
        />
        <InviteStatePreview
          label="Already used · open Murph"
          state="already-used"
          view={{ ...BASE_PENDING_VIEW, status: "accepted" }}
        />
        <InviteStatePreview
          label="Billing not finished yet"
          state="group-not-active"
          view={{ ...BASE_PENDING_VIEW, groupActive: false }}
        />
        <InviteStatePreview
          label="Family is full · no open seat"
          state="seat-unavailable"
          view={{ ...BASE_PENDING_VIEW, seatAvailable: false }}
        />
        <InviteStatePreview
          label="Invite expired"
          state="expired"
          view={{ ...BASE_PENDING_VIEW, status: "expired" }}
        />
        <InviteStatePreview
          label="Invite canceled"
          state="revoked"
          view={{ ...BASE_PENDING_VIEW, status: "revoked" }}
        />
        <InviteStatePreview
          label="Link no longer valid"
          state="invalid"
          view={null}
        />
      </div>
    </div>
  );
}

function InviteStatePreview(props: {
  authenticated?: boolean;
  label: string;
  messagesAcceptHref?: string | null;
  state: string;
  view: FamilyInviteView;
  webAcceptInitialState?: FamilyInviteWebAcceptInitialState;
}) {
  return (
    <div className="flex flex-col gap-3" data-design-state={props.state}>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </p>
      <div className="rounded-2xl border border-border bg-background p-6" inert>
        <div className="mx-auto w-full max-w-md">
          <FamilyInviteScreen
            authenticated={props.authenticated ?? false}
            messagesAcceptHref={props.messagesAcceptHref ?? null}
            view={props.view}
            {...(props.webAcceptInitialState
              ? { webAcceptInitialState: props.webAcceptInitialState }
              : {})}
          />
        </div>
      </div>
    </div>
  );
}
