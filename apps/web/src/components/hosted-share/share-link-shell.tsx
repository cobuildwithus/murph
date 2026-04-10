import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HostedSharePageData } from "@/src/lib/hosted-share/service";

import { ShareLinkClient } from "./share-link-client";
import { ShareLinkPreviewAlert } from "./share-link-preview";
import { resolveShareLinkSubtitle, resolveShareLinkTitle } from "./share-link-state";

export function ShareLinkShell({ data, shareCode }: { data: HostedSharePageData; shareCode: string }) {
  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <Card className="mx-auto w-full max-w-2xl shadow-sm">
        <CardHeader className="gap-3">
          <Badge variant="secondary" className="w-fit">
            Murph share link
          </Badge>
          <div className="space-y-3">
            <CardTitle className="text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">
              {resolveShareLinkTitle(data)}
            </CardTitle>
            <CardDescription className="leading-relaxed text-stone-500">
              {resolveShareLinkSubtitle(data)}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <ShareLinkPreviewAlert data={data} />
          <ShareLinkClient initialData={data} shareCode={shareCode} />
        </CardContent>
      </Card>
    </main>
  );
}
