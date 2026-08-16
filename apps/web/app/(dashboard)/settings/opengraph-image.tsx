import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../../_og/og-shared";
import { SETTINGS_OG_ALT, SettingsShareCard } from "./settings-share-card";

export const alt = SETTINGS_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function SettingsOGImage() {
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();

  return new ImageResponse(<SettingsShareCard logoDataUri={logoDataUri} />, {
    ...OG_SIZE,
    fonts,
  });
}
