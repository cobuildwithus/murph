import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";

import type {
  HostedAssistantRuntimeJobResult,
} from "./models.ts";

export interface HostedAssistantRuntimeChildResult {
  ok: boolean;
  error?: {
    code?: string | null;
    message: string;
    name?: string | null;
    stack?: string | null;
  };
  result?: HostedAssistantRuntimeJobResult;
}

const HOSTED_RUNTIME_CHILD_RESULT_PREFIX = "__HB_ASSISTANT_RUNTIME_RESULT__";

export function createHostedRuntimeChildError(
  error: HostedAssistantRuntimeChildResult["error"] | undefined,
  code: number | null,
): Error {
  const message = error?.message
    ?? `Hosted assistant runtime child exited with code ${code ?? "unknown"}.`;

  if (error?.name === "HostedAssistantConfigurationError") {
    const classified = new HostedAssistantConfigurationError(
      error.code === "HOSTED_ASSISTANT_CONFIG_REQUIRED"
        ? "HOSTED_ASSISTANT_CONFIG_REQUIRED"
        : "HOSTED_ASSISTANT_CONFIG_INVALID",
      message,
    );
    classified.stack = error.stack ?? classified.stack;
    return classified;
  }

  const untyped = new Error(message);
  if (error?.name) {
    untyped.name = error.name;
  }
  if (error?.stack) {
    untyped.stack = error.stack;
  }
  return untyped;
}

export function formatHostedRuntimeChildResult(
  payload: HostedAssistantRuntimeChildResult,
): string {
  return `${HOSTED_RUNTIME_CHILD_RESULT_PREFIX}${Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64")}`;
}

export function parseHostedRuntimeChildResult(output: string): HostedAssistantRuntimeChildResult {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const encoded = [...lines]
    .reverse()
    .find((line) => line.startsWith(HOSTED_RUNTIME_CHILD_RESULT_PREFIX));

  if (!encoded) {
    throw new Error("Hosted assistant runtime child did not emit a result payload.");
  }

  return JSON.parse(
    Buffer.from(
      encoded.slice(HOSTED_RUNTIME_CHILD_RESULT_PREFIX.length),
      "base64",
    ).toString("utf8"),
  ) as HostedAssistantRuntimeChildResult;
}
