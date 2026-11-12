import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gameRecapDraftSchema, gameRecapPresentationSchema, gameRecapWriterSchema, storedGameRecapEnvelopeSchema, presentGameRecap, type GameRecapEnvelope } from "../src/recap-show.js";

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
  it.each(["legacy", "full-show", "failed-scene-no-song"])("decodes the stable %s fixture", name => {
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
  it("accepts a descriptive show treatment without the legacy copy cutoff", () => {
    const treatment = "A silent-film domestic melodrama about the purple mat and the missing breakfast";
    const draft = gameRecapDraftSchema.parse({ story: { ...story, treatment }, files: [] });
    expect(draft.story.treatment).toBe(treatment);
    const stored = storedGameRecapEnvelopeSchema.parse({ ...envelope, story: draft.story });
    expect(presentGameRecap({ ...input, stored }).show?.treatment).toBe(treatment);
    expect(gameRecapWriterSchema.safeParse(draft.story).success).toBe(false);
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
    expect(view.show).not.toHaveProperty('mediaDeadline');
    expect(view.show).not.toHaveProperty('refreshAfterMs');
    const hidden = presentGameRecap({ ...input, stored, mediaVisible: false });
    expect(hidden.show?.pages.map(page => page.kind)).toEqual(['cover', 'result']);
    expect(hidden.show?.pages[0]).toMatchObject({ media: { status: 'failed' }, fallback: { kind: 'photo', entryIds: ['photo-one'] } });
    expect(hidden.chatLine).toBe(story.chatLine);
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
