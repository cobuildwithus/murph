import {
  CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_CAPTURE_ID_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_KEY_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_SHA256_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES,
} from "@murphai/hosted-execution/contracts";

import {
  createHostedEnvironmentVoiceStore,
  deleteHostedEnvironmentVoiceObject,
  HOSTED_ENVIRONMENT_VOICE_MAX_BYTES,
  requireHostedEnvironmentVoiceCaptureId,
  requireHostedEnvironmentVoiceKey,
  requireHostedEnvironmentVoiceSha256,
} from "../../environment-voice-store.ts";
import { json, jsonError, readRequestBodyBytes } from "../../json.ts";
import {
  resolveHostedExecutionUserCryptoContext,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import { requireBoundInternalRouteUser } from "../auth.ts";
import { decodeRouteParam } from "../route-utils/route-params.ts";
import type { DeclarativeRoute } from "../routes.ts";

export const environmentVoiceRoutes:
  readonly DeclarativeRoute<WorkerRouteContext>[] = [
    {
      authorizeBeforeMethod: true,
      authorization: "vercel-oidc",
      beforeMethod(context, params) {
        return requireBoundInternalRouteUser(
          context,
          params,
          "environment-voice-stage",
        );
      },
      async handle(context, params) {
        return await handleEnvironmentVoiceStageRoute(context, params.userId);
      },
      match: (pathname) =>
        matchCloudflareHostedControlUserRoutePath(
          "environmentVoiceStage",
          pathname,
        ),
      methods: [
        CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.environmentVoiceStage.method,
      ],
      name: "environment-voice-stage",
      wrongMethodResponse: "method-not-allowed",
    },
    {
      authorizeBeforeMethod: true,
      authorization: "vercel-oidc",
      beforeMethod(context, params) {
        return requireBoundInternalRouteUser(
          context,
          params,
          "environment-voice-delete",
        );
      },
      async handle(context, params) {
        return await handleEnvironmentVoiceDeleteRoute(context, params.userId);
      },
      match: (pathname) =>
        matchCloudflareHostedControlUserRoutePath(
          "environmentVoiceDelete",
          pathname,
        ),
      methods: [
        CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.environmentVoiceDelete.method,
      ],
      name: "environment-voice-delete",
      wrongMethodResponse: "method-not-allowed",
    },
  ];

export async function handleEnvironmentVoiceDeleteRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let audioKey: string;
  try {
    audioKey = requireHostedEnvironmentVoiceKey(
      context.request.headers.get(
        CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_KEY_HEADER,
      ) ?? "",
    );
  } catch {
    return jsonError("Environment voice key is invalid.", 400);
  }
  await deleteHostedEnvironmentVoiceObject({
    audioKey,
    bucket: context.env.BUNDLES,
    userId,
  });
  return json({ deleted: true });
}

export async function handleEnvironmentVoiceStageRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const requestedContentType = context.request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const contentType = HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES.find(
    (candidate) => candidate === requestedContentType,
  );
  if (!contentType) {
    return jsonError("Environment voice format is unsupported.", 415);
  }

  let captureId: string;
  let sha256: string;
  try {
    captureId = requireHostedEnvironmentVoiceCaptureId(
      context.request.headers.get(
        CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_CAPTURE_ID_HEADER,
      ) ?? "",
    );
    sha256 = requireHostedEnvironmentVoiceSha256(
      context.request.headers.get(
        CLOUDFLARE_HOSTED_CONTROL_ENVIRONMENT_VOICE_SHA256_HEADER,
      ) ?? "",
    );
  } catch {
    return jsonError("Environment voice request metadata is invalid.", 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = await readRequestBodyBytes(context.request, {
      limitBytes: HOSTED_ENVIRONMENT_VOICE_MAX_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError("Environment voice exceeds the 3 MiB limit.", 413);
    }
    throw error;
  }

  const crypto = await resolveHostedExecutionUserCryptoContext({
    bucket: context.env.BUNDLES,
    domain: "ingress",
    environment: context.environment,
    userId,
  });
  const store = createHostedEnvironmentVoiceStore({
    bucket: context.env.BUNDLES,
    keysById: crypto.keysById,
    resolveRootKeyById: crypto.resolveKeyById,
    rootKey: crypto.rootKey,
    rootKeyId: crypto.rootKeyId,
    userId,
  });
  try {
    return json(await store.stageAudio({ bytes, captureId, sha256 }));
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return jsonError("Environment voice payload is invalid.", 400);
    }
    throw error;
  }
}
