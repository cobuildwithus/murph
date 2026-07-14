import {
  CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_CAPTURE_ID_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_KEY_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_SHA256_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";

import {
  json,
  jsonError,
  readRequestBodyBytes,
} from "../../json.ts";
import {
  createHostedMealPhotoStore,
  deleteHostedMealPhotoObject,
  HOSTED_MEAL_PHOTO_CONTENT_TYPE,
  HOSTED_MEAL_PHOTO_MAX_BYTES,
  requireHostedMealPhotoCaptureId,
  requireHostedMealPhotoKey,
  requireHostedMealPhotoSha256,
} from "../../meal-photo-store.ts";
import {
  resolveHostedExecutionUserCryptoContext,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  requireBoundInternalRouteUser,
} from "../auth.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";

export const mealPhotoRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "meal-photo-stage");
    },
    async handle(context, params) {
      return await handleMealPhotoStageRoute(context, params.userId);
    },
    match: (pathname) =>
      matchCloudflareHostedControlUserRoutePath("mealPhotoStage", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.mealPhotoStage.method],
    name: "meal-photo-stage",
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "meal-photo-delete");
    },
    async handle(context, params) {
      return await handleMealPhotoDeleteRoute(context, params.userId);
    },
    match: (pathname) =>
      matchCloudflareHostedControlUserRoutePath("mealPhotoDelete", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.mealPhotoDelete.method],
    name: "meal-photo-delete",
    wrongMethodResponse: "method-not-allowed",
  },
];

export async function handleMealPhotoDeleteRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  let mealPhotoKey: string;
  try {
    mealPhotoKey = requireHostedMealPhotoKey(
      context.request.headers.get(CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_KEY_HEADER) ?? "",
    );
  } catch {
    return jsonError("Meal photo key is invalid.", 400);
  }

  await deleteHostedMealPhotoObject({
    bucket: context.env.BUNDLES,
    mealPhotoKey,
    userId,
  });
  return json({ deleted: true });
}

export async function handleMealPhotoStageRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const contentType = context.request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== HOSTED_MEAL_PHOTO_CONTENT_TYPE) {
    return jsonError("Meal photo must use image/jpeg.", 415);
  }

  let captureId: string;
  let sha256: string;
  try {
    captureId = requireHostedMealPhotoCaptureId(
      context.request.headers.get(
        CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_CAPTURE_ID_HEADER,
      ) ?? "",
    );
    sha256 = requireHostedMealPhotoSha256(
      context.request.headers.get(
        CLOUDFLARE_HOSTED_CONTROL_MEAL_PHOTO_SHA256_HEADER,
      ) ?? "",
    );
  } catch {
    return jsonError("Meal photo request metadata is invalid.", 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = await readRequestBodyBytes(context.request, {
      limitBytes: HOSTED_MEAL_PHOTO_MAX_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError("Meal photo exceeds the 4 MiB limit.", 413);
    }
    throw error;
  }

  const store = await createMealPhotoStore(context, userId);

  try {
    return json(await store.stageMealPhoto({ bytes, captureId, sha256 }));
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return jsonError("Meal photo payload is invalid.", 400);
    }
    throw error;
  }
}

async function createMealPhotoStore(context: WorkerRouteContext, userId: string) {
  const crypto = await resolveHostedExecutionUserCryptoContext({
    bucket: context.env.BUNDLES,
    domain: "ingress",
    environment: context.environment,
    userId,
  });
  return createHostedMealPhotoStore({
    bucket: context.env.BUNDLES,
    keysById: crypto.keysById,
    resolveRootKeyById: crypto.resolveKeyById,
    rootKey: crypto.rootKey,
    rootKeyId: crypto.rootKeyId,
    userId,
  });
}
