import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  RunnerContainer as HostedLocalTestRunnerContainer,
} from "../src/hosted-local-test/runner-container.ts";
import {
  HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS,
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
} from "../src/runner-egress-intercept.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

const TRANSCRIBE_URL = "http://murph-transcribe.worker/v1/transcribe";

function readHostedLocalTestOutboundByHost(): typeof HOSTED_RUNNER_OUTBOUND_BY_HOST {
  const handlers = HostedLocalTestRunnerContainer.outboundByHost;
  if (!handlers) {
    throw new Error("Hosted-local test RunnerContainer did not register outbound handlers.");
  }

  return handlers as typeof HOSTED_RUNNER_OUTBOUND_BY_HOST;
}

function createOutboundEnv(input: {
  AI?: RunnerOutboundEnvironmentSource["AI"];
} = {}): RunnerOutboundEnvironmentSource {
  return {
    ...createHostedExecutionTestEnv(),
    AI: input.AI,
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    RUNNER_CONTAINER: {
      get: () => ({
        readActiveRuntimeUserFence: async () => ({ active: true, attemptId: "attempt-1", leaseGeneration: "1", userId: "member_123" }),
      }),
      getByName: () => ({
        destroyInstance: async () => {},
        invoke: async () => {
          throw new Error("Runner container must not be invoked by outbound wrapper tests.");
        },
        readActiveRuntimeUserFence: async () => ({ active: true, attemptId: "attempt-1", leaseGeneration: "1", userId: "member_123" }),
        smokeHealth: async () => {
          throw new Error("Runner container smoke must not run in outbound wrapper tests.");
        },
      }),
      idFromString: (id: string) => id,
    },
    USER_RUNNER: {
      getByName: () => ({
        validateActiveRuntimeWriteFence: async (fenceInput: { userId: string }) => ({
          attemptId: "attempt_active_user_fence",
          leaseGeneration: "7",
          owns: true,
          userId: fenceInput.userId,
          workspaceVersion: "4",
        }),
        validateRuntimeProviderEgressToken: async () => ({ owns: false }),
        validateRuntimeWriteFence: async () => false,
      }),
    },
  };
}

describe("hosted-local test RunnerContainer outbound composition", () => {
  it("wraps only the transcribe host and keeps every other production handler untouched", () => {
    const wrapped = readHostedLocalTestOutboundByHost();

    expect(Object.keys(wrapped).sort()).toEqual(
      Object.keys(HOSTED_RUNNER_OUTBOUND_BY_HOST).sort(),
    );
    expect(wrapped).not.toBe(HOSTED_RUNNER_OUTBOUND_BY_HOST);
    for (const [host, handler] of Object.entries(HOSTED_RUNNER_OUTBOUND_BY_HOST)) {
      if (host === HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.transcribe) {
        expect(wrapped[host]).not.toBe(handler);
      } else {
        expect(wrapped[host]).toBe(handler);
      }
    }
  });

  it("keeps the hosted-local test composition out of the production worker entry graph", async () => {
    // @cloudflare/containers keys outboundByHost by class NAME, so importing
    // the hosted-local-test subclass anywhere in the production graph would
    // replace the production RunnerContainer registry entry with the
    // fake-AI-wrapped map. Pin that the production entry files never
    // reference the test composition.
    for (const sourcePath of ["../src/index.ts", "../src/runner-container.ts"]) {
      const source = await readFile(new URL(sourcePath, import.meta.url), "utf8");
      expect(source.includes("hosted-local-test"), sourcePath).toBe(false);
    }
  });

  it("injects the deterministic fake AI binding when env.AI is absent", async () => {
    const handler = readHostedLocalTestOutboundByHost()[
      HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.transcribe
    ];
    if (!handler) {
      throw new Error("Wrapped transcribe outbound handler is missing.");
    }

    const response = await handler(
      new Request(TRANSCRIBE_URL, {
        body: "wav-bytes",
        headers: { "content-type": "audio/wav" },
        method: "POST",
      }),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      durationMs: 2_500,
      language: "en",
      segments: [
        { endMs: 1_400, startMs: 0, text: "Remember to" },
        { endMs: 2_500, startMs: 1_400, text: "log the voice note" },
      ],
      text: "Remember to log the voice note",
    });
  });

  it("passes a configured env.AI binding through instead of the fake", async () => {
    const handler = readHostedLocalTestOutboundByHost()[
      HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.transcribe
    ];
    if (!handler) {
      throw new Error("Wrapped transcribe outbound handler is missing.");
    }
    const aiRun = vi.fn(async (model: string, payload: Record<string, unknown>) => {
      expect(model).toBe("@cf/openai/whisper-large-v3-turbo");
      expect(typeof payload.audio).toBe("string");
      return {
        segments: [],
        text: "Real binding transcript",
        transcription_info: { duration: 1, language: "en" },
      };
    });

    const response = await handler(
      new Request(TRANSCRIBE_URL, {
        body: "wav-bytes",
        method: "POST",
      }),
      createOutboundEnv({ AI: { run: aiRun } }),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      text: "Real binding transcript",
    });
    expect(aiRun).toHaveBeenCalledTimes(1);
  });

  it("rejects empty audio bodies instead of fabricating the canned transcript", async () => {
    const handler = readHostedLocalTestOutboundByHost()[
      HOSTED_RUNNER_DEFAULT_OUTBOUND_HOSTS.transcribe
    ];
    if (!handler) {
      throw new Error("Wrapped transcribe outbound handler is missing.");
    }

    const response = await handler(
      new Request(TRANSCRIBE_URL, { method: "POST" }),
      createOutboundEnv(),
      { containerId: "opaque-container-id" },
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Hosted transcription request body must include audio bytes.",
    );
  });
});
