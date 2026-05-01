import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV,
  HOSTED_RUNNER_WHISPER_MODEL_PATH,
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
        whisper: {
          command: "/usr/local/bin/whisper-cli",
          modelPath: HOSTED_RUNNER_WHISPER_MODEL_PATH,
        },
      },
    });
  });

  it("uses explicit local e2e parser tools only when the local marker is set", () => {
    vi.stubEnv(HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV, "1");
    vi.stubEnv("FFMPEG_COMMAND", "/app/test-parser-toolchain/ffmpeg");
    vi.stubEnv("WHISPER_COMMAND", "/app/test-parser-toolchain/whisper-cli");
    vi.stubEnv("WHISPER_MODEL_PATH", "/app/test-parser-toolchain/ggml-test.bin");

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
        whisper: {
          command: "/app/test-parser-toolchain/whisper-cli",
          modelPath: "/app/test-parser-toolchain/ggml-test.bin",
        },
      },
    });
  });

  it("requires exact local e2e parser fixture paths behind the marker", () => {
    vi.stubEnv(HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV, "1");
    vi.stubEnv("FFMPEG_COMMAND", "/app/test-parser-toolchain/../other-bin/ffmpeg");
    vi.stubEnv("WHISPER_COMMAND", "/app/test-parser-toolchain/whisper-cli");
    vi.stubEnv("WHISPER_MODEL_PATH", "/app/test-parser-toolchain/ggml-test.bin");

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
        whisper: {
          command: "/app/test-parser-toolchain/whisper-cli",
          modelPath: "/app/test-parser-toolchain/ggml-test.bin",
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
        whisper: {
          command: "/app/test-parser-toolchain/whisper-cli",
          modelPath: "/app/test-parser-toolchain/ggml-test.bin",
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
        whisper: {
          command: "/app/test-parser-toolchain/whisper-cli",
          modelPath: "/app/test-parser-toolchain/ggml-test.bin",
        },
      },
    })).toBe(false);
  });
});
