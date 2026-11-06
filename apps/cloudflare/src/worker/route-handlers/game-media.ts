import {
  CLOUDFLARE_HOSTED_CONTROL_GAME_MEDIA_ID_HEADER,
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
  type CloudflareHostedControlUserRouteName,
} from "@murphai/cloudflare-hosted-control/routes";

import { json, jsonError, readRequestBodyText } from "../../json.ts";
import {
  createHostedGameMediaStore,
  HOSTED_GAME_MEDIA_MAX_ENVELOPE_BYTES,
  requireHostedGameMediaEnvelope,
  type HostedGameMediaStore,
} from "../../game-media-store.ts";
import { requireHostedGameMediaId } from "../../storage-paths.ts";
import type { WorkerRouteContext } from "../../worker-routes/shared.ts";
import { requireBoundInternalRouteUser } from "../auth.ts";
import type { DeclarativeRoute } from "../routes.ts";
import { decodeRouteParam } from "../route-utils/route-params.ts";

type GameMediaRouteName = Extract<
  CloudflareHostedControlUserRouteName,
  "gameMediaDelete" | "gameMediaRead" | "gameMediaStage" | "gameMediaStat"
>;

type GameMediaHandler = (
  context: WorkerRouteContext,
  store: HostedGameMediaStore,
  mediaId: string,
) => Promise<Response>;

/** Web-only, bound to the photo owner: the same Vercel OIDC guard as the other user routes. */
function gameMediaRoute(routeName: GameMediaRouteName, name: string, handle: GameMediaHandler): DeclarativeRoute<WorkerRouteContext> {
  return {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod: (context, params) => requireBoundInternalRouteUser(context, params, name),
    handle: (context, params) => handleGameMediaRoute(context, params.userId, handle),
    match: (pathname) => matchCloudflareHostedControlUserRoutePath(routeName, pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS[routeName].method],
    name,
    wrongMethodResponse: "method-not-allowed",
  };
}

export const gameMediaRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  gameMediaRoute("gameMediaStage", "game-media-stage", stageGameMedia),
  gameMediaRoute("gameMediaRead", "game-media-read", readGameMedia),
  gameMediaRoute("gameMediaStat", "game-media-stat", statGameMedia),
  gameMediaRoute("gameMediaDelete", "game-media-delete", deleteGameMedia),
];

export async function handleGameMediaRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
  handle: GameMediaHandler,
): Promise<Response> {
  let mediaId: string;
  try {
    mediaId = requireHostedGameMediaId(
      context.request.headers.get(CLOUDFLARE_HOSTED_CONTROL_GAME_MEDIA_ID_HEADER) ?? "",
    );
  } catch {
    return jsonError("Game media id is invalid.", 400);
  }
  const store = createHostedGameMediaStore({
    bucket: context.env.BUNDLES,
    userId: decodeRouteParam(encodedUserId),
  });
  return await handle(context, store, mediaId);
}

async function stageGameMedia(context: WorkerRouteContext, store: HostedGameMediaStore, mediaId: string) {
  let envelope: string;
  try {
    envelope = requireHostedGameMediaEnvelope(
      await readRequestBodyText(context.request, { limitBytes: HOSTED_GAME_MEDIA_MAX_ENVELOPE_BYTES }),
    );
  } catch (error) {
    if (error instanceof RangeError) return jsonError("Game media is too large.", 413);
    if (error instanceof TypeError) return jsonError("Game media must be sealed.", 400);
    throw error;
  }
  return json({ stored: true, ...(await store.write(mediaId, envelope)) });
}

async function readGameMedia(_context: WorkerRouteContext, store: HostedGameMediaStore, mediaId: string) {
  const envelope = await store.read(mediaId);
  if (envelope === null) return jsonError("Game media not found.", 404);
  return new Response(envelope, {
    headers: { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8" },
  });
}

async function statGameMedia(_context: WorkerRouteContext, store: HostedGameMediaStore, mediaId: string) {
  const stat = await store.stat(mediaId);
  return stat ? json(stat) : jsonError("Game media not found.", 404);
}

async function deleteGameMedia(_context: WorkerRouteContext, store: HostedGameMediaStore, mediaId: string) {
  await store.delete(mediaId);
  return json({ deleted: true });
}
