import { isRequestInputError, RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import {
  json, InvalidJsonInputError,
} from "../json.ts";

import {
  buildWorkerRouteLogDetails,
} from "./route-utils/log-details.ts";

export function mapWorkerRouteError(request: Request, error: unknown): Response {

  const classified = classifyPublicRouteError(error);
  emitHostedExecutionStructuredLog({
    component: "worker",
    details: buildWorkerRouteLogDetails({ reason: "route-handler-threw" }, request),
    error,
    level: classified.status >= 500 ? "error" : "warn",
    message: "Hosted worker route failed.",
    phase: "failed",
  });
  return json({ error: classified.error }, classified.status);
}

export function classifyPublicRouteError(error: unknown): { error: string; status: number } {

  if (error instanceof InvalidJsonInputError) {
    return { error: "Invalid JSON.", status: 400 };
  }
  if (isRequestInputError(error) || error instanceof RequestBodyTooLargeError) {
    return { error: "Invalid request.", status: 400 };
  }
  return { error: "Internal error.", status: 500 };
}
