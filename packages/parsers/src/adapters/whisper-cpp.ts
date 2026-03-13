import path from "node:path";

import type { ParseRequest, ParsedBlock, ProviderRunResult } from "../contracts/parse.js";
import type { ParserProvider } from "../contracts/provider.js";
import {
  buildMarkdown,
  readUtf8IfExists,
  resolveConfiguredExecutable,
  runCommand,
  splitTextIntoBlocks,
} from "../shared.js";

export interface WhisperCppProviderOptions {
  commandCandidates?: string[];
  modelPath?: string;
  language?: string;
  translate?: boolean;
  extraArgs?: string[];
}

export function createWhisperCppProvider(
  options: WhisperCppProviderOptions = {},
): ParserProvider {
  async function resolveCommand(): Promise<string | null> {
    return resolveConfiguredExecutable({
      explicitCandidates: options.commandCandidates,
      envValue: process.env.HEALTHYBOB_WHISPER_COMMAND,
      fallbackCommands: ["whisper-cli", "whisper-cpp"],
    });
  }

  function resolveModelPath(): string | null {
    const candidate = options.modelPath ?? process.env.HEALTHYBOB_WHISPER_MODEL_PATH ?? null;
    return candidate && candidate.trim().length > 0 ? candidate.trim() : null;
  }

  return {
    id: "whisper.cpp",
    locality: "local",
    openness: "open_source",
    runtime: "cli",
    priority: 900,
    async discover() {
      const command = await resolveCommand();
      const modelPath = resolveModelPath();

      if (!command) {
        return {
          available: false,
          reason: "whisper.cpp CLI executable not found.",
        };
      }

      if (!modelPath) {
        return {
          available: false,
          reason: "Whisper model path is not configured.",
          executablePath: command,
        };
      }

      return {
        available: true,
        reason: "whisper.cpp CLI and model path configured.",
        executablePath: command,
        details: {
          modelPath,
        },
      };
    },
    supports(request: ParseRequest) {
      const kind = request.preparedKind ?? request.artifact.kind;
      return kind === "audio";
    },
    async run(request): Promise<ProviderRunResult> {
      const command = await resolveCommand();
      const modelPath = resolveModelPath();

      if (!command) {
        throw new TypeError("whisper.cpp CLI executable not found.");
      }

      if (!modelPath) {
        throw new TypeError("Whisper model path is not configured.");
      }

      const outputBase = path.join(request.scratchDirectory, `${request.artifact.attachmentId}.whisper`);
      const args = [
        "-m",
        modelPath,
        "-f",
        request.inputPath,
        "-otxt",
        "-osrt",
        "-of",
        outputBase,
        ...(options.language ? ["-l", options.language] : []),
        ...(options.translate ? ["-tr"] : []),
        ...(options.extraArgs ?? []),
      ];
      const result = await runCommand(command, args);
      const textOutput = (await readUtf8IfExists(`${outputBase}.txt`))?.trim();
      const srtOutput = await readUtf8IfExists(`${outputBase}.srt`);
      const text = textOutput || result.stdout.trim() || result.stderr.trim();

      if (!text) {
        throw new TypeError("whisper.cpp did not produce a transcript.");
      }

      const blocks = srtOutput ? parseSrtBlocks(srtOutput) : splitTextIntoBlocks(text, { defaultKind: "segment" });
      const durationMs = blocks.reduce((maxValue, block) => {
        const endMs = typeof block.endMs === "number" ? block.endMs : 0;
        return Math.max(maxValue, endMs);
      }, 0);

      return {
        text,
        markdown: buildMarkdown(text, blocks),
        blocks,
        metadata: {
          language: options.language ?? null,
          durationMs: durationMs || null,
        },
      };
    },
  };
}

function parseSrtBlocks(content: string): ParsedBlock[] {
  return content
    .trim()
    .split(/\r?\n\r?\n/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk, index) => {
      const lines = chunk.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
      const timingLine = lines.find((line) => line.includes("-->"));
      const text = lines.slice(timingLine ? lines.indexOf(timingLine) + 1 : 1).join(" ").trim();
      const [start, end] = (timingLine ?? "").split(/\s+-->\s+/u);

      return {
        id: `seg_${String(index + 1).padStart(4, "0")}`,
        kind: "segment" as const,
        text,
        order: index,
        startMs: parseSrtTimestamp(start),
        endMs: parseSrtTimestamp(end),
      };
    })
    .filter((block) => block.text.length > 0);
}

function parseSrtTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/u.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, hours, minutes, seconds, millis] = match;
  return (
    Number(hours) * 60 * 60 * 1_000 +
    Number(minutes) * 60 * 1_000 +
    Number(seconds) * 1_000 +
    Number(millis)
  );
}
