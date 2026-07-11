import assert from "node:assert/strict";

import { afterEach, expect, test, vi } from "vitest";

const { imageResponseSpy, readFileMock } = vi.hoisted(() => ({
  imageResponseSpy: vi.fn(),
  readFileMock: vi.fn(async (path: string | URL) => {
    const value = String(path);
    if (value.includes("logo.svg")) return Buffer.from("<svg/>");
    if (value.includes("Fraunces-400.ttf")) return Buffer.from([1, 2, 3]);
    if (value.includes("Fraunces-600.ttf")) return Buffer.from([4, 5, 6]);
    if (value.includes("DMSans-400.ttf")) return Buffer.from([7, 8, 9]);
    throw new Error(`Unexpected readFile path: ${value}`);
  }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}));

vi.mock("next/font/local", () => ({
  default() {
    return {
      variable: "font-local",
    };
  },
}));

vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {
    constructor(input: unknown, init: unknown) {
      imageResponseSpy(input, init);
    }
  },
}));

import OGImage from "../app/opengraph-image";

afterEach(() => {
  imageResponseSpy.mockClear();
  readFileMock.mockClear();
});

test("OGImage reads bundled font assets without fetching Google Fonts", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  try {
    await OGImage();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
  expect(readFileMock).toHaveBeenCalledTimes(4);

  const readPaths = readFileMock.mock.calls.map(([path]) => String(path));
  assert.equal(readPaths.some((path) => path.includes("public/logo.svg")), true);
  assert.equal(readPaths.some((path) => path.includes("Fraunces-400.ttf")), true);
  assert.equal(readPaths.some((path) => path.includes("Fraunces-600.ttf")), true);
  assert.equal(readPaths.some((path) => path.includes("DMSans-400.ttf")), true);

  expect(imageResponseSpy).toHaveBeenCalledTimes(1);

  const [imageTree, init] = imageResponseSpy.mock.calls[0] as [
    unknown,
    { fonts: Array<{ name: string; weight: number; data: ArrayBuffer }> },
  ];
  const serializedImageTree = JSON.stringify(imageTree);
  expect(serializedImageTree).toContain("Everyone has a health goal.");
  expect(serializedImageTree).toContain("Nobody does it alone.");
  expect(serializedImageTree).not.toContain("Health experiments with friends.");

  expect(init.fonts.map((font) => [font.name, font.weight])).toEqual([
    ["Fraunces", 400],
    ["Fraunces", 600],
    ["DM Sans", 400],
  ]);
});
