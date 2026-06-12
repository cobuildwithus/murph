import { promises as fs } from "node:fs";
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

  const remoteTranscriptionOnly = input.ffmpeg?.remoteTranscriptionOnly === true;
  if (
    artifact.kind === "audio" &&
    remoteTranscriptionOnly &&
    await isRemoteTranscriptionDirectAudioArtifact(artifact)
  ) {
    return { inputPath: artifact.absolutePath, preparedKind: "audio" };
  }

  const command = await resolveFfmpegCommand(input.ffmpeg);
  if (!command) {
    if (
      artifact.kind === "audio" &&
      !remoteTranscriptionOnly &&
      isDirectWhisperAudioArtifact(artifact)
    ) {
      return { inputPath: artifact.absolutePath, preparedKind: "audio" };
    }

    throw new TypeError(
      artifact.kind === "video"
        ? "ffmpeg is required to extract audio from video attachments."
        : "ffmpeg is required to normalize non-WAV audio attachments for transcription.",
    );
  }

  await ensureDirectory(scratchDirectory);
  const outputPath = path.join(
    scratchDirectory,
    `${artifact.attachmentId}${remoteTranscriptionOnly ? ".mp3" : ".wav"}`,
  );
  const ffmpegArgs = remoteTranscriptionOnly
    ? [
        "-y",
        "-i",
        artifact.absolutePath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "64k",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        outputPath,
      ]
    : [
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
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        outputPath,
      ];
  await runCommand(command, ffmpegArgs, {
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
// the ffmpeg preparation path. MP4-family containers are also deliberately
// absent: they routinely carry video, and the ffmpeg `-vn` path avoids sending
// those video-capable container bytes through passthrough.
const REMOTE_TRANSCRIPTION_DIRECT_AUDIO_MIMES = new Set([
  "audio/aac",
  "audio/x-aac",
  "audio/aiff",
  "audio/x-aiff",
  "audio/caf",
  "audio/x-caf",
  "audio/mp3",
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
]);

const REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_MIMES = new Set([
  "audio/m4a",
  "audio/mp4",
  "audio/x-m4a",
]);

const REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_EXTENSIONS = new Set([
  ".m4a",
  ".mp4",
]);

// Keep in sync with the remote transcription provider and Worker body cap.
const REMOTE_TRANSCRIPTION_DIRECT_MAX_INPUT_BYTES = 16 * 1024 * 1024;

async function isRemoteTranscriptionDirectAudioArtifact(
  artifact: ParserArtifactRef,
): Promise<boolean> {
  const mime = normalizeMediaType(artifact.mime);
  const fileName = artifact.fileName?.toLowerCase() ?? "";
  const extension = path.extname(fileName);
  if (REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_EXTENSIONS.has(extension)) {
    return false;
  }

  if (mime.startsWith("video/") || REMOTE_TRANSCRIPTION_BLOCKED_AUDIO_MIMES.has(mime)) {
    return false;
  }

  if (!REMOTE_TRANSCRIPTION_DIRECT_AUDIO_MIMES.has(mime)) {
    return false;
  }

  if (!await hasRemoteTranscriptionDirectAudioSignature(artifact.absolutePath, mime)) {
    return false;
  }

  const stat = await fs.stat(artifact.absolutePath);
  return stat.size <= REMOTE_TRANSCRIPTION_DIRECT_MAX_INPUT_BYTES;
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

async function hasRemoteTranscriptionDirectAudioSignature(
  filePath: string,
  mime: string,
): Promise<boolean> {
  const header = await readFileHeader(filePath, 16);
  if (header.length === 0) {
    return false;
  }

  if (mime === "audio/caf" || mime === "audio/x-caf") {
    return header.subarray(0, 4).equals(Buffer.from("caff", "ascii"));
  }

  if (mime === "audio/aiff" || mime === "audio/x-aiff") {
    return (
      header.subarray(0, 4).equals(Buffer.from("FORM", "ascii")) &&
      (
        header.subarray(8, 12).equals(Buffer.from("AIFF", "ascii")) ||
        header.subarray(8, 12).equals(Buffer.from("AIFC", "ascii"))
      )
    );
  }

  if (mime === "audio/wav" || mime === "audio/wave" || mime === "audio/x-wav") {
    return (
      header.subarray(0, 4).equals(Buffer.from("RIFF", "ascii")) &&
      header.subarray(8, 12).equals(Buffer.from("WAVE", "ascii"))
    );
  }

  if (mime === "audio/mp3" || mime === "audio/mpeg") {
    return (
      header.subarray(0, 3).equals(Buffer.from("ID3", "ascii")) ||
      (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
    );
  }

  if (mime === "audio/aac" || mime === "audio/x-aac") {
    return header[0] === 0xff && (header[1] & 0xf0) === 0xf0;
  }

  return false;
}

async function readFileHeader(filePath: string, bytes: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
