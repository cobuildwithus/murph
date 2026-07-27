import { parseHostedExecutionDeviceSyncWakeHint as parseOwnedHostedExecutionDeviceSyncWakeHint } from "@murphai/device-syncd/hosted-runtime";

import type {
  HostedExecutionDeviceSyncWakeEvent,
} from "../contracts.ts";

import { requireString } from "./assertions.ts";

export function parseHostedExecutionDeviceSyncExpectedConnectedAt(
  value: unknown,
  label: string,
): string {
  const timestamp = requireString(value, label);
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new TypeError(
      `${label} must be a valid ISO-8601 timestamp in canonical UTC form.`,
    );
  }

  return timestamp;
}

export function parseHostedExecutionDeviceSyncWakeHint(
  value: unknown,
): HostedExecutionDeviceSyncWakeEvent["hint"] {
  return parseOwnedHostedExecutionDeviceSyncWakeHint(value);
}

export function parseHostedExecutionDeviceSyncReason(
  value: unknown,
): HostedExecutionDeviceSyncWakeEvent["reason"] {
  const reason = requireString(value, "Hosted execution device-sync.wake reason");

  if (
    reason === "connected"
    || reason === "webhook_hint"
    || reason === "disconnected"
    || reason === "reauthorization_required"
    || reason === "reconcile_due"
  ) {
    return reason;
  }

  throw new TypeError(`Unsupported hosted execution device-sync.wake reason: ${reason}`);
}
