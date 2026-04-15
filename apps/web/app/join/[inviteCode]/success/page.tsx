import { buildHostedInvitePageData } from "@/src/lib/hosted-onboarding/invite-service";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { JoinInviteSuccessShell } from "@/src/components/hosted-onboarding/join-invite-success-shell";

export default async function JoinInviteSuccessPage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ session_id?: string; share?: string }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const decodedInviteCode = decodeURIComponent(inviteCode);
  const shareCode = typeof searchParams.share === "string" ? decodeURIComponent(searchParams.share) : null;
  const sessionId = typeof searchParams.session_id === "string"
    ? decodeURIComponent(searchParams.session_id)
    : null;
  const { authenticatedMember } = await getHostedPageAuthSnapshot();
  const initialStatus = await buildHostedInvitePageData({
    authenticatedMember,
    inviteCode: decodedInviteCode,
  });

  return (
    <JoinInviteSuccessShell
      initialStatus={initialStatus}
      inviteCode={decodedInviteCode}
      sessionId={sessionId}
      shareCode={shareCode}
    />
  );
}
