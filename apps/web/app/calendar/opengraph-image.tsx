import { ImageResponse } from "next/og";

import {
  loadMurphHeroOgAssets,
  OG_CONTENT_TYPE,
  OG_SIZE,
} from "../_og/og-shared";

import { CALENDAR_OG_ALT, CalendarShareCard } from "./calendar-share-card";

export const alt = CALENDAR_OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function CalendarOGImage() {
  const { fonts, logoDataUri } = await loadMurphHeroOgAssets();
  return new ImageResponse(<CalendarShareCard logoDataUri={logoDataUri} />, {
    ...OG_SIZE,
    fonts,
  });
}
