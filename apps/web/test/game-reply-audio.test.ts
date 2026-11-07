import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectReplyAudio } from "@/src/lib/game/reply-audio";
import { GameRuleError } from "@/src/lib/game/rules";

const fixture = (seconds = 1) => Buffer.from(readFileSync(new URL(`./fixtures/game-reply-audio/apple-aac-${seconds}s.m4a`, import.meta.url)));
const at = (bytes: Buffer, type: string) => bytes.indexOf(Buffer.from(type)) + 4;
function change(type: string, offset: number, value: number): Buffer {
  const bytes = fixture(); bytes.writeUInt32BE(value, at(bytes, type) + offset); return bytes;
}
function box(type: string, payload = Buffer.alloc(0)) {
  const size = Buffer.alloc(4); size.writeUInt32BE(payload.length + 8);
  return Buffer.concat([size, Buffer.from(type), payload]);
}

describe("bounded M4A AAC inspection", () => {
  it.each([1, 12, 30])("accepts real Apple AAC output at %i seconds with encoder padding", seconds => {
    const descriptor = inspectReplyAudio(fixture(seconds));
    expect(descriptor.durationMs).toBeGreaterThanOrEqual(seconds * 1000);
    expect(descriptor.durationMs).toBeLessThanOrEqual(seconds * 1000 + 500);
  });
  it("stores mdhd while enforcing both media and movie duration", () => {
    const bytes = change("mvhd", 16, 12_000);
    expect(inspectReplyAudio(bytes)).toEqual(inspectReplyAudio(fixture()));
    for (const type of ["mdhd", "mvhd"]) {
      expect(() => inspectReplyAudio(change(type, 12, 0))).toThrow(GameRuleError);
      expect(() => inspectReplyAudio(change(type, 16, 0))).toThrow(GameRuleError);
      expect(() => inspectReplyAudio(change(type, 16, 31 * 24_000))).toThrow(GameRuleError);
      const badVersion = fixture(); badVersion[at(badVersion, type)] = 2;
      expect(() => inspectReplyAudio(badVersion)).toThrow(GameRuleError);
    }
  });
  it("rejects 31 seconds, empty, oversized, truncated and header-only files", () => {
    for (const bytes of [fixture(31), Buffer.alloc(0), Buffer.alloc(400_001), fixture().subarray(0, -1), fixture().subarray(0, 28), Buffer.from("not audio")]) {
      expect(() => inspectReplyAudio(bytes)).toThrow(GameRuleError);
    }
  });
  it("requires one sound track and AAC, local references and in-bounds samples", () => {
    const video = fixture(); video.write("vide", at(video, "hdlr") + 8);
    const alac = fixture(); alac.write("alac", at(alac, "mp4a") - 4);
    const mp3 = fixture(); mp3[at(mp3, "esds") + 17] = 0x6b;
    const external = change("url ", 0, 0);
    const empty = change("stsz", 8, 0);
    const outside = change("stco", 8, 0xfffffff0);
    const samples = change("stsz", 12, 0xfffffff0);
    const wrongDescription = change("stsc", 16, 2);
    for (const bytes of [video, alac, mp3, external, empty, outside, samples, wrongDescription]) expect(() => inspectReplyAudio(bytes)).toThrow(GameRuleError);
  });
  it("rejects bad sizes, duplicate tracks, fragments and bounded-walk exhaustion", () => {
    const badSize = fixture(); badSize.writeUInt32BE(7, 0);
    const extended = fixture(); extended.writeUInt32BE(1, 0); extended.writeBigUInt64BE(2n ** 63n, 8);
    const bytes = fixture(), start = at(bytes, "trak") - 8, size = bytes.readUInt32BE(start);
    const extraTrack = Buffer.concat([bytes.subarray(0, start), bytes.subarray(start, start + size), bytes.subarray(start)]);
    const moov = at(bytes, "moov") - 8; extraTrack.writeUInt32BE(bytes.readUInt32BE(moov) + size, moov);
    let nested = box("free"); for (let i = 0; i < 10; i++) nested = box("udta", nested);
    for (const invalid of [badSize, extended, extraTrack, Buffer.concat([bytes, box("moof")]), Buffer.concat([bytes, nested]), Buffer.concat([bytes, ...Array.from({ length: 257 }, () => box("free"))])]) {
      expect(() => inspectReplyAudio(invalid)).toThrow(GameRuleError);
    }
  });
});
