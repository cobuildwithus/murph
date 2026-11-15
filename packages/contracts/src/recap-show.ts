import * as z from "./zod-runtime.ts";
import { alignSongLyrics, songLinesSchema, songWordTimestampsSchema } from "./song-timing.ts";
export { alignSongLyrics, songWordTimestampsSchema, type SongWordTimestamp } from "./song-timing.ts";

const ref = z.string().min(1).max(128);
export const recapBlockSchema = z.object({
  kind: z.enum(["photo", "photoPair", "contactSheet", "headline", "kicker", "quote", "stat", "scene"]),
  scene: z.object({ cast: z.array(z.string().min(1).max(200)).min(1).max(2), murph: z.literal(true).optional(), prompt: z.string().min(1).max(4000), faceY: z.number().min(0).max(1).optional() }).strict().optional(),
  entryIds: z.array(ref).optional(),
  style: z.enum(["print", "fullBleed"]).optional(),
  text: z.string().optional(),
  statValue: z.string().optional(),
  quote: z.object({ who: z.string(), text: z.string(), date: z.string().optional() }).strict().optional(),
}).strict();
const showSuperlatives = z.array(z.object({
  memberId: ref, title: z.string().trim().min(1).max(200), line: z.string().trim().min(1).max(1000),
}).strict()).max(10);

const recapSuperlatives = z.array(z.object({
  memberId: ref,
  title: z.string().trim().min(1).max(80).refine((title) => {
    const words = title.split(/\s+/u).length;
    return words >= 2 && words <= 6 && !/[.。]$/u.test(title) && !/^most\s+likely\s+to\b/iu.test(title);
  }),
  line: z.string().trim().min(1).max(160),
}).strict()).min(1).max(10).refine((items) =>
  new Set(items.map((item) => item.memberId)).size === items.length
  && new Set(items.map((item) => item.title.toLowerCase())).size === items.length);

export const gameRecapWriterSchema = z.object({
  pages: z.array(z.object({
    background: z.enum(["night", "paper", "sage", "sienna", "slate"]),
    blocks: z.array(recapBlockSchema),
  }).strict()),
  superlatives: recapSuperlatives.optional(),
  treatment: z.string().trim().min(1).max(60).optional(),
  song: z.object({ title: z.string().trim().min(1).max(30), style: z.string().trim().min(1).max(220), lyrics: z.array(z.string().trim().min(1).max(60)).min(4).max(6) }).strict().optional(),
  scoreLine: z.string().optional(),
  chatLine: z.string(),
}).strict();
export type GameRecapStory = z.infer<typeof gameRecapWriterSchema>;

/** The ordered pages the band plays under, before the sung part and result. */
export function recapMusicPageKinds(story: Pick<GameRecapStory, "pages" | "superlatives">): Array<"cover" | "scene" | "print" | "text" | "superlative"> {
  return [...story.pages.map((page, index) => index === 0 ? "cover" as const
    : page.blocks.some(block => block.kind === "scene") ? "scene" as const
    : page.blocks.some(block => ["photo", "photoPair", "contactSheet"].includes(block.kind)) ? "print" as const : "text" as const),
  ...(story.superlatives ?? []).map(() => "superlative" as const)];
}

/** Raw provider words only: directions with zero duration are not singing. */
export function recapSungWords(timestamps: readonly import("./song-timing.ts").SongWordTimestamp[], sungStartMs: number) {
  return timestamps.filter(word => word.endMs > word.startMs && word.startMs >= sungStartMs);
}

export function recapFirstSungWordMs(timestamps: readonly import("./song-timing.ts").SongWordTimestamp[], sungStartMs: number): number | undefined {
  const words = recapSungWords(timestamps, sungStartMs);
  return words.length ? Math.min(...words.map(word => word.startMs)) : undefined;
}

export function recapScorePageCount(durationMs: number): number | undefined {
  const count = Math.round((durationMs - 20_000) / 5000);
  return count >= 1 && count <= 9 && Math.abs(durationMs - (count * 5000 + 20_000)) <= 500 ? count : undefined;
}

