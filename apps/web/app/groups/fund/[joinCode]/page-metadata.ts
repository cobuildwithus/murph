import type { Metadata } from "next";

import { resolveDecodedRouteParam } from "@/src/lib/http";
import {
  createMurphOgImageRef,
  createMurphPageMetadata,
} from "@/src/lib/site-metadata";

import { GROUP_FUND_OG_ALT } from "./group-fund-share-card";

// Kept import-light (no page module) so tests can prove the share-preview
// metadata without mocking the funding page's server dependencies.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ joinCode: string }>;
}): Promise<Metadata> {
  const joinCode = await resolveDecodedRouteParam(params, "joinCode");
  const ogImage = createMurphOgImageRef({
    alt: GROUP_FUND_OG_ALT,
    url: `/groups/fund/${encodeURIComponent(joinCode)}/opengraph-image`,
  });

  return {
    ...createMurphPageMetadata({
      title: "Sponsor Murph in this chat",
      description:
        "Keep the group talking and make the thank-you unnecessarily entertaining.",
      openGraph: { images: [ogImage] },
      twitter: { images: [ogImage] },
    }),
    robots: { follow: false, index: false },
  };
}
