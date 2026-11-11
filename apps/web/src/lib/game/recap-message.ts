import { readHostedPublicOrigin } from "../hosted-web/public-url";

/** The sealed story stays bare; only its delivery text includes the app handoff. */
export function gameRecapMessage(gameId: string, chatLine: string, previewToken?: string): string {
  const origin = readHostedPublicOrigin();
  if (!origin) throw new Error("A public Web origin is required for recap links.");
  return `${chatLine}\nWatch the recap: ${origin}/recap/${encodeURIComponent(gameId)}${previewToken ? `?preview=${encodeURIComponent(previewToken)}` : ""}`;
}

/** Read the accepted capability on replay; never mint one for a delivery retry. */
export async function acceptedGameRecapMessage(gameId: string, chatLine: string): Promise<string> {
  const { readRecapEnvelope } = await import("./recap-asset-access");
  const current = await readRecapEnvelope(gameId);
  return gameRecapMessage(gameId, chatLine, current?.envelope.story.chatLine === chatLine ? current.envelope.preview.token : undefined);
}
