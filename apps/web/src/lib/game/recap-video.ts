import "server-only";
import { createHash } from "node:crypto";
import { RECAP_VIDEO_MAX_DURATION_MS, RECAP_VIDEO_MAX_REFERENCES, recapVideoDraftSchema, recapVideoSchema,
  type RecapAsset, type RecapVideo } from "@murphai/contracts/recap-show";
import { logHostedOnboardingWarning } from "../hosted-onboarding/logging";
import { getPrisma } from "../prisma";
import { isPairRecapVideoEnabled } from "./access";
import { recapReferencesCurrent } from "./recap-asset-access";
import { readRecapSourceReferences } from "./recap-inputs";
import { readRecapGenerationObject, resolveRecapSources } from "./recap-media";
import { recapResourceId } from "./recap-retirement";
import { outcomeFor, type StoredResult, type StoredTerms, type TermWords } from "./rules";
import type { GameRecapMaterial } from "./service";
import { stakeItem } from "./views";

/** The last screen's facts, in the third person: who won and what is owed. */
export type RecapPoster = {
  // `everyDay`: neither player missed a day, which the last screen of an even game says.
  outcome: { kind: "won"; winnerMemberId: string; loserMemberId: string } | { kind: "even"; everyDay: boolean };
  stake: { kind: "prize" | "dare"; title: string; owedByMemberId: string; owedToMemberId: string }
    | { kind: "both_win"; title: string } | { kind: "none" }
    // Owed in a shape the last screen has no single drawing for, such as one item per missed day.
    | { kind: "other" };
};

type RecapPosterInput = {
  result: StoredResult; terms: StoredTerms; words: TermWords;
  tickets: readonly { stakeKey: string; owedBySeats: readonly number[]; owedToSeats: readonly number[] }[];
};

/** The material's `game.poster`, only where a video may be made. It rides in the untyped
 * game object because a new material field would make an older runtime reject the read. */
export function recapPosterField(maxPlayers: number, input: RecapPosterInput): { poster?: RecapPoster } {
  return isPairRecapVideoEnabled(maxPlayers) ? { poster: recapPoster(input) } : {};
}

/** Read from the settled result and the tickets it issued, the same facts the app's
 * result page shows each player. The renderer never works out a winner itself. */
export function recapPoster(input: RecapPosterInput): RecapPoster {
  const scores = input.result.scores;
  const winner = scores.find(score => outcomeFor(input.result, score.memberId) === "won");
  const loser = winner && scores.find(score => score.memberId !== winner.memberId);
  const outcome: RecapPoster["outcome"] = winner && loser ? { kind: "won", winnerMemberId: winner.memberId, loserMemberId: loser.memberId }
    : { kind: "even", everyDay: scores.every(score => score.misses === 0) };
  const kindOf = (key: string) => input.terms.versions.flatMap(version => version.stakes).find(stake => stake.key === key)?.kind;
  const member = (seats: readonly number[]) => seats.length === 1 ? scores.find(score => score.seat === seats[0])?.memberId : undefined;
  const [first, second] = input.tickets;
  if (!first) return { outcome, stake: { kind: "none" } };
  const kind = kindOf(first.stakeKey), title = stakeItem(input.words, first.stakeKey);
  const owedBy = member(first.owedBySeats), owedTo = member(first.owedToSeats);
  if (title && kind === "both_get" && input.tickets.length === 2 && second!.stakeKey === first.stakeKey) return { outcome, stake: { kind: "both_win", title } };
  if (title && input.tickets.length === 1 && owedBy && owedTo && (kind === "prize" || kind === "winner_gets" || kind === "dare")) {
    return { outcome, stake: { kind: kind === "dare" ? "dare" : "prize", title, owedByMemberId: owedBy, owedToMemberId: owedTo } };
  }
  return { outcome, stake: { kind: "other" } };
}

