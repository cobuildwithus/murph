import type { Metadata } from "next";

import { HostedGroupStartClient } from "@/src/components/hosted-groups/group-start-client";
import { readActiveHostedMemberAccess } from "@/src/lib/hosted-onboarding/member-access";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Set up Murph for a group",
  description: "Finish setting up Murph, then return to your group chat.",
  referrer: "no-referrer",
  robots: {
    follow: false,
    index: false,
  },
};

export default async function HostedGroupStartPage() {
  const auth = await getHostedPageAuthSnapshot();
  const activeAccess = auth.authenticatedMember
    ? await readActiveHostedMemberAccess({
        memberId: auth.authenticatedMember.id,
      })
    : false;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <HostedGroupStartClient
        activeAccess={activeAccess}
        authenticated={auth.authenticated}
      />
    </main>
  );
}
