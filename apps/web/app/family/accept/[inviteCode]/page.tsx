import { Check as CheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  FamilyInviteSignInButton,
  FamilyInviteWebAcceptButton,
} from "@/src/components/family/family-invite-accept-client";
import {
  JoinInviteEyebrow,
  type JoinInviteEyebrowTone,
} from "@/src/components/hosted-onboarding/join-invite-eyebrow";
import { JoinInviteCenteredShell } from "@/src/components/hosted-onboarding/join-invite-shell";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent } from "@/src/components/ui/card";
import { PageHeader } from "@/src/components/ui/page-header";
import { readConfiguredMurphPhoneNumbers } from "@/src/lib/device-sync/messaging-return-destination";
import {
  buildHostedFamilyInviteMessagesHref,
  readHostedFamilyInviteAcceptanceView,
} from "@/src/lib/hosted-onboarding/family-plan";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Family invite — Murph",
    description: "Join a Murph Family plan.",
  }),
  robots: { follow: false, index: false },
};

type FamilyInviteView = Awaited<ReturnType<typeof readHostedFamilyInviteAcceptanceView>>;

export default async function FamilyAcceptPage({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = await params;
  const [view, auth] = await Promise.all([
    readHostedFamilyInviteAcceptanceView({ inviteCode }),
    getHostedPageAuthSnapshot(),
  ]);

  return (
    <JoinInviteCenteredShell>
      <div className="flex w-full flex-col gap-6">
        {renderInvite({
          authenticated: auth.authenticated,
          messagesAcceptHref: resolveMessagesAcceptHref(view),
          view,
        })}
      </div>
    </JoinInviteCenteredShell>
  );
}

// The invitee accepts by texting Murph the family token. Phone-bound invites
// prefer the line an existing member already messages on; unbound invites fall
// back to a configured line and the webhook assigns a home line on first
// contact.
function resolveMessagesAcceptHref(view: FamilyInviteView): string | null {
  if (!view) {
    return null;
  }
  const isFullyUnbound = !view.isPhoneBound && !view.isEmailBound && !view.isTelegramBound;
  if (!view.isPhoneBound && !isFullyUnbound) {
    return null;
  }
  const murphPhoneNumber =
    view.messagesRecipientPhone ?? readConfiguredMurphPhoneNumbers()[0] ?? null;
  if (!murphPhoneNumber) {
    return null;
  }
  return buildHostedFamilyInviteMessagesHref({
    inviteCode: view.inviteCode,
    murphPhoneNumber,
  });
}

function renderInvite(input: {
  authenticated: boolean;
  messagesAcceptHref: string | null;
  view: FamilyInviteView;
}): ReactNode {
  const { view } = input;

  if (!view) {
    return (
      <InviteMessage
        eyebrow="Link no longer works"
        tone="danger"
        title="This invite isn't valid"
        body="This family invite is no longer available. Ask the person who invited you to send a new one."
      />
    );
  }

  if (view.status === "expired") {
    return (
      <InviteMessage
        eyebrow="Link no longer works"
        tone="danger"
        title="This invite has expired"
        body="Ask the plan owner to send you a fresh family invite."
      />
    );
  }

  if (view.status === "revoked") {
    return (
      <InviteMessage
        eyebrow="Link no longer works"
        tone="danger"
        title="This invite was canceled"
        body="Ask the plan owner for a new invite."
      />
    );
  }

  if (view.status === "accepted") {
    return (
      <InviteMessage
        eyebrow="Murph Family"
        title="This invite was already used"
        body="If that was you, open Murph to continue."
        action={
          <Button render={<Link href="/home" />} nativeButton={false} size="xl">
            Open Murph
          </Button>
        }
      />
    );
  }

  if (!view.groupActive) {
    return (
      <InviteMessage
        eyebrow="Almost ready"
        title="This family plan isn't active yet"
        body="Ask the plan owner to finish setting up billing, then open this invite again."
      />
    );
  }

  if (!view.seatAvailable) {
    return (
      <InviteMessage
        eyebrow="Family is full"
        title="This family plan is full"
        body="The plan has no open paid seats. Ask the owner to add a Family seat."
      />
    );
  }

  const inviter = view.groupDisplayName ?? "Your family plan owner";
  const isFullyUnbound = !view.isPhoneBound && !view.isEmailBound && !view.isTelegramBound;
  const webBindingLabel =
    isFullyUnbound
      ? "your phone number or email address"
      : view.isEmailBound && view.isPhoneBound
        ? "phone number or email address"
        : view.isEmailBound
          ? "email address"
          : "phone number";

  return (
    <>
      <PageHeader
        eyebrow={<JoinInviteEyebrow label="Murph Family" tone="default" />}
        title={`${inviter} invited you to Murph Family`}
        description="Join to get your own private Murph account, paid for by your family plan."
      />

      <Card size="sm">
        <CardContent>
          <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
            <FeatureRow>They pay for your Murph access.</FeatureRow>
            <FeatureRow>You get your own private Murph account.</FeatureRow>
            <FeatureRow>
              {"They can't see your messages, health data, or vault."}
            </FeatureRow>
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        {renderAcceptCta({
          authenticated: input.authenticated,
          messagesAcceptHref: input.messagesAcceptHref,
          view,
          webBindingLabel,
          webSignInDescription: isFullyUnbound
            ? "Sign in with your own phone number or email address. We'll bring you back here."
            : undefined,
        })}
      </div>
    </>
  );
}

function renderAcceptCta(input: {
  authenticated: boolean;
  messagesAcceptHref: string | null;
  view: NonNullable<FamilyInviteView>;
  webBindingLabel: string;
  webSignInDescription?: string;
}): ReactNode {
  const { view } = input;
  const isFullyUnbound = !view.isPhoneBound && !view.isEmailBound && !view.isTelegramBound;
  const webSignInDescriptionProps = input.webSignInDescription
    ? { description: input.webSignInDescription }
    : {};
  const unboundTelegramInviteLink = isFullyUnbound && view.telegramInviteUrl ? (
    <Button
      render={<a href={view.telegramInviteUrl} />}
      nativeButton={false}
      size="sm"
      variant="link"
      className="h-auto w-fit p-0 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      Continue in Telegram
    </Button>
  ) : null;

  // Already signed in with an acceptable identity: one tap, no re-verification.
  if (input.authenticated && view.webAcceptable) {
    if (input.messagesAcceptHref) {
      return (
        <>
          <FamilyInviteWebAcceptButton inviteCode={view.inviteCode} />
          <Button
            render={<a href={input.messagesAcceptHref} />}
            nativeButton={false}
            size="xl"
            variant="secondary"
          >
            Continue in Messages
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            {isFullyUnbound
              ? "Joining by text works from the phone you use to send the message."
              : "Joining by text works from the phone this invite was sent to."}
          </p>
          {unboundTelegramInviteLink}
        </>
      );
    }

    return unboundTelegramInviteLink ? (
      <>
        <FamilyInviteWebAcceptButton inviteCode={view.inviteCode} />
        {unboundTelegramInviteLink}
      </>
    ) : (
      <FamilyInviteWebAcceptButton inviteCode={view.inviteCode} />
    );
  }

  // Phone-bound or unbound-by-text: accept in Messages by sending the token.
  if (input.messagesAcceptHref) {
    return (
      <>
        <Button
          render={<a href={input.messagesAcceptHref} />}
          nativeButton={false}
          size="xl"
        >
          Continue in Messages
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          This opens a text to Murph so you can join right from your phone.
        </p>
        {view.webAcceptable ? (
          <FamilyInviteSignInButton
            bindingLabel={input.webBindingLabel}
            variant="link"
            {...webSignInDescriptionProps}
          />
        ) : null}
        {unboundTelegramInviteLink}
      </>
    );
  }

  // Email-bound (or a phone invite with no reachable Murph line): sign in on the
  // web with the identity the invite was sent to.
  if (view.webAcceptable) {
    return (
      <>
        <FamilyInviteSignInButton
          bindingLabel={input.webBindingLabel}
          {...webSignInDescriptionProps}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          {input.webSignInDescription ??
            `Sign in with the ${input.webBindingLabel} this invite was sent to, and we'll bring you back here.`}
        </p>
        {unboundTelegramInviteLink}
      </>
    );
  }

  // Telegram-bound invites only: continue in Telegram.
  if (view.telegramInviteUrl) {
    return (
      <>
        <Button render={<a href={view.telegramInviteUrl} />} nativeButton={false} size="xl">
          Continue in Telegram
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          Open this in Telegram to join, so Murph can confirm it&apos;s you.
        </p>
      </>
    );
  }

  return (
    <p className="text-sm text-pretty text-muted-foreground">
      Open this invite from the chat where you received it to join.
    </p>
  );
}

function FeatureRow({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function InviteMessage(props: {
  action?: ReactNode;
  body: string;
  eyebrow: string;
  title: string;
  tone?: JoinInviteEyebrowTone;
}) {
  return (
    <>
      <PageHeader
        eyebrow={<JoinInviteEyebrow label={props.eyebrow} tone={props.tone ?? "default"} />}
        title={props.title}
        description={props.body}
      />
      {props.action ? <div className="flex flex-col gap-2">{props.action}</div> : null}
    </>
  );
}
