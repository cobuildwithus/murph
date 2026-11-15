import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gameRecapDraftSchema, gameRecapEnvelopeSchema, gameRecapPresentationSchema, gameRecapWriterSchema, recapSongLines, recapStorageObjects, recapVideoDraftSchema, storedGameRecapEnvelopeSchema, storedGameRecapSchema, presentGameRecap, type GameRecapEnvelope } from "../src/recap-show.js";

const story = { treatment: "Courtroom drama", chatLine: "Player A won. The mat was present.", pages: [
  { background: "paper" as const, blocks: [{ kind: "headline" as const, text: "The mat takes the stand" },
    { kind: "scene" as const, scene: { cast: ["Player A", "Player B"], prompt: "A fictional courtroom made of exercise mats, with two athletes standing beside a wooden desk and bright morning windows." }, entryIds: ["photo-one"] }] },
], song: { title: "The Mat Knows", style: "Playful", lyrics: ["The mat knows", "The shoes wait", "The door opens", "The score stays"] } };
const envelope: GameRecapEnvelope = { version: 1, generationId: "game-recap:synthetic-game", story,
  acceptedAt: "2026-11-10T12:00:00Z",
  preview: { token: "synthetic-preview-token-with-no-authority", expiresAt: "2026-12-10T12:00:00Z" },
  assets: [{ slot: "scene-0", kind: "image", recipeId: "recipe-one", storageKey: "private-storage-key", references: [], hash: "a".repeat(64), mediaType: "image/jpeg", byteLength: 123 }],
};
const input = { stored: envelope, permittedPhotoIds: new Set(["photo-one"]), mediaUrl: () => "/synthetic-media" };
describe("recap presentation compatibility", () => {
  it.each(["legacy", "full-show", "full-show-video", "failed-scene-no-song", "score-show"])("decodes the stable %s fixture", name => {
    const value = JSON.parse(readFileSync(new URL(`../fixtures/recap-show/${name}.json`, import.meta.url), "utf8"));
    expect(gameRecapPresentationSchema.parse(value)).toEqual(value);
  });
  it("returns shows to every reader without a legacy projection or private metadata", () => {
    const view = presentGameRecap(input);
    expect(view.pages).toEqual([]);
    expect(view.show?.pages[0].kind).toBe("cover");
    expect(JSON.stringify(view)).not.toMatch(/private-storage|prompt|cast|preview/);
  });
  it("keeps setup, picture position and payoff on a four-block page", () => {
    const page = { background: "paper" as const, blocks: [
      { kind: "kicker" as const, text: "Day three" },
      { kind: "headline" as const, text: "The door opens" }, story.pages[0].blocks[1],
      { kind: "headline" as const, text: "The mat objects" },
    ] };
    const view = presentGameRecap({ ...input, stored: { ...envelope, story: { ...story, pages: [page] } } });
    expect(view.show?.pages[0].imageIndex).toBe(2);
    expect(view.show?.pages[0].blocks.map(block => block.text)).toEqual(["Day three", "The door opens", "The mat objects"]);
  });
  it("caps new treatments at 40 characters while retaining historical long treatments", () => {
    const treatment = "A silent-film domestic melodrama about the purple mat and the missing breakfast";
    expect(gameRecapDraftSchema.safeParse({ story: { ...story, treatment: "x".repeat(40) }, files: [] }).success).toBe(true);
    expect(gameRecapDraftSchema.safeParse({ story: { ...story, treatment: "x".repeat(41) }, files: [] }).success).toBe(false);
    const stored = storedGameRecapEnvelopeSchema.parse({ ...envelope, story: { ...story, treatment } });
    expect(presentGameRecap({ ...input, stored }).show?.treatment).toBe(treatment);
    expect(gameRecapWriterSchema.safeParse(stored.story).success).toBe(false);
  });

  it("drops a trailing full stop so the app's starring line reads cleanly", () => {
    const draft = gameRecapDraftSchema.parse({ story: { ...story, treatment: "A polar-expedition comedy." }, files: [] });
    const stored = storedGameRecapEnvelopeSchema.parse({ ...envelope, story: draft.story });
    expect(presentGameRecap({ ...input, stored }).show?.treatment).toBe("A polar-expedition comedy");
  });
  it("accepts selected local files but rejects host authority and duplicate slots", () => {
    const selected = { slot: "scene-0", path: "media/one.jpg" };
    expect(gameRecapDraftSchema.safeParse({ story, files: [selected] }).success).toBe(true);
    expect(gameRecapDraftSchema.safeParse({ story, files: [selected, selected] }).success).toBe(false);
    expect(gameRecapDraftSchema.safeParse({ story, files: [{ ...selected, storageKey: "forged" }] }).success).toBe(false);
  });
  it("publishes final images and songs without a pending variant or polling", () => {
    const stored: GameRecapEnvelope = { ...envelope, assets: [...envelope.assets, {
      slot: 'song', kind: 'song', recipeId: 'synthetic-song', storageKey: 'private-song', references: [],
      hash: 'b'.repeat(64), mediaType: 'audio/mpeg', byteLength: 100, durationMs: 20_000,
    }] };
    const view = presentGameRecap({ ...input, stored });
    expect(view.show?.pages.map(page => page.kind)).toEqual(['cover', 'song', 'result']);
    expect(view.show?.pages[0].media).toMatchObject({ status: 'ready', mediaType: 'image/jpeg' });
    expect(view.show?.pages[1].media).toMatchObject({ status: 'ready', mediaType: 'audio/mpeg' });
    expect(view.show?.pages[1].song).not.toHaveProperty('lines');
    expect(view.show).not.toHaveProperty('mediaDeadline');
    expect(view.show).not.toHaveProperty('refreshAfterMs');
    const hidden = presentGameRecap({ ...input, stored, mediaVisible: false });
    expect(hidden.show?.pages.map(page => page.kind)).toEqual(['cover', 'result']);
    expect(hidden.show?.pages[0]).toMatchObject({ media: { status: 'failed' }, fallback: { kind: 'photo', entryIds: ['photo-one'] } });
    expect(hidden.chatLine).toBe(story.chatLine);
  });
  it("projects exactly one timing line per lyric line without provider words or private asset metadata", () => {
    const lyrics = ["Leo,  goes", "Ava stays."];
    const stored = storedGameRecapEnvelopeSchema.parse({ ...envelope, story: { ...story, song: { ...story.song, lyrics } }, assets: [{
      slot: 'song', kind: 'song', recipeId: 'synthetic-song', storageKey: 'private-song', references: [],
      hash: 'b'.repeat(64), mediaType: 'audio/mpeg', byteLength: 100, durationMs: 20_000,
      wordsTimestamps: [{ word: 'LEO', startMs: 100, endMs: 300 }, { word: 'goes', startMs: 400, endMs: 600 },
        { word: 'ava', startMs: 900, endMs: 1200 }, { word: 'stays', startMs: 1500, endMs: 1800 }],
    }] });
    const view = gameRecapPresentationSchema.parse(presentGameRecap({ ...input, stored }));
    expect(view.show?.pages.find(page => page.kind === 'song')?.song).toEqual({ title: story.song.title, lyrics, lines: [
      { words: [{ text: 'Leo,', startMs: 100, endMs: 300 }, { text: 'goes', startMs: 400, endMs: 600 }] },
      { words: [{ text: 'Ava', startMs: 900, endMs: 1200 }, { text: 'stays.', startMs: 1500, endMs: 1800 }] },
    ] });
    expect(JSON.stringify(view)).not.toMatch(/wordsTimestamps|private-song|LEO/);
  });
  it('projects score clocks and omits them entirely for legacy, hidden or invalid media', () => {
    const asset = { slot: 'song', kind: 'song', recipeId: 'synthetic', storageKey: 'private-song', references: [],
      hash: 'b'.repeat(64), mediaType: 'audio/mpeg', byteLength: 400_000, durationMs: 25_008, songStartMs: 4800,
      wordsTimestamps: [{ word: 'Hello', startMs: 5000, endMs: 5300 }] } satisfies GameRecapEnvelope['assets'][number];
    const stored: GameRecapEnvelope = { ...envelope, story: { ...story, song: { ...story.song, lyrics: ['Hello'] } }, assets: [asset] };
    const view = gameRecapPresentationSchema.parse(presentGameRecap({ ...input, stored, mediaUrl: slot => `/synthetic/${slot}` }));
    expect(view.show?.score).toEqual({ media: { status: 'ready', url: '/synthetic/score', mediaType: 'audio/mpeg', durationMs: 25_008 } });
    expect(view.show?.pages.map(page => page.cueMs)).toEqual([0, 5000, undefined]);
    expect(view.show?.pages[1]?.media).toMatchObject({ url: '/synthetic/song', durationMs: 20_208 });
    expect(view.show?.pages[1]?.song?.lines?.[0]?.words).toEqual([{ text: 'Hello', startMs: 200, endMs: 500 }]);
    expect(JSON.stringify(view)).not.toMatch(/songStartMs|wordsTimestamps|private-song/);
    // A singer five seconds late: the song starts on the planned start, so the cover keeps its five seconds and the
    // song page opens on time, its band playing on until the first word lights five seconds in.
    const late = { ...asset, songStartMs: 5000, wordsTimestamps: [{ word: 'Hello', startMs: 10_000, endMs: 10_300 }] };
    const planned = gameRecapPresentationSchema.parse(presentGameRecap({ ...input, stored: { ...stored, assets: [late] }, mediaUrl: slot => `/synthetic/${slot}` }));
    expect(planned.show?.pages.map(page => page.cueMs)).toEqual([0, 5000, undefined]);
    expect(planned.show?.pages[1]?.media).toMatchObject({ url: '/synthetic/song', durationMs: 20_008 });
    expect(planned.show?.pages[1]?.song?.lines?.[0]?.words).toEqual([{ text: 'Hello', startMs: 5000, endMs: 5300 }]);
    // The same singer in a score stored before songs started by then keeps its page on the first sung word.
    const older = gameRecapPresentationSchema.parse(presentGameRecap({ ...input, stored: { ...stored, assets: [{ ...late, songStartMs: 9792 }] }, mediaUrl: slot => `/synthetic/${slot}` }));
    expect(older.show?.pages.map(page => page.cueMs)).toEqual([0, 10_000, undefined]);
    expect(older.show?.pages[1]?.song?.lines?.[0]?.words).toEqual([{ text: 'Hello', startMs: 208, endMs: 508 }]);
    // An opening lyric word the timings missed waits for the singing instead of lighting through the band's opening.
    const missed = [{ word: 'rise', startMs: 10_000, endMs: 10_300 }, { word: 'together', startMs: 10_400, endMs: 10_900 }];
    expect(recapSongLines(['We rise together'], { wordsTimestamps: missed, durationMs: 25_008, songStartMs: 5000 }, 5000)?.[0]?.words)
      .toEqual([{ text: 'We', startMs: 5000, endMs: 5000 }, { text: 'rise', startMs: 5000, endMs: 5300 }, { text: 'together', startMs: 5400, endMs: 5900 }]);
    const { songStartMs: _origin, ...legacy } = asset;
    for (const fallback of [
      presentGameRecap({ ...input, stored, mediaVisible: false }),
      presentGameRecap({ ...input, stored: storedGameRecapEnvelopeSchema.parse({ ...stored, assets: [{ ...asset, songStartMs: -1 }] }) }),
      presentGameRecap({ ...input, stored: { ...stored, assets: [{ ...legacy, durationMs: 20_000 }] } }),
    ]) {
      expect(fallback.show).not.toHaveProperty('score');
      expect(fallback.show?.pages.every(page => !('cueMs' in page))).toBe(true);
    }
  });
  it("accepts only bounded face positions and keeps timing facts out of editable file selections", () => {
    const withFace = (faceY: number) => ({ story: { ...story, pages: [{ background: 'paper', blocks: [{ kind: 'scene', scene: { ...story.pages[0].blocks[1]!.scene, faceY } }] }] }, files: [] });
    for (const y of [0, 0.25, 1]) expect(gameRecapDraftSchema.safeParse(withFace(y)).success).toBe(true);
    for (const y of [-0.01, 1.01, NaN, Infinity]) expect(gameRecapDraftSchema.safeParse(withFace(y)).success).toBe(false);
    expect(gameRecapDraftSchema.safeParse({ story, files: [{ slot: 'song', path: 'media/song.mp3', wordsTimestamps: [] }] }).success).toBe(false);
  });
  it("uses stable text fallback for missing media and revoked photo references", () => {
    const view = presentGameRecap({ ...input, stored: { ...envelope, assets: [] }, permittedPhotoIds: new Set() });
    expect(view.show?.pages[0]).toMatchObject({ id: 'page-0', media: { status: 'failed' }, fallback: { kind: 'text', entryIds: [] } });
    expect(view.show?.pages.map(page => page.kind)).toEqual(['cover', 'result']);
  });
  it("retains historical plain-story reads without a show or polling", () => {
    const fixture = JSON.parse(readFileSync(new URL('../fixtures/recap-show/legacy.json', import.meta.url), 'utf8'));
    expect(presentGameRecap({ ...input, stored: gameRecapWriterSchema.parse(fixture) })).toEqual(fixture);
  });
  it("rejects host authority and malformed optional authoring media on new writes", () => {
    expect(gameRecapWriterSchema.safeParse({ ...story, assets: [] }).success).toBe(false);
    expect(gameRecapWriterSchema.safeParse({ ...story, song: { ...story.song, lyrics: [""] } }).success).toBe(false);
    expect(gameRecapWriterSchema.safeParse({ ...story, treatment: " " }).success).toBe(false);
  });
  it("keeps the readable story and result when stored optional media is malformed", () => {
    const stored = storedGameRecapEnvelopeSchema.parse({ ...envelope, story: { ...story, song: { lyrics: null } }, assets: [{ ...envelope.assets[0], width: -1 }] });
    expect(stored.story.song).toBeUndefined();
    const view = presentGameRecap({ ...input, stored });
    expect(view.chatLine).toBe(story.chatLine);
    expect(view.show?.pages.map(page => page.kind)).toEqual(["cover", "result"]);
    expect(view.show?.pages[0].media?.status).toBe("failed");
  });
});

