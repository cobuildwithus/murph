import { JoinInviteSuccessClient } from "@/src/components/hosted-onboarding/join-invite-success-client";
import { buildHostedInvitePageData } from "@/src/lib/hosted-onboarding/invite-service";

export default async function JoinInviteSuccessPage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const decodedInviteCode = decodeURIComponent(inviteCode);
  const shareCode = typeof searchParams.share === "string" ? decodeURIComponent(searchParams.share) : null;
  const initialStatus = await buildHostedInvitePageData({
    authenticatedMember: null,
    inviteCode: decodedInviteCode,
  });

  return (
    <JoinInviteSuccessClient
      initialStatus={initialStatus}
      inviteCode={decodedInviteCode}
      shareCode={shareCode}
    />
  );
}
