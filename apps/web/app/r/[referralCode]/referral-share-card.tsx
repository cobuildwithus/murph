import { MurphHeroOg } from "../../_og/murph-hero-og";

export const REFERRAL_OG_ALT =
  "You’re invited to Murph, your private health assistant.";

/**
 * The /r/[referralCode] link unfurl. Members text this link to friends, so
 * the card frames the invite around the brand line rather than speaking as
 * Murph: the recipient has no conversation with Murph yet.
 * Rendered by the opengraph-image route (satori) and the /design catalog
 * share-preview study, so the preview cannot drift from production.
 */
export function ReferralShareCard({ logoDataUri }: { logoDataUri: string }) {
  return (
    <MurphHeroOg
      logoDataUri={logoDataUri}
      eyebrow="You’re invited"
      headline={"Don’t do it\nalone."}
      headlineFontSize={96}
      subtext="Murph, your private health assistant."
      subtextFontSize={30}
    />
  );
}
