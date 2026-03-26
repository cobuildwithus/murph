import { createHmac } from "node:crypto";

import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  type HostedExecutionDispatchRequest,
} from "@healthybob/runtime-state";

import { readHostedExecutionDispatchEnvironment } from "./env";

const HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS = 2_000;

export async function dispatchHostedExecution(
  input: HostedExecutionDispatchRequest,
): Promise<{ dispatched: boolean; reason?: string }> {
  const environment = readHostedExecutionDispatchEnvironment();

  if (!environment.dispatchUrl || !environment.signingSecret) {
    return {
      dispatched: false,
      reason: "not-configured",
    };
  }

  const payload = JSON.stringify(input);
  const signature = createExecutionSignature({
    payload,
    secret: environment.signingSecret,
    timestamp: input.occurredAt,
  });
  const response = await fetch(`${environment.dispatchUrl}/internal/dispatch`, {
    body: payload,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [HOSTED_EXECUTION_SIGNATURE_HEADER]: signature,
      [HOSTED_EXECUTION_TIMESTAMP_HEADER]: input.occurredAt,
    },
    method: "POST",
    signal: AbortSignal.timeout(HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Hosted execution dispatch failed with HTTP ${response.status}.`);
  }

  return {
    dispatched: true,
  };
}

export async function dispatchHostedExecutionBestEffort(
  input: HostedExecutionDispatchRequest,
  options: {
    context?: string;
  } = {},
): Promise<{ dispatched: boolean; reason?: string }> {
  try {
    return await dispatchHostedExecution(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      options.context ? `Hosted execution dispatch failed (${options.context}).` : "Hosted execution dispatch failed.",
      message,
    );
    return {
      dispatched: false,
      reason: "dispatch-failed",
    };
  }
}

function createExecutionSignature(input: {
  payload: string;
  secret: string;
  timestamp: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.payload}`)
    .digest("hex");
}
