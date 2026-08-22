import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/src/components/ui/card";
import { decodeURIComponentOrRaw } from "@/src/lib/http";
import {
  createMurphOgImageRef,
  createMurphPageMetadata,
} from "@/src/lib/site-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}): Promise<Metadata> {
  const { inviteCode } = await params;
  // Keep the parent invite card: createMurphPageMetadata otherwise injects
  // the site default, which overrides the parent segment's dedicated image.
  // Tolerant decode: metadata must not become a new failure path for
  // malformed codes.
  const ogImage = createMurphOgImageRef({
    alt: "You’re invited to Murph.",
    url: `/join/${encodeURIComponent(decodeURIComponentOrRaw(inviteCode))}/opengraph-image`,
  });

  return createMurphPageMetadata({
    title: "Checkout paused — Murph",
    description: "Return to your Murph invite when you are ready to finish checkout.",
    openGraph: { images: [ogImage] },
    twitter: { images: [ogImage] },
  });
}

export default async function JoinInviteCancelPage(input: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = await input.params;
  const href = `/join/${encodeURIComponent(decodeURIComponent(inviteCode))}`;

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
              Your phone number is still verified. Jump back to the invite page whenever you want to finish
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
