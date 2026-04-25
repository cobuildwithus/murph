import {
  type HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  gatewayProjectionSnapshotSchema,
} from "@murphai/gateway-core";
import {
  parseHostedAssistantDeliveryEffects,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionRunnerResult,
} from "@murphai/hosted-execution/parsers";

import {
  assertHostedBundlePayloadArchiveValid,
  assertHostedBundlePayloadArchiveValidAsync,
  type HostedBundleArchiveValidationOperation,
} from "./hosted-bundle-validation.ts";

export function assertHostedAssistantRuntimeJobResult(
  value: unknown,
  options: {
    bundleArchiveOperation?: HostedBundleArchiveValidationOperation;
  } = {},
): asserts value is HostedAssistantRuntimeJobResult {
  const record = requireRecord(value, "Hosted assistant runtime job result");
  const phase = record.phase ?? "completed";

  if (phase !== "completed" && phase !== "prepared") {
    throw new TypeError("Hosted assistant runtime job result.phase must be completed or prepared.");
  }

  const runnerResult = parseHostedExecutionRunnerResult(record.result);
  assertHostedBundlePayloadArchiveValid({
    bundle: runnerResult.bundle,
    expectedKind: "vault",
    operation: options.bundleArchiveOperation ?? "runner-output",
  });

  if (phase === "prepared") {
    parseHostedAssistantDeliveryEffectList(record.committedAssistantDeliveryEffects);
    parseGatewayProjectionSnapshotOrNull(
      record.committedGatewayProjectionSnapshot,
      "Hosted assistant runtime prepared job result.committedGatewayProjectionSnapshot",
    );

    if (
      record.finalGatewayProjectionSnapshot !== undefined
      && record.finalGatewayProjectionSnapshot !== null
    ) {
      throw new TypeError(
        "Hosted assistant runtime prepared job result.finalGatewayProjectionSnapshot must be null when present.",
      );
    }
    return;
  }

  parseGatewayProjectionSnapshotOrNull(
    record.finalGatewayProjectionSnapshot,
    "Hosted assistant runtime completed job result.finalGatewayProjectionSnapshot",
  );
}

export async function assertHostedAssistantRuntimeJobResultAsync(
  value: unknown,
  options: {
    bundleArchiveOperation?: HostedBundleArchiveValidationOperation;
  } = {},
): Promise<HostedAssistantRuntimeJobResult> {
  const runnerResult = assertHostedAssistantRuntimeJobResultShape(value);
  await assertHostedBundlePayloadArchiveValidAsync({
    bundle: runnerResult.bundle,
    expectedKind: "vault",
    operation: options.bundleArchiveOperation ?? "runner-output",
  });

  return value as HostedAssistantRuntimeJobResult;
}

function assertHostedAssistantRuntimeJobResultShape(
  value: unknown,
): ReturnType<typeof parseHostedExecutionRunnerResult> {
  const record = requireRecord(value, "Hosted assistant runtime job result");
  const phase = record.phase ?? "completed";

  if (phase !== "completed" && phase !== "prepared") {
    throw new TypeError("Hosted assistant runtime job result.phase must be completed or prepared.");
  }

  const runnerResult = parseHostedExecutionRunnerResult(record.result);

  if (phase === "prepared") {
    parseHostedAssistantDeliveryEffectList(record.committedAssistantDeliveryEffects);
    parseGatewayProjectionSnapshotOrNull(
      record.committedGatewayProjectionSnapshot,
      "Hosted assistant runtime prepared job result.committedGatewayProjectionSnapshot",
    );

    if (
      record.finalGatewayProjectionSnapshot !== undefined
      && record.finalGatewayProjectionSnapshot !== null
    ) {
      throw new TypeError(
        "Hosted assistant runtime prepared job result.finalGatewayProjectionSnapshot must be null when present.",
      );
    }
    return runnerResult;
  }

  parseGatewayProjectionSnapshotOrNull(
    record.finalGatewayProjectionSnapshot,
    "Hosted assistant runtime completed job result.finalGatewayProjectionSnapshot",
  );
  return runnerResult;
}

function parseHostedAssistantDeliveryEffectList(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new TypeError(
      "Hosted assistant runtime prepared job result.committedAssistantDeliveryEffects must be an array.",
    );
  }

  parseHostedAssistantDeliveryEffects(value);
}

function parseGatewayProjectionSnapshotOrNull(
  value: unknown,
  label: string,
): void {
  if (value === null) {
    return;
  }

  if (value === undefined) {
    throw new TypeError(`${label} is required.`);
  }

  gatewayProjectionSnapshotSchema.parse(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}
