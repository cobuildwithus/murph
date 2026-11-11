import "server-only";
import { timingSafeEqual } from "node:crypto";
import { readRecapEnvelope, recapReferencesCurrent } from "./recap-asset-access";
import { readRecapMedia } from "./recap-media";
import { getPrisma } from "../prisma";
import { isRecapMediaVisible } from "./access";

/** Capability grants only the current generated cover. No transcript, roster,
 * raw photo, song, native presentation or provider/storage identity is exposed. */
export async function readRecapCoverPreview(gameId: string, token: string, now = new Date()) {
  if (!isRecapMediaVisible() || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  const current = await readRecapEnvelope(gameId);
  if (!current || Date.parse(current.envelope.preview.expiresAt) <= now.getTime() || !equalToken(token, current.envelope.preview.token)) return null;
  const cover = current.envelope.assets.find(asset => asset.slot === "scene-0" && asset.mediaType === "image/jpeg");
  if (!cover || !await recapReferencesCurrent(getPrisma(), gameId, [cover])) return null;
  const media = await readRecapMedia({ ownerMemberId: current.row.wordsOwnerMemberId, storageKey: cover.storageKey });
  return media && media.hash === cover.hash ? media.bytes : null;
}

function equalToken(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
