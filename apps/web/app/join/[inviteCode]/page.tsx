import type { Metadata } from "next";
import { cookies } from "next/headers";

import { JoinInviteClient } from "@/src/components/hosted-onboarding/join-invite-client";
import { buildHostedInvitePageData } from "@/src/lib/hosted-onboarding/service";
import { resolveHostedSessionFromCookieStore } from "@/src/lib/hosted-onboarding/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Healthy Bob hosted invite",
  description: "Create your passkey and finish hosted Healthy Bob checkout.",
  openGraph: {
    title: "Healthy Bob hosted invite",
    description: "Create your passkey and finish hosted Healthy Bob checkout.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Healthy Bob hosted invite",
    description: "Create your passkey and finish hosted Healthy Bob checkout.",
  },
};

export default async function JoinInvitePage(input: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = await input.params;
  const cookieStore = await cookies();
  const sessionRecord = await resolveHostedSessionFromCookieStore(cookieStore);
  const initialStatus = await buildHostedInvitePageData({
    inviteCode: decodeURIComponent(inviteCode),
    sessionRecord,
  });

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "clamp(1.25rem, 4vw, 2.5rem)",
        background:
          "radial-gradient(circle at top, rgba(191, 219, 254, 0.55) 0%, rgba(248, 250, 252, 1) 38%, rgba(226, 232, 240, 0.96) 100%)",
        color: "rgb(15 23 42)",
      }}
    >
      <div style={{ width: "100%", maxWidth: "48rem", margin: "0 auto" }}>
        <JoinInviteClient
          inviteCode={decodeURIComponent(inviteCode)}
          initialStatus={initialStatus}
        />
      </div>
    </main>
  );
}
