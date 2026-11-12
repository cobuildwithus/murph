import { readRecapCoverPreview } from "@/src/lib/game/recap-preview";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ gameId: string; token: string }> }) {
  const { gameId, token } = await context.params;
  const bytes = await readRecapCoverPreview(gameId, token);
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" };
  if (!bytes) return new Response(null, { status: 404, headers });
  const preview = await facesBand(bytes).then((band) => band.resize(1200, 630, { fit: "cover", position: "attention" }).jpeg().toBuffer());
  return new Response(new Uint8Array(preview), { headers: { ...headers, "content-type": "image/jpeg", "content-length": String(preview.length) } });
}

/** Faces in a portrait scene sit in its upper part; the feet and floor below
 * draw the attention crop when left in. Keep the top 62%, or just enough for
 * the preview's shape on a wide picture. */
async function facesBand(bytes: Uint8Array) {
  const { width = 0, height = 0 } = await sharp(bytes).metadata();
  const band = Math.min(height, Math.max(Math.round(height * 0.62), Math.ceil((width * 630) / 1200)));
  return band > 0 && band < height ? sharp(bytes).extract({ left: 0, top: 0, width, height: band }) : sharp(bytes);
}
