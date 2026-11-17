import { readRecapCoverPreview } from "@/src/lib/game/recap-preview";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ gameId: string; token: string }> }) {
  const { gameId, token } = await context.params;
  const cover = await readRecapCoverPreview(gameId, token);
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" };
  if (!cover) return new Response(null, { status: 404, headers });
  const preview = await facesBand(cover.bytes, cover.faceY).then((band) => band.resize(1200, 630, { fit: "cover", position: cover.faceY === undefined ? "attention" : "centre" }).jpeg().toBuffer());
  return new Response(new Uint8Array(preview), { headers: { ...headers, "content-type": "image/jpeg", "content-length": String(preview.length) } });
}

/** Center on the inspected face position. Historical scenes retain the upper
 * 62% attention crop, which excludes distracting feet and floor. */
async function facesBand(bytes: Uint8Array, faceY?: number) {
  const { width = 0, height = 0 } = await sharp(bytes).metadata();
  if (faceY !== undefined && width > 0 && height > 0) {
    const band = Math.min(height, Math.ceil((width * 630) / 1200));
    const top = Math.max(0, Math.min(height - band, Math.round(faceY * height - band / 2)));
    return sharp(bytes).extract({ left: 0, top, width, height: band });
  }
  const band = Math.min(height, Math.max(Math.round(height * 0.62), Math.ceil((width * 630) / 1200)));
  return band > 0 && band < height ? sharp(bytes).extract({ left: 0, top: 0, width, height: band }) : sharp(bytes);
}
