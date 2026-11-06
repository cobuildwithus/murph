import type { Metadata } from "next";
import Link from "next/link";

import {
  GroupJoinAcceptForm,
  GroupJoinLeaveButton,
  GroupJoinLegalConsentGate,
  GroupJoinSignIn,
} from "@/src/components/hosted-groups/group-join-client";
import {
  LINK_PAGE_PILL_CLASS,
  LinkPageFrame,
  LinkPageScreen,
  linkPageHeadline,
} from "@/src/components/link-page/link-page-shell";
import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import {
  readGroupJoinPostAuthHandoff,
  resolveGroupJoinPostJoinDestination,
  type GroupJoinPostJoinDestination,
} from "@/src/lib/hosted-groups/group-join-handoff";
import { readHostedGroupJoinView } from "@/src/lib/hosted-groups/group-store";
import { readHostedInitialOnboardingState } from "@/src/lib/hosted-onboarding/initial-onboarding";
import {
  getHostedPageAuthSnapshot,
  readHostedDashboardCheckoutRequired,
} from "@/src/lib/hosted-onboarding/page-auth";
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
  invite?: string | string[] | undefined;
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
  const inviteCode = readSingleSearchParam(resolvedSearchParams.invite);
  const defaultPostJoinDestination = resolveGroupJoinPostJoinDestination(
    readGroupJoinPostAuthHandoff(resolvedSearchParams.postJoin),
  );
  const auth = await getHostedPageAuthSnapshot();
  const prisma = getPrisma();
  const memberId = auth.authenticatedMember?.id ?? null;
  const [
    view,
    launchConsentStatus,
    resolvedPostJoinContactOption,
    checkoutRequired,
  ] = await Promise.all([
    readHostedGroupJoinView({ joinCode, memberId, prisma }),
    memberId
      ? readGroupJoinLaunchConsentStatus({ memberId, prisma })
      : Promise.resolve(null),
    memberId
      ? resolveGroupJoinPostJoinContactOption({ memberId, prisma })
      : Promise.resolve(null),
    readHostedDashboardCheckoutRequired(auth),
  ]);
  const postJoinDestination = checkoutRequired
    ? "/join"
    : defaultPostJoinDestination;
  // Most members live in a chat thread, not the dashboard, so the post-join
  // hand-off returns completed members to the channel Murph already reaches
  // them on. The dashboard auth owner identifies first-checkout members, who
  // continue directly into its existing setup route instead.
  const postJoinContactOption = postJoinDestination === "/join"
    ? null
    : resolvedPostJoinContactOption;

  return (
    // Only the sharing list needs the page held to one screen.
    <LinkPageFrame fit={Boolean(view && auth.authenticated && launchConsentStatus?.launchGranted)}>
      {renderGroupJoin({
        authenticated: auth.authenticated,
        inviteCode,
        joinCode,
        launchConsentStatus,
        postJoinContactOption,
        postJoinDestination,
        view,
      })}
    </LinkPageFrame>
  );
}

async function resolveGroupJoinPostJoinContactOption(input: {
  memberId: string;
  prisma: ReturnType<typeof getPrisma>;
}): Promise<MurphContactOption | null> {
  try {
    const onboarding = await readHostedInitialOnboardingState({
      memberId: input.memberId,
      prisma: input.prisma,
    });
    if (onboarding.status === "pending") {
      return null;
    }
    return await resolveHostedMurphContactOption();
  } catch {
    return null;
  }
}

function renderGroupJoin(input: {
  authenticated: boolean;
  inviteCode: string | null;
  joinCode: string;
  launchConsentStatus: HostedConsentStatus | null;
  postJoinContactOption: MurphContactOption | null;
  postJoinDestination: GroupJoinPostJoinDestination;
  view: Awaited<ReturnType<typeof readHostedGroupJoinView>>;
}) {
  const { view } = input;
  if (!view) {
    return (
      <LinkPageScreen
        actions={
          <Link className={LINK_PAGE_PILL_CLASS} href="/home">
            Open Murph
          </Link>
        }
        detail="This Murph group link is no longer available. Ask the person who shared it to send a new one."
        title="This group link isn't valid."
      />
    );
  }

  const displayName = view.displayName?.trim() || null;
  const groupName = displayName ?? describeGroupKind(view.kind);
  const alreadyActiveMember = view.viewerMembershipStatus === "active";
  const title = linkPageHeadline(
    alreadyActiveMember ? `You're in ${groupName}` : `Join ${groupName}`,
  );
  const memberLabel = view.memberCount === 1 ? "1 person" : `${view.memberCount} people`;
  const detail = `${memberLabel}. You choose what you share.`;
  const leaveAction = view.viewerCanLeave ? (
    <GroupJoinLeaveButton groupName={groupName} joinCode={input.joinCode} />
  ) : null;

  return (
    <div
      id="group-join-action"
      aria-label="Group join action"
      aria-live="polite"
      className="flex min-h-0 flex-1 flex-col"
      role="region"
    >
      {!input.authenticated ? (
        <GroupJoinSignIn
          detail={detail}
          inviteCode={input.inviteCode}
          memberCount={view.memberCount}
          title={title}
        />
      ) : !input.launchConsentStatus?.launchGranted ? (
        <GroupJoinLegalConsentGate
          detail={detail}
          initialStatus={input.launchConsentStatus}
          leaveAction={leaveAction}
          notNowHref={input.postJoinDestination}
          title={title}
        />
      ) : (
        <GroupJoinAcceptForm
          activeVaultShareProjectionScopes={view.activeVaultShareProjectionScopes}
          alreadyActiveMember={alreadyActiveMember}
          detail={detail}
          expectedMembershipId={view.viewerMembershipId}
          groupName={groupName}
          inviteCode={input.inviteCode}
          joinCode={input.joinCode}
          leaveAction={leaveAction}
          memberCount={view.memberCount}
          permissions={view.requestedVaultShareProjections}
          postJoinContactOption={input.postJoinContactOption}
          postJoinDestination={input.postJoinDestination}
        />
      )}
    </div>
  );
}

function readSingleSearchParam(
  value: string | string[] | undefined,
): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
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
