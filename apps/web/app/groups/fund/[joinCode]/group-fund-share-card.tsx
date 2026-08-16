import { MurphHeroOg } from "../../../_og/murph-hero-og";

export const GROUP_FUND_OG_ALT =
  "Sponsor Murph for your group. How groups keep Murph running.";

/**
 * The /groups/fund/[joinCode] link unfurl, dropped into group chats next to
 * the /groups/join card, so it keeps the same MURPH GROUP eyebrow. The copy
 * is deliberately capability-neutral (it describes what sponsoring is, not
 * that this specific link is live) so it stays true for expired or retired
 * funding links; the landing page owns the valid/unavailable states.
 * Rendered by the opengraph-image route (satori) and the /design catalog
 * share-preview study, so the preview cannot drift from production.
 */
export function GroupFundShareCard({ logoDataUri }: { logoDataUri: string }) {
  return (
    <MurphHeroOg
      logoDataUri={logoDataUri}
      eyebrow="MURPH GROUP"
      headline={"Sponsor Murph\nfor your group."}
      headlineFontSize={78}
      subtext="How groups keep Murph running."
      subtextFontSize={30}
    />
  );
}
