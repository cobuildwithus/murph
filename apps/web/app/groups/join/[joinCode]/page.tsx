import type { Metadata } from "next";
import Link from "next/link";

import {
  GroupJoinAcceptForm,
  GroupJoinLeaveButton,
  GroupJoinLegalConsentGate,
  GroupJoinSignInButton,
} from "@/src/components/hosted-groups/group-join-client";
import { Button } from "@/src/components/ui/button";
import {
  readGroupJoinPostAuthHandoff,
  resolveGroupJoinPostJoinDestination,
  type GroupJoinPostJoinDestination,
} from "@/src/lib/hosted-groups/group-join-handoff";
import { readHostedGroupJoinView } from "@/src/lib/hosted-groups/group-store";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import {
  readHostedConsentStatus,
  type HostedConsentStatus,
} from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type GroupJoinSearchParams = {
  postJoin?: string | string[] | undefined;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ joinCode: string }>;
}): Promise<Metadata> {
  const { joinCode } = await params;
  const ogImage = {
    alt: "Join your people on Murph.",
    height: 630,
    type: "image/png",
    url: `/groups/join/${encodeURIComponent(joinCode)}/opengraph-image`,
    width: 1200,
  } as const;

  return {
    ...createMurphPageMetadata({
      title: "Join group · Murph",
      description: "Join a Murph group.",
      openGraph: { images: [ogImage] },
      twitter: { images: [ogImage] },
    }),
    robots: { follow: false, index: false },
  };
}

export default async function GroupJoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ joinCode: string }>;
  searchParams?: Promise<GroupJoinSearchParams>;
}) {
  const [joinCode, resolvedSearchParams]: [string, GroupJoinSearchParams] = await Promise.all([
    resolveDecodedRouteParam(params, "joinCode"),
    searchParams ?? Promise.resolve<GroupJoinSearchParams>({}),
  ]);
  const postJoinDestination = resolveGroupJoinPostJoinDestination(
    readGroupJoinPostAuthHandoff(resolvedSearchParams.postJoin),
  );
  const auth = await getHostedPageAuthSnapshot();
  const prisma = getPrisma();
  const view = await readHostedGroupJoinView({
    joinCode,
    memberId: auth.authenticatedMember?.id ?? null,
    prisma,
  });
  const launchConsentStatus = auth.authenticatedMember
    ? await readGroupJoinLaunchConsentStatus({
        memberId: auth.authenticatedMember.id,
        prisma,
      })
    : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 px-6 py-16">
      {renderGroupJoin({
        authenticated: auth.authenticated,
        joinCode,
        launchConsentStatus,
        postJoinDestination,
        view,
      })}
    </main>
  );
}

function renderGroupJoin(input: {
  authenticated: boolean;
  joinCode: string;
  launchConsentStatus: HostedConsentStatus | null;
  postJoinDestination: GroupJoinPostJoinDestination;
  view: Awaited<ReturnType<typeof readHostedGroupJoinView>>;
}) {
  const { view } = input;
  if (!view) {
    return (
      <GroupJoinMessage
        title="This group link isn't valid"
        body="This Murph group link is no longer available. Ask the person who shared it to send a new one."
      />
    );
  }

  const displayName = view.displayName?.trim() || null;
  const groupName = displayName ?? describeGroupKind(view.kind);
  const alreadyActiveMember = view.viewerMembershipStatus === "active";
  const memberLabel = view.memberCount === 1 ? "1 member" : `${view.memberCount} members`;
  const eyebrow = `${kindNoun(view.kind)} · ${memberLabel}`;
  const avatarInitial = (displayName ?? kindNoun(view.kind)).charAt(0).toUpperCase();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-[76px] items-center justify-center rounded-full bg-[#d4c4a8] font-serif text-[2rem] font-semibold text-[#2d3436]">
          {avatarInitial}
        </div>
        <div className="flex flex-col items-center gap-2.5">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
            {eyebrow}
          </span>
          <h1 className="font-serif text-[2rem] leading-[1.05] font-semibold tracking-tight text-balance text-foreground">
            {alreadyActiveMember ? `You're in ${groupName}` : `Join ${groupName}`}
          </h1>
          <p className="max-w-[20rem] text-pretty text-[15px] leading-relaxed text-muted-foreground">
            Get healthier with people you trust. You choose exactly what you share.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <ClarityRow label="Shared" text="Your name, plus what you choose below." />
        <div className="h-px bg-border" />
        <ClarityRow
          label="Private"
          text="Your chats and vault. Anything you don't choose to share stays private."
        />
      </div>

      <div
        id="group-join-action"
        aria-label="Group join action"
        aria-live="polite"
        className="flex flex-col"
        role="region"
      >
        {input.authenticated ? (
          <div className="flex flex-col gap-2">
            {!input.launchConsentStatus?.launchGranted ? (
              <GroupJoinLegalConsentGate initialStatus={input.launchConsentStatus} />
            ) : (
              <GroupJoinAcceptForm
                activeVaultShareProjectionScopes={view.activeVaultShareProjectionScopes}
                alreadyActiveMember={alreadyActiveMember}
                expectedMembershipId={view.viewerMembershipId}
                groupName={groupName}
                joinCode={input.joinCode}
                permissions={view.requestedVaultShareProjections}
                postJoinDestination={alreadyActiveMember ? "/home" : input.postJoinDestination}
              />
            )}
            {view.viewerCanLeave ? (
              <GroupJoinLeaveButton groupName={groupName} joinCode={input.joinCode} />
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <GroupJoinSignInButton />
            <p className="text-center text-xs leading-5 text-muted-foreground">
              Create or open your private Murph account, and we&apos;ll bring you back here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

async function readGroupJoinLaunchConsentStatus(input: {
  memberId: string;
  prisma: Parameters<typeof readHostedConsentStatus>[0]["prisma"];
}): Promise<HostedConsentStatus | null> {
  try {
    return sanitizeHostedConsentStatusForClient(
      await readHostedConsentStatus({
        memberId: input.memberId,
        prisma: input.prisma,
      }),
    );
  } catch {
    return null;
  }
}

function sanitizeHostedConsentStatusForClient(
  status: HostedConsentStatus,
): HostedConsentStatus {
  return {
    ...status,
    scopes: status.scopes.map((scope) => ({
      ...scope,
      grant: null,
    })),
  };
}

function ClarityRow(props: { label: string; text: string }) {
  return (
    <div className="flex gap-4">
      <span className="w-[74px] shrink-0 pt-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {props.label}
      </span>
      <p className="text-sm leading-relaxed text-foreground">{props.text}</p>
    </div>
  );
}

function kindNoun(kind: string): string {
  switch (kind) {
    case "couple": return "Couple";
    case "family": return "Family";
    case "friends": return "Friends";
    case "household": return "Household";
    case "team": return "Team";
    default: return "Group";
  }
}

function describeGroupKind(kind: string): string {
  switch (kind) {
    case "couple": return "this couple";
    case "family": return "this family";
    case "friends": return "this circle";
    case "household": return "this household";
    case "team": return "this team";
    default: return "this group";
  }
}

function GroupJoinMessage(props: { body: string; title: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="font-serif text-[1.75rem] font-semibold tracking-tight text-balance text-foreground">
        {props.title}
      </h1>
      <p className="max-w-sm text-pretty text-sm text-muted-foreground">{props.body}</p>
      <Button render={<Link href="/home" />} nativeButton={false} size="xl" className="mt-2 w-full">
        Open Murph
      </Button>
    </div>
  );
}
