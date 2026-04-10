import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { ShareLinkShell } from "@/src/components/hosted-share/share-link-shell";

export default async function HostedSharePage(input: {
  params: Promise<{ shareCode: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { shareCode } = await input.params;
  const searchParams = await input.searchParams;
  const decodedShareCode = decodeURIComponent(shareCode);
  const { authenticatedMember } = await getHostedPageAuthSnapshot();
  const initialData = await buildHostedSharePageData({
    authenticatedMember,
    shareCode: decodedShareCode,
    inviteCode: searchParams.invite ? decodeURIComponent(searchParams.invite) : null,
  });

  return <ShareLinkShell data={initialData} shareCode={decodedShareCode} />;
}
