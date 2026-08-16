import { MurphHeroOg } from "../../_og/murph-hero-og";

export const SETTINGS_OG_ALT =
  "Manage your Murph. Account, plan, usage, and privacy.";

/**
 * The /settings link unfurl. Billing and usage nudges Murph texts deep-link
 * here, so the card names the real sections instead of the homepage pitch.
 * Rendered by the opengraph-image route (satori) and the /design catalog
 * share-preview study, so the preview cannot drift from production.
 */
export function SettingsShareCard({ logoDataUri }: { logoDataUri: string }) {
  return (
    <MurphHeroOg
      logoDataUri={logoDataUri}
      headline={"Manage\nyour Murph."}
      headlineFontSize={96}
      subtext="Account, plan, usage, and privacy."
      subtextFontSize={30}
    />
  );
}