export function recapSongLines(lyrics: readonly string[], asset: Pick<RecapAsset, "wordsTimestamps" | "durationMs" | "songStartMs">, sungStartMs: number) {
  if (!asset.wordsTimestamps || !asset.durationMs) return undefined;
  const start = asset.songStartMs ?? 0;
  const words = asset.songStartMs === undefined ? asset.wordsTimestamps : recapSungWords(asset.wordsTimestamps, sungStartMs)
    .map(word => ({ ...word, startMs: word.startMs - start, endMs: word.endMs - start }));
  return alignSongLyrics(lyrics, words, asset.durationMs - start);
}

/** When the song page opens in its score; undefined for a song without one. It opens on the planned start of the
 * singing, so a singer who comes in late lengthens the song's own opening and never the page before it. A score
 * stored before songs were cut by then opens, as it always did, on its first sung word, after its own clock starts. */
function recapSongCueMs({ songStartMs, wordsTimestamps }: RecapAsset, sungStartMs: number): number | undefined {
  if (songStartMs === undefined || !wordsTimestamps) return undefined;
  const firstWordMs = recapFirstSungWordMs(wordsTimestamps, sungStartMs);
  if (firstWordMs === undefined) return undefined;
  return songStartMs <= sungStartMs ? sungStartMs : firstWordMs;
}

/** Local selections carry paths; the host owns hashes, bytes and source lineage. */
export const recapShowStorySchema = gameRecapWriterSchema.extend({
  treatment: z.string().trim().min(1).optional(),
  pages: z.array(gameRecapWriterSchema.shape.pages.element.extend({ blocks: z.array(recapBlockSchema).min(1).max(4) })).min(1).max(7),
  superlatives: showSuperlatives.max(2).refine(cards => new Set(cards.map(card => card.memberId)).size === cards.length).optional(),
  song: z.object({ title: z.string().trim().min(1).max(200), style: z.string().trim().min(1).max(2000), lyrics: z.array(z.string().trim().min(1).max(500)).min(1).max(20) }).strict().optional(),
  chatLine: z.string().trim().min(1).max(1000),
});
export const recapShowWriterSchema = recapShowStorySchema.extend({
  treatment: z.string().trim().min(1).max(40).optional(),
});
export const gameRecapDraftSchema = z.object({
  story: recapShowWriterSchema,
  files: z.array(z.object({ slot: z.string().regex(/^(scene-[0-6]|song)$/u), path: z.string().min(1).max(512) }).strict()).max(5)
    .refine(files => new Set(files.map(file => file.slot)).size === files.length),
}).strict();
export type GameRecapDraft = z.infer<typeof gameRecapDraftSchema>;

// Historical optional cards were best-effort. New writers get strict validation.
export const gameRecapStorySchema = gameRecapWriterSchema.extend({
  superlatives: recapSuperlatives.optional().catch(undefined),
  song: gameRecapWriterSchema.shape.song.catch(undefined),
});

const instant = z.isoDateTime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const recapSourceSchema = z.object({
  kind: z.enum(["profile", "contact", "entry", "murph"]),
  memberId: ref.optional(), entryId: ref.optional(), key: z.string().min(1).max(512),
}).strict();
export const recapAssetSchema = z.object({
  slot: ref,
  kind: z.enum(["image", "song"]),
  recipeId: ref,
  storageKey: z.string().min(1).max(512),
  references: z.array(recapSourceSchema).max(16),
  hash: sha256,
  mediaType: z.enum(["image/jpeg", "audio/mpeg"]),
  byteLength: z.number().int().positive().max(2 * 1024 * 1024),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
  songStartMs: z.number().nonnegative().optional(),
  wordsTimestamps: songWordTimestampsSchema.optional(),
}).strict().refine(asset => asset.songStartMs === undefined || asset.slot === "song" && asset.kind === "song"
  && asset.mediaType === "audio/mpeg" && !!asset.wordsTimestamps && !!asset.durationMs
  && asset.songStartMs < asset.durationMs && recapScorePageCount(asset.durationMs) !== undefined,
"A score requires a song, raw timings, a measured score duration and a slice origin before its end.");
export type RecapAsset = z.infer<typeof recapAssetSchema>;

