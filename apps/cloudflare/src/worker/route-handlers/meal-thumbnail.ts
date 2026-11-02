import { matchCloudflareHostedControlUserRoutePath } from "@murphai/cloudflare-hosted-control/routes";
import { createHostedMediaStore } from "../../bundle-store.ts";
import { json, jsonError, readRequestBodyText } from "../../json.ts";
import { createHostedMealThumbnailDelivery, matchHostedPrivateMediaCapabilityPath, readHostedPrivateMedia, readHostedPrivateMediaCapabilitySecret, readHostedPrivateMediaDeliveryOrigin } from "../../private-media.ts";
import { resolveHostedExecutionUserCryptoContext, type WorkerRouteContext } from "../../worker-routes/shared.ts";
import { requireBoundInternalRouteUser } from "../auth.ts";
import type { DeclarativeRoute } from "../routes.ts";

export const mealThumbnailRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [{
  authorization: "vercel-oidc", authorizeBeforeMethod: true,
  beforeMethod: (context, params) => requireBoundInternalRouteUser(context, params, "meal-thumbnail-delivery"),
  match: pathname => matchCloudflareHostedControlUserRoutePath("mealThumbnailDelivery", pathname),
  methods: ["POST"], name: "meal-thumbnail-delivery", wrongMethodResponse: "method-not-allowed",
  async handle(context, params) {
    const secret = readHostedPrivateMediaCapabilitySecret(context.env);
    if (!secret) return jsonError("Private media delivery is unavailable.", 503);
    let photos: Array<{ mediaId: string; sha256: string; byteSize: number }>;
    try {
      photos = parsePhotos(JSON.parse(await readRequestBodyText(context.request, { limitBytes: 2 * 1024 * 1024 })));
    } catch { return jsonError("Meal thumbnail request is invalid.", 400); }
    const userId = decodeURIComponent(params.userId!);
    const deliveryOrigin = readHostedPrivateMediaDeliveryOrigin(context.env);
    return json(await Promise.all(photos.map(photo => createHostedMealThumbnailDelivery({
      ...photo, userId, capabilitySecret: secret, deliveryOrigin,
    }))));
  },
}, {
  match(pathname) {
    if (!pathname.endsWith("/meal-thumbnail.jpg")) return null;
    const matched = matchHostedPrivateMediaCapabilityPath(pathname.replace(/\/meal-thumbnail.jpg$/u, "/group-avatar.jpg"));
    return matched ? { capability: matched.capability } : null;
  },
  methods: ["GET", "HEAD"], name: "meal-thumbnail-read", wrongMethodResponse: "not-found",
  async handle(context, params) {
    const secret = readHostedPrivateMediaCapabilitySecret(context.env);
    const entries = [...context.url.searchParams.entries()];
    const exp = entries.length === 1 && entries[0]?.[0] === "exp" && /^[1-9][0-9]*$/u.test(entries[0][1]) ? Number(entries[0][1]) : NaN;
    const media = secret && Number.isSafeInteger(exp) ? await readHostedPrivateMedia({
      bucket: context.env.BUNDLES, capability: params.capability!, capabilitySecret: secret, expiresAtUnixSeconds: exp, runtimeMediaOnly: true,
      async readRuntimeMedia(descriptor) {
        const crypto = await resolveHostedExecutionUserCryptoContext({ bucket: context.env.BUNDLES, domain: "runtime", environment: context.environment, userId: descriptor.userId });
        const store = createHostedMediaStore({ bucket: context.env.BUNDLES, userId: descriptor.userId,
          key: crypto.rootKey, keyId: crypto.rootKeyId, keysById: crypto.keysById, resolveKeyById: crypto.resolveKeyById });
        return store.readMedia({ mediaId: descriptor.mediaId, sha256: descriptor.sha256, byteSize: descriptor.byteSize, mediaKind: "image" });
      },
    }) : null;
    if (!media) return new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } });
    return new Response(context.request.method === "HEAD" ? null : new Uint8Array(media.bytes), {
      headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff",
        "content-disposition": 'inline; filename="meal-thumbnail.jpg"', "content-length": String(media.bytes.byteLength) },
    });
  },
}];

function parsePhotos(value: unknown): Array<{ mediaId: string; sha256: string; byteSize: number }> {
  if (!value || typeof value !== "object" || !("photos" in value) || !Array.isArray(value.photos) || value.photos.length > 5000) throw new TypeError("Invalid photos.");
  return value.photos.map((item: unknown) => {
    if (!item || typeof item !== "object" || !("mediaId" in item) || !("sha256" in item) || !("byteSize" in item)
      || typeof item.mediaId !== "string" || !/^[a-f0-9]{64}$/u.test(item.mediaId)
      || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.sha256)
      || typeof item.byteSize !== "number" || !Number.isSafeInteger(item.byteSize) || item.byteSize < 1 || item.byteSize > 1024 * 1024) throw new TypeError("Invalid photo.");
    return { mediaId: item.mediaId, sha256: item.sha256, byteSize: item.byteSize };
  });
}
