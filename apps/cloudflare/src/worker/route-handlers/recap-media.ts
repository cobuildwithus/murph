import { parseInput, RequestInputError, RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
import { CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS, matchCloudflareHostedControlUserRoutePath } from "@murphai/cloudflare-hosted-control/routes";
import { requireHostedRecapMediaId, requireHostedProgressPicId } from "../../storage-paths.ts";
import { createRecapMediaStore, createProgressPicStore, requireSealedGameMediaUpload } from "../../recap-media-store.ts";
import { json, jsonError, readRequestBodyText } from "../../json.ts";
import type { WorkerRouteContext } from "../../worker-routes/shared.ts";
import { requireBoundInternalRouteUser } from "../auth.ts";
import type { DeclarativeRoute } from "../routes.ts";
import { decodeRouteParam } from "../route-utils/route-params.ts";

export const recapMediaRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = (["recapMediaStage", "recapMediaRead", "progressPicStage", "progressPicRead"] as const).map(routeName => ({
  authorizeBeforeMethod: true, authorization: "vercel-oidc",
  beforeMethod: (context, params) => requireBoundInternalRouteUser(context, params, routeName),
  match: pathname => matchCloudflareHostedControlUserRoutePath(routeName, pathname),
  methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS[routeName].method], name: routeName, wrongMethodResponse: "method-not-allowed",
  async handle(context, params) {
    const progress = routeName === "progressPicStage" || routeName === "progressPicRead";
    let mediaId: string;
    try { mediaId = parseInput(context.request.headers, () => (progress ? requireHostedProgressPicId : requireHostedRecapMediaId)(context.request.headers.get("x-murph-recap-media-id") ?? "")); }
    catch (error) {
      if (error instanceof RequestInputError) return jsonError("Invalid recap identity.", 400);
      throw error;
    }
    const store = (progress ? createProgressPicStore : createRecapMediaStore)({ bucket: context.env.BUNDLES, userId: decodeRouteParam(params.userId) });
    if (routeName === "recapMediaRead" || routeName === "progressPicRead") {
      const result = await store.read(mediaId);
      return result ? new Response(JSON.stringify(result), { headers: { "content-type": "application/json", "cache-control": "private, no-store" } }) : jsonError("Recap media not found.", 404);
    }
    const hash = context.request.headers.get("x-murph-recap-hash") ?? "";
    let upload: ReturnType<typeof requireSealedGameMediaUpload>;
    try {
      const body = await readRequestBodyText(context.request, { limitBytes: 3 * 1024 * 1024 });
      upload = parseInput(body, () => requireSealedGameMediaUpload(body, hash, progress ? "game-progress" : "weekly-game"));
    } catch (error) {
      if (error instanceof RequestInputError || error instanceof SyntaxError) return jsonError("Invalid sealed media.", 400);
      if (error instanceof RequestBodyTooLargeError) return jsonError("Recap asset is too large.", 413);
      throw error;
    }
    return json(await store.write(mediaId, upload));
  },
}));
