import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function JoinInviteCancelPage(input: {
  params: Promise<{ inviteCode: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const { inviteCode } = await input.params;
  const searchParams = await input.searchParams;
  const shareCode = typeof searchParams.share === "string" ? decodeURIComponent(searchParams.share) : null;
  const href = `/join/${encodeURIComponent(decodeURIComponent(inviteCode))}${shareCode ? `?share=${encodeURIComponent(shareCode)}` : ""}`;

  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <Card className="w-full max-w-xl shadow-sm">
        <CardHeader className="gap-5">
          <div className="flex h-12 w-12 items-center justify-center rounded bg-amber-50">
            <svg className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div className="space-y-5">
            <CardTitle className="text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">
              Checkout paused
            </CardTitle>
            <CardDescription className="leading-relaxed text-stone-500">
              Your verified phone session is still ready. Jump back to the invite page whenever you want to finish
              checkout.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button render={<Link href={href} />} nativeButton={false} size="lg">
            Return to invite
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
