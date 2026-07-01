import type { Metadata } from "next";
import Link from "next/link";

import {
  GroupJoinAcceptForm,
  GroupJoinSignInButton,
} from "@/src/components/hosted-groups/group-join-client";
import { Button } from "@/src/components/ui/button";
import { readHostedGroupJoinView } from "@/src/lib/hosted-groups/group-store";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Join group — Murph",
    description: "Join a Murph group.",
  }),
  robots: { follow: false, index: false },
};

export default async function GroupJoinPage({
  params,
}: {
  params: Promise<{ joinCode: string }>;
}) {
  const joinCode = await resolveDecodedRouteParam(params, "joinCode");
  const auth = await getHostedPageAuthSnapshot();
  const view = await readHostedGroupJoinView({
    joinCode,
    memberId: auth.authenticatedMember?.id ?? null,
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 px-6 py-16">
      {renderGroupJoin({ authenticated: auth.authenticated, joinCode, view })}
    </main>
  );
}

function renderGroupJoin(input: {
  authenticated: boolean;
  joinCode: string;
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

  const groupName = view.displayName ?? describeGroupKind(view.kind);
  const alreadyActiveMember = view.viewerMembershipStatus === "active";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance text-foreground">
          {alreadyActiveMember ? `You're in ${groupName}` : `Join ${groupName}`}
        </h1>
        <ul className="flex flex-col gap-1.5 text-sm text-pretty text-muted-foreground">
          <li>Joining this group adds you as a member in Murph.</li>
          <li>It does not share your private Murph chats, health data, vault data, account data, or email settings.</li>
          <li>Any health permissions below are optional and explicit.</li>
        </ul>
        <p className="text-xs text-muted-foreground">
          {view.memberCount === 1 ? "1 active member" : `${view.memberCount} active members`}
        </p>
      </div>

      {input.authenticated ? (
        <GroupJoinAcceptForm
          activeVaultShareProjectionKinds={view.activeVaultShareProjectionKinds}
          alreadyActiveMember={alreadyActiveMember}
          joinCode={input.joinCode}
          permissions={view.requestedVaultShareProjections}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <GroupJoinSignInButton />
          <p className="text-xs leading-5 text-muted-foreground">
            Sign in or create a private Murph account, and we&apos;ll bring you back here.
          </p>
        </div>
      )}
    </div>
  );
}

function describeGroupKind(kind: string): string {
  switch (kind) {
    case "couple": return "this couple group";
    case "family": return "this family group";
    case "friends": return "this friends group";
    case "household": return "this household group";
    case "team": return "this team group";
    default: return "this Murph group";
  }
}

function GroupJoinMessage(props: { body: string; title: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance text-foreground">
        {props.title}
      </h1>
      <p className="text-sm text-pretty text-muted-foreground">{props.body}</p>
      <Button render={<Link href="/home" />} nativeButton={false} size="xl">
        Open Murph
      </Button>
    </div>
  );
}
