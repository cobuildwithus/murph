import { ImageResponse } from "next/og";

import {
  CONNECT_OG_ALT,
  ConnectShareCard,
} from "@/app/(dashboard)/connect/connect-share-card";

import {
  loadMurphHeroOgAssets,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../_og/og-shared";

export const alt = CONNECT_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function ConnectOGImage() {
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(<ConnectShareCard logoDataUri={logoDataUri} />, {
    ...OG_SIZE,
    fonts,
  });
}