type Box = { type: string; start: number; end: number };
const TOP_LEVEL = new Set(["ftyp", "moov", "mdat", "free", "skip", "wide"]);
const BRANDS = /^(?:isom|iso[2-9]|mp4[12]|avc1)$/u;

/** The direct children of one box range. Null unless they tile it exactly, within the count. */
function boxes(bytes: Buffer, start: number, end: number, limit: number): Box[] | null {
  const found: Box[] = [];
  let at = start;
  while (at < end) {
    if (found.length === limit || end - at < 8) return null;
    let size = bytes.readUInt32BE(at), header = 8;
    if (size === 1) {
      if (end - at < 16) return null;
      const large = bytes.readBigUInt64BE(at + 8);
      if (large > BigInt(end - at)) return null;
      size = Number(large); header = 16;
    }
    // Size zero ("to the end of the file") is refused with every other open-ended shape.
    if (size < header || size > end - at) return null;
    found.push({ type: bytes.toString("latin1", at + 4, at + 8), start: at + header, end: at + size });
    at += size;
  }
  return found;
}

/** The movie box's children, once the file's own boxes tile it exactly around one known header, one movie and media. */
function movieBoxes(bytes: Buffer): Box[] | null {
  const top = boxes(bytes, 0, bytes.length, 16);
  const header = top?.[0];
  if (!top || header?.type !== "ftyp" || header.end - header.start < 8 || !BRANDS.test(bytes.toString("latin1", header.start, header.start + 4))) return null;
  const movies = top.filter(box => box.type === "moov");
  if (movies.length !== 1 || top.some(box => !TOP_LEVEL.has(box.type)) || !top.some(box => box.type === "mdat" && box.end > box.start)) return null;
  return boxes(bytes, movies[0]!.start, movies[0]!.end, 32);
}

function movieDurationMs(bytes: Buffer, mvhd: Box): number | null {
  const long = bytes[mvhd.start] === 1;
  if (mvhd.end - mvhd.start < (long ? 32 : 20)) return null;
  const timescale = bytes.readUInt32BE(mvhd.start + (long ? 20 : 12));
  const ticks = long ? Number(bytes.readBigUInt64BE(mvhd.start + 24)) : bytes.readUInt32BE(mvhd.start + 16);
  const durationMs = timescale ? Math.round(ticks * 1000 / timescale) : 0;
  return Number.isSafeInteger(durationMs) && durationMs >= 1 && durationMs <= RECAP_VIDEO_MAX_DURATION_MS ? durationMs : null;
}

/** A picture track's frame, "sound" for any other track, null for a track that cannot be read. */
function trackFrame(bytes: Buffer, track: Box): { width: number; height: number } | "sound" | null {
  const inside = boxes(bytes, track.start, track.end, 16);
  const tkhd = inside?.find(box => box.type === "tkhd"), mdia = inside?.find(box => box.type === "mdia");
  const hdlr = mdia && boxes(bytes, mdia.start, mdia.end, 16)?.find(box => box.type === "hdlr");
  if (!tkhd || !hdlr || hdlr.end - hdlr.start < 12) return null;
  if (bytes.toString("latin1", hdlr.start + 8, hdlr.start + 12) !== "vide") return "sound";
  // The frame size closes the track header as two 16.16 fixed-point numbers.
  const size = tkhd.start + (bytes[tkhd.start] === 1 ? 88 : 76);
  if (tkhd.end - size < 8) return null;
  const width = bytes.readUInt32BE(size) / 65536, height = bytes.readUInt32BE(size + 4) / 65536;
  return Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 ? { width, height } : null;
}

/**
 * Measure a complete, self-contained MP4: its boxes tile the file exactly, it
 * opens with a known `ftyp`, and it holds media and one `moov` with exactly one
 * picture track. The duration and frame size come from the file, never from
 * the caller. Null for anything else, fragmented files included.
 */
