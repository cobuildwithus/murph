import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ controlPlane: vi.fn() }));
vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.controlPlane,
}));

import {
  ackHostedDeviceSyncDirtyStateProcessed,
  applyHostedDeviceSyncRuntimeResult,
  readHostedDeviceSyncPendingDirtyState,
  readHostedDeviceSyncRuntimeState,
} from "@/src/lib/device-sync/hosted-runtime-authority";
import { requestHostedDeviceSyncReconcile } from "@/src/lib/device-sync/hosted-runtime-reconcile";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";

const services = [
  readHostedDeviceSyncRuntimeState,
  applyHostedDeviceSyncRuntimeResult,
  readHostedDeviceSyncPendingDirtyState,
  ackHostedDeviceSyncDirtyStateProcessed,
  requestHostedDeviceSyncReconcile,
];

beforeEach(() => { vi.resetAllMocks(); });

it.each(services)("rejects malformed caller JSON shape before control-plane work %#", async (service) => {
  const route = withJsonError(async (request: Request) =>
    jsonOk(await service({ request, trustedUserId: "member_opaque" })),
  );
  const response = await route(new Request("https://example.test/device-sync", {
    method: "POST", body: "[]",
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Invalid request." } });
  expect(mocks.controlPlane).not.toHaveBeenCalled();
});

it.each(services)("does not translate a stream failure into caller rejection %#", async (service) => {
  const route = withJsonError(async (request: Request) =>
    jsonOk(await service({ request, trustedUserId: "member_opaque" })),
  );
  const response = await route(new Request("https://example.test/device-sync", {
    method: "POST",
    body: new ReadableStream({
      start(controller) { controller.error(new TypeError("Synthetic stream failure.")); },
    }),
    duplex: "half",
  } as RequestInit));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal error." } });
  expect(mocks.controlPlane).not.toHaveBeenCalled();
});

it.each(services)("rejects malformed caller JSON syntax before control-plane work %#", async (service) => {
  const route = withJsonError(async (request: Request) =>
    jsonOk(await service({ request, trustedUserId: "member_opaque" })),
  );
  const response = await route(new Request("https://example.test/device-sync", {
    method: "POST", body: "{",
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code: "INVALID_JSON", message: "Invalid JSON." } });
  expect(mocks.controlPlane).not.toHaveBeenCalled();
});
