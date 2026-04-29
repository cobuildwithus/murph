import { promises as fs } from "node:fs";

import type { ParseRequest, ProviderRunResult } from "../contracts/parse.js";
import type { ParserProvider } from "../contracts/provider.js";
import {
  buildMarkdown,
  describeExecutableAvailability,
  readConfiguredEnvValue,
  requireExecutable,
  resolveConfiguredExecutable,
  runCommand,
  splitTextIntoBlocks,
} from "../shared.js";

const DEFAULT_MAX_INPUT_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const PDFINFO_MAX_OUTPUT_BYTES = 128 * 1024;

export interface PopplerPdfProviderOptions {
  commandTimeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxPages?: number;
  pdfInfoCommandCandidates?: string[];
  pdfToTextCommandCandidates?: string[];
  resolvedToolState?: {
    available: boolean;
    reason: string;
    pdfInfoCommandPath: string | null;
    pdfToTextCommandPath: string | null;
  };
}

export function createPopplerPdfProvider(
  options: PopplerPdfProviderOptions = {},
): ParserProvider {
  const resolvedToolState = options.resolvedToolState;
  const limits = normalizePopplerLimits(options);

  async function resolvePdfInfoCommand(): Promise<string | null> {
    if (resolvedToolState) {
      return normalizeNullableString(resolvedToolState.pdfInfoCommandPath);
    }

    return resolveConfiguredExecutable({
      explicitCandidates: options.pdfInfoCommandCandidates,
      envValue: () => readConfiguredEnvValue(process.env, ["PDFINFO_COMMAND"]),
      fallbackCommands: ["pdfinfo"],
    });
  }

  async function resolvePdfToTextCommand(): Promise<string | null> {
    if (resolvedToolState) {
      return normalizeNullableString(resolvedToolState.pdfToTextCommandPath);
    }

    return resolveConfiguredExecutable({
      explicitCandidates: options.pdfToTextCommandCandidates,
      envValue: () => readConfiguredEnvValue(process.env, ["PDFTOTEXT_COMMAND"]),
      fallbackCommands: ["pdftotext"],
    });
  }

  return {
    id: "poppler.pdf",
    locality: "local",
    openness: "open_source",
    priority: 950,
    runtime: "cli",
    async discover() {
      if (resolvedToolState) {
        return buildResolvedAvailability(resolvedToolState);
      }

      const pdfInfoCommand = await resolvePdfInfoCommand();
      const pdfToTextCommand = await resolvePdfToTextCommand();
      if (!pdfInfoCommand || !pdfToTextCommand) {
        return {
          available: false,
          reason: !pdfInfoCommand
            ? "pdfinfo CLI executable not found."
            : "pdftotext CLI executable not found.",
          executablePath: pdfInfoCommand ?? pdfToTextCommand,
          details: {
            pdfInfoCommand,
            pdfToTextCommand,
          },
        };
      }

      return describeExecutableAvailability({
        executablePath: pdfToTextCommand,
        availableReason: "Poppler PDF text extraction tools available.",
        missingReason: "pdftotext CLI executable not found.",
      });
    },
    supports(request: ParseRequest) {
      const kind = request.preparedKind ?? request.artifact.kind;
      return kind === "document" && isPdfArtifact(request.artifact.fileName, request.artifact.mime);
    },
    async run(request): Promise<ProviderRunResult> {
      if (resolvedToolState && !resolvedToolState.available) {
        throw new TypeError(resolvedToolState.reason);
      }

      const pdfInfoCommand = requireExecutable(
        await resolvePdfInfoCommand(),
        resolvedToolState?.reason ?? "pdfinfo CLI executable not found.",
      );
      const pdfToTextCommand = requireExecutable(
        await resolvePdfToTextCommand(),
        resolvedToolState?.reason ?? "pdftotext CLI executable not found.",
      );

      await assertPdfInputWithinLimit(request.inputPath, limits.maxInputBytes);

      const pdfInfo = await runCommand(pdfInfoCommand, [request.inputPath], {
        maxStderrBytes: PDFINFO_MAX_OUTPUT_BYTES,
        maxStdoutBytes: PDFINFO_MAX_OUTPUT_BYTES,
        timeoutMs: limits.commandTimeoutMs,
      });
      const pageCount = parsePdfInfoPageCount(pdfInfo.stdout);
      const endPage = pageCount === null
        ? limits.maxPages
        : Math.min(pageCount, limits.maxPages);
      const extracted = await runCommand(pdfToTextCommand, [
        "-enc",
        "UTF-8",
        "-f",
        "1",
        "-l",
        String(endPage),
        "-nopgbrk",
        request.inputPath,
        "-",
      ], {
        maxStderrBytes: PDFINFO_MAX_OUTPUT_BYTES,
        maxStdoutBytes: limits.maxOutputBytes,
        timeoutMs: limits.commandTimeoutMs,
      });

      const text = extracted.stdout.trim();
      if (!text) {
        throw new TypeError("pdftotext did not extract text from PDF.");
      }

      const blocks = splitTextIntoBlocks(text, { defaultKind: "paragraph" });
      const warnings = pageCount !== null && pageCount > limits.maxPages
        ? [{
            code: "pdf_page_limit",
            message: `PDF text extraction was limited to the first ${limits.maxPages} pages.`,
          }]
        : undefined;

      return {
        blocks,
        markdown: buildMarkdown(text, blocks),
        metadata: {
          pageCount,
          ...(warnings ? { warnings } : {}),
        },
        text,
      };
    },
  };
}

function buildResolvedAvailability(
  resolvedToolState: NonNullable<PopplerPdfProviderOptions["resolvedToolState"]>,
) {
  const pdfInfoCommand = normalizeNullableString(resolvedToolState.pdfInfoCommandPath);
  const pdfToTextCommand = normalizeNullableString(resolvedToolState.pdfToTextCommandPath);

  return {
    available: resolvedToolState.available,
    reason: resolvedToolState.reason,
    ...(pdfToTextCommand ? { executablePath: pdfToTextCommand } : {}),
    details: {
      pdfInfoCommand,
      pdfToTextCommand,
    },
  };
}

function isPdfArtifact(fileName: string | null | undefined, mime: string | null | undefined): boolean {
  return (
    (fileName?.toLowerCase().endsWith(".pdf") ?? false) ||
    String(mime ?? "").toLowerCase() === "application/pdf"
  );
}

function parsePdfInfoPageCount(stdout: string): number | null {
  const match = /^Pages:\s+(\d+)$/mu.exec(stdout);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizePopplerLimits(options: PopplerPdfProviderOptions): {
  commandTimeoutMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxPages: number;
} {
  return {
    commandTimeoutMs: normalizePositiveInteger(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
    maxInputBytes: normalizePositiveInteger(options.maxInputBytes, DEFAULT_MAX_INPUT_BYTES),
    maxOutputBytes: normalizePositiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
    maxPages: normalizePositiveInteger(options.maxPages, DEFAULT_MAX_PAGES),
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

async function assertPdfInputWithinLimit(inputPath: string, maxInputBytes: number): Promise<void> {
  const stats = await fs.stat(inputPath);
  if (stats.size > maxInputBytes) {
    throw new TypeError(`PDF input exceeds parser limit of ${maxInputBytes} bytes.`);
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
