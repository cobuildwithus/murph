import { existsSync } from "node:fs";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireHostedOpsRequestAccess: vi.fn(),
  seedHostedOpsAppReviewGame: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ops/access", () => ({
  requireHostedOpsRequestAccess: mocks.requireHostedOpsRequestAccess,
}));

vi.mock("@/src/lib/hosted-ops/app-review-game", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-ops/app-review-game")>(),
  seedHostedOpsAppReviewGame: mocks.seedHostedOpsAppReviewGame,
}));

type RouteModule = typeof import("../app/api/ops/app-review-game/route");
let route: RouteModule;

function post(body: unknown): Request {
  return new Request("https://join.example.test/api/ops/app-review-game", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", origin: "https://join.example.test" },
    method: "POST",
  });
}

describe("hosted ops App Review game route", () => {
  beforeAll(async () => {
    route = await import("../app/api/ops/app-review-game/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedOpsRequestAccess.mockResolvedValue({ member: { id: "member_ops" } });
    mocks.seedHostedOpsAppReviewGame.mockImplementation(async ({ mode }: { mode: string }) => ({
      action: mode === "apply" ? "applied" : "dry-run", blockers: [], sends: "none",
    }));
  });

  it("dry-runs by default behind same-origin founder access", async () => {
    const request = post({});
    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedOpsRequestAccess).toHaveBeenCalledWith(request, { requireMutationOrigin: true });
    expect(mocks.seedHostedOpsAppReviewGame).toHaveBeenCalledWith({ mode: "dry-run", readPhoto: expect.any(Function) });
    await expect(response.json()).resolves.toMatchObject({ action: "dry-run", sends: "none" });
  });

  it("applies only when asked, reading the traced site photos", async () => {
    const response = await route.POST(post({ mode: "apply" }));

    expect(response.status).toBe(200);
    const [{ mode, readPhoto }] = mocks.seedHostedOpsAppReviewGame.mock.calls[0] as [{ mode: string; readPhoto: (file: string) => Promise<Uint8Array> }];
    expect(mode).toBe("apply");
    const { APP_REVIEW_GAME_PHOTOS } = await import("@/src/lib/hosted-ops/app-review-game");
    for (const file of Object.values(APP_REVIEW_GAME_PHOTOS)) {
      const bytes = await readPhoto(file);
      expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    }
  });

  it("rejects other fields and modes before touching data", async () => {
    const extra = await route.POST(post({ mode: "dry-run", memberId: "hbm_other" }));
    expect(extra.status).toBe(400);
    await expect(extra.json()).resolves.toMatchObject({ error: { code: "HOSTED_OPS_APP_REVIEW_GAME_REQUEST_INVALID" } });

    const mode = await route.POST(post({ mode: "reset" }));
    expect(mode.status).toBe(400);
    await expect(mode.json()).resolves.toMatchObject({ error: { code: "HOSTED_OPS_APP_REVIEW_GAME_MODE_INVALID" } });
    expect(mocks.seedHostedOpsAppReviewGame).not.toHaveBeenCalled();
  });

  it("stays hidden from members outside ops", async () => {
    mocks.requireHostedOpsRequestAccess.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_OPS_ACCESS_DENIED", httpStatus: 404, message: "Hosted ops route was not found.",
    }));
    const response = await route.POST(post({ mode: "apply" }));

    expect(response.status).toBe(404);
    expect(mocks.seedHostedOpsAppReviewGame).not.toHaveBeenCalled();
  });

  it("posts only site images that next.config traces into the route", async () => {
    const { APP_REVIEW_GAME_PHOTOS } = await import("@/src/lib/hosted-ops/app-review-game");
    const traced = Object.values(APP_REVIEW_GAME_PHOTOS).map((file) => `public${file}`).sort();
    // Kept equal to the "/api/ops/app-review-game" entry asserted in next-config.test.ts.
    expect(traced).toEqual([
      "public/design-assets/hero-at-home-static-stretching-latest.jpeg",
      "public/design-assets/hero-morning-outdoor-light-exposure.jpeg",
      "public/design-assets/hero-walking-after-every-meal.jpeg",
    ]);
    for (const file of traced) expect(existsSync(path.resolve(__dirname, "..", file))).toBe(true);
  });
});
