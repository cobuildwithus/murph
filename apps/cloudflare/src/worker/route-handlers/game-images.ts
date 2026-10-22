import { CLOUDFLARE_HOSTED_CONTROL_GAME_MEDIA_ID_HEADER, CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath } from "@murphai/cloudflare-hosted-control/routes";
import { createGameImageStore } from "../../game-image-store.ts";
import { json, jsonError, readRequestBodyBytes } from "../../json.ts";
import { requireHostedGameMediaId } from "../../storage-paths.ts";
import type { WorkerRouteContext } from "../../worker-routes/shared.ts";
import { requireBoundInternalRouteUser } from "../auth.ts";
import type { DeclarativeRoute } from "../routes.ts";
import { decodeRouteParam } from "../route-utils/route-params.ts";

const NAMES = ["gameImageStage", "gameImageDelivery", "gameImageStat"] as const;

/** Only Web can stage images or request a capability, after applying the
 * current viewer/game authorization. No client chooses an Images provider ID.
 */
export const gameImageRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = NAMES.map((name) => ({
  authorizeBeforeMethod: true,
  authorization: "vercel-oidc",
  beforeMethod: (context, params) => requireBoundInternalRouteUser(context, params, name),
  handle: (context, params) => handle(context, decodeRouteParam(params.userId), name),
  match: (pathname) => matchCloudflareHostedControlUserRoutePath(name, pathname),
  methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS[name].method],
  name,
  wrongMethodResponse: "method-not-allowed",
}));

async function handle(context: WorkerRouteContext, userId: string, operation: typeof NAMES[number]): Promise<Response> {
  let mediaId: string;
  try { mediaId = requireHostedGameMediaId(context.request.headers.get(CLOUDFLARE_HOSTED_CONTROL_GAME_MEDIA_ID_HEADER) ?? ""); }
  catch { return jsonError("Game image id is invalid.", 400); }
  if (!context.env.GAME_IMAGES) return jsonError("Game image storage is unavailable.", 503);
  const store = createGameImageStore({ bucket: context.env.BUNDLES, images: context.env.GAME_IMAGES, userId,
    deploymentOrigin: context.env.CF_PUBLIC_BASE_URL ?? "" });
  if (operation === "gameImageStage") {
    const type = context.request.headers.get("content-type");
    if (type !== "image/jpeg" && type !== "image/heic") return jsonError("Game image type is invalid.", 400);
    if ((type === "image/jpeg") !== mediaId.endsWith(".jpg")) return jsonError("Game image type does not match.", 400);
    let bytes: Uint8Array;
    try { bytes = await readRequestBodyBytes(context.request, { limitBytes: 4 * 1024 * 1024 }); }
    catch (error) {
      if (error instanceof RangeError) return jsonError("Game image is too large.", 413);
      throw error;
    }
    if (bytes.length === 0) return jsonError("Game image is empty.", 400);
    try { await store.upload(mediaId, bytes); }
    catch (error) {
      if (error instanceof TypeError) return jsonError("Game image is invalid.", 400);
      throw new Error("Game image staging failed.");
    }
    return json({ stored: true });
  }
  if (operation === "gameImageStat") {
    const result = await store.stat(mediaId);
    return result ? json(result) : jsonError("Game image not found.", 404);
  }
  const variant = context.request.headers.get("x-murph-image-variant");
  if (variant !== "avatar" && variant !== "photo") return jsonError("Game image variant is invalid.", 400);
  try {
    const result = await store.delivery(mediaId, variant);
    return result ? new Response(JSON.stringify(result), { headers: {
      "cache-control": "private, no-store", "content-type": "application/json", "referrer-policy": "no-referrer",
    } }) : jsonError("Game image not found.", 404);
  } catch { throw new Error("Game image delivery failed."); }
}

