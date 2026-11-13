import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isAppleMobileUserAgent } from "@/src/lib/apple-mobile";
import { resolveConnectLinkSource } from "@/src/lib/device-sync/connect-link-source";
import { connectSourceAppUrl } from "@/src/lib/game/app-links";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { createMurphOgImageRef, createMurphPageMetadata, MURPH_NOINDEX_PAGE_ROBOTS, MURPH_PUBLIC_SITE_URL } from "@/src/lib/site-metadata";

import { ConnectLinkView } from "./connect-link-view";

// The page reads the device from the request, so it is never prerendered.
export const dynamic = "force-dynamic";

type ConnectLinkPageProps = { params: Promise<{ source: string }> };

/**
 * The link preview Messages shows: "Connect Apple Health to Murph" over the
 * route's own card image, passed explicitly so the website connect page's
 * image never stands in for it. A link that is about to redirect says nothing.
 */
export async function generateMetadata(props: ConnectLinkPageProps): Promise<Metadata> {
  const source = resolveConnectLinkSource(await resolveDecodedRouteParam(props.params, "source"));
  if (source?.kind !== "app") return { robots: MURPH_NOINDEX_PAGE_ROBOTS };
  const title = `Connect ${source.name} to Murph`;
  const image = createMurphOgImageRef({ alt: title, url: `/connect/${encodeURIComponent(source.id)}/opengraph-image` });
  return {
    ...createMurphPageMetadata({
      description: "Open this on your iPhone to connect it in the Murph app.",
      openGraph: { images: [image], type: "website" },
      robots: MURPH_NOINDEX_PAGE_ROBOTS,
      title,
      twitter: { images: [image] },
    }),
    referrer: "no-referrer",
  };
}

/**
 * `withmurph.ai/connect/<source>`: the link Murph's app opens on that
 * source's connect step. This page is what a browser shows instead: Apple
 * Health and the wearables that come in through it only connect in the app,
 * so it offers the app, or on a computer a code to scan. A source that signs
 * in on its own website goes to the website's connect page, which can
 * connect it with no app; an unknown or paused source goes there too.
 */
export default async function ConnectLinkPage(props: ConnectLinkPageProps) {
  const source = resolveConnectLinkSource(await resolveDecodedRouteParam(props.params, "source"));
  if (!source) redirect("/connect");
  if (source.kind === "web") redirect(`/connect#${source.id}`);
  return (
    <main className="flex min-h-dvh flex-col bg-[#1C1915]">
      {/* The night ground reaches past the page: overscroll and Safari's bars. */}
      <style>{"html,body{background:#1C1915}"}</style>
      <ConnectLinkView
        appUrl={connectSourceAppUrl(source.id)}
        linkUrl={`${MURPH_PUBLIC_SITE_URL}/connect/${encodeURIComponent(source.id)}`}
        onComputer={!isAppleMobileUserAgent((await headers()).get("user-agent"))}
        source={source}
      />
    </main>
  );
}
