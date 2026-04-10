import { Card } from "@/components/ui/card";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

import { JoinInviteSuccessClient } from "./join-invite-success-client";

export function JoinInviteSuccessShell({
  initialStatus,
  inviteCode,
  shareCode,
}: {
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  shareCode: string | null;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <Card className="w-full max-w-xl shadow-sm">
        <JoinInviteSuccessClient initialStatus={initialStatus} inviteCode={inviteCode} shareCode={shareCode} />
      </Card>
    </main>
  );
}
