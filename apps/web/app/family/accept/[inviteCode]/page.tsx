import type { Metadata } from "next";
import Link from "next/link";

import {
  FamilyInviteSignInButton,
  FamilyInviteWebAcceptButton,
} from "@/src/components/family/family-invite-accept-client";
import { Button } from "@/src/components/ui/button";
import { readHostedFamilyInviteAcceptanceView } from "@/src/lib/hosted-onboarding/family-plan";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}): Promise<Metadata> {
  const { inviteCode } = await params;
  const inviteOpenGraphImage = {
    alt: "You’re invited to Murph Family.",
    height: 630,
    type: "image/png",
    url: `/family/accept/${encodeURIComponent(inviteCode)}/opengraph-image`,
    width: 1200,
  } as const;

  return {
    ...createMurphPageMetadata({
      title: "Family invite · Murph",
      description: "Join a Murph Family plan.",
      openGraph: { images: [inviteOpenGraphImage] },
      twitter: { images: [inviteOpenGraphImage] },
    }),
    robots: { follow: false, index: false },
  };
}

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
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      {renderInvite({ authenticated: auth.authenticated, view })}
    </main>
  );
}

function renderInvite(input: {
  authenticated: boolean;
  view: Awaited<ReturnType<typeof readHostedFamilyInviteAcceptanceView>>;
}) {
  const { view } = input;

  if (!view) {
    return (
      <InviteMessage
        title="This invite isn't valid"
        body="This family invite is no longer available. Ask the person who invited you to send a new one."
      />
    );
  }

  if (view.status === "expired") {
    return (
      <InviteMessage
        title="This invite has expired"
        body="Ask the plan owner to send you a fresh family invite."
      />
    );
  }

  if (view.status === "revoked") {
    return <InviteMessage title="This invite was canceled" body="Ask the plan owner for a new invite." />;
  }

  if (view.status === "accepted") {
    return (
      <InviteMessage
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
        title="This family plan isn't active yet"
        body="Ask the plan owner to finish setting up billing, then open this invite again."
      />
    );
  }

  if (!view.seatAvailable) {
    return (
      <InviteMessage
        title="This family plan is full"
        body="The plan has no open paid seats. Ask the owner to add a Family seat."
      />
    );
  }

  const inviter = view.groupDisplayName ?? "Your family plan owner";
  const webBindingLabel = view.isEmailBound && view.isPhoneBound
    ? "phone number or email address"
    : view.isEmailBound
      ? "email address"
      : "phone number";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance text-foreground">
          {inviter} invited you to Murph Family
        </h1>
        <ul className="flex flex-col gap-1.5 text-sm text-pretty text-muted-foreground">
          <li>They pay for your Murph access.</li>
          <li>You get your own private Murph account.</li>
          <li>{"They can't see your messages, health data, or vault."}</li>
        </ul>
      </div>

      {view.webAcceptable ? (
        input.authenticated ? (
          <FamilyInviteWebAcceptButton inviteCode={view.inviteCode} />
        ) : (
          <div className="flex flex-col gap-2">
            <FamilyInviteSignInButton bindingLabel={webBindingLabel} />
            <p className="text-xs leading-5 text-muted-foreground">
              {`Sign in with the ${webBindingLabel} this invite was sent to, and we'll bring you back here.`}
            </p>
          </div>
        )
      ) : view.telegramInviteUrl ? (
        <div className="flex flex-col gap-2">
          <Button render={<a href={view.telegramInviteUrl} />} nativeButton={false} size="xl">
            Continue in Telegram
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            {"Open this in Telegram to join — that's how Murph confirms it's you."}
          </p>
        </div>
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">
          Open this invite from the Telegram or WhatsApp chat where you received it to join.
        </p>
      )}
    </div>
  );
}

function InviteMessage(props: { action?: React.ReactNode; body: string; title: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance text-foreground">
        {props.title}
      </h1>
      <p className="text-sm text-pretty text-muted-foreground">{props.body}</p>
      {props.action ?? null}
    </div>
  );
}
