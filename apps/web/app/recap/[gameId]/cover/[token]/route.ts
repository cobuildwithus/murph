import { readRecapCoverPreview } from "@/src/lib/game/recap-preview";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ gameId: string; token: string }> }) {
  const { gameId, token } = await context.params;
  const bytes = await readRecapCoverPreview(gameId, token);
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" };
  if (!bytes) return new Response(null, { status: 404, headers });
  const preview = await sharp(bytes).resize(1200, 630, { fit: "cover", position: "attention" }).jpeg().toBuffer();
  return new Response(new Uint8Array(preview), { headers: { ...headers, "content-type": "image/jpeg", "content-length": String(preview.length) } });
}
