import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { inspectRecapMedia } from "@/src/lib/game/recap-media";

it("rejects header-only MP3s and caller-supplied duration that disagrees with decoded samples", async () => {
  const key = `recap/${"a".repeat(32)}/song.mp3`;
  await expect(inspectRecapMedia(new Uint8Array([0xff, 0xfb, 0x90, 0x64]), key, 20_000)).rejects.toThrow();
  const short = await readFile(new URL("../../../fixtures/generated-audio/speech.mp3", import.meta.url));
  await expect(inspectRecapMedia(short, key, 20_000)).rejects.toThrow("duration");
});
