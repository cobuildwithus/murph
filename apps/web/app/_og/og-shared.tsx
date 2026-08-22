import { readFile } from "node:fs/promises";

import {
  dmSans400FontPath,
  fraunces600FontPath,
  logoSvgPath,
} from "../font-files";

export { MurphHeroOg } from "./murph-hero-og";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 600 };

/**
 * Loads the shared assets every Murph hero OG image needs: the Fraunces 600 +
 * DM Sans 400 fonts and the murph lockup as a data URI. Kept in one place so
 * route-level opengraph-image files stay thin. The frame itself lives in
 * ./murph-hero-og, which stays node-free so the /design catalog can render it.
 */
export async function loadMurphHeroOgAssets(): Promise<{
  fonts: OgFont[];
  logoDataUri: string;
}> {
  const [logoBuffer, fraunces600Data, dmSans400Data] = await Promise.all([
    readFile(logoSvgPath),
    readFile(fraunces600FontPath).then(toArrayBuffer),
    readFile(dmSans400FontPath).then(toArrayBuffer),
  ]);

  return {
    logoDataUri: `data:image/svg+xml;base64,${logoBuffer.toString("base64")}`,
    fonts: [
      { name: "Fraunces", data: fraunces600Data, weight: 600 },
      { name: "DM Sans", data: dmSans400Data, weight: 400 },
    ],
  };
}

function toArrayBuffer(buffer: Buffer) {
  return Uint8Array.from(buffer).buffer;
}
