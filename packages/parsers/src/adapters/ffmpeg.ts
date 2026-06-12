import path from "node:path";

import type { ParserArtifactRef } from "../contracts/artifact.js";
import { ensureDirectory, readConfiguredEnvValue, resolveConfiguredExecutable, runCommand } from "../shared.js";

export interface FfmpegToolOptions {
  commandCandidates?: string[];
  allowSystemLookup?: boolean;
  commandTimeoutMs?: number;
  maxCommandOutputBytes?: number;
  /**
   * True when remote transcription is the only available transcription lane
   * (remote endpoint configured, local whisper.cpp unavailable). Audio in a
   * container format the remote model is verified to accept is passed through
   * untouched instead of being normalized to 16 kHz WAV, which only local
   * whisper.cpp requires.
   */
  remoteTranscriptionOnly?: boolean;
}

export async function resolveFfmpegCommand(
  options: FfmpegToolOptions = {},
): Promise<string | null> {
  return resolveConfiguredExecutable({
    explicitCandidates: options.commandCandidates,
    envValue: () =>
      options.allowSystemLookup === false
        ? null
        : readConfiguredEnvValue(process.env, ["FFMPEG_COMMAND"]),
    fallbackCommands: options.allowSystemLookup === false ? [] : ["ffmpeg"],
  });
}

export async function prepareAudioInput(input: {
  artifact: ParserArtifactRef;
  scratchDirectory: string;
  ffmpeg?: FfmpegToolOptions;
  signal?: AbortSignal;
}): Promise<{ inputPath: string; preparedKind?: "audio" }> {
  const { artifact, scratchDirectory } = input;

  if (artifact.kind !== "audio" && artifact.kind !== "video") {
    return { inputPath: artifact.absolutePath };
  }

  if (
    artifact.kind === "audio" &&
    input.ffmpeg?.remoteTranscriptionOnly === true &&
    isRemoteTranscriptionDirectAudioArtifact(artifact)
  ) {
    return { inputPath: artifact.absolutePath, preparedKind: "audio" };
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
  ], {
    signal: input.signal,
    ...(input.ffmpeg?.maxCommandOutputBytes === undefined
      ? {}
      : {
          maxStderrBytes: input.ffmpeg.maxCommandOutputBytes,
          maxStdoutBytes: input.ffmpeg.maxCommandOutputBytes,
        }),
    ...(input.ffmpeg?.commandTimeoutMs === undefined
      ? {}
      : {
          timeoutMs: input.ffmpeg.commandTimeoutMs,
        }),
  });

  return {
    inputPath: outputPath,
    preparedKind: "audio",
  };
}

// Container formats verified accepted by the hosted remote transcription model
// (@cf/openai/whisper-large-v3-turbo; live-checked against the production model
// on 2026-06-12). AMR is deliberately absent: it is unverified, so it stays on
// the ffmpeg WAV normalization path. `audio/mp4`/`.mp4` are also deliberately
// absent: that container routinely carries video, and the ffmpeg `-vn` path
// avoids sending those video-capable container bytes through passthrough.
const REMOTE_TRANSCRIPTION_DIRECT_AUDIO_MIMES = new Set([
  "audio/aac",
  "audio/x-aac",
  "audio/aiff",
  "audio/x-aiff",
  "audio/caf",
  "audio/x-caf",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mp3",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
]);

const REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_MIMES = new Set([
  "audio/mp4",
]);

const REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_EXTENSIONS = new Set([
  ".mp4",
]);

const REMOTE_TRANSCRIPTION_DIRECT_AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".aif",
  ".aiff",
  ".caf",
  ".m4a",
  ".mp3",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".wave",
]);

function isRemoteTranscriptionDirectAudioArtifact(artifact: ParserArtifactRef): boolean {
  const mime = normalizeMediaType(artifact.mime);
  const fileName = artifact.fileName?.toLowerCase() ?? "";
  const extension = path.extname(fileName);
  if (REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_EXTENSIONS.has(extension)) {
    return false;
  }

  if (mime.startsWith("video/") || REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_MIMES.has(mime)) {
    return false;
  }

  if (REMOTE_TRANSCRIPTION_DIRECT_AUDIO_MIMES.has(mime)) {
    return true;
  }

  return REMOTE_TRANSCRIPTION_DIRECT_AUDIO_EXTENSIONS.has(extension);
}

function isDirectWhisperAudioArtifact(artifact: ParserArtifactRef): boolean {
  const fileName = artifact.fileName?.toLowerCase() ?? "";
  const mime = normalizeMediaType(artifact.mime);
  return (
    fileName.endsWith(".wav") ||
    fileName.endsWith(".wave") ||
    mime === "audio/wav" ||
    mime === "audio/x-wav" ||
    mime === "audio/wave"
  );
}

function normalizeMediaType(value: string | null | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
