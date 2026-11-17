import { afterEach, describe, expect, it, vi } from "vitest";
import * as privateMedia from "../src/private-media.ts";
import worker from "../src/worker/index.ts";
import { workerPublicRoutes } from "../src/worker/public-routes.ts";
import type { WorkerEnvironmentSource } from "../src/worker-routes/shared.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const NOINDEX = "noindex, nofollow, noarchive, nosnippet, noimageindex";
const MEDIA_URL = `https://runner.example.test/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.png?exp=2000000000`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const unusedContainers = { getByName() { throw new Error("Unexpected container access."); } };
const env: WorkerEnvironmentSource = {
  ...createHostedExecutionTestEnv(),
  BUNDLES: new MemoryEncryptedR2Bucket(),
  HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET: "synthetic-private-media-capability-secret",
  RUNNER_CONTAINER: unusedContainers,
  RUNNER_CONTAINER_SMOKE: unusedContainers,
};

describe("worker response crawler policy", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["GET", "HEAD"])("protects private-media %s without changing its bytes or headers", async (method) => {
    vi.spyOn(privateMedia, "readHostedPrivateMedia").mockResolvedValue({ bytes: PNG, contentType: "image/png" });
    const response = await worker.fetch(new Request(MEDIA_URL, { method }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe(NOINDEX);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe(String(PNG.length));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(method === "HEAD" ? new Uint8Array() : PNG);
  });

  it("protects an unmatched route", async () => {
    const response = await worker.fetch(new Request("https://runner.example.test/missing"), env);
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe(NOINDEX);
  });

  it("protects errors mapped at the outer fetch boundary", async () => {
    vi.spyOn(privateMedia, "readHostedPrivateMedia").mockRejectedValue(new Error("Synthetic storage failure."));
    const response = await worker.fetch(new Request(MEDIA_URL), env);
    expect(response.status).toBe(500);
    expect(response.headers.get("X-Robots-Tag")).toBe(NOINDEX);
    expect(await response.json()).toEqual({ error: "Internal error." });
  });

  it("copies immutable redirect headers and preserves the redirect", async () => {
    const redirect = Response.redirect("https://runner.example.test/destination", 307);
    expect(() => redirect.headers.set("X-Robots-Tag", NOINDEX)).toThrow();
    const route = workerPublicRoutes.find(route => route.name === "service-banner")!;
    vi.spyOn(route, "handle").mockReturnValue(redirect);
    const response = await worker.fetch(new Request("https://runner.example.test/"), env);
    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe("https://runner.example.test/destination");
    expect(response.headers.get("X-Robots-Tag")).toBe(NOINDEX);
    expect(redirect.headers.has("X-Robots-Tag")).toBe(false);
  });

  it("passes upgrades through untouched", async () => {
    // Node cannot construct a 101 Response; model the platform response at the route boundary.
    const upgrade = new Response(null);
    Object.defineProperty(upgrade, "status", { value: 101 });
    const route = workerPublicRoutes.find(route => route.name === "service-banner")!;
    vi.spyOn(route, "handle").mockReturnValue(upgrade);
    expect(await worker.fetch(new Request("https://runner.example.test/"), env)).toBe(upgrade);
    expect(upgrade.headers.has("X-Robots-Tag")).toBe(false);
  });
});
