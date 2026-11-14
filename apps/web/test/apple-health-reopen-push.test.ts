import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ cron: vi.fn(), sweep: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({ requireVercelCronRequest: m.cron }));
vi.mock("@/src/lib/device-sync/apple-health-reopen-push", async original => ({
  ...await original<typeof import("@/src/lib/device-sync/apple-health-reopen-push")>(), sendDueAppleHealthReopenPushes: m.sweep,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: vi.fn() }));

import { APPLE_HEALTH_REOPEN_PUSH_DAYS, readSendWindowEnd } from "@/src/lib/device-sync/apple-health-reopen-push";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { GET } from "../app/api/internal/device-sync/apple-health-reopen-push/cron/route";

const request = () => new Request("https://example.test/api/internal/device-sync/apple-health-reopen-push/cron");

describe("Apple Health reopen push cron route", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("authenticates as a Vercel cron, runs one sweep and returns counts only", async () => {
    const counts = { configured: true, claimed: 2, errors: 0, failed: 0, sent: 2, superseded: 0, unregistered: 0 };
    m.sweep.mockResolvedValue(counts);
    const cron = request();
    const response = await GET(cron);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reopenPushes: counts });
    expect(m.cron).toHaveBeenCalledExactlyOnceWith(cron);
    expect(m.sweep).toHaveBeenCalledExactlyOnceWith({ signal: cron.signal });
  });

  it("sends nothing for a request that is not the cron", async () => {
    m.cron.mockImplementation(() => {
      throw hostedOnboardingError({ code: "VERCEL_CRON_UNAUTHORIZED", httpStatus: 401, message: "Unauthorized Vercel cron request." });
    });
    expect((await GET(request())).status).toBe(401);
    expect(m.sweep).not.toHaveBeenCalled();
  });
});

describe("Apple Health reopen push send window", () => {
  const end = (instant: string, zone: string | null) => readSendWindowEnd(new Date(instant), zone)?.toISOString() ?? null;

  it("opens at 9am and closes at 9pm in the member's zone", () => {
    expect(end("2026-11-10T13:59:59.000Z", "America/New_York")).toBeNull();
    expect(end("2026-11-10T14:00:00.000Z", "America/New_York")).toBe("2026-11-11T02:00:00.000Z");
    expect(end("2026-11-11T01:59:30.500Z", "America/New_York")).toBe("2026-11-11T02:00:00.000Z");
    expect(end("2026-11-11T02:00:00.000Z", "America/New_York")).toBeNull();
  });

  it("uses 17:00 to 19:00 UTC when the zone is unknown or unreadable", () => {
    for (const zone of [null, "", "Not/AZone"]) {
      expect(end("2026-11-10T16:59:00.000Z", zone)).toBeNull();
      expect(end("2026-11-10T17:00:00.000Z", zone)).toBe("2026-11-10T19:00:00.000Z");
      expect(end("2026-11-10T19:00:00.000Z", zone)).toBeNull();
    }
  });

  it("keeps the unknown-zone window inside 9am to 9pm from US Pacific through Central Europe all year", () => {
    for (const day of ["2026-01-15", "2026-07-15"]) {
      for (const zone of ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin"]) {
        expect(end(`${day}T17:00:00.000Z`, zone), `${zone} ${day} open`).not.toBeNull();
        expect(end(`${day}T18:59:00.000Z`, zone), `${zone} ${day} close`).not.toBeNull();
      }
    }
  });

  it("schedules daily for three days and then weekly, ending before day 31", () => {
    expect([...APPLE_HEALTH_REOPEN_PUSH_DAYS]).toEqual([1, 2, 3, 10, 17, 24]);
  });
});
