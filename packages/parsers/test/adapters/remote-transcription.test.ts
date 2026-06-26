import path from "node:path";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { createRemoteTranscriptionProvider } from "../../src/adapters/remote-transcription.js";
import type { ParseRequest } from "../../src/contracts/parse.js";

const ENDPOINT = "http://murph-transcribe.worker/v1/transcribe";

async function withTempAudioFile<T>(
  run: (audioPath: string) => Promise<T>,
): Promise<T> {
  const directoryPath = await fs.mkdtemp(
    path.join(tmpdir(), "murph-parsers-remote-transcription-"),
  );

  try {
    const audioPath = path.join(directoryPath, "voice-memo.wav");
    await fs.writeFile(audioPath, Buffer.from("RIFF-wav-bytes"));
    return await run(audioPath);
  } finally {
    await fs.rm(directoryPath, { force: true, recursive: true });
  }
}

function buildRequest(inputPath: string): ParseRequest {
  return {
    artifact: {
      absolutePath: inputPath,
      attachmentId: "att_remote_transcription",
      captureId: "cap_remote_transcription",
      fileName: "voice-memo.wav",
      kind: "audio",
      mime: "audio/wav",
      storedPath: "raw/inbox/voice-memo.wav",
    },
    inputPath,
    intent: "attachment_text",
    preparedKind: "audio",
    scratchDirectory: path.dirname(inputPath),
  };
}

