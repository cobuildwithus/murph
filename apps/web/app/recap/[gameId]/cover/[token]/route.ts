import { readRecapCoverPreview } from "@/src/lib/game/recap-preview";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ gameId: string; token: string }> }) {
  const { gameId, token } = await context.params;
  const bytes = await readRecapCoverPreview(gameId, token);
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" };
  if (!bytes) return new Response(null, { status: 404, headers });
  return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-type": "image/jpeg", "content-length": String(bytes.length) } });
}
