import path from "node:path";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createZxingWasmProvider } from "../../src/adapters/zxing-wasm.js";

async function withTempDirectory<T>(
  run: (directoryPath: string) => Promise<T>,
): Promise<T> {
  const directoryPath = await fs.mkdtemp(
    path.join(tmpdir(), "murph-parsers-zxing-wasm-"),
  );

  try {
    return await run(directoryPath);
  } finally {
    await fs.rm(directoryPath, { force: true, recursive: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createZxingWasmProvider", () => {
  it("supports image artifacts only", async () => {
    const provider = createZxingWasmProvider({
      loadModule: async () => ({
        async prepareZXingModule() {},
        async readBarcodes() {
          return [];
        },
      }),
      resolveWasmPath: () => "/tmp/fake-zxing-reader.wasm",
    });

    expect(
      provider.supports({
        intent: "attachment_text",
        artifact: {
          absolutePath: "/tmp/example.png",
          attachmentId: "attachment-image",
          captureId: "capture-1",
          kind: "image",
          storedPath: "raw/inbox/capture-1/example.png",
        },
        inputPath: "/tmp/example.png",
        scratchDirectory: "/tmp/scratch",
      }),
    ).toBe(true);

    expect(
      provider.supports({
        intent: "attachment_text",
        artifact: {
          absolutePath: "/tmp/example.pdf",
          attachmentId: "attachment-document",
          captureId: "capture-1",
          kind: "document",
          storedPath: "raw/inbox/capture-1/example.pdf",
        },
        inputPath: "/tmp/example.pdf",
        scratchDirectory: "/tmp/scratch",
      }),
    ).toBe(false);
  });

  it("decodes image codes with an injected local wasm reader", async () => {
    await withTempDirectory(async (directoryPath) => {
      const wasmPath = path.join(directoryPath, "zxing_reader.wasm");
      const imagePath = path.join(directoryPath, "meal.png");
      await fs.writeFile(wasmPath, Buffer.from([0, 1, 2, 3]));
      await fs.writeFile(imagePath, Buffer.from([4, 5, 6, 7]));

      const prepareZXingModule = vi.fn(async () => undefined);
      const readBarcodes = vi.fn(async () => [
        {
          text: "https://example.com/nutrition",
          format: "QRCode",
          symbology: "QRCode",
        },
        {
          text: "012345678905",
          format: "UPCA",
          symbology: "EANUPC",
        },
        {
          text: "012345678905",
          format: "UPCA",
          symbology: "EANUPC",
        },
      ]);
      const provider = createZxingWasmProvider({
        loadModule: async () => ({
          prepareZXingModule,
          readBarcodes,
        }),
        resolveWasmPath: () => wasmPath,
      });

      expect(await provider.discover()).toMatchObject({
        available: true,
        executablePath: wasmPath,
      });

      const firstRun = await provider.run({
        intent: "attachment_text",
        artifact: {
          absolutePath: imagePath,
          attachmentId: "attachment-image",
          captureId: "capture-1",
          kind: "image",
          storedPath: "raw/inbox/capture-1/meal.png",
        },
        inputPath: imagePath,
        scratchDirectory: directoryPath,
      });
      const secondRun = await provider.run({
        intent: "attachment_text",
        artifact: {
          absolutePath: imagePath,
          attachmentId: "attachment-image",
          captureId: "capture-1",
          kind: "image",
          storedPath: "raw/inbox/capture-1/meal.png",
        },
        inputPath: imagePath,
        scratchDirectory: directoryPath,
      });

      expect(prepareZXingModule).toHaveBeenCalledTimes(1);
      expect(readBarcodes).toHaveBeenCalledTimes(2);
      expect(readBarcodes).toHaveBeenNthCalledWith(
        1,
        expect.any(Uint8Array),
        expect.objectContaining({
          maxNumberOfSymbols: 8,
          tryHarder: true,
        }),
      );
      expect(firstRun.text).toContain("Decoded QR/barcode values:");
      expect(firstRun.text).toContain(
        "- QRCode: https://example.com/nutrition",
      );
      expect(firstRun.text).toContain("- UPCA (EANUPC): 012345678905");
      expect(firstRun.blocks).toHaveLength(3);
      expect(firstRun.metadata?.warnings).toEqual([]);
      expect(secondRun.text).toBe(firstRun.text);
    });
  });

  it("returns an empty parse result when no codes are present", async () => {
    await withTempDirectory(async (directoryPath) => {
      const wasmPath = path.join(directoryPath, "zxing_reader.wasm");
      const imagePath = path.join(directoryPath, "meal.png");
      await fs.writeFile(wasmPath, Buffer.from([0, 1, 2, 3]));
      await fs.writeFile(imagePath, Buffer.from([4, 5, 6, 7]));

      const provider = createZxingWasmProvider({
        loadModule: async () => ({
          async prepareZXingModule() {},
          async readBarcodes() {
            return [];
          },
        }),
        resolveWasmPath: () => wasmPath,
      });

      const result = await provider.run({
        intent: "attachment_text",
        artifact: {
          absolutePath: imagePath,
          attachmentId: "attachment-image",
          captureId: "capture-1",
          kind: "image",
          storedPath: "raw/inbox/capture-1/meal.png",
        },
        inputPath: imagePath,
        scratchDirectory: directoryPath,
      });

      expect(result.text).toBe("");
      expect(result.blocks).toEqual([]);
      expect(result.metadata?.warnings).toEqual([
        {
          code: "no_image_codes_detected",
          message: "No QR code or barcode was detected in the image.",
        },
      ]);
    });
  });
});
