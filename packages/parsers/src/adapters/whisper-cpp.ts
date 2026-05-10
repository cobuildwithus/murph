import path from "node:path";

import type { ParseRequest, ParsedBlock, ProviderRunResult } from "../contracts/parse.js";
import type { ParserProvider } from "../contracts/provider.js";
import {
  assertFileSizeAtMost,
  buildMarkdown,
  DEFAULT_AUDIO_PROVIDER_MAX_INPUT_BYTES,
  DEFAULT_PARSER_TRANSCRIPT_MAX_BYTES,
  describeExecutableAvailability,
  readConfiguredEnvValue,
  requireExecutable,
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
  commandTimeoutMs?: number;
  maxInputBytes?: number;
  maxCommandOutputBytes?: number;
  maxTranscriptBytes?: number;
  resolvedToolState?: {
    available: boolean;
    reason: string;
    commandPath: string | null;
    modelPath: string | null;
  };
}

const WHISPER_COMMAND_TIMEOUT_MS = 10 * 60 * 1_000;
const WHISPER_COMMAND_OUTPUT_BYTES = 64 * 1024;

export function createWhisperCppProvider(
  options: WhisperCppProviderOptions = {},
): ParserProvider {
  const resolvedToolState = options.resolvedToolState;

  async function resolveCommand(): Promise<string | null> {
    if (resolvedToolState) {
      return normalizeNullableString(resolvedToolState.commandPath);
    }

    return resolveConfiguredExecutable({
      explicitCandidates: options.commandCandidates,
      envValue: () => readConfiguredEnvValue(process.env, ["WHISPER_COMMAND"]),
      fallbackCommands: ["whisper-cli", "whisper-cpp"],
    });
  }

  function resolveModelPath(): string | null {
    if (resolvedToolState) {
      return normalizeNullableString(resolvedToolState.modelPath);
    }

    const candidate =
      options.modelPath ??
      readConfiguredEnvValue(process.env, ["WHISPER_MODEL_PATH"]);
    return candidate && candidate.trim().length > 0 ? candidate.trim() : null;
  }

  return {
    id: "whisper.cpp",
    locality: "local",
    openness: "open_source",
    runtime: "cli",
    priority: 900,
    async discover() {
      if (resolvedToolState) {
        return buildResolvedAvailability(resolvedToolState);
      }

      const command = await resolveCommand();
      const modelPath = resolveModelPath();
      const availability = describeExecutableAvailability({
        executablePath: command,
        availableReason: "whisper.cpp CLI and model path configured.",
        missingReason: "whisper.cpp CLI executable not found.",
      });

      if (!availability.available) {
        return availability;
      }

      if (!modelPath) {
        return {
          available: false,
          reason: "Whisper model path is not configured.",
          executablePath: availability.executablePath,
        };
      }

      return {
        ...availability,
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
      if (resolvedToolState && !resolvedToolState.available) {
        throw new TypeError(resolvedToolState.reason);
      }

      const command = requireExecutable(
        await resolveCommand(),
        resolvedToolState?.reason ?? "whisper.cpp CLI executable not found.",
      );
      const modelPath = resolveModelPath();

      if (!modelPath) {
        throw new TypeError(resolvedToolState?.reason ?? "Whisper model path is not configured.");
      }

      await assertFileSizeAtMost(
        request.inputPath,
        options.maxInputBytes ?? DEFAULT_AUDIO_PROVIDER_MAX_INPUT_BYTES,
        "Audio attachment",
      );
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
      await runCommand(command, args, {
        maxStderrBytes: options.maxCommandOutputBytes ?? WHISPER_COMMAND_OUTPUT_BYTES,
        maxStdoutBytes: options.maxCommandOutputBytes ?? WHISPER_COMMAND_OUTPUT_BYTES,
        signal: request.signal,
        timeoutMs: options.commandTimeoutMs ?? WHISPER_COMMAND_TIMEOUT_MS,
      });
      const maxTranscriptBytes =
        options.maxTranscriptBytes ?? DEFAULT_PARSER_TRANSCRIPT_MAX_BYTES;
      const textOutput = (await readUtf8IfExists(`${outputBase}.txt`, {
        maxBytes: maxTranscriptBytes,
      }))?.trim() ?? "";
      const srtOutput = await readUtf8IfExists(`${outputBase}.srt`, {
        maxBytes: maxTranscriptBytes,
      });
      const srtBlocks = srtOutput ? parseSrtBlocks(srtOutput) : [];
      const text = textOutput || srtBlocks.map((block) => block.text).join(" ").trim();

      if (!text) {
        throw new TypeError("whisper.cpp did not produce a transcript file.");
      }

      const blocks =
        srtBlocks.length > 0 ? srtBlocks : splitTextIntoBlocks(text, { defaultKind: "segment" });
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

function buildResolvedAvailability(
  resolvedToolState: NonNullable<WhisperCppProviderOptions["resolvedToolState"]>,
) {
  const executablePath = normalizeNullableString(resolvedToolState.commandPath);
  const modelPath = normalizeNullableString(resolvedToolState.modelPath);

  return {
    available: resolvedToolState.available,
    reason: resolvedToolState.reason,
    ...(executablePath ? { executablePath } : {}),
    ...(resolvedToolState.available && modelPath
      ? {
          details: {
            modelPath,
          },
        }
      : {}),
  };
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
