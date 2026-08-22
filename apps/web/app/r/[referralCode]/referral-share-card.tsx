import { MurphHeroOg } from "../../_og/murph-hero-og";

export const REFERRAL_OG_ALT = "Meet Murph, your private health assistant.";

/**
 * The /r/[referralCode] link unfurl. Members text this link to friends, so
 * the card introduces Murph rather than speaking as it: the recipient has no
 * Murph conversation yet. The copy is deliberately capability-neutral so it
 * stays true when a link has expired or been revoked; the landing page owns
 * the valid/unavailable/busy states. Rendered by the opengraph-image route
 * (satori) and the /design catalog share-preview study, so the preview
 * cannot drift from production.
 */
export function ReferralShareCard({ logoDataUri }: { logoDataUri: string }) {
  return (
    <MurphHeroOg
      logoDataUri={logoDataUri}
      headline="Meet Murph."
      headlineFontSize={96}
      subtext="Your private health assistant."
      subtextFontSize={30}
    />
  );
}
