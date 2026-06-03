import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import {
  methodNotAllowed,
  notFound,
} from "../json.ts";
import type {
  WorkerRouteContext,
} from "../worker-routes/shared.ts";
import {
  authorizeRoute,
} from "./auth.ts";
import {
  buildWorkerRouteLogDetails,
} from "./route-utils/log-details.ts";

export type RouteParams = Readonly<Record<string, string>>;
export type RouteMatcher = (pathname: string) => RouteParams | null;
export type WorkerRouteAuthorization =
  | "vercel-oidc"
  | "web-callback-signature"
  | null;
export type WrongMethodResponse = "method-not-allowed" | "not-found";

export interface DeclarativeRoute<Context> {
  authorizeBeforeMethod?: boolean;
  authorization?: WorkerRouteAuthorization;
  beforeMethod?(context: Context, params: RouteParams): Promise<Response | null> | Response | null;
  handle(context: Context, params: RouteParams): Promise<Response> | Response;
  match: RouteMatcher;
  methods: readonly string[];
  name: string;
  wrongMethodResponse?: WrongMethodResponse;
}

export async function handleDeclarativeRoute<Context>(
  routes: readonly DeclarativeRoute<Context>[],
  context: Context & { request: Request; url: URL },
): Promise<Response | null> {
  for (const route of routes) {
    const params = route.match(context.url.pathname);
    if (!params) {
      continue;
    }

    const authorizationContext = context as { request: Request } & Partial<WorkerRouteContext>;
    if (route.authorizeBeforeMethod) {
      const authorizationError = await authorizeRoute(route.authorization ?? null, authorizationContext, route.name);
      if (authorizationError) {
        return authorizationError;
      }
    }

    if (!route.methods.includes(context.request.method)) {
      emitHostedExecutionStructuredLog({
        component: "worker",
        details: buildWorkerRouteLogDetails({
          reason: "wrong-method",
          routeName: route.name,
        }, context.request),
        level: "warn",
        message: "Hosted worker route rejected an unsupported method.",
        phase: "failed",
      });
      return respondToWrongMethod(route.wrongMethodResponse ?? "not-found");
    }

    const preMethodResponse = await route.beforeMethod?.(context, params);
    if (preMethodResponse) {
      return preMethodResponse;
    }

    if (!route.authorizeBeforeMethod) {
      const authorizationError = await authorizeRoute(route.authorization ?? null, authorizationContext, route.name);
      if (authorizationError) {
        return authorizationError;
      }
    }

    return route.handle(context, params);
  }

  return null;
}

export function matchExactPath(...paths: readonly string[]): RouteMatcher {
  const allowedPaths = new Set(paths);
  return (pathname) => (allowedPaths.has(pathname) ? {} : null);
}

export function matchTestUserRoute(prefix: string, suffix: string): RouteMatcher {
  return (pathname) => {
    if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
      return null;
    }

    const userId = pathname.slice(prefix.length, pathname.length - suffix.length);
    return userId.length > 0 ? { userId } : null;
  };
}

export function respondToWrongMethod(response: WrongMethodResponse): Response {
  return response === "method-not-allowed" ? methodNotAllowed() : notFound();
}
