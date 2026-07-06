import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  verifyHostedExecutionVercelOidcRequest,
} from "../auth-adapter.ts";
import {
  json,
  jsonError,
  unauthorized,
} from "../json.ts";
import {
  verifyHostedWebCallbackSignatureHeaders,
} from "../web-callback-auth.ts";
import {
  readCachedRequestText,
  type WorkerRouteContext,
} from "../worker-routes/shared.ts";
import type {
  RouteParams,
  WorkerRouteAuthorization,
} from "./routes.ts";
import {
  buildWorkerRouteLogDetails,
} from "./route-utils/log-details.ts";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  readHostedExecutionBoundUserIdHeader,
} from "./route-utils/bound-user-header.ts";
import {
  isRequestBodyTooLargeError,
} from "./route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "./route-utils/route-params.ts";

export async function authorizeRoute(
  authorization: WorkerRouteAuthorization,
  context: { request: Request } & Partial<WorkerRouteContext>,
  routeName: string,
  options: {
    signatureBodyLimitBytes?: number;
  } = {},
): Promise<Response | null> {
  switch (authorization) {
    case "web-callback-signature": {
      const callbackSigning = context.environment?.webCallbackSigning;
      const url = context.url;
      if (!callbackSigning || !url) {
        emitHostedExecutionStructuredLog({
          component: "worker",
          details: buildWorkerRouteLogDetails({
            authScheme: "web-callback-signature",
            reason: "missing-callback-signing-environment",
            routeName,
          }, context.request),
          level: "warn",
          message: "Hosted worker route rejected an internal request before auth because callback signing is unavailable.",
          phase: "failed",
        });
        return unauthorized();
      }

      if (options.signatureBodyLimitBytes === undefined) {
        throw new TypeError(
          `Hosted worker route ${routeName} is missing a signature body limit.`,
        );
      }

      let payload: string;
      try {
        payload = await readCachedRequestText(context, {
          limitBytes: options.signatureBodyLimitBytes,
        });
      } catch (error) {
        if (isRequestBodyTooLargeError(error)) {
          return jsonError("Request body too large.", 413);
        }

        throw error;
      }
      const verified = await verifyHostedWebCallbackSignatureHeaders({
        environment: callbackSigning,
        method: context.request.method,
        path: url.pathname,
        payload,
        request: context.request,
        search: url.search,
        userId: readOptionalHostedExecutionUserIdHeader(context.request),
      });

      if (verified) {
        return null;
      }

      emitHostedExecutionStructuredLog({
        component: "worker",
        details: buildWorkerRouteLogDetails({
          authScheme: "web-callback-signature",
          reason: "callback-signature-verification-failed",
          routeName,
        }, context.request),
        level: "warn",
        message: "Hosted worker route rejected an internal request after callback signature verification failed.",
        phase: "failed",
      });
      return unauthorized();
    }
    case "web-callback-signature-or-vercel-oidc": {
      // Dispatch on the credential the caller presented; never fall through
      // from a failed signature to OIDC (or vice versa), so a bad credential
      // of either kind stays fail-closed.
      return authorizeRoute(
        readPresentedWorkerRouteAuthorization(context.request),
        context,
        routeName,
        options,
      );
    }
    case "vercel-oidc": {
      const validation = context.environment?.vercelOidcValidation;
      if (!validation) {
        emitHostedExecutionStructuredLog({
          component: "worker",
          details: buildWorkerRouteLogDetails({
            authScheme: "vercel-oidc",
            reason: "missing-vercel-oidc-validation",
            routeName,
          }, context.request),
          level: "warn",
          message: "Hosted worker route rejected an internal request before auth because OIDC validation is unavailable.",
          phase: "failed",
        });
        return unauthorized();
      }
      const verified = await verifyHostedExecutionVercelOidcRequest({
        request: context.request,
        validation,
      });

      if (verified) {
        return null;
      }

      emitHostedExecutionStructuredLog({
        component: "worker",
        details: buildWorkerRouteLogDetails({
          authScheme: "vercel-oidc",
          reason: "vercel-oidc-verification-failed",
          routeName,
        }, context.request),
        level: "warn",
        message: "Hosted worker route rejected an internal request after OIDC verification failed.",
        phase: "failed",
      });
      return unauthorized();
    }
    default:
      return null;
  }
}

// For dual-scheme routes: which concrete credential the caller presented.
// The signature header wins so orchestrator-signed requests keep their exact
// current semantics; a request without it is authorized as web-plane OIDC.
export function readPresentedWorkerRouteAuthorization(
  request: Request,
): "vercel-oidc" | "web-callback-signature" {
  return request.headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER) !== null
    ? "web-callback-signature"
    : "vercel-oidc";
}

export function requireBoundInternalRouteUser(
  context: Pick<WorkerRouteContext, "request">,
  params: RouteParams,
  routeName: string,
): Response | null {
  return requireHostedExecutionBoundUserResponse(
    context.request,
    decodeRouteParam(params.userId),
    "Hosted execution bound user does not match the route user.",
    "bound-user-mismatch",
    routeName,
  );
}

export function requireHostedExecutionBoundUserResponse(
  request: Request,
  expectedUserId: string,
  mismatchMessage: string,
  reason: string,
  routeName: string,
): Response | null {
  const boundUserId = readHostedExecutionBoundUserId(request);

  if (!boundUserId) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        boundUserId: null,
        reason: "missing-bound-user-header",
        routeName,
        userId: expectedUserId,
      }, request, expectedUserId),
      level: "warn",
      message: "Hosted worker route rejected a request without the bound-user header.",
      phase: "failed",
      userId: expectedUserId,
    });
    return json({
      error: `${HOSTED_EXECUTION_USER_ID_HEADER} header is required for hosted execution user-bound control routes.`,
    }, 401);
  }

  if (boundUserId !== expectedUserId) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        boundUserId,
        reason,
        routeName,
        userId: expectedUserId,
      }, request, expectedUserId),
      level: "warn",
      message: "Hosted worker route rejected a request because the bound user did not match the route user.",
      phase: "failed",
      userId: expectedUserId,
    });
    return json({
      error: mismatchMessage,
    }, 401);
  }

  return null;
}

export function readHostedExecutionBoundUserId(request: Request): string | null {
  return readHostedExecutionBoundUserIdHeader(request);
}

export function readOptionalHostedExecutionUserIdHeader(request: Request): string | null {
  return readHostedExecutionBoundUserId(request);
}
