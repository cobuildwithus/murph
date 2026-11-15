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
