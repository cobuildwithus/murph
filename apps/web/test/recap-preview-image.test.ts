import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("ships the recap preview as a 1200 by 630 PNG", async () => {
  const png = await readFile(new URL("../public/recap-preview.png", import.meta.url));
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});
