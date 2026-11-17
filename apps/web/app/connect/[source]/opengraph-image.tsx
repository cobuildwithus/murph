import { readFile } from "node:fs/promises";

import { ImageResponse } from "next/og";

import { resolveConnectLinkSource } from "@/src/lib/device-sync/connect-link-source";
import { resolveDecodedRouteParam } from "@/src/lib/http";

import { OG_CONTENT_TYPE, OG_SIZE } from "../../_og/og-shared";
import { resolveRuntimeAssetPath } from "../../runtime-asset-files";
import { ConnectLinkShareCard } from "./connect-link-share-card";

export const alt = "Connect it to Murph.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * The card for a source that connects in the app. Its two icons are read from
 * `public/`, which `next.config.ts` traces into this route. A link that only
 * redirects has no card of its own.
 */
export default async function ConnectLinkOGImage(props: { params: Promise<{ source: string }> }) {
  const source = resolveConnectLinkSource(await resolveDecodedRouteParam(props.params, "source"));
  if (source?.kind !== "app") return new Response(null, { status: 404 });
  const [murphIcon, sourceIcon] = await Promise.all([
    pngDataUri("/brand-logos/murph-logo-avatar-light.png"),
    pngDataUri(source.logoPath),
  ]);
  return new ImageResponse(<ConnectLinkShareCard murphIcon={murphIcon} sourceIcon={sourceIcon} />, OG_SIZE);
}

async function pngDataUri(publicPath: string): Promise<string> {
  const file = await readFile(resolveRuntimeAssetPath(`public${publicPath}`));
  return `data:image/png;base64,${file.toString("base64")}`;
}
