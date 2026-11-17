import { createTestHostedRuntimeCryptoContext } from "./hosted-runtime-crypto-fixtures.ts";
import * as routeContext from "../src/worker-routes/shared.ts";
import * as bundleStore from "../src/bundle-store.ts";
import { afterEach, expect, it, vi } from "vitest";
import * as privateMedia from "../src/private-media.ts";
import { mealThumbnailRoutes } from "../src/worker/route-handlers/meal-thumbnail.ts";
import { mapWorkerRouteError } from "../src/worker/errors.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import type { WorkerRouteContext } from "../src/worker-routes/shared.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

function context(userId: string, photos = [{ mediaId: "a".repeat(64), sha256: "b".repeat(64), byteSize: 4 }]): WorkerRouteContext {
  const unused = async (): Promise<never> => { throw new Error("Unexpected container call."); };
  const namespace = { getByName: () => ({ destroyInstance: unused, invoke: unused, smokeHealth: unused }) };
  const configured = createHostedExecutionTestEnv();
  const request = new Request("https://runner.example.test/meal-thumbnail-delivery", {
    method: "POST",
    headers: { "x-hosted-execution-user-id": userId },
    body: JSON.stringify({ photos }),
  });
  return {
    env: { ...configured, BUNDLES: new MemoryEncryptedR2Bucket(),
      RUNNER_CONTAINER: namespace, RUNNER_CONTAINER_SMOKE: namespace,
      HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET: "synthetic-capability-secret-value" },
    environment: readHostedExecutionEnvironment(configured), request, url: new URL(request.url),
  };
}

afterEach(() => vi.restoreAllMocks());

it("rejects the authenticated caller's oversized user id before delivery work", async () => {
  const userId = "m".repeat(513);
  const c = context(userId);
  const delivery = vi.spyOn(privateMedia, "createHostedMealThumbnailDelivery");
  const route = mealThumbnailRoutes[0]!;
  expect(await route.beforeMethod!(c, { userId })).toBeNull();
  let response: Response;
  try { response = await route.handle(c, { userId }); }
  catch (error) { response = mapWorkerRouteError(c.request, error); }
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request." });
  expect(delivery).not.toHaveBeenCalled();
});

it("keeps delivery implementation failures outside caller validation", async () => {
  const userId = "member_synthetic";
  const c = context(userId);
  vi.spyOn(privateMedia, "createHostedMealThumbnailDelivery").mockRejectedValueOnce(new TypeError("Synthetic crypto failure."));
  let response: Response;
  try { response = await mealThumbnailRoutes[0]!.handle(c, { userId }); }
  catch (error) { response = mapWorkerRouteError(c.request, error); }
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Internal error." });
});

it("preserves the empty delivery batch response without validating unused delivery identity", async () => {
  const userId = "m".repeat(513);
  const response = await mealThumbnailRoutes[0]!.handle(context(userId, []), { userId });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([]);
});

it.each(["crypto-context", "runtime-read", "stored-content"])("reports meal thumbnail %s failures as server errors", async failure => {
  const c = context("synthetic-owner");
  const delivery = await privateMedia.createHostedMealThumbnailDelivery({
    userId: "synthetic-owner", mediaId: "a".repeat(64), sha256: "b".repeat(64), byteSize: 4,
    capabilitySecret: c.env.HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET!, deliveryOrigin: "https://runner.example.test",
  });
  c.request = new Request(delivery.url);
  c.url = new URL(delivery.url);
  const resolveCrypto = vi.spyOn(routeContext, "resolveHostedExecutionUserCryptoContext");
  const readMedia = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  if (failure === "crypto-context") resolveCrypto.mockRejectedValue(new TypeError("Synthetic crypto lookup failure."));
  else {
    const { envelopes } = await createTestHostedRuntimeCryptoContext("synthetic-owner");
    resolveCrypto.mockResolvedValue({ rootKey: new Uint8Array(32), rootKeyId: "synthetic-root", keysById: {},
      resolveKeyById: async () => null, cacheMaxAgeMs: 0, cryptoContextVersion: null, domain: "runtime",
      envelope: envelopes.runtime, fetchedAtMs: Date.now() });
    const store = bundleStore.createHostedMediaStore({ bucket: c.env.BUNDLES, key: new Uint8Array(32), keyId: "synthetic-root", userId: "synthetic-owner" });
    vi.spyOn(bundleStore, "createHostedMediaStore").mockReturnValue({ ...store, readMedia });
    if (failure === "runtime-read") readMedia.mockRejectedValue(new TypeError("Synthetic runtime media failure."));
  }
  const route = mealThumbnailRoutes[1]!;
  const params = route.match(c.url.pathname)!;
  let response: Response;
  try { response = await route.handle(c, params); }
  catch (error) { response = mapWorkerRouteError(c.request, error); }
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Internal error." });

  resolveCrypto.mockClear();
  c.url.searchParams.set("exp", "1");
  const refusal = await route.handle(c, params);
  expect(refusal.status).toBe(404);
  expect(await refusal.text()).toBe("");
  expect(resolveCrypto).not.toHaveBeenCalled();
});

it("answers 503 for a thumbnail read when the server capability secret is missing", async () => {
  const c = context("member_synthetic");
  const url = new URL(`https://runner.example.test/private-media/${"c".repeat(43)}/meal-thumbnail.jpg?exp=${Math.floor(Date.now() / 1000) + 60}`);
  const read = mealThumbnailRoutes.find(route => route.name === "meal-thumbnail-read")!;
  const env = { ...c.env };
  delete (env as Record<string, unknown>).HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET;
  const response = await read.handle({ ...c, env, request: new Request(url), url }, { capability: "c".repeat(43) });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Private media delivery is unavailable." });
});