/** The recap as one MP4. It is stored as ordered opaque parts on the asset rails;
 * only the whole file has a hash, a length, media facts and source lineage. */
export const RECAP_VIDEO_MAX_BYTES = 8_000_000;
export const RECAP_VIDEO_PART_MAX_BYTES = 2_000_000;
export const RECAP_VIDEO_MAX_PARTS = 4;
export const RECAP_VIDEO_MAX_DURATION_MS = 120_000;
/** Every source a renderable show can draw: two contact sheets alone need eighteen. */
export const RECAP_VIDEO_MAX_REFERENCES = 64;
export const recapVideoPartSchema = z.object({
  storageKey: z.string().min(1).max(512), hash: sha256,
  byteLength: z.number().int().positive().max(RECAP_VIDEO_PART_MAX_BYTES),
}).strict();
export type RecapVideoPart = z.infer<typeof recapVideoPartSchema>;
const videoParts = z.array(recapVideoPartSchema).min(1).max(RECAP_VIDEO_MAX_PARTS);
const videoBytes = z.number().int().positive().max(RECAP_VIDEO_MAX_BYTES);
const wholeVideo = (video: { byteLength: number; parts: readonly RecapVideoPart[] }) =>
  video.parts.reduce((sum, part) => sum + part.byteLength, 0) === video.byteLength
  && new Set(video.parts.map(part => part.storageKey)).size === video.parts.length;
export const recapVideoSchema = z.object({
  hash: sha256, byteLength: videoBytes,
  durationMs: z.number().int().positive().max(RECAP_VIDEO_MAX_DURATION_MS),
  width: z.number().int().positive().max(2048), height: z.number().int().positive().max(2048),
  references: z.array(recapSourceSchema).max(RECAP_VIDEO_MAX_REFERENCES),
  parts: videoParts,
}).strict().refine(wholeVideo, "Video parts must be distinct and add up to the whole file.");
export type RecapVideo = z.infer<typeof recapVideoSchema>;
/** What the host declares with a write. Web measures the file and resolves the sources itself. */
export const recapVideoDraftSchema = z.object({
  hash: sha256, byteLength: videoBytes,
  referenceIds: z.array(sha256).max(RECAP_VIDEO_MAX_REFERENCES),
  parts: videoParts,
}).strict().refine(wholeVideo, "Video parts must be distinct and add up to the whole file.");
export type RecapVideoDraft = z.infer<typeof recapVideoDraftSchema>;
/** The video Web accepted for a generation. A local file may be sent only when it matches. */
export const recapVideoIdentitySchema = z.object({ generationId: ref, hash: sha256, byteLength: videoBytes }).strict();
export type RecapVideoIdentity = z.infer<typeof recapVideoIdentitySchema>;

export const gameRecapEnvelopeSchema = z.object({
  version: z.literal(1), generationId: ref, story: recapShowWriterSchema.extend({ song: recapShowWriterSchema.shape.song.catch(undefined) }),
  acceptedAt: instant,
  assets: z.array(recapAssetSchema).max(5),
  video: recapVideoSchema.optional(),
  preview: z.object({ token: z.string().min(32).max(128), expiresAt: instant }).strict(),
}).strict();
export type GameRecapEnvelope = z.infer<typeof gameRecapEnvelopeSchema>;
export const storedGameRecapEnvelopeSchema = gameRecapEnvelopeSchema.extend({
  story: recapShowStorySchema.extend({ song: recapShowStorySchema.shape.song.catch(undefined), superlatives: recapShowStorySchema.shape.superlatives.catch(undefined) }),
  assets: z.array(z.unknown()).max(5).transform(values => values.flatMap(value => {
    const asset = recapAssetSchema.safeParse(value);
    return asset.success ? [asset.data] : [];
  })).catch([]),
  // A malformed video is dropped; the recap stays readable.
  video: recapVideoSchema.optional().catch(undefined),
});

export type RecapStorageObject = { slot: string; storageKey: string; hash: string;
  mediaType: RecapAsset["mediaType"] | "video/mp4"; references: RecapAsset["references"] };
/** Every stored object a recap owns: its scene and song assets, then its video's parts.
 * Acceptance, receipt retention and serving all walk this list. A part is served
 * under `video-<index>` and authorized by its parent video's sources. */
