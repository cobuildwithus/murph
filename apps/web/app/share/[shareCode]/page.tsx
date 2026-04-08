import { ShareLinkClient } from "@/src/components/hosted-share/share-link-client";
import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";

export default async function HostedSharePage(input: {
  params: Promise<{ shareCode: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { shareCode } = await input.params;
  const searchParams = await input.searchParams;
  const decodedShareCode = decodeURIComponent(shareCode);
  const initialData = await buildHostedSharePageData({
    authenticatedMember: null,
    shareCode: decodedShareCode,
    inviteCode: searchParams.invite ? decodeURIComponent(searchParams.invite) : null,
  });

  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <ShareLinkClient initialData={initialData} shareCode={decodedShareCode} />
    </main>
  );
}
