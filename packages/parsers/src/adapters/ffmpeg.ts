import path from "node:path";

import type { ParserArtifactRef } from "../contracts/artifact.js";
import { ensureDirectory, readConfiguredEnvValue, resolveConfiguredExecutable, runCommand } from "../shared.js";

export interface FfmpegToolOptions {
  commandCandidates?: string[];
  allowSystemLookup?: boolean;
}

export async function resolveFfmpegCommand(
  options: FfmpegToolOptions = {},
): Promise<string | null> {
  return resolveConfiguredExecutable({
    explicitCandidates: options.commandCandidates,
    envValue: () =>
      options.allowSystemLookup === false
        ? null
        : readConfiguredEnvValue(process.env, ["FFMPEG_COMMAND", "HEALTHYBOB_FFMPEG_COMMAND"]),
    fallbackCommands: options.allowSystemLookup === false ? [] : ["ffmpeg"],
  });
}

export async function prepareAudioInput(input: {
  artifact: ParserArtifactRef;
  scratchDirectory: string;
  ffmpeg?: FfmpegToolOptions;
}): Promise<{ inputPath: string; preparedKind?: "audio" }> {
  const { artifact, scratchDirectory } = input;

  if (artifact.kind !== "audio" && artifact.kind !== "video") {
    return { inputPath: artifact.absolutePath };
  }

  const command = await resolveFfmpegCommand(input.ffmpeg);
  if (!command) {
    if (artifact.kind === "audio" && isDirectWhisperAudioArtifact(artifact)) {
      return { inputPath: artifact.absolutePath, preparedKind: "audio" };
    }

    throw new TypeError(
      artifact.kind === "video"
        ? "ffmpeg is required to extract audio from video attachments."
        : "ffmpeg is required to normalize non-WAV audio attachments for transcription.",
    );
  }

  await ensureDirectory(scratchDirectory);
  const outputPath = path.join(scratchDirectory, `${artifact.attachmentId}.wav`);
  await runCommand(command, [
    "-y",
    "-i",
    artifact.absolutePath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    outputPath,
  ]);

  return {
    inputPath: outputPath,
    preparedKind: "audio",
  };
}

function isDirectWhisperAudioArtifact(artifact: ParserArtifactRef): boolean {
  const fileName = artifact.fileName?.toLowerCase() ?? "";
  const mime = artifact.mime?.toLowerCase() ?? "";
  return (
    fileName.endsWith(".wav") ||
    fileName.endsWith(".wave") ||
    mime === "audio/wav" ||
    mime === "audio/x-wav" ||
    mime === "audio/wave"
  );
}
