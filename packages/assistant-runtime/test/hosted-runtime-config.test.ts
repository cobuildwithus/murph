import { describe, expect, it } from "vitest";

import { parseHostedAssistantRuntimeConfig } from "../src/hosted-runtime/parsers.ts";

describe("parseHostedAssistantRuntimeConfig", () => {
  it("parses explicit hosted parser toolchain config", () => {
    const parsed = parseHostedAssistantRuntimeConfig({
      parserToolchain: {
        tools: {
          ffmpeg: {
            command: "/usr/bin/ffmpeg",
          },
          whisper: {
            command: "/usr/local/bin/whisper-cli",
            modelPath: "/home/runner/.murph/models/whisper/ggml-base.en.bin",
          },
        },
      },
    });

    expect(parsed.parserToolchain).toEqual({
      tools: {
        ffmpeg: {
          command: "/usr/bin/ffmpeg",
        },
        whisper: {
          command: "/usr/local/bin/whisper-cli",
          modelPath: "/home/runner/.murph/models/whisper/ggml-base.en.bin",
        },
      },
    });
  });

  it("rejects relative hosted parser toolchain paths", () => {
    expect(() =>
      parseHostedAssistantRuntimeConfig({
        parserToolchain: {
          tools: {
            whisper: {
              command: "whisper-cli",
              modelPath: "/home/runner/.murph/models/whisper/ggml-base.en.bin",
            },
          },
        },
      })).toThrow(/parserToolchain\.tools\.whisper\.command must be an absolute path/u);
  });

  it("rejects null and empty hosted parser toolchain paths", () => {
    expect(() =>
      parseHostedAssistantRuntimeConfig({
        parserToolchain: {
          tools: {
            whisper: {
              command: null,
            },
          },
        },
      })).toThrow(/parserToolchain\.tools\.whisper\.command must be a non-empty string/u);

    expect(() =>
      parseHostedAssistantRuntimeConfig({
        parserToolchain: {
          tools: {
            whisper: {
              modelPath: "   ",
            },
          },
        },
      })).toThrow(
        /parserToolchain\.tools\.whisper\.modelPath must be a non-empty absolute path/u,
      );
  });

  it("parses hosted transcription endpoints and trims surrounding whitespace", () => {
    const parsed = parseHostedAssistantRuntimeConfig({
      parserToolchain: {
        tools: {
          transcription: {
            endpoint: "  http://murph-transcribe.worker/v1/transcribe  ",
          },
        },
      },
    });

    expect(parsed.parserToolchain).toEqual({
      tools: {
        transcription: {
          endpoint: "http://murph-transcribe.worker/v1/transcribe",
        },
      },
    });
  });

  it("rejects non-absolute and non-http(s) hosted transcription endpoints", () => {
    expect(() =>
      parseHostedAssistantRuntimeConfig({
        parserToolchain: {
          tools: {
            transcription: {
              endpoint: "v1/transcribe",
            },
          },
        },
      })).toThrow(
        /parserToolchain\.tools\.transcription\.endpoint must be an absolute http\(s\) URL/u,
      );

    expect(() =>
      parseHostedAssistantRuntimeConfig({
        parserToolchain: {
          tools: {
            transcription: {
              endpoint: "ftp://murph-transcribe.worker/v1/transcribe",
            },
          },
        },
      })).toThrow(
        /parserToolchain\.tools\.transcription\.endpoint must be an absolute http\(s\) URL/u,
      );

    expect(() =>
      parseHostedAssistantRuntimeConfig({
        parserToolchain: {
          tools: {
            transcription: {
              endpoint: null,
            },
          },
        },
      })).toThrow(
        /parserToolchain\.tools\.transcription\.endpoint must be a non-empty string/u,
      );
  });

  it("rejects parserToolchain:null", () => {
    expect(() =>
      parseHostedAssistantRuntimeConfig({
        parserToolchain: null,
      })
    ).toThrow(
      "Hosted assistant runtime config.parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
  });

  it("parses hosted device-sync runtime config through the shared device-sync parser", () => {
    const parsed = parseHostedAssistantRuntimeConfig({
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
          whatsappCloudApiConfigured: false,
        },
        deviceSync: {
          providerConfigs: {
            strava: {
              clientId: "strava-client-id",
              clientSecret: "strava-client-secret",
              scopes: ["activity:read"],
            },
          },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "codec-secret",
        },
      },
    });

    expect(parsed.resolvedConfig?.deviceSync).toMatchObject({
      publicBaseUrl: "https://device-sync.example.test",
      secret: "codec-secret",
    });
    expect(parsed.resolvedConfig?.deviceSync?.providerConfigs.strava).toMatchObject({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      scopes: ["activity:read"],
    });
  });

  it("rejects unknown top-level hosted runtime device-sync fields", () => {
    expect(() =>
      parseHostedAssistantRuntimeConfig({
        resolvedConfig: {
          channelCapabilities: {
            emailSendReady: false,
            telegramBotConfigured: false,
            whatsappCloudApiConfigured: false,
          },
          deviceSync: {
            providerConfigs: {
              strava: {
                clientId: "strava-client-id",
                clientSecret: "strava-client-secret",
              },
            },
            publicBaseUrl: "https://device-sync.example.test",
            secret: "codec-secret",
            unexpectedField: "nope",
          },
        },
      })).toThrow(/resolvedConfig\.deviceSync\.unexpectedField/u);
  });
});
