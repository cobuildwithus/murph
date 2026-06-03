import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";

export { HOSTED_EXECUTION_USER_ID_HEADER };

export function readHostedExecutionBoundUserIdHeader(request: Request): string | null {
  const value = request.headers.get(HOSTED_EXECUTION_USER_ID_HEADER);

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
