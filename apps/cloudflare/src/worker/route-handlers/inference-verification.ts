import {
  CLOUDFLARE_HOSTED_INFERENCE_VERIFICATION_BODY_MAX_BYTES,
  parseCloudflareHostedInferenceVerificationRequest,
} from "@murphai/cloudflare-hosted-control/inference-verification";
import {
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";

import {
  HostedInferenceVerificationError,
  verifyHostedInferenceConnection,
} from "../../hosted-inference-verification.ts";
import {
  json,
  requireJsonObject,
} from "../../json.ts";
import {
  readCachedRequestText,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  requireBoundInternalRouteUser,
} from "../auth.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";

const inferenceVerificationRoute = {
  authorizeBeforeMethod: true,
  authorization: "vercel-oidc",
  beforeMethod(context, params) {
    return requireBoundInternalRouteUser(
      context,
      params,
      "inference-verification",
    );
  },
  async handle(context) {
    try {
      const payload = await readCachedRequestText(context, {
        limitBytes: CLOUDFLARE_HOSTED_INFERENCE_VERIFICATION_BODY_MAX_BYTES,
      });
      const request = parseCloudflareHostedInferenceVerificationRequest(
        requireJsonObject(JSON.parse(payload)),
      );
      return json(await verifyHostedInferenceConnection({ request }));
    } catch (error) {
      if (
        error instanceof HostedInferenceVerificationError
        || error instanceof TypeError
        || error instanceof RangeError
        || error instanceof SyntaxError
      ) {
        return json({
          error: {
            code: "HOSTED_INFERENCE_VERIFICATION_FAILED",
            message:
              "The custom inference endpoint did not pass Murph verification.",
          },
        }, 422);
      }
      throw error;
    }
  },
  match: (pathname) =>
    matchCloudflareHostedControlUserRoutePath(
      "inferenceVerification",
      pathname,
    ),
  methods: [
    CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.inferenceVerification.method,
  ],
  name: "inference-verification",
  wrongMethodResponse: "method-not-allowed",
} satisfies DeclarativeRoute<WorkerRouteContext>;

export const inferenceVerificationRoutes = [
  inferenceVerificationRoute,
] as const;
