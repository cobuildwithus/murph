import { afterEach, describe, expect, it, vi } from "vitest";
import { gameRecapEnvelopeSchema } from "@murphai/contracts/recap-show";
import { readRecapCoverPreview } from "@/src/lib/game/recap-preview";
const mocks = vi.hoisted(() => ({ read: vi.fn(), references: vi.fn(), media: vi.fn() }));
vi.mock("@/src/lib/game/recap-asset-access", () => ({ readRecapEnvelope: mocks.read, recapReferencesCurrent: mocks.references }));
vi.mock("@/src/lib/game/recap-media", () => ({ readRecapMedia: mocks.media }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
const now = new Date("2026-11-10T00:00:00Z"), token = "a".repeat(43);
function envelope() { return gameRecapEnvelopeSchema.parse({ version: 1, generationId: "a".repeat(32), story: { treatment: "Courtroom drama", chatLine: "Synthetic verdict.", pages: [{ background: "paper", blocks: [{ kind: "headline", text: "The verdict" }] }] },
  acceptedAt: now.toISOString(), preview: { token, expiresAt: "2026-12-10T00:00:00Z" },
  assets: [{ slot: "scene-0", kind: "image", recipeId: "synthetic-recipe", storageKey: "synthetic-key", references: [], hash: "b".repeat(64), mediaType: "image/jpeg", byteLength: 3 }] }); }
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("cover-only preview capability", () => {
  it("reads only the accepted cover hint and preserves historical long premises", async () => {
    const current = envelope();
    current.story.treatment = 'A historical show premise with more than sixty characters remains readable';
    current.story.pages[0]!.blocks.push({ kind: 'scene', scene: { cast: ['Leo', 'Ava'], prompt: 'Synthetic scene', faceY: 0.35 } });
    current.story.pages.push({ background: 'paper', blocks: [{ kind: 'scene', scene: { cast: ['Leo'], prompt: 'Synthetic scene', faceY: 0.8 } }] });
    mocks.read.mockResolvedValue({ row: { wordsOwnerMemberId: 'synthetic-owner' }, envelope: current });
    mocks.references.mockResolvedValue(true);
    mocks.media.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), hash: 'b'.repeat(64) });
    expect(await readRecapCoverPreview('synthetic-game', token, now)).toEqual({ bytes: new Uint8Array([1, 2, 3]), faceY: 0.35 });
    mocks.media.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), hash: 'c'.repeat(64) });
    expect(await readRecapCoverPreview('synthetic-game', token, now)).toBeNull();
  });
  it("serves exactly the generated cover and denies wrong, expired, stale-source and hidden capabilities", async () => {
    const current = envelope(); mocks.read.mockResolvedValue({ row: { wordsOwnerMemberId: "synthetic-owner" }, envelope: current }); mocks.references.mockResolvedValue(true);
    mocks.media.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), hash: "b".repeat(64) });
    expect(await readRecapCoverPreview("synthetic-game", token, now)).toEqual({ bytes: new Uint8Array([1, 2, 3]) });
    expect(await readRecapCoverPreview("synthetic-game", "c".repeat(43), now)).toBeNull();
    expect(await readRecapCoverPreview("synthetic-game", token, new Date(current.preview.expiresAt))).toBeNull();
    current.preview.token = "c".repeat(43);
    expect(await readRecapCoverPreview("synthetic-game", token, now)).toBeNull();
    expect(await readRecapCoverPreview("synthetic-game", current.preview.token, now)).not.toBeNull();
    current.preview.token = token;
    mocks.references.mockResolvedValue(false); expect(await readRecapCoverPreview("synthetic-game", token, now)).toBeNull();
    mocks.references.mockResolvedValue(true); vi.stubEnv("MURPH_GAME_RECAP_MEDIA_VISIBLE", "false"); expect(await readRecapCoverPreview("synthetic-game", token, now)).toBeNull();
  });
});