export function recapStorageObjects(recap: Pick<GameRecapEnvelope, "assets" | "video">): RecapStorageObject[] {
  const video = recap.video;
  return [
    ...recap.assets.map(({ slot, storageKey, hash, mediaType, references }) => ({ slot, storageKey, hash, mediaType, references })),
    ...(video ? video.parts.map((part, index) => ({ slot: `video-${index}`, storageKey: part.storageKey, hash: part.hash,
      mediaType: "video/mp4" as const, references: video.references })) : []),
  ];
}
export const storedGameRecapSchema = z.union([storedGameRecapEnvelopeSchema, gameRecapStorySchema]);
export function readGameRecapStory(value: unknown): GameRecapStory {
  const parsed = storedGameRecapSchema.parse(value);
  return "version" in parsed ? parsed.story : parsed;
}

// Presentation contains no recipes, storage keys, reference identities or provider metadata.
export const legacyRecapBlockSchema = recapBlockSchema.omit({ scene: true }).extend({
  kind: z.enum(["photo", "photoPair", "contactSheet", "headline", "kicker", "quote", "stat"]),
});
const displayMedia = z.discriminatedUnion("status", [
  z.object({ status: z.literal("failed") }).strict(),
  z.object({ status: z.literal("ready"), url: z.string().min(1), mediaType: z.enum(["image/jpeg", "audio/mpeg"]),
    width: z.number().positive().optional(), height: z.number().positive().optional(), durationMs: z.number().positive().optional(),
  }).strict(),
]);
export const recapShowPageSchema = z.object({
  id: ref, kind: z.enum(["cover", "scene", "print", "text", "superlative", "song", "result"]),
  background: z.enum(["night", "paper", "sage", "sienna", "slate"]),
  blocks: z.array(legacyRecapBlockSchema),
  // Insert the generated image at this zero-based position among blocks.
  imageIndex: z.number().int().min(0).max(3).optional(),
  media: displayMedia.optional(),
  cueMs: z.number().nonnegative().optional(),
  fallback: z.object({ kind: z.enum(["photo", "text"]), entryIds: z.array(ref).max(1) }).strict().optional(),
  card: z.object({ memberId: ref, title: z.string(), line: z.string() }).strict().optional(),
  song: z.object({ title: z.string(), lyrics: z.array(z.string()), lines: songLinesSchema.optional() }).strict().optional(),
}).strict();
export const gameRecapPresentationSchema = z.object({
  pages: z.array(z.object({ background: z.enum(["night", "paper", "sage", "sienna", "slate"]), blocks: z.array(legacyRecapBlockSchema) }).strict()),
  superlatives: recapSuperlatives.optional(), scoreLine: z.string().optional(), chatLine: z.string(),
  show: z.object({ version: z.literal(1), generationId: ref, treatment: z.string(),
    acceptedAt: instant,
    pages: z.array(recapShowPageSchema).max(11),
    score: z.object({ media: displayMedia }).strict().optional(),
    // One file: download the parts in order and join them.
    video: z.object({ mediaType: z.literal("video/mp4"), byteLength: videoBytes,
      durationMs: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive(),
      parts: z.array(z.object({ url: z.string().min(1), byteLength: z.number().int().positive() }).strict()).min(1).max(RECAP_VIDEO_MAX_PARTS),
    }).strict().optional(),
  }).strict().optional(),
}).strict();
export type GameRecapPresentation = z.infer<typeof gameRecapPresentationSchema>;
export type RecapShowPage = z.infer<typeof recapShowPageSchema>;

