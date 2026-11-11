import * as z from "./zod-runtime.ts";

const ref = z.string().min(1).max(128);
export const recapBlockSchema = z.object({
  kind: z.enum(["photo", "photoPair", "contactSheet", "headline", "kicker", "quote", "stat", "scene"]),
  scene: z.object({ cast: z.array(z.string().min(1).max(200)).min(1).max(2), murph: z.literal(true).optional(), prompt: z.string().min(1).max(4000) }).strict().optional(),
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

/** Local selections carry paths; the host owns hashes, bytes and source lineage. */
export const recapShowWriterSchema = gameRecapWriterSchema.extend({
  treatment: z.string().trim().min(1).optional(),
  pages: z.array(gameRecapWriterSchema.shape.pages.element.extend({ blocks: z.array(recapBlockSchema).min(1).max(4) })).min(1).max(7),
  superlatives: showSuperlatives.max(2).refine(cards => new Set(cards.map(card => card.memberId)).size === cards.length).optional(),
  song: z.object({ title: z.string().trim().min(1).max(200), style: z.string().trim().min(1).max(2000), lyrics: z.array(z.string().trim().min(1).max(500)).min(1).max(20) }).strict().optional(),
  chatLine: z.string().trim().min(1).max(1000),
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
export const recapAssetSchema = z.object({
  slot: ref,
  kind: z.enum(["image", "song"]),
  recipeId: ref,
  storageKey: z.string().min(1).max(512),
  references: z.array(z.object({
    kind: z.enum(["profile", "entry", "murph"]),
    memberId: ref.optional(), entryId: ref.optional(), key: z.string().min(1).max(512),
  }).strict()).max(16),
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
  mediaType: z.enum(["image/jpeg", "audio/mpeg"]),
  byteLength: z.number().int().positive().max(2 * 1024 * 1024),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
}).strict();
export type RecapAsset = z.infer<typeof recapAssetSchema>;
export const gameRecapEnvelopeSchema = z.object({
  version: z.literal(1), generationId: ref, story: recapShowWriterSchema.extend({ song: recapShowWriterSchema.shape.song.catch(undefined) }),
  acceptedAt: instant,
  assets: z.array(recapAssetSchema).max(5),
  preview: z.object({ token: z.string().min(32).max(128), expiresAt: instant }).strict(),
}).strict();
export type GameRecapEnvelope = z.infer<typeof gameRecapEnvelopeSchema>;
export const storedGameRecapEnvelopeSchema = gameRecapEnvelopeSchema.extend({
  story: gameRecapEnvelopeSchema.shape.story.extend({ superlatives: recapShowWriterSchema.shape.superlatives.catch(undefined) }),
  assets: z.array(z.unknown()).max(5).transform(values => values.flatMap(value => {
    const asset = recapAssetSchema.safeParse(value);
    return asset.success ? [asset.data] : [];
  })).catch([]),
});
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
  fallback: z.object({ kind: z.enum(["photo", "text"]), entryIds: z.array(ref).max(1) }).strict().optional(),
  card: z.object({ memberId: ref, title: z.string(), line: z.string() }).strict().optional(),
  song: z.object({ title: z.string(), lyrics: z.array(z.string()) }).strict().optional(),
}).strict();
export const gameRecapPresentationSchema = z.object({
  pages: z.array(z.object({ background: z.enum(["night", "paper", "sage", "sienna", "slate"]), blocks: z.array(legacyRecapBlockSchema) }).strict()),
  superlatives: recapSuperlatives.optional(), scoreLine: z.string().optional(), chatLine: z.string(),
  show: z.object({ version: z.literal(1), generationId: ref, treatment: z.string(),
    acceptedAt: instant,
    pages: z.array(recapShowPageSchema).max(11),
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
  const media = (slot: string): z.infer<typeof displayMedia> => {
    const asset = envelope.assets.find(item => item.slot === slot);
    if (input.mediaVisible === false || !asset) return { status: "failed" };
    return { status: "ready", url: input.mediaUrl(slot, envelope.generationId), mediaType: asset.mediaType,
      ...(asset.width ? { width: asset.width } : {}), ...(asset.height ? { height: asset.height } : {}), ...(asset.durationMs ? { durationMs: asset.durationMs } : {}) };
  };
  const pages: RecapShowPage[] = story.pages.map((page, index) => {
    const sceneIndex = page.blocks.findIndex(block => block.kind === "scene");
    const scene = page.blocks[sceneIndex];
    const ids = (scene?.entryIds ?? []).filter(id => input.permittedPhotoIds.has(id)).slice(0, 1);
    return { id: `page-${index}`, kind: index === 0 ? "cover" : scene ? "scene" : page.blocks.some(block => ["photo", "photoPair", "contactSheet"].includes(block.kind)) ? "print" : "text",
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
  if (story.song && songMedia.status === "ready") pages.push({ id: "song", kind: "song", background: "night", blocks: [], media: songMedia, song: { title: story.song.title, lyrics: story.song.lyrics } });
  pages.push({ id: "result", kind: "result", background: "paper", blocks: [] });
  return { ...legacy, show: { version: 1, generationId: envelope.generationId, treatment: story.treatment ?? "", acceptedAt: envelope.acceptedAt, pages } };
}
