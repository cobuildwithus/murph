import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../_og/og-shared";
import { REFERRAL_OG_ALT, ReferralShareCard } from "./referral-share-card";

export const alt = REFERRAL_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function SignupReferralOGImage() {
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(<ReferralShareCard logoDataUri={logoDataUri} />, {
    ...OG_SIZE,
    fonts,
  });
}
