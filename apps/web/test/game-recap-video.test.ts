import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectRecapMedia, uploadRecapVideoPart } from "@/src/lib/game/recap-media";
import { inspectRecapVideo, recapPoster } from "@/src/lib/game/recap-video";
import { isPairRecapVideoEnabled, pairRecapShowCapability } from "@/src/lib/game/access";

const file = await readFile(new URL("../../../fixtures/recap-video/synthetic.mp4", import.meta.url));
const at = (bytes: Buffer, type: string, from = 0) => {
  const index = bytes.indexOf(type, from, "latin1");
  if (index < 4) throw new Error(`The fixture has no ${type} box.`);
  return index - 4;
};
const changed = (edit: (bytes: Buffer) => void) => { const bytes = Buffer.from(file); edit(bytes); return bytes; };

describe("recap video measurement", () => {
  it("measures a complete MP4 from its own boxes", () => {
    expect(inspectRecapVideo(file)).toEqual({ durationMs: 2000, width: 804, height: 1748 });
    expect(inspectRecapVideo(new Uint8Array(Buffer.concat([Buffer.alloc(3), file])).subarray(3))).toEqual({ durationMs: 2000, width: 804, height: 1748 });
  });

  it("accepts a 64-bit box size only while it stays inside the file", () => {
    const mdat = at(file, "mdat"), size = file.readUInt32BE(mdat);
    const wide = (declared: bigint) => {
      const header = Buffer.alloc(16); header.writeUInt32BE(1, 0); header.write("mdat", 4, "latin1"); header.writeBigUInt64BE(declared, 8);
      return Buffer.concat([file.subarray(0, mdat), header, file.subarray(mdat + 8, mdat + size), file.subarray(mdat + size)]);
    };
    expect(inspectRecapVideo(wide(BigInt(size + 8)))).toEqual({ durationMs: 2000, width: 804, height: 1748 });
    expect(inspectRecapVideo(wide(BigInt(size + 9)))).toBeNull();
    expect(inspectRecapVideo(wide(2n ** 63n))).toBeNull();
  });

  it.each<[string, Buffer]>([
    ["an empty file", Buffer.alloc(0)],
    ["a file cut short", file.subarray(0, file.length - 10)],
    ["bytes after the last box", Buffer.concat([file, Buffer.from("extra")])],
    ["a header alone", file.subarray(0, at(file, "moov"))],
    ["a movie without media", file.subarray(0, at(file, "mdat"))],
    ["media before any file type", Buffer.concat([file.subarray(at(file, "moov")), file.subarray(0, at(file, "moov"))])],
    ["an unknown brand", changed(bytes => bytes.write("qt  ", 8, "latin1"))],
    ["a fragmented or unknown top-level box", changed(bytes => bytes.write("moof", at(bytes, "mdat") + 4, "latin1"))],
    ["a box that runs to the end of the file", changed(bytes => bytes.writeUInt32BE(0, at(bytes, "mdat")))],
    ["a box shorter than its own header", changed(bytes => bytes.writeUInt32BE(4, at(bytes, "mdat")))],
    ["two movies", Buffer.concat([file, file.subarray(at(file, "moov"), at(file, "moov") + file.readUInt32BE(at(file, "moov")))])],
    ["no duration", changed(bytes => bytes.writeUInt32BE(0, at(bytes, "mvhd") + 8 + 16))],
    ["no timescale", changed(bytes => bytes.writeUInt32BE(0, at(bytes, "mvhd") + 8 + 12))],
    ["a duration over two minutes", changed(bytes => bytes.writeUInt32BE(bytes.readUInt32BE(at(bytes, "mvhd") + 8 + 12) * 121, at(bytes, "mvhd") + 8 + 16))],
    ["no picture track", changed(bytes => bytes.write("soun", bytes.indexOf("vide", 0, "latin1"), "latin1"))],
    ["two picture tracks", changed(bytes => bytes.write("vide", bytes.indexOf("soun", 0, "latin1"), "latin1"))],
    ["a frame with no width", changed(bytes => bytes.writeUInt32BE(0, at(bytes, "tkhd") + 8 + 76))],
    ["a frame with a fractional height", changed(bytes => bytes.writeUInt32BE((1748 << 16) + 1, at(bytes, "tkhd") + 8 + 80))],
  ])("refuses %s", (_name, bytes) => {
    expect(inspectRecapVideo(bytes)).toBeNull();
  });

  it("bounds a stored part by size alone and leaves the other kinds as they were", async () => {
    const part = `recap/${"a".repeat(32)}/${"b".repeat(64)}.mp4`;
    expect(await inspectRecapMedia(new Uint8Array(2_000_000), part)).toMatchObject({ bytes: 2_000_000, mediaType: "video/mp4" });
    await expect(inspectRecapMedia(new Uint8Array(2_000_001), part)).rejects.toThrow(RequestInputError);
    await expect(inspectRecapMedia(new Uint8Array(0), part)).rejects.toThrow(RequestInputError);
    await expect(inspectRecapMedia(new Uint8Array(8), `recap/${"a".repeat(32)}/video-0.mp4`)).rejects.toThrow();
    await expect(inspectRecapMedia(file, `recap/${"a".repeat(32)}/${"b".repeat(64)}.jpg`)).rejects.toThrow();
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([0, 2_000_001])("rejects a %i-byte video part at staging before reading authority or registering receipts", async length => {
    vi.stubEnv("MURPH_GAME_RECAP_SHOW_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_RECAP_VIDEO_ENABLED", "true");
    const beforeMutationTx = vi.fn();
    await expect(uploadRecapVideoPart({
      memberId: "member_synthetic", gameId: "game_synthetic", eventId: "event_synthetic", beforeMutationTx,
      material: { game: {}, players: [], entries: [], validation: { show: true, startedAt: new Date(0), settledAt: new Date(1), playerNamesByMemberId: [], result: [] } },
      file: { kind: "upload", slot: "video-0", mediaType: "video/mp4", referenceIds: [], bytes: Buffer.alloc(length).toString("base64") },
    })).rejects.toThrow(RequestInputError);
    expect(beforeMutationTx).not.toHaveBeenCalled();
  });

  it("is produced only for a pair show with its own flag on", () => {
    const on = { MURPH_GAME_RECAP_SHOW_ENABLED: "true", MURPH_GAME_RECAP_VIDEO_ENABLED: "true" };
    expect(isPairRecapVideoEnabled(2, on)).toBe(true);
    expect(isPairRecapVideoEnabled(10, on)).toBe(false);
    expect(isPairRecapVideoEnabled(2, { MURPH_GAME_RECAP_SHOW_ENABLED: "true" })).toBe(false);
    expect(isPairRecapVideoEnabled(2, { MURPH_GAME_RECAP_VIDEO_ENABLED: "true" })).toBe(false);
    expect(isPairRecapVideoEnabled(2, { ...on, MURPH_GAME_RECAP_VIDEO_ENABLED: "1" })).toBe(false);
  });

  it("asks the runner for a video on a pair recap wake only with its flag on", () => {
    const show = { MURPH_GAME_RECAP_SHOW_ENABLED: "true" };
    expect(pairRecapShowCapability(2, { ...show, MURPH_GAME_RECAP_VIDEO_ENABLED: "true" })).toEqual({ show: true, video: true });
    // Flag off: the wake is exactly today's.
    expect(pairRecapShowCapability(2, show)).toEqual({ show: true });
    expect(pairRecapShowCapability(2, { MURPH_GAME_RECAP_VIDEO_ENABLED: "true" })).toEqual({});
    expect(pairRecapShowCapability(10, { ...show, MURPH_GAME_RECAP_VIDEO_ENABLED: "true" })).toEqual({});
  });
});

describe("recap poster facts", () => {
  const scores = (first: [number, number], second: [number, number]) => ({ v: 1 as const, termsVersion: 1, scores: [
    { seat: 0, memberId: "member-a", score: first[0], misses: first[1] }, { seat: 1, memberId: "member-b", score: second[0], misses: second[1] }] });
  const terms = (...stakes: { key: string; kind: "prize" | "dare" | "both_get" | "winner_gets" | "per_miss" }[]) =>
    ({ v: 1 as const, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes }] });
  const words = { v: 1 as const, versions: [{ n: 1, tasks: [], stakes: [{ key: "prize", item: "Choose lunch" }, { key: "dare", item: "Sing in the lobby" }, { key: "both", item: "dinner out together" }, { key: "miss", item: "one coffee" }] }] };
  const owes = (stakeKey: string, by: number, to: number) => ({ stakeKey, owedBySeats: [by], owedToSeats: [to] });
  const won = { kind: "won", winnerMemberId: "member-a", loserMemberId: "member-b" };

  it("names the winner and the prize or dare the loser owes", () => {
    expect(recapPoster({ result: scores([7, 0], [5, 2]), terms: terms({ key: "prize", kind: "prize" }), words, tickets: [owes("prize", 1, 0)] }))
      .toEqual({ outcome: won, stake: { kind: "prize", title: "Choose lunch", owedByMemberId: "member-b", owedToMemberId: "member-a" } });
    expect(recapPoster({ result: scores([7, 0], [5, 2]), terms: terms({ key: "prize", kind: "winner_gets" }), words, tickets: [owes("prize", 1, 0)] }).stake)
      .toMatchObject({ kind: "prize", title: "Choose lunch" });
    expect(recapPoster({ result: scores([5, 2], [6, 1]), terms: terms({ key: "dare", kind: "dare" }), words, tickets: [owes("dare", 0, 1)] }))
      .toEqual({ outcome: { kind: "won", winnerMemberId: "member-b", loserMemberId: "member-a" }, stake: { kind: "dare", title: "Sing in the lobby", owedByMemberId: "member-a", owedToMemberId: "member-b" } });
  });

  it("calls a tie and a game nobody missed even, with the prize both earned when there is one", () => {
    expect(recapPoster({ result: scores([6, 1], [6, 1]), terms: terms({ key: "prize", kind: "prize" }), words, tickets: [] })).toEqual({ outcome: { kind: "even", everyDay: false }, stake: { kind: "none" } });
    expect(recapPoster({ result: scores([7, 0], [7, 0]), terms: terms({ key: "prize", kind: "prize" }), words, tickets: [] })).toEqual({ outcome: { kind: "even", everyDay: true }, stake: { kind: "none" } });
    expect(recapPoster({ result: scores([7, 0], [7, 0]), terms: terms({ key: "prize", kind: "prize" }, { key: "both", kind: "both_get" }), words, tickets: [owes("both", 1, 0), owes("both", 0, 1)] }))
      .toEqual({ outcome: { kind: "even", everyDay: true }, stake: { kind: "both_win", title: "dinner out together" } });
  });

  it("never guesses at a stake the last screen has no single drawing for", () => {
    const perMiss = { result: scores([7, 0], [5, 2]), terms: terms({ key: "miss", kind: "per_miss" }), words, tickets: [owes("miss", 1, 0), owes("miss", 1, 0)] };
    expect(recapPoster(perMiss)).toEqual({ outcome: won, stake: { kind: "other" } });
    expect(recapPoster({ ...perMiss, tickets: [owes("miss", 1, 0)] }).stake).toEqual({ kind: "other" });
    expect(recapPoster({ ...perMiss, tickets: [owes("unknown", 1, 0)] }).stake).toEqual({ kind: "other" });
    expect(recapPoster({ ...perMiss, terms: terms({ key: "prize", kind: "prize" }), tickets: [{ stakeKey: "prize", owedBySeats: [1, 2], owedToSeats: [0] }] }).stake).toEqual({ kind: "other" });
  });
});
