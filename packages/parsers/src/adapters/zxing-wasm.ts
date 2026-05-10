import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { ParseRequest, ProviderRunResult } from "../contracts/parse.js";
import type { ParserProvider } from "../contracts/provider.js";
import {
  assertFileSizeAtMost,
  DEFAULT_IMAGE_PROVIDER_MAX_INPUT_BYTES,
  splitTextIntoBlocks,
} from "../shared.js";

const require = createRequire(import.meta.url);

const DEFAULT_MAX_NUMBER_OF_SYMBOLS = 8;
const ZXING_READER_ENTRY_SPECIFIER = "zxing-wasm/reader";
const ZXING_READER_WASM_SPECIFIER = "zxing-wasm/reader/zxing_reader.wasm";

interface ZxingReadResult {
  text?: unknown;
  format?: unknown;
  symbology?: unknown;
}

interface ZxingReaderOptions {
  maxNumberOfSymbols?: number;
  tryHarder?: boolean;
}

interface ZxingPrepareInput {
  fireImmediately?: boolean;
  overrides?: {
    wasmBinary?: ArrayBuffer;
  };
}

interface ZxingReaderModule {
  prepareZXingModule(input: ZxingPrepareInput): void | Promise<unknown>;
  readBarcodes(
    input: ArrayBuffer | Uint8Array,
    options?: ZxingReaderOptions,
  ): Promise<ZxingReadResult[]>;
}

export interface ZxingWasmProviderOptions {
  loadModule?: () => Promise<ZxingReaderModule>;
  maxInputBytes?: number;
  maxNumberOfSymbols?: number;
  resolveWasmPath?: () => string;
  tryHarder?: boolean;
}

export interface NormalizedZxingReadResult {
  text: string;
  format: string;
  symbology: string | null;
}

export function createZxingWasmProvider(
  options: ZxingWasmProviderOptions = {},
): ParserProvider {
  let preparedModule: Promise<ZxingReaderModule> | null = null;

  async function resolveWasmPath(): Promise<string> {
    const resolvedPath = options.resolveWasmPath?.() ?? defaultResolveZxingReaderWasmPath();
    await fs.access(resolvedPath);
    return resolvedPath;
  }

  async function prepareReaderModule(): Promise<ZxingReaderModule> {
    if (preparedModule) {
      return preparedModule;
    }

    preparedModule = (async () => {
      const wasmPath = await resolveWasmPath();
      const readerModule = await loadZxingReaderModule(options.loadModule);
      const wasmBinary = toArrayBuffer(await fs.readFile(wasmPath));

      // Force the packaged wasm binary to load from disk so image scanning stays local/offline.
      await Promise.resolve(
        readerModule.prepareZXingModule({
          overrides: {
            wasmBinary,
          },
          fireImmediately: true,
        }),
      );

      return readerModule;
    })().catch((error) => {
      preparedModule = null;
      throw error;
    });

    return preparedModule;
  }

  return {
    id: "zxing-wasm",
    locality: "local",
    openness: "open_source",
    runtime: "node",
    priority: 950,
    async discover() {
      try {
        const wasmPath = await resolveWasmPath();
        await prepareReaderModule();

        return {
          available: true,
          reason: "zxing-wasm reader and local WebAssembly binary available.",
          executablePath: wasmPath,
          details: {
            wasmPath,
          },
        };
      } catch (error) {
        return {
          available: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
    supports(request: ParseRequest) {
      const kind = request.preparedKind ?? request.artifact.kind;
      return kind === "image";
    },
    async run(request): Promise<ProviderRunResult> {
      const readerModule = await prepareReaderModule();
      await assertFileSizeAtMost(
        request.inputPath,
        options.maxInputBytes ?? DEFAULT_IMAGE_PROVIDER_MAX_INPUT_BYTES,
        "Image attachment",
      );
      const imageBytes = await fs.readFile(request.inputPath);
      const readResults = await readerModule.readBarcodes(imageBytes, {
        maxNumberOfSymbols:
          options.maxNumberOfSymbols ?? DEFAULT_MAX_NUMBER_OF_SYMBOLS,
        tryHarder: options.tryHarder ?? true,
      });
      const decodedCodes = normalizeZxingReadResults(
        Array.isArray(readResults) ? readResults : [],
      );
      const text = buildDecodedImageCodeText(decodedCodes);
      const blocks =
        text.length > 0 ? splitTextIntoBlocks(text, { defaultKind: "line" }) : [];

      return {
        text,
        markdown: text,
        blocks,
        metadata: {
          warnings:
            decodedCodes.length === 0
              ? [
                  {
                    code: "no_image_codes_detected",
                    message: "No QR code or barcode was detected in the image.",
                  },
                ]
              : [],
        },
      };
    },
  };
}

export function normalizeZxingReadResults(
  results: readonly ZxingReadResult[],
): NormalizedZxingReadResult[] {
  const deduped = new Map<string, NormalizedZxingReadResult>();

  for (const result of results) {
    const text = typeof result.text === "string" ? result.text.trim() : "";
    const format =
      typeof result.format === "string" && result.format.trim().length > 0
        ? result.format.trim()
        : "unknown";
    const symbology =
      typeof result.symbology === "string" && result.symbology.trim().length > 0
        ? result.symbology.trim()
        : null;

    if (!text) {
      continue;
    }

    const dedupeKey = `${format}\u0000${symbology ?? ""}\u0000${text}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, {
        text,
        format,
        symbology,
      });
    }
  }

  return [...deduped.values()];
}

export function buildDecodedImageCodeText(
  results: readonly NormalizedZxingReadResult[],
): string {
  if (results.length === 0) {
    return "";
  }

  return [
    "Decoded QR/barcode values:",
    ...results.map((result) => {
      const formatLabel =
        result.symbology && result.symbology !== result.format
          ? `${result.format} (${result.symbology})`
          : result.format;
      return `- ${formatLabel}: ${result.text}`;
    }),
  ].join("\n");
}

function defaultResolveZxingReaderWasmPath(): string {
  try {
    return require.resolve(ZXING_READER_WASM_SPECIFIER);
  } catch {
    const readerEntryPath = require.resolve(ZXING_READER_ENTRY_SPECIFIER);
    return path.resolve(
      path.dirname(readerEntryPath),
      "..",
      "..",
      "reader",
      "zxing_reader.wasm",
    );
  }
}

async function loadZxingReaderModule(
  customLoader: ZxingWasmProviderOptions["loadModule"],
): Promise<ZxingReaderModule> {
  if (customLoader) {
    return customLoader();
  }

  return require(ZXING_READER_ENTRY_SPECIFIER) as ZxingReaderModule;
}

function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}
