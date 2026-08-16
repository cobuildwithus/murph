import { MurphHeroOg } from "../../_og/murph-hero-og";

export const REFERRAL_OG_ALT =
  "Murph, your private health assistant. Don’t do it alone.";

/**
 * The /r/[referralCode] link unfurl. Members text this link to friends, so
 * the card frames the brand line rather than speaking as Murph: the
 * recipient has no Murph conversation yet. The copy is deliberately
 * capability-neutral so it stays true when a link has expired or been
 * revoked; the landing page owns the valid/unavailable/busy states.
 * Rendered by the opengraph-image route (satori) and the /design catalog
 * share-preview study, so the preview cannot drift from production.
 */
export function ReferralShareCard({ logoDataUri }: { logoDataUri: string }) {
  return (
    <MurphHeroOg
      logoDataUri={logoDataUri}
      headline={"Don’t do it\nalone."}
      headlineFontSize={96}
      subtext="Murph, your private health assistant."
      subtextFontSize={30}
    />
  );
}
