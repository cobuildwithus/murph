import { MurphHeroOg } from "../../_og/murph-hero-og";

export const APPROVE_OG_ALT =
  "Murph needs your OK. Tap to review the request before it expires.";

/**
 * The /approve link unfurl. It lands inside a conversation with Murph, right
 * under the message that sent the link, so the copy speaks as Murph rather
 * than about it, and nothing in the frame imitates a tappable control.
 * Rendered by the opengraph-image route (satori) and by the /design catalog
 * share-preview study, so the preview cannot drift from production.
 */
export function ApproveShareCard({ logoDataUri }: { logoDataUri: string }) {
  return (
    <MurphHeroOg
      logoDataUri={logoDataUri}
      headline={"I need\nyour OK."}
      headlineFontSize={96}
      subtext="Tap to review. The link expires soon."
      subtextFontSize={30}
    />
  );
}
