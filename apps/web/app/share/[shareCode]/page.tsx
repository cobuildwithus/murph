import { ShareLinkClient } from "@/src/components/hosted-share/share-link-client";
import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";
import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import {
  resolveHostedPrivyClientAppId,
  resolveHostedPrivyClientId,
} from "@/src/lib/hosted-onboarding/landing";

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
  const privyAppId = resolveHostedPrivyClientAppId();
  const privyClientId = resolveHostedPrivyClientId();

  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      {privyAppId ? (
        <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
          <ShareLinkClient initialData={initialData} shareCode={decodedShareCode} />
        </HostedPrivyProvider>
      ) : (
        <div className="mx-auto max-w-2xl rounded-xl border border-stone-200 bg-stone-50 p-6 text-stone-700">
          Phone signup is not configured for this environment yet.
        </div>
      )}
    </main>
  );
}
