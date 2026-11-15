import { deviceWebhookEnqueueRoutes } from "../src/worker/route-handlers/device-webhook-enqueue.ts";
import { RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
import * as gameMediaStore from "../src/game-media-store.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { readRequestBodyBytes } from "../src/json.ts";
import { mapWorkerRouteError } from "../src/worker/errors.ts";
import { authorizeRoute } from "../src/worker/auth.ts";
import { gameMediaRoutes } from "../src/worker/route-handlers/game-media.ts";
import { gameImageRoutes } from "../src/worker/route-handlers/game-images.ts";
import { recapMediaRoutes } from "../src/worker/route-handlers/recap-media.ts";
import { handleMealPhotoStageRoute } from "../src/worker/route-handlers/meal-photo-stage.ts";
import { handleTestDirectR2LocatorMarkerRoute } from "../src/worker/route-handlers/test-direct-r2.ts";
import { handleTemporalMailboxSignalFaultRoute } from "../src/worker/route-handlers/test-temporal-mailbox-signal-fault.ts";
import { handleRunnerRuntimeCompletionRequest } from "../src/runner-outbound/runtime-completion.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../src/internal-hosts.ts";
import { HOSTED_RUNTIME_ATTEMPT_ID_HEADER, HOSTED_RUNTIME_LEASE_GENERATION_HEADER } from "../src/runner-outbound/headers.ts";
import { HOSTED_GAME_MEDIA_MAX_ENVELOPE_BYTES } from "../src/game-media-store.ts";
import { HOSTED_WEB_REQUEST_MAX_BYTES } from "@murphai/hosted-execution/runtime-control";
import type { WorkerRouteContext } from "../src/worker-routes/shared.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const userId = "synthetic-member";
const routes = [
  { name: "game media", limit: HOSTED_GAME_MEDIA_MAX_ENVELOPE_BYTES, error: "Game media is too large.", handle: (c: WorkerRouteContext) => gameMediaRoutes[0]!.handle(c, { userId }) },
  { name: "game image", limit: 4 * 1024 * 1024, error: "Game image is too large.", handle: (c: WorkerRouteContext) => gameImageRoutes[0]!.handle(c, { userId }) },
  { name: "recap", limit: 3 * 1024 * 1024, error: "Recap asset is too large.", handle: (c: WorkerRouteContext) => recapMediaRoutes[0]!.handle(c, { userId }) },
  { name: "meal photo", limit: 4 * 1024 * 1024, error: "Meal photo exceeds the 4 MiB limit.", handle: (c: WorkerRouteContext) => handleMealPhotoStageRoute(c, userId) },
  { name: "direct R2", limit: 4096, error: "Request body too large.", handle: (c: WorkerRouteContext) => handleTestDirectR2LocatorMarkerRoute(c, userId) },
  { name: "Temporal fault", limit: 4096, error: "Request body too large.", handle: (c: WorkerRouteContext) => handleTemporalMailboxSignalFaultRoute(c, userId, "arm") },
  { name: "signature auth", limit: 8, error: "Request body too large.", handle: (c: WorkerRouteContext) => authorizeRoute("web-callback-signature", c, "test", { signatureBodyLimitBytes: 8 }) },
  { name: "completion", limit: 256 * 1024, error: "Request body too large.", handle: (c: WorkerRouteContext) => handleRunnerRuntimeCompletionRequest({ ...c, userId }) },
  { name: "web control", limit: HOSTED_WEB_REQUEST_MAX_BYTES, error: "Request body too large.", handle: (c: WorkerRouteContext) => handleRunnerOutboundRequest(c.request, c.env, userId) },
];
const modes = ["declared", "streamed", "under-reported"] as const;
type Mode = typeof modes[number];

function context(limit: number, mode: Mode): WorkerRouteContext {
  const request = new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}/api/internal/hosted-workspace/checkpoint`, {
    method: "POST",
    headers: {
      "content-type": "image/jpeg",
      "x-hosted-execution-user-id": userId,
      "x-murph-game-media-id": `${"a".repeat(64)}.jpg`,
      "x-murph-recap-media-id": `recap/${"a".repeat(32)}/scene-0.jpg`,
      "x-murph-meal-photo-capture-id": "a".repeat(64),
      "x-murph-meal-photo-sha256": "b".repeat(64),
      [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "synthetic-attempt",
      [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "1",
    },
  });
  if (mode !== "streamed") request.headers.set("content-length", String(mode === "declared" ? limit + 1 : 1));
  Object.defineProperty(request, "body", { configurable: true, value: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(limit));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  }) });
  const unused = async (): Promise<never> => { throw new Error("Unexpected external call."); };
  const namespace = { getByName: () => ({ destroyInstance: unused, invoke: unused, smokeHealth: unused }) };
  return {
    env: {
      ...createHostedExecutionTestEnv(), NODE_ENV: "test", MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      CF_PUBLIC_BASE_URL: "https://runner.example.test",
      BUNDLES: new MemoryEncryptedR2Bucket(), RUNNER_CONTAINER: namespace, RUNNER_CONTAINER_SMOKE: namespace,
      GAME_IMAGES: { info: unused, hosted: { upload: unused, image: () => ({ signedUrl: unused, delete: unused }), list: unused } },
    },
    environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
    request, url: new URL(request.url),
  };
}

describe("Worker body-limit response parity", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  describe.each(routes)("$name", ({ handle, limit, error }) => {
    it.each(["Invalid array length", "Request body exceeded 8 bytes."])("does not mislabel an unrelated RangeError: %s", async message => {
      const c = context(0, "streamed");
      Object.defineProperty(c.request, "body", { value: new ReadableStream({ start(controller) { controller.error(new RangeError(message)); } }) });
      const response = await Promise.resolve(handle(c)).catch(error => mapWorkerRouteError(c.request, error));
      expect(response?.status).toBe(500);
      expect(Object.fromEntries(response!.headers)).toEqual({ "content-type": "application/json; charset=utf-8" });
      await expect(response!.json()).resolves.toEqual({ error: "Internal error." });
    });
    it.each(modes)("keeps the response for %s overflow", async mode => {
      const response = await handle(context(limit, mode));
      expect(response?.status).toBe(413);
      expect(Object.fromEntries(response!.headers)).toEqual({ "content-type": "application/json; charset=utf-8" });
      await expect(response!.json()).resolves.toEqual({ error });
    });
  });
  it.each([
    new RangeError("Synthetic stream failure."),
    new TypeError("Synthetic stream failure."),
    new URIError("Synthetic stream failure."),
    new SyntaxError("Synthetic stream failure."),
  ])("answers a device webhook stream failure as a server error: %s", async (failure) => {
    const c = context(0, "streamed");
    Object.defineProperty(c.request, "body", { value: new ReadableStream({ start(controller) { controller.error(failure); } }) });
    const response = await Promise.resolve(deviceWebhookEnqueueRoutes[0]!.handle(c, {}))
      .catch(error => mapWorkerRouteError(c.request, error));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal error." });
  });

  it("does not label a parser RangeError as game media size", async () => {
    const c = context(0, "streamed");
    const parse = vi.spyOn(gameMediaStore, "requireHostedGameMediaEnvelope").mockImplementationOnce(() => { throw new RangeError("Invalid array length"); });
    const response = await Promise.resolve(gameMediaRoutes[0]!.handle(c, { userId })).catch(error => mapWorkerRouteError(c.request, error));
    expect(parse).toHaveBeenCalledOnce();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal error." });
  });

  it("keeps 413 when a recap envelope within the wire limit normalizes past it", async () => {
    const c = context(0, "streamed");
    c.request.headers.set("x-murph-recap-hash", "a".repeat(64));
    // Invalid UTF-8 decodes to longer replacement characters, so the sealed text can outgrow the bytes read.
    vi.spyOn(gameMediaStore, "requireHostedGameMediaEnvelope").mockReturnValueOnce("x".repeat(3 * 1024 * 1024 + 1));
    const put = vi.spyOn(c.env.BUNDLES, "put");
    const response = await recapMediaRoutes[0]!.handle(c, { userId });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Recap asset is too large." });
    expect(put).not.toHaveBeenCalled();
  });

  it("accepts exactly the byte limit", async () => {
    const request = new Request("https://example.test/body", { method: "POST", body: "é".repeat(4) });
    expect(await readRequestBodyBytes(request, { limitBytes: 8 })).toEqual(new TextEncoder().encode("é".repeat(4)));
  });

  it.each(modes)("bounds bytes for %s overflow", async mode => {
    await expect(readRequestBodyBytes(context(8, mode).request, { limitBytes: 8 })).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
