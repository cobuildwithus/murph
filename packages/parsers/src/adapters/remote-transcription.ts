import { promises as fs } from "node:fs";

import type { ParsedBlock, ProviderRunResult } from "../contracts/parse.js";
import type { ParserProvider } from "../contracts/provider.js";
import {
  assertFileSizeAtMost,
  buildMarkdown,
  splitTextIntoBlocks,
} from "../shared.js";

export interface RemoteTranscriptionProviderOptions {
  endpoint: string;
  requestTimeoutMs?: number;
  maxInputBytes?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

const REMOTE_TRANSCRIPTION_TIMEOUT_MS = 2 * 60 * 1_000;
// 16 kHz mono PCM WAV is ~1.9 MiB/min, so this covers ~8 minutes of
// ffmpeg-normalized audio (much longer for passthrough compressed originals)
// while keeping the Worker-side base64 + inference payload well inside the
// Worker isolate memory limit. Keep in sync with
// HOSTED_TRANSCRIBE_MAX_BODY_BYTES in apps/cloudflare.
const REMOTE_TRANSCRIPTION_MAX_INPUT_BYTES = 16 * 1024 * 1024;
const REMOTE_TRANSCRIPTION_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export function createRemoteTranscriptionProvider(
  options: RemoteTranscriptionProviderOptions,
): ParserProvider {
  const endpoint = parseTranscriptionEndpoint(options.endpoint);

  return {
    id: "remote-transcription",
    locality: "remote",
    openness: "open_weights",
    runtime: "remote_api",
    priority: 800,
    async discover() {
      return {
        available: true,
        reason: "Remote transcription endpoint configured.",
        details: {
          endpoint: endpoint.href,
        },
      };
    },
    supports(request) {
      const kind = request.preparedKind ?? request.artifact.kind;
      return kind === "audio";
    },
    async run(request): Promise<ProviderRunResult> {
      await assertFileSizeAtMost(
        request.inputPath,
        options.maxInputBytes ?? REMOTE_TRANSCRIPTION_MAX_INPUT_BYTES,
        "Audio attachment",
      );
      const audio = await fs.readFile(request.inputPath);
      const url = new URL(endpoint.href);

      const fetchImpl = options.fetchImpl ?? fetch;
      const timeoutMs = options.requestTimeoutMs ?? REMOTE_TRANSCRIPTION_TIMEOUT_MS;
      const postOnce = async (): Promise<Response> =>
        await fetchImpl(url, {
          body: new Uint8Array(audio),
          headers: {
            accept: "application/json",
            // The endpoint transcodes from raw bytes; the body may be WAV or a
            // passthrough compressed original, so avoid claiming a format.
            "content-type": "application/octet-stream",
          },
          method: "POST",
          signal: request.signal
            ? AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)])
            : AbortSignal.timeout(timeoutMs),
        });
      // The upload is replay-safe (no side effects), so retry once on
      // transient upstream/network failure before failing the parse job.
      let response: Response | null = null;
      try {
        response = await postOnce();
      } catch (error) {
        if (request.signal?.aborted) {
          throw error;
        }
      }
      if (!response || (response.status >= 500 && !request.signal?.aborted)) {
        response = await postOnce();
      }

      if (!response.ok) {
        throw new TypeError(
          `Remote transcription request failed with status ${response.status}.`,
        );
      }

      const payload = await readBoundedJsonResponse(
        response,
        options.maxResponseBytes ?? REMOTE_TRANSCRIPTION_MAX_RESPONSE_BYTES,
      );
      const text = readTranscriptText(payload);
      const blocks = readTranscriptBlocks(payload, text);
      const durationMs = readTranscriptDurationMs(payload, blocks);

      return {
        text,
        markdown: buildMarkdown(text, blocks),
        blocks,
        metadata: {
          language: readTranscriptLanguage(payload),
          durationMs,
        },
      };
    },
  };
}

function parseTranscriptionEndpoint(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Remote transcription endpoint must be an absolute http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Remote transcription endpoint must be an absolute http(s) URL.");
  }

  return parsed;
}

async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new TypeError(
      `Remote transcription response exceeds the ${maxBytes} byte limit.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TypeError("Remote transcription response is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Remote transcription response must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function readTranscriptText(payload: Record<string, unknown>): string {
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    throw new TypeError("Remote transcription response did not include transcript text.");
  }

  return text;
}

function readTranscriptBlocks(
  payload: Record<string, unknown>,
  text: string,
): ParsedBlock[] {
  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  const blocks = segments
    .map((segment, index) => readTranscriptSegmentBlock(segment, index))
    .filter((block): block is ParsedBlock => block !== null);

  return blocks.length > 0 ? blocks : splitTextIntoBlocks(text, { defaultKind: "segment" });
}

function readTranscriptSegmentBlock(segment: unknown, index: number): ParsedBlock | null {
  if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
    return null;
  }

  const record = segment as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) {
    return null;
  }

  return {
    id: `seg_${String(index + 1).padStart(4, "0")}`,
    kind: "segment",
    text,
    order: index,
    startMs: readNonNegativeNumber(record.startMs),
    endMs: readNonNegativeNumber(record.endMs),
  };
}

function readTranscriptDurationMs(
  payload: Record<string, unknown>,
  blocks: ParsedBlock[],
): number | null {
  const reported = readNonNegativeNumber(payload.durationMs);
  if (reported !== null) {
    return reported;
  }

  const maxEndMs = blocks.reduce((maxValue, block) => {
    const endMs = typeof block.endMs === "number" ? block.endMs : 0;
    return Math.max(maxValue, endMs);
  }, 0);
  return maxEndMs > 0 ? maxEndMs : null;
}

function readTranscriptLanguage(payload: Record<string, unknown>): string | null {
  return typeof payload.language === "string" && payload.language.trim().length > 0
    ? payload.language.trim()
    : null;
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
