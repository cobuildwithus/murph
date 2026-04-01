import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function JoinInviteSuccessPage(input: {
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
          <div className="flex h-12 w-12 items-center justify-center rounded bg-olive/10">
            <svg className="h-6 w-6 text-olive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="space-y-5">
            <CardTitle className="text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">
              Payment received
            </CardTitle>
            <CardDescription className="leading-relaxed text-stone-500">
              We&apos;re finishing hosted activation now. Head back to your invite page and it will show when the
              subscription state turns active.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button render={<Link href={href} />} nativeButton={false} size="lg">
            Return to Murph
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
