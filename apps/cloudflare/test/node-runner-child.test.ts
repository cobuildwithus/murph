import { afterEach, describe, expect, it, vi } from "vitest";

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
  parseHostedRuntimeChildResult,
} from "@murphai/assistant-runtime";

import {
  runHostedExecutionChild,
} from "../src/node-runner-child.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("runHostedExecutionChild", () => {
  it("logs and writes a stable bootstrap failure result for invalid JSON input", async () => {
    const stdout = { write: vi.fn() };
    const setExitCode = vi.fn();

    await runHostedExecutionChild({
      readStandardInput: async () => "{not-json",
      setExitCode,
      stdout,
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "child",
        details: expect.objectContaining({
          bootstrapStage: "parse",
        }),
        level: "error",
        message: "Hosted node runner child failed to parse its bootstrap payload.",
        phase: "failed",
      }),
    );
    expect(setExitCode).toHaveBeenCalledWith(1);

    const payload = readChildResult(stdout.write.mock.calls[0]?.[0]);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "syntax_error",
          message: "Hosted node runner child bootstrap payload is invalid.",
        }),
      }),
    );
  });

  it("logs and writes a stable bootstrap failure result for validation failures", async () => {
    const stdout = { write: vi.fn() };
    const setExitCode = vi.fn();

    await runHostedExecutionChild({
      readStandardInput: async () => JSON.stringify({
        internalWorkerProxyToken: "proxy-token",
        job: {
          request: null,
        },
      }),
      setExitCode,
      stdout,
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "child",
        details: expect.objectContaining({
          bootstrapStage: "parse",
        }),
        level: "error",
        message: "Hosted node runner child failed to parse its bootstrap payload.",
        phase: "failed",
      }),
    );
    expect(setExitCode).toHaveBeenCalledWith(1);

    const payload = readChildResult(stdout.write.mock.calls[0]?.[0]);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "type_error",
          message: "Hosted node runner child bootstrap payload is invalid.",
        }),
      }),
    );
  });
});

function readChildResult(chunk: unknown) {
  if (typeof chunk !== "string") {
    throw new Error("Expected the child to write a result payload.");
  }

  return parseHostedRuntimeChildResult(chunk);
}
