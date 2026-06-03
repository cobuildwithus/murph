import {
  readHostedExecutionBoundUserIdHeader,
} from "./bound-user-header.ts";

export function buildWorkerRouteLogDetails(
  input: {
    authScheme?: string | null;
    boundUserId?: string | null;
    reason: string;
    routeName?: string | null;
    targetHost?: string | null;
    userId?: string | null;
  },
  request: Request,
  userId?: string | null,
): Record<string, string> {
  const url = new URL(request.url);
  const boundUserId = input.boundUserId ?? readHostedExecutionBoundUserIdHeader(request);
  return {
    ...(input.authScheme ? { authScheme: input.authScheme } : {}),
    ...(boundUserId ? { boundUserId } : {}),
    host: url.host,
    method: request.method,
    pathname: redactWorkerRoutePathname(url.pathname),
    reason: input.reason,
    ...(input.routeName ? { routeName: input.routeName } : {}),
    ...(input.targetHost ? { targetHost: input.targetHost } : {}),
    ...(input.userId ?? userId ? { userId: input.userId ?? userId ?? "" } : {}),
  };
}

export function redactWorkerRoutePathname(pathname: string): string {
  return pathname.replace(
    /^\/internal\/users\/[^/]+(?=\/|$)/u,
    "/internal/users/<REDACTED_USER>",
  );
}
