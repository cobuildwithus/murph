import { afterEach, describe, expect, it, vi } from "vitest";

import { CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT } from "../src/internal-hosts.ts";
import {
  HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV,
  createHostedRunnerNativeParserToolchain,
  isHostedRunnerLocalE2eParserToolchain,
} from "../src/runner-native-parser-toolchain.ts";

describe("createHostedRunnerNativeParserToolchain", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the image-owned native parser defaults and ignores parser env overrides", () => {
    vi.stubEnv("FFMPEG_COMMAND", "/stale/ffmpeg");
    vi.stubEnv("PDFINFO_COMMAND", "/stale/pdfinfo");
    vi.stubEnv("PDFTOTEXT_COMMAND", "/stale/pdftotext");
    vi.stubEnv("WHISPER_COMMAND", "/stale/whisper-cli");
    vi.stubEnv("WHISPER_MODEL_PATH", "/stale/model.bin");

    expect(createHostedRunnerNativeParserToolchain()).toEqual({
      tools: {
        ffmpeg: {
          command: "/usr/bin/ffmpeg",
        },
        pdfinfo: {
          command: "/usr/bin/pdfinfo",
        },
        pdftotext: {
          command: "/usr/bin/pdftotext",
        },
        transcription: {
          endpoint: CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT,
        },
      },
    });
  });

  it("routes hosted transcription through the worker transcribe host", () => {
    expect(CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT).toBe(
      "http://murph-transcribe.worker/v1/transcribe",
    );
  });

  it("uses explicit local e2e parser tools only when the local marker is set", () => {
    vi.stubEnv(HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV, "1");
    vi.stubEnv("FFMPEG_COMMAND", "/app/test-parser-toolchain/ffmpeg");

    expect(createHostedRunnerNativeParserToolchain()).toEqual({
      tools: {
        ffmpeg: {
          command: "/app/test-parser-toolchain/ffmpeg",
        },
        pdfinfo: {
          command: "/usr/bin/pdfinfo",
        },
        pdftotext: {
          command: "/usr/bin/pdftotext",
        },
        transcription: {
          endpoint: CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT,
        },
      },
    });
  });

  it("requires exact local e2e parser fixture paths behind the marker", () => {
    vi.stubEnv(HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV, "1");
    vi.stubEnv("FFMPEG_COMMAND", "/app/test-parser-toolchain/../other-bin/ffmpeg");

    expect(() => createHostedRunnerNativeParserToolchain()).toThrow(
      "HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN=1 requires FFMPEG_COMMAND=/app/test-parser-toolchain/ffmpeg.",
    );
  });

  it("recognizes only the exact worker-serialized local e2e parser toolchain shape", () => {
    expect(isHostedRunnerLocalE2eParserToolchain({
      tools: {
        ffmpeg: {
          command: "/app/test-parser-toolchain/ffmpeg",
        },
        pdfinfo: {
          command: "/usr/bin/pdfinfo",
        },
        pdftotext: {
          command: "/usr/bin/pdftotext",
        },
        transcription: {
          endpoint: CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT,
        },
      },
    })).toBe(true);
    expect(isHostedRunnerLocalE2eParserToolchain({
      tools: {
        ffmpeg: {
          command: "/app/test-parser-toolchain/../other-bin/ffmpeg",
        },
        pdfinfo: {
          command: "/usr/bin/pdfinfo",
        },
        pdftotext: {
          command: "/usr/bin/pdftotext",
        },
        transcription: {
          endpoint: CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT,
        },
      },
    })).toBe(false);
    expect(isHostedRunnerLocalE2eParserToolchain({
      tools: {
        ffmpeg: {
          command: "/app/test-parser-toolchain/ffmpeg",
        },
        pdfinfo: {
          command: "/stale/pdfinfo",
        },
        pdftotext: {
          command: "/usr/bin/pdftotext",
        },
        transcription: {
          endpoint: CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT,
        },
      },
    })).toBe(false);
    expect(isHostedRunnerLocalE2eParserToolchain({
      tools: {
        ffmpeg: {
          command: "/app/test-parser-toolchain/ffmpeg",
        },
        pdfinfo: {
          command: "/usr/bin/pdfinfo",
        },
        pdftotext: {
          command: "/usr/bin/pdftotext",
        },
        transcription: {
          endpoint: CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT,
        },
        whisper: {
          command: "/app/test-parser-toolchain/whisper-cli",
        },
      },
    })).toBe(false);
  });
});