export function inspectRecapVideo(input: Uint8Array): { durationMs: number; width: number; height: number } | null {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const movie = movieBoxes(bytes);
  const headers = movie?.filter(box => box.type === "mvhd") ?? [], tracks = movie?.filter(box => box.type === "trak") ?? [];
  if (headers.length !== 1 || tracks.length < 1 || tracks.length > 4) return null;
  const durationMs = movieDurationMs(bytes, headers[0]!);
  const frames = tracks.map(track => trackFrame(bytes, track));
  const pictures = frames.filter(frame => frame !== "sound");
  const picture = pictures[0];
  return durationMs && pictures.length === 1 && picture ? { durationMs, ...picture } : null;
}

/**
 * The video a write may attach, or null for "no video". Runs before the
 * accepting transaction and outside it: every part must be this generation's
 * own stored object, the joined parts must be the declared file and a real MP4,
 * and every source it shows must be a current one. A candidate that is not a
 * well-formed draft, fails any test or has a part that cannot be read is left
 * off; the recap is accepted without it.
 */
export async function selectRecapVideo(input: {
  draft: unknown; gameId: string; eventId: string; generationId: string; ownerMemberId: string;
  assets: readonly RecapAsset[]; material: GameRecapMaterial;
}): Promise<RecapVideo | null> {
  const selected = await measureRecapVideo(input);
  if (typeof selected !== "string") return selected;
  logHostedOnboardingWarning("game.recap.video-skipped", { reason: selected });
  return null;
}

async function measureRecapVideo(input: Parameters<typeof selectRecapVideo>[0]): Promise<RecapVideo | "disabled" | "draft" | "source" | "sources" | "part" | "file" | "container"> {
  if (!isPairRecapVideoEnabled(2)) return "disabled";
  // Count and size bounds hold before anything is read.
  const draft = recapVideoDraftSchema.safeParse(input.draft).data;
  if (!draft) return "draft";
  const declared = resolveRecapSources(await readRecapSourceReferences(input.material, input.eventId), draft.referenceIds);
  if (!declared) return "source";
  // The video shows the scenes too, so it inherits every source they were made from.
  const references = [...input.assets.flatMap(asset => asset.references), ...declared]
    .filter((source, index, all) => all.findIndex(other => other.kind === source.kind && other.key === source.key
      && other.memberId === source.memberId && other.entryId === source.entryId) === index);
  // Lineage is never truncated: a show with more sources than the bound gets no video.
  if (references.length > RECAP_VIDEO_MAX_REFERENCES) return "sources";
  // Every part must still hold the receipt its upload registered: a part that was
  // never staged here, has expired or was retired is not read at all.
  const staged = await getPrisma().gameRecapAsset.count({ where: { userId: input.ownerMemberId, retiredAt: null, purgedAt: null, recoveryUntil: { gt: new Date() },
    resourceId: { in: draft.parts.map(part => recapResourceId(input.gameId, input.generationId, part.storageKey)) } } });
  if (staged !== draft.parts.length) return "part";
  const parts: Uint8Array[] = [];
  for (const part of draft.parts) {
    // An unreadable part costs the video, never the recap.
    const bytes = await readRecapGenerationObject({ generationId: input.generationId, ownerMemberId: input.ownerMemberId, object: { ...part, mediaType: "video/mp4" } }).catch(() => null);
    if (!bytes || bytes.length !== part.byteLength) return "part";
    parts.push(bytes);
  }
  const file = Buffer.concat(parts);
  if (file.length !== draft.byteLength || createHash("sha256").update(file).digest("hex") !== draft.hash) return "file";
  const measured = inspectRecapVideo(file);
  const video = measured && recapVideoSchema.safeParse({ hash: draft.hash, byteLength: draft.byteLength, ...measured, references, parts: draft.parts }).data;
  if (!video) return "container";
  return await recapReferencesCurrent(getPrisma(), input.gameId, [video]) ? video : "source";
}
