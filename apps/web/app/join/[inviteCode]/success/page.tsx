import { buildHostedInvitePageData } from "@/src/lib/hosted-onboarding/invite-service";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { JoinInviteSuccessShell } from "@/src/components/hosted-onboarding/join-invite-success-shell";

export default async function JoinInviteSuccessPage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const decodedInviteCode = decodeURIComponent(inviteCode);
  const shareCode = typeof searchParams.share === "string" ? decodeURIComponent(searchParams.share) : null;
  const { authenticatedMember } = await getHostedPageAuthSnapshot();
  const initialStatus = await buildHostedInvitePageData({
    authenticatedMember,
    inviteCode: decodedInviteCode,
  });

  return <JoinInviteSuccessShell initialStatus={initialStatus} inviteCode={decodedInviteCode} shareCode={shareCode} />;
}
