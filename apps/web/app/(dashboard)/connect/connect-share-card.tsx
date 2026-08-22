import { MurphHeroOg } from "../../_og/murph-hero-og";

export const CONNECT_OG_ALT =
  "Let’s connect your device. Wearables and health data sources.";

/**
 * The /connect link unfurl. Murph texts this link for first-time device
 * connects and reconnects, so the copy speaks as Murph and stays true for
 * both flows. Rendered by the opengraph-image route (satori) and the /design
 * catalog share-preview study, so the preview cannot drift from production.
 */
export function ConnectShareCard({ logoDataUri }: { logoDataUri: string }) {
  return (
    <MurphHeroOg
      logoDataUri={logoDataUri}
      headline={"Let’s connect\nyour device."}
      headlineFontSize={88}
      subtext="Wearables and health data sources."
      subtextFontSize={30}
    />
  );
}
