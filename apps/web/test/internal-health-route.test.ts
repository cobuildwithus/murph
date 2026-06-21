import { beforeAll, describe, expect, it } from "vitest";

type InternalHealthRouteModule = typeof import("../app/api/internal/health/route");

let internalHealthRoute: InternalHealthRouteModule;

describe("internal health route", () => {
  beforeAll(async () => {
    internalHealthRoute = await import("../app/api/internal/health/route");
  });

  it("returns a lightweight no-store health payload", async () => {
    const response = await internalHealthRoute.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      computerUse: {
        profileMode: "member",
      },
      ok: true,
      service: "hosted-web",
    });
  });
});
