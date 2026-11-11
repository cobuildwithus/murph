import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { RecapReference } from "@murphai/contracts/recap-material";
import { RECAP_REFERENCE_MAX_EDGE } from "@murphai/contracts/recap-admission";
import { getPrisma } from "../prisma";
import { readGameMedia } from "./media";
import type { readGameRecapMaterial } from "./service";

type Material = NonNullable<Awaited<ReturnType<typeof readGameRecapMaterial>>>;
export type RecapSourceReference = RecapReference & { key: string };
const CHARACTER_SHEET_SHA256 = "4521d2ccf4621ccf9fa44da3bc62349f804f24da1c2303fb996271ebc5241720";
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Only a fresh authorized material read may supply this witness and roster. */
export async function readRecapSourceReferences(material: Material, eventId: string): Promise<RecapSourceReference[]> {
  if (!material.validation.show || material.validation.group) return [];
  if (typeof material.game.id !== "string") throw new TypeError("Recap game identity is missing.");
  const db = getPrisma();
  const memberIds = material.validation.playerNamesByMemberId.map(player => player.memberId);
  const entryIds = material.entries.filter(entry => entry.kind === "photo").map(entry => entry.entryId);
  const [profiles, entries, character] = await Promise.all([
    db.gameProfile.findMany({ where: { memberId: { in: memberIds } }, select: { memberId: true, photoKey: true } }),
    db.gameEntry.findMany({ where: { gameId: material.game.id, id: { in: entryIds }, memberId: { in: memberIds },
      withdrawnAt: null, attempt: { gt: 0 }, reports: { none: {} } }, select: { id: true, memberId: true, mediaKeys: true } }),
    readApprovedRecapCharacterSheet(),
  ]);
  const values: Omit<RecapSourceReference, "id">[] = [
    ...profiles.flatMap(profile => profile.photoKey ? [{ kind: "profile" as const, memberId: profile.memberId, key: profile.photoKey }] : []),
    ...entries.flatMap(entry => entry.mediaKeys.slice(0, 1).map(key => ({ kind: "entry" as const, memberId: entry.memberId, entryId: entry.id, key }))),
    ...(character ? [{ kind: "murph" as const, key: "murph-character-sheet-v1" }] : []),
  ];
  return values.map(value => ({ ...value, id: digest(JSON.stringify([eventId, value.kind, value.key])) }));
}

export function publicRecapReferences(references: readonly RecapSourceReference[]): RecapReference[] {
  return references.map(({ key: _key, ...reference }) => reference);
}

export async function readRecapReferenceBytes(reference: RecapSourceReference) {
  const source = reference.kind === "murph" ? await readApprovedRecapCharacterSheet() : (await readGameMedia(reference.key))?.bytes;
  if (!source) return null;
  const bytes = await sharp(source, { limitInputPixels: 40_000_000 }).rotate()
    .resize({ width: RECAP_REFERENCE_MAX_EDGE, height: RECAP_REFERENCE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 }).toBuffer();
  const metadata = await sharp(bytes).metadata();
  return { id: reference.id, bytes: bytes.toString("base64"), hash: digest(bytes), mediaType: "image/jpeg" as const,
    byteLength: bytes.length, width: metadata.width!, height: metadata.height! };
}

/** Missing or changed art disables the cameo instead of substituting a character. */
async function readApprovedRecapCharacterSheet(): Promise<Uint8Array | null> {
  const candidates = ["agent-docs/assets/murph-character-sheet-v1.png", "../../agent-docs/assets/murph-character-sheet-v1.png"];
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(path.resolve(candidate));
      if (digest(bytes) === CHARACTER_SHEET_SHA256) return bytes;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return null;
}
