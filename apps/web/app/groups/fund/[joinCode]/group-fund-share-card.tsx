import { MurphHeroOg } from "../../../_og/murph-hero-og";

export const GROUP_FUND_OG_ALT =
  "Murph group sponsorship. How groups keep Murph running.";

/**
 * The /groups/fund/[joinCode] link unfurl, dropped into group chats. The copy
 * is deliberately descriptive rather than imperative (it names what the route
 * is about, not an action this specific link is promised to offer) so it
 * stays true for expired or retired funding links; the landing page owns the
 * valid/unavailable states. Rendered by the opengraph-image route (satori)
 * and the /design catalog share-preview study, so the preview cannot drift
 * from production.
 */
export function GroupFundShareCard({ logoDataUri }: { logoDataUri: string }) {
  return (
    <MurphHeroOg
      logoDataUri={logoDataUri}
      headline={"Murph group\nsponsorship."}
      headlineFontSize={78}
      subtext="How groups keep Murph running."
      subtextFontSize={30}
    />
  );
}
