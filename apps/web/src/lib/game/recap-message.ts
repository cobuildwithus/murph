import { readHostedPublicOrigin } from "../hosted-web/public-url";

/** The sealed story stays bare; only its delivery text includes the app handoff. */
export function gameRecapMessage(gameId: string, chatLine: string): string {
  const origin = readHostedPublicOrigin();
  if (!origin) throw new Error("A public Web origin is required for recap links.");
  return `${chatLine}\nWatch the recap: ${origin}/recap/${encodeURIComponent(gameId)}`;
}
