import "server-only";

import { readCloudflareHostedControlHttpError } from "@murphai/cloudflare-hosted-control/client";

/**
 * A log-safe stage for a failed saved-replica read: the control HTTP status
 * and code, or the error class. Never the message, which can carry signed
 * URLs, private paths or decrypt details.
 */
export function describeCompanionProjectionFailure(error: unknown): string {
  const control = readCloudflareHostedControlHttpError(error);
  if (control) return `control_${control.status}_${control.code ?? "none"}`;
  return error instanceof Error ? error.name : typeof error;
}
