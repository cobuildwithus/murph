import path from "node:path";

import type { ParseRequest, ParsedTable, ProviderRunResult } from "../contracts/parse.js";
import type { ParserProvider } from "../contracts/provider.js";
import {
  buildMarkdown,
  collectFilesRecursively,
  describeExecutableAvailability,
  readConfiguredEnvValue,
  requireExecutable,
  readUtf8IfExists,
  resolveConfiguredExecutable,
  runCommand,
  splitTextIntoBlocks,
} from "../shared.js";

export interface PaddleOcrProviderOptions {
  commandCandidates?: string[];
  language?: string;
  extraArgs?: string[];
}

export function createPaddleOcrProvider(
  options: PaddleOcrProviderOptions = {},
): ParserProvider {
  async function resolveCommand(): Promise<string | null> {
    return resolveConfiguredExecutable({
      explicitCandidates: options.commandCandidates,
      envValue: () => readConfiguredEnvValue(process.env, ["PADDLEOCR_COMMAND", "HEALTHYBOB_PADDLEOCR_COMMAND"]),
      fallbackCommands: ["paddleocr", "paddlex"],
    });
  }

  return {
    id: "paddleocr",
    locality: "local",
    openness: "open_source",
    runtime: "python",
    priority: 800,
    async discover() {
      const command = await resolveCommand();
      return describeExecutableAvailability({
        executablePath: command,
        availableReason: "PaddleOCR CLI available.",
        missingReason: "PaddleOCR CLI not found.",
      });
    },
    supports(request: ParseRequest) {
      const kind = request.preparedKind ?? request.artifact.kind;
      if (kind === "image") {
        return true;
      }

      if (kind !== "document") {
        return false;
      }

      return isPdfArtifact(request);
    },
    async run(request): Promise<ProviderRunResult> {
      const command = requireExecutable(await resolveCommand(), "PaddleOCR CLI not found.");

      const outputDirectory = path.join(request.scratchDirectory, "paddleocr-output");
      const isPdf = isPdfArtifact(request);
      const isPaddlex = path.basename(command).toLowerCase().startsWith("paddlex");
      const args = isPaddlex
        ? buildPaddlexArgs(request.inputPath, outputDirectory)
        : buildPaddleOcrArgs({
            inputPath: request.inputPath,
            outputDirectory,
            isPdf,
            language: options.language,
            extraArgs: options.extraArgs,
          });

      await runCommand(command, args);
      const collected = await collectPaddleOutput(outputDirectory);

      if (!collected.text) {
        throw new TypeError("PaddleOCR did not produce extractable text.");
      }

      const blocks = splitTextIntoBlocks(collected.text);

      return {
        text: collected.text,
        markdown: collected.markdown ?? buildMarkdown(collected.text, blocks),
        blocks,
        tables: collected.tables,
        metadata: {
          pageCount: collected.pageCount,
        },
      };
    },
  };
}

function isPdfArtifact(request: ParseRequest): boolean {
  const fileName = request.artifact.fileName?.toLowerCase() ?? "";
  const mime = request.artifact.mime?.toLowerCase() ?? "";
  return fileName.endsWith(".pdf") || mime === "application/pdf";
}

function buildPaddleOcrArgs(input: {
  inputPath: string;
  outputDirectory: string;
  isPdf: boolean;
  language?: string;
  extraArgs?: string[];
}): string[] {
  if (input.isPdf) {
    return [
      `--image_dir=${input.inputPath}`,
      "--type=structure",
      "--recovery=true",
      "--use_pdf2docx_api=true",
      "--use_gpu=False",
      `--output=${input.outputDirectory}`,
      ...(input.language ? [`--lang=${input.language}`] : []),
      ...(input.extraArgs ?? []),
    ];
  }

  return [
    `--image_dir=${input.inputPath}`,
    "--type=ocr",
    "--use_gpu=False",
    `--output=${input.outputDirectory}`,
    ...(input.language ? [`--lang=${input.language}`] : []),
    ...(input.extraArgs ?? []),
  ];
}

function buildPaddlexArgs(inputPath: string, outputDirectory: string): string[] {
  return [
    "--pipeline",
    "OCR",
    "--input",
    inputPath,
    "--save_path",
    outputDirectory,
    "--device",
    "cpu",
  ];
}

async function collectPaddleOutput(
  outputDirectory: string,
): Promise<{ text: string; markdown: string | null; tables: ParsedTable[]; pageCount: number | null }> {
  const files = await collectFilesRecursively(outputDirectory);
  const markdownContents: string[] = [];
  const textContents: string[] = [];
  const tables: ParsedTable[] = [];

  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    const content = await readUtf8IfExists(filePath);
    if (!content) {
      continue;
    }

    if (extension === ".md") {
      markdownContents.push(content.trim());
      continue;
    }

    if (extension === ".txt") {
      textContents.push(content.trim());
      continue;
    }

    if (extension === ".json") {
      try {
        const parsed = JSON.parse(content) as unknown;
        const harvested = harvestJsonText(parsed);
        markdownContents.push(...harvested.markdown);
        textContents.push(...harvested.text);
        tables.push(...harvested.tables);
      } catch {
        continue;
      }
    }
  }

  const markdown = markdownContents.filter(Boolean).sort((left, right) => right.length - left.length)[0] ?? null;
  const text = [
    ...textContents.filter(Boolean),
    markdown ? markdownToText(markdown) : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return {
    text,
    markdown,
    tables,
    pageCount: markdownContents.length > 0 ? markdownContents.length : null,
  };
}

function harvestJsonText(value: unknown): { text: string[]; markdown: string[]; tables: ParsedTable[] } {
  const text: string[] = [];
  const markdown: string[] = [];
  const tables: ParsedTable[] = [];
  walkJson(value, {
    onString(key, item) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes("markdown")) {
        markdown.push(item.trim());
        return;
      }
      if (normalizedKey.includes("text") || normalizedKey.includes("transcription") || normalizedKey.includes("html")) {
        text.push(item.trim());
      }
    },
    onArray(key, item) {
      if (key.toLowerCase().includes("table") && item.every((row) => Array.isArray(row))) {
        const rows = item.map((row) => row.map((cell) => String(cell ?? "")));
        tables.push({
          id: `tbl_${String(tables.length + 1).padStart(4, "0")}`,
          rows,
        });
      }
      if (key.toLowerCase() === "rec_texts" && item.every((entry) => typeof entry === "string")) {
        text.push(item.join(" "));
      }
    },
  });

  return { text, markdown, tables };
}

function walkJson(
  value: unknown,
  visitors: {
    onString(key: string, value: string): void;
    onArray(key: string, value: unknown[]): void;
  },
  key = "root",
): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      visitors.onString(key, trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    visitors.onArray(key, value);
    for (const item of value) {
      walkJson(item, visitors, key);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      walkJson(childValue, visitors, childKey);
    }
  }
}

function markdownToText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^[-*+]\s+/gmu, "")
    .replace(/\|/gu, " ")
    .trim();
}
