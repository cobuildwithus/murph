import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gameRecapDraftSchema, gameRecapPresentationSchema, gameRecapWriterSchema, storedGameRecapEnvelopeSchema, presentGameRecap, type GameRecapEnvelope } from "../src/recap-show.js";

const story = { treatment: "Courtroom drama", chatLine: "Player A won. The mat was present.", pages: [
  { background: "paper" as const, blocks: [{ kind: "headline" as const, text: "The mat takes the stand" },
    { kind: "scene" as const, scene: { cast: ["Player A", "Player B"], prompt: "A fictional courtroom made of exercise mats, with two athletes standing beside a wooden desk and bright morning windows." }, entryIds: ["photo-one"] }] },
], song: { title: "The Mat Knows", style: "Playful", lyrics: ["The mat knows", "The shoes wait", "The door opens", "The score stays"] } };
const envelope: GameRecapEnvelope = { version: 1, generationId: "game-recap:synthetic-game", story,
  acceptedAt: "2026-11-10T12:00:00Z", coverDeadline: "2026-11-10T12:05:00Z", mediaDeadline: "2026-11-10T12:10:00Z",
  preview: { token: "synthetic-preview-token-with-no-authority", expiresAt: "2026-12-10T12:00:00Z" },
  assets: [{ slot: "scene-0", kind: "image", recipeId: "recipe-one", storageKey: "private-storage-key", references: [], status: "pending" }],
};
const input = { stored: envelope, now: new Date("2026-11-10T12:01:00Z"), permittedPhotoIds: new Set(["photo-one"]), mediaUrl: () => "/synthetic-media" };
describe("recap presentation compatibility", () => {
  it.each(["legacy", "full-show", "pending-failed", "failed-scene-no-song"])("decodes the stable %s fixture", name => {
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
  it("accepts selected local files but rejects host authority and duplicate slots", () => {
    const selected = { slot: "scene-0", receipt: { operationId: "op-1", path: "media/one.jpg", hash: "a".repeat(64), mediaType: "image/jpeg", byteLength: 123, width: 100, height: 200 } };
    expect(gameRecapDraftSchema.safeParse({ story, files: [selected] }).success).toBe(true);
    expect(gameRecapDraftSchema.safeParse({ story, files: [selected, selected] }).success).toBe(false);
    expect(gameRecapDraftSchema.safeParse({ story, files: [{ ...selected, storageKey: "forged" }] }).success).toBe(false);
  });
  it("keeps page identity, falls back on deadline, and never makes failed audio a page", () => {
    const pending = presentGameRecap(input);
    const expired = presentGameRecap({ ...input, now: new Date(envelope.mediaDeadline), permittedPhotoIds: new Set() });
    expect(pending.show?.pages[0].media).toEqual({ status: "pending" });
    expect(expired.show?.pages[0]).toMatchObject({ id: pending.show?.pages[0].id, media: { status: "failed" }, fallback: { kind: "text", entryIds: [] } });
    expect(expired.show?.refreshAfterMs).toBeUndefined();
    expect(expired.show?.pages.map(page => page.kind)).toEqual(["cover", "result"]);
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
