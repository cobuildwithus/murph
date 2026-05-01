import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNNER_WHISPER_MODEL_PATH,
  createHostedRunnerNativeParserToolchain,
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
});