describe("createRemoteTranscriptionProvider", () => {
  it("reports availability from the configured endpoint", async () => {
    const provider = createRemoteTranscriptionProvider({
      authorizationHeader: "Bearer signed-provider-credential",
      endpoint: ENDPOINT,
    });
    expect(provider.id).toBe("remote-transcription");
    expect(provider.locality).toBe("remote");
    await expect(provider.discover()).resolves.toMatchObject({
      available: true,
      details: { endpoint: ENDPOINT },
    });

    expect(() => createRemoteTranscriptionProvider({ endpoint: "not-a-url" })).toThrow(
      "Remote transcription endpoint must be an absolute http(s) URL.",
    );
  });

  it("supports prepared audio requests only", async () => {
    const provider = createRemoteTranscriptionProvider({ endpoint: ENDPOINT });
    await withTempAudioFile(async (audioPath) => {
      expect(provider.supports(buildRequest(audioPath))).toBe(true);
      expect(provider.supports({
        ...buildRequest(audioPath),
        artifact: {
          ...buildRequest(audioPath).artifact,
          kind: "document",
        },
        preparedKind: undefined,
      })).toBe(false);
    });
  });

  it("uploads the prepared audio and maps the transcript response", async () => {
    await withTempAudioFile(async (audioPath) => {
      const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
        expect(String(url)).toBe(ENDPOINT);
        expect(init?.method).toBe("POST");
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer signed-provider-credential");
        expect(headers.get("content-type")).toBe("application/octet-stream");
        expect(Buffer.from(init?.body as Uint8Array).toString("utf8")).toBe("RIFF-wav-bytes");
        return Response.json({
          durationMs: 30_000,
          language: "en",
          segments: [
            { endMs: 1_500, startMs: 0, text: "Remember to" },
            { endMs: 2_900, startMs: 1_500, text: "log the voice note" },
          ],
          text: "Remember to log the voice note",
        });
      });
      const provider = createRemoteTranscriptionProvider({
        authorizationHeader: "Bearer signed-provider-credential",
        endpoint: ENDPOINT,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const result = await provider.run(buildRequest(audioPath));
      expect(result.text).toBe("Remember to log the voice note");
      expect(result.metadata).toEqual({ durationMs: 30_000, language: "en" });
      expect(result.blocks).toEqual([
        {
          endMs: 1_500,
          id: "seg_0001",
          kind: "segment",
          order: 0,
          startMs: 0,
          text: "Remember to",
        },
        {
          endMs: 2_900,
          id: "seg_0002",
          kind: "segment",
          order: 1,
          startMs: 1_500,
          text: "log the voice note",
        },
      ]);
    });
  });

  it("falls back to text-derived blocks when no segments are returned", async () => {
    await withTempAudioFile(async (audioPath) => {
      const provider = createRemoteTranscriptionProvider({
        endpoint: ENDPOINT,
        fetchImpl: (async () => Response.json({ text: "Just text." })) as typeof fetch,
      });

      const result = await provider.run(buildRequest(audioPath));
      expect(result.text).toBe("Just text.");
      expect(result.blocks?.length).toBeGreaterThan(0);
      expect(result.metadata).toEqual({ durationMs: null, language: null });
    });
  });

  it("fails closed on non-ok responses, oversized payloads, and missing text", async () => {
    await withTempAudioFile(async (audioPath) => {
      const failing = createRemoteTranscriptionProvider({
        endpoint: ENDPOINT,
        fetchImpl: (async () => new Response("Unauthorized", { status: 401 })) as typeof fetch,
      });
      await expect(failing.run(buildRequest(audioPath))).rejects.toThrow(
        "Remote transcription request failed with status 401.",
      );

      const oversized = createRemoteTranscriptionProvider({
        endpoint: ENDPOINT,
        fetchImpl: (async () => Response.json({ text: "abc" })) as typeof fetch,
        maxResponseBytes: 4,
      });
      await expect(oversized.run(buildRequest(audioPath))).rejects.toThrow(
        "Remote transcription response exceeds the 4 byte limit.",
      );

      const missingText = createRemoteTranscriptionProvider({
        endpoint: ENDPOINT,
        fetchImpl: (async () => Response.json({ text: "  " })) as typeof fetch,
      });
      await expect(missingText.run(buildRequest(audioPath))).rejects.toThrow(
        "Remote transcription response did not include transcript text.",
      );

      const tooLarge = createRemoteTranscriptionProvider({
        endpoint: ENDPOINT,
        fetchImpl: (async () => Response.json({ text: "ok" })) as typeof fetch,
        maxInputBytes: 4,
      });
      await expect(tooLarge.run(buildRequest(audioPath))).rejects.toThrow(/Audio attachment/u);
    });
  });

  it("retries the replay-safe upload once on transient upstream failure", async () => {
    await withTempAudioFile(async (audioPath) => {
      const recovering = vi.fn()
        .mockResolvedValueOnce(new Response("Hosted transcription failed.", { status: 502 }))
        .mockResolvedValueOnce(Response.json({ text: "second attempt ok" }));
      const provider = createRemoteTranscriptionProvider({
        endpoint: ENDPOINT,
        fetchImpl: recovering as unknown as typeof fetch,
      });
      const result = await provider.run(buildRequest(audioPath));
      expect(result.text).toBe("second attempt ok");
      expect(recovering).toHaveBeenCalledTimes(2);

      const failing = vi.fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(new Response("Hosted transcription failed.", { status: 502 }));
      const stillFailing = createRemoteTranscriptionProvider({
        endpoint: ENDPOINT,
        fetchImpl: failing as unknown as typeof fetch,
      });
      await expect(stillFailing.run(buildRequest(audioPath))).rejects.toThrow(
        "Remote transcription request failed with status 502.",
      );
      expect(failing).toHaveBeenCalledTimes(2);
    });
  });

  it("aborts the upload when the parse signal aborts", async () => {
    await withTempAudioFile(async (audioPath) => {
      const controller = new AbortController();
      controller.abort();
      const provider = createRemoteTranscriptionProvider({
        endpoint: ENDPOINT,
        fetchImpl: (async (_url: URL, init?: RequestInit) => {
          init?.signal?.throwIfAborted();
          return Response.json({ text: "unreachable" });
        }) as unknown as typeof fetch,
      });

      await expect(provider.run({
        ...buildRequest(audioPath),
        signal: controller.signal,
      })).rejects.toThrow();
    });
  });
});
