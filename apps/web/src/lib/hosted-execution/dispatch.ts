import { createHmac } from "node:crypto";

import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  type HostedExecutionDispatchRequest,
} from "@healthybob/runtime-state";

import { readHostedExecutionDispatchEnvironment } from "./env";

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
  });

  if (!response.ok) {
    throw new Error(`Hosted execution dispatch failed with HTTP ${response.status}.`);
  }

  return {
    dispatched: true,
  };
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
