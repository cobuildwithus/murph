import type { Metadata } from "next";

import { resolveDecodedRouteParam } from "@/src/lib/http";
import {
  createMurphOgImageRef,
  createMurphPageMetadata,
} from "@/src/lib/site-metadata";

import { REFERRAL_OG_ALT } from "./referral-share-card";

// Kept import-light (no page module) so tests can prove the share-preview
// metadata without mocking the landing page's server dependencies.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ referralCode: string }>;
}): Promise<Metadata> {
  const referralCode = await resolveDecodedRouteParam(params, "referralCode");
  const ogImage = createMurphOgImageRef({
    alt: REFERRAL_OG_ALT,
    url: `/r/${encodeURIComponent(referralCode)}/opengraph-image`,
  });

  return {
    ...createMurphPageMetadata({
      description: "Join Murph, your private health assistant.",
      title: "Join Murph",
      openGraph: { images: [ogImage] },
      twitter: { images: [ogImage] },
    }),
    referrer: "strict-origin",
    robots: {
      follow: false,
      index: false,
    },
  };
}
