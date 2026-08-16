import { MurphHeroOg } from "../../../_og/murph-hero-og";

export const GROUP_FUND_OG_ALT =
  "Keep Murph in this chat. Sponsor Murph for the whole chat.";

/**
 * The /groups/fund/[joinCode] link unfurl, dropped into group chats next to
 * the /groups/join card, so it keeps the same MURPH GROUP eyebrow. Rendered
 * by the opengraph-image route (satori) and the /design catalog share-preview
 * study, so the preview cannot drift from production.
 */
export function GroupFundShareCard({ logoDataUri }: { logoDataUri: string }) {
  return (
    <MurphHeroOg
      logoDataUri={logoDataUri}
      eyebrow="Murph group"
      headline={"Keep Murph\nin this chat."}
      headlineFontSize={88}
      subtext="Sponsor Murph for the whole chat."
      subtextFontSize={30}
    />
  );
}