describe("recap video in the stored envelope", () => {
  const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/recap-show/${name}.json`, import.meta.url), "utf8"));
  const plain = fixture("envelope") as GameRecapEnvelope, withVideo = fixture("envelope-video") as GameRecapEnvelope & { video: NonNullable<GameRecapEnvelope["video"]> };
  const present = (stored: GameRecapEnvelope, mediaVisible?: boolean) => presentGameRecap({ stored, mediaVisible,
    permittedPhotoIds: new Set(["synthetic-photo-a"]), mediaUrl: (slot, generation) => `/media/${slot}?generation=${generation}` });
  // What ran one release earlier: the same strict envelope, without the `video` key.
  const previousRelease = storedGameRecapEnvelopeSchema.omit({ video: true });

  it("reads an envelope without a video exactly as before", () => {
    const stored = storedGameRecapEnvelopeSchema.parse(plain);
    expect(stored).toEqual(plain);
    expect(stored).not.toHaveProperty("video");
    expect(stored).toEqual(previousRelease.parse(plain));
    expect(gameRecapEnvelopeSchema.parse(plain)).toEqual(plain);
    const view = present(stored);
    expect(Object.keys(view.show!)).toEqual(["version", "generationId", "treatment", "acceptedAt", "pages"]);
    expect(view).toEqual(present(previousRelease.parse(plain)));
    expect(recapStorageObjects(stored).map(object => object.slot)).toEqual(["scene-0", "song"]);
  });

  it("reads one video with its ordered parts and leaves the assets and their limit alone", () => {
    const stored = storedGameRecapEnvelopeSchema.parse(withVideo);
    expect(stored).toEqual(withVideo);
    expect(gameRecapEnvelopeSchema.parse(withVideo)).toEqual(withVideo);
    expect(stored.assets).toEqual(plain.assets);
    expect(recapStorageObjects(stored)).toEqual([
      ...plain.assets.map(({ slot, storageKey, hash, mediaType, references }) => ({ slot, storageKey, hash, mediaType, references })),
      ...withVideo.video.parts.map((part, index) => ({ slot: `video-${index}`, storageKey: part.storageKey, hash: part.hash, mediaType: "video/mp4", references: withVideo.video.references })),
    ]);
    const sixth = { ...withVideo, assets: Array.from({ length: 6 }, () => withVideo.assets[0]) };
    expect(gameRecapEnvelopeSchema.safeParse(sixth).success).toBe(false);
    expect(storedGameRecapEnvelopeSchema.parse(sixth).assets).toEqual([]);
  });

  it("is the rollback floor: the previous release cannot read an envelope that has a video", () => {
    expect(previousRelease.safeParse(withVideo).success).toBe(false);
    // The union's story branch is strict too, so the older reader has no fallback either.
    expect(gameRecapWriterSchema.safeParse(withVideo).success).toBe(false);
    expect(storedGameRecapSchema.parse(withVideo)).toEqual(withVideo);
  });

  it.skipIf(process.env.MURPH_VERIFY_RECAP_SKEW !== "1")("matches the real previous release on both envelope formats", async () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const old = new URL(`../src/.recap-video-skew-${randomUUID()}.ts`, import.meta.url);
    await writeFile(old, execFileSync("git", ["show", "fa02b3ce62e03f5c7469d46bcf677f0faad41dcb:packages/contracts/src/recap-show.ts"], { cwd: root, encoding: "utf8" }), { flag: "wx" });
    try {
      const base = await import(old.href) as typeof import("../src/recap-show.js");
      expect(base.storedGameRecapSchema.parse(plain)).toEqual(storedGameRecapSchema.parse(plain));
      expect(base.presentGameRecap({ stored: base.storedGameRecapEnvelopeSchema.parse(plain), permittedPhotoIds: new Set(["synthetic-photo-a"]), mediaUrl: (slot, generation) => `/media/${slot}?generation=${generation}` }))
        .toEqual(present(storedGameRecapEnvelopeSchema.parse(plain)));
      expect(base.storedGameRecapSchema.safeParse(withVideo).success).toBe(false);
    } finally { await rm(old, { force: true }); }
  });

  it("presents the video as ordered part links without storage identity, and hides it with the media switch", () => {
    const view = gameRecapPresentationSchema.parse(present(storedGameRecapEnvelopeSchema.parse(withVideo)));
    expect(view.show?.video).toEqual({ mediaType: "video/mp4", byteLength: 5_200_000, durationMs: 51_033, width: 804, height: 1748,
      parts: [2_000_000, 2_000_000, 1_200_000].map((byteLength, index) => ({ url: `/media/video-${index}?generation=${withVideo.generationId}`, byteLength })) });
    expect(JSON.stringify(view)).not.toMatch(/storageKey|\.mp4|references|synthetic-member|[a-f0-9]{64}/u);
    expect({ ...view, show: { ...view.show, video: undefined } }).toEqual(present(storedGameRecapEnvelopeSchema.parse(plain)));
    const hidden = present(storedGameRecapEnvelopeSchema.parse(withVideo), false);
    expect(hidden.show).not.toHaveProperty("video");
    expect(hidden).toEqual(present(storedGameRecapEnvelopeSchema.parse(plain), false));
  });

  const part = withVideo.video.parts[0]!;
  it.each([
    ["parts that do not add up to the file", { byteLength: 5_200_001 }],
    ["a file over eight megabytes", { byteLength: 8_000_001, parts: [...withVideo.video.parts, { ...part, storageKey: "recap/other.mp4", byteLength: 2_000_000 }, { ...part, storageKey: "recap/last.mp4", byteLength: 800_001 }] }],
    ["a fifth part", { byteLength: 5, parts: Array.from({ length: 5 }, (_, index) => ({ ...part, storageKey: `recap/part-${index}.mp4`, byteLength: 1 })) }],
    ["no parts", { parts: [] }],
    ["a part over two megabytes", { byteLength: 2_000_001, parts: [{ ...part, byteLength: 2_000_001 }] }],
    ["the same part twice", { byteLength: 4_000_000, parts: [part, part] }],
    ["a part with media facts of its own", { parts: withVideo.video.parts.map(value => ({ ...value, durationMs: 1 })) }],
    ["a duration over two minutes", { durationMs: 120_001 }],
    ["a frame over the bound", { height: 2049 }],
    ["more sources than the bound", { references: Array.from({ length: 65 }, (_, index) => ({ kind: "entry", memberId: "synthetic-member-a", entryId: `entry-${index}`, key: `game/synthetic-member-a/${index}.jpg` })) }],
    ["a hash that is not one", { hash: "not-a-hash" }],
    ["an unknown field", { url: "https://media.invalid/file.mp4" }],
  ])("refuses %s on a write and drops only the video on a stored read", (_name, change) => {
    const changed = { ...withVideo, video: { ...withVideo.video, ...change } };
    expect(gameRecapEnvelopeSchema.safeParse(changed).success).toBe(false);
    const stored = storedGameRecapEnvelopeSchema.parse(changed);
    expect(stored).toEqual(plain);
    expect(present(stored)).toEqual(present(storedGameRecapEnvelopeSchema.parse(plain)));
  });

  it("bounds what a host may declare with a write", () => {
    const draft = { hash: withVideo.video.hash, byteLength: withVideo.video.byteLength, referenceIds: ["a".repeat(64)], parts: withVideo.video.parts };
    expect(recapVideoDraftSchema.parse(draft)).toEqual(draft);
    for (const change of [{ durationMs: 51_033 }, { references: [] }, { byteLength: 1 }, { parts: [] }, { referenceIds: Array.from({ length: 65 }, () => "a".repeat(64)) }, { referenceIds: ["game/key.jpg"] }]) {
      expect(recapVideoDraftSchema.safeParse({ ...draft, ...change }).success).toBe(false);
    }
  });
});

