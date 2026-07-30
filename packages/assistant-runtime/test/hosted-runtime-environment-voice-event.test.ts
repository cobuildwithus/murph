import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantExecutionContext } from "@murphai/assistant-engine";
import {
  buildHostedExecutionEnvironmentVoiceCapturedWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  createConfiguredParserRegistry: vi.fn(),
  parseAttachment: vi.fn(),
  sendAssistantNotification: vi.fn(),
}));

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<
    typeof import("@murphai/assistant-engine")
  >("@murphai/assistant-engine");
  return {
    ...actual,
    sendAssistantNotification: mocks.sendAssistantNotification,
  };
});
vi.mock("@murphai/parsers", async () => {
  const actual = await vi.importActual<typeof import("@murphai/parsers")>(
    "@murphai/parsers",
  );
  return {
    ...actual,
    createConfiguredParserRegistry: mocks.createConfiguredParserRegistry,
    parseAttachment: mocks.parseAttachment,
  };
});

import {
  executeHostedEnvironmentVoiceWake,
} from "../src/hosted-runtime/events/environment-voice.ts";
import {
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";

describe("hosted environment voice processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transcribes transiently, runs the constrained Habitat profile, and defers deletion until checkpoint", async () => {
    const bytes = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
    const sha256 = await sha256Hex(bytes);
    const readEnvironmentVoice = vi.fn(async () => bytes);
    mocks.createConfiguredParserRegistry.mockResolvedValue({
      ffmpeg: undefined,
      registry: Symbol("parser-registry"),
    });
    mocks.parseAttachment.mockResolvedValue({
      output: { text: "My bedroom is dark and quiet." },
    });
    mocks.sendAssistantNotification.mockResolvedValue({
      kind: "skip",
      privateSummary: "Environment voice facts processed.",
    });
    const executionContext: AssistantExecutionContext = {
      hosted: {
        memberId: "member_123",
        userEnvKeys: [],
      },
    };
    const wake = buildHostedExecutionEnvironmentVoiceCapturedWake({
      audioKey: "c".repeat(40),
      byteLength: bytes.byteLength,
      captureId: sha256,
      capturedAt: "2026-07-30T12:00:00.000Z",
      contentType: "audio/webm",
      durationMs: 12_000,
      eventId: `environment-voice:${sha256}`,
      memberId: "member_123",
      occurredAt: "2026-07-30T12:00:00.000Z",
      sha256,
    });

    const outcome = await executeHostedEnvironmentVoiceWake({
      executionContext,
      runtime: {
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          deviceSyncPort: null,
          effectsPort: {
            ...createHostedRuntimeEffectsPortStub(),
            readEnvironmentVoice,
          },
          usageRecordPort: null,
        },
      },
      signal: null,
      turnEnvironment: {
        currentWorkingDirectory: null,
        env: { VAULT: "/synthetic/vault" },
      },
      vaultRoot: "/synthetic/vault",
      wake,
    });

    expect(readEnvironmentVoice).toHaveBeenCalledWith("c".repeat(40));
    expect(mocks.parseAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact: expect.objectContaining({
          attachmentId: sha256,
          kind: "audio",
          mime: "audio/webm",
          sha256,
        }),
      }),
    );
    expect(mocks.sendAssistantNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalPolicy: "never",
        instructions: expect.stringContaining(
          JSON.stringify("My bedroom is dark and quiet."),
        ),
        sandbox: "workspace-write",
        turnPolicy: {
          kind: "maintenance-exact-skip",
          maintenanceProfile: "habitat-voice",
          privateSummary: "Environment voice facts processed.",
        },
      }),
    );
    expect(outcome.postCheckpointRecord).toEqual({
      audioKey: "c".repeat(40),
      kind: "environment-voice.audio-delete",
    });
  });

  it("does not invoke the model when staged audio fails integrity validation", async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const effectsPort = {
      ...createHostedRuntimeEffectsPortStub(),
      readEnvironmentVoice: vi.fn(async () => bytes),
    };

    await expect(
      executeHostedEnvironmentVoiceWake({
        executionContext: {
          hosted: { memberId: "member_123", userEnvKeys: [] },
        },
        runtime: {
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            deviceSyncPort: null,
            effectsPort,
            usageRecordPort: null,
          },
        },
        signal: null,
        turnEnvironment: {},
        vaultRoot: "/synthetic/vault",
        wake: buildHostedExecutionEnvironmentVoiceCapturedWake({
          audioKey: "c".repeat(40),
          byteLength: bytes.byteLength,
          captureId: "a".repeat(64),
          capturedAt: "2026-07-30T12:00:00.000Z",
          contentType: "audio/webm",
          durationMs: 12_000,
          eventId: "environment-voice:invalid",
          memberId: "member_123",
          occurredAt: "2026-07-30T12:00:00.000Z",
          sha256: "b".repeat(64),
        }),
      }),
    ).rejects.toThrow(/integrity/u);
    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
  });
});

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copy.buffer),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
