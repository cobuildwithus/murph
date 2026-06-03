import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import {
  json,
} from "../json.ts";
import {
  buildWorkerRouteLogDetails,
} from "./route-utils/log-details.ts";

export function mapWorkerRouteError(request: Request, error: unknown): Response {
  emitHostedExecutionStructuredLog({
    component: "worker",
    details: buildWorkerRouteLogDetails({
      reason: "route-handler-threw",
    }, request),
    error,
    level: "error",
    message: "Hosted worker route failed.",
    phase: "failed",
  });
  const classified = classifyPublicRouteError(error);
  return json({ error: classified.error }, classified.status);
}

export function classifyPublicRouteError(error: unknown): { error: string; status: number } {
  if (error instanceof SyntaxError) {
    return { error: "Invalid JSON.", status: 400 };
  }
  if (error instanceof TypeError || error instanceof RangeError || error instanceof URIError) {
    return { error: "Invalid request.", status: 400 };
  }
  return { error: "Internal error.", status: 500 };
}