/** Pure projection; the caller supplies only currently authorized photo IDs and media URLs. */
export function presentGameRecap(input: {
  stored: GameRecapStory | GameRecapEnvelope;
  permittedPhotoIds: ReadonlySet<string>; mediaUrl: (slot: string, generationId: string) => string;
  mediaVisible?: boolean;
}): GameRecapPresentation {
  const envelope = "version" in input.stored ? input.stored : null;
  const story = "version" in input.stored ? input.stored.story : input.stored;
  const legacyPages = envelope ? [] : story.pages.map(page => ({ background: page.background, blocks: page.blocks.flatMap(block => {
    if (block.kind !== "scene") {
      const { scene: _scene, ...legacy } = block;
      return [{ ...legacy, kind: block.kind }];
    }
    const ids = (block.entryIds ?? []).filter(id => input.permittedPhotoIds.has(id)).slice(0, 1);
    return ids.length ? [{ kind: "photo" as const, entryIds: ids, style: "print" as const }] : [];
  }) })).filter(page => page.blocks.length > 0);
  const legacy: GameRecapPresentation = { pages: legacyPages, chatLine: story.chatLine,
    ...(story.scoreLine === undefined ? {} : { scoreLine: story.scoreLine }),
    ...(!envelope && story.superlatives ? { superlatives: story.superlatives } : {}),
  };
  if (!envelope) return legacy;
  const musicKinds = recapMusicPageKinds(story);
  const media = (slot: string): z.infer<typeof displayMedia> => {
    const asset = envelope.assets.find(item => item.slot === (slot === "score" ? "song" : slot));
    if (input.mediaVisible === false || !asset) return { status: "failed" };
    return { status: "ready", url: input.mediaUrl(slot, envelope.generationId), mediaType: asset.mediaType,
      ...(asset.width ? { width: asset.width } : {}), ...(asset.height ? { height: asset.height } : {}),
      ...(asset.durationMs ? { durationMs: asset.durationMs - (slot === "song" ? asset.songStartMs ?? 0 : 0) } : {}) };
  };
  const pages: RecapShowPage[] = story.pages.map((page, index) => {
    const sceneIndex = page.blocks.findIndex(block => block.kind === "scene");
    const scene = page.blocks[sceneIndex];
    const ids = (scene?.entryIds ?? []).filter(id => input.permittedPhotoIds.has(id)).slice(0, 1);
    return { id: `page-${index}`, kind: musicKinds[index]!,
      background: page.background,
      blocks: page.blocks.flatMap(block => {
        if (block.kind === "scene") return [];
        const { scene: _scene, ...legacy } = block;
        return [{ ...legacy, kind: block.kind, ...(["photo", "photoPair", "contactSheet"].includes(block.kind) ? { style: "print" as const } : {}) }];
      }),
      ...(scene ? { imageIndex: sceneIndex, media: media(`scene-${index}`), fallback: { kind: ids.length ? "photo" as const : "text" as const, entryIds: ids } } : {}),
    };
  });
  for (const card of story.superlatives ?? []) pages.push({ id: `card-${card.memberId}`, kind: "superlative", background: "paper", blocks: [], card });
  const songMedia = media("song");
  let score: { media: z.infer<typeof displayMedia> } | undefined;
  if (story.song && songMedia.status === "ready") {
    const asset = envelope.assets.find(item => item.slot === "song")!;
    const sungStartMs = musicKinds.length * 5000;
    const lines = recapSongLines(story.song.lyrics, asset, sungStartMs);
    const cueMs = recapSongCueMs(asset, sungStartMs);
    if (cueMs !== undefined) {
      score = { media: media("score") };
      pages.forEach((page, index) => { page.cueMs = index * 5000; });
    }
    pages.push({ id: "song", kind: "song", background: "night", blocks: [], media: songMedia,
      ...(cueMs === undefined ? {} : { cueMs }),
      song: { title: story.song.title, lyrics: story.song.lyrics, ...(lines ? { lines } : {}) } });
  }
  pages.push({ id: "result", kind: "result", background: "paper", blocks: [] });
  const video = input.mediaVisible === false ? undefined : envelope.video;
  return { ...legacy, show: { version: 1, generationId: envelope.generationId, treatment: (story.treatment ?? "").replace(/[\s.,;:]+$/u, ""), acceptedAt: envelope.acceptedAt, pages, ...(score ? { score } : {}),
    ...(video ? { video: { mediaType: "video/mp4" as const, byteLength: video.byteLength, durationMs: video.durationMs, width: video.width, height: video.height,
      parts: video.parts.map((part, index) => ({ url: input.mediaUrl(`video-${index}`, envelope.generationId), byteLength: part.byteLength })) } } : {}) } };
}
