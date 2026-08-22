import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../../_og/og-shared";
import { GROUP_FUND_OG_ALT, GroupFundShareCard } from "./group-fund-share-card";

export const alt = GROUP_FUND_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function GroupFundOGImage() {
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(<GroupFundShareCard logoDataUri={logoDataUri} />, {
    ...OG_SIZE,
    fonts,
  });
}
