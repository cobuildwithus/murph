import { describe, expect, it, vi } from "vitest";
import { createRunnerReleaseProvider } from "../scripts/runner-release-provider.ts";

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));

describe("native account capacity evidence", () => {
  it("reads the account's actual quota and excludes unrelated private fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      result: {
        external_account_id: "private-fixture",
        defaults: { privateFixture: true },
        limits: { total_vcpu: 80, total_memory_mib: 240_000, total_disk_mb: 480_000 },
      },
    })));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
      .readAccountLimits()).resolves.toEqual({ vcpu: 80, memoryMiB: 240_000, diskMB: 480_000 });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.cloudflare.com/client/v4/accounts/fixture/containers/me");
  });

  it.each([undefined, null, {}, { total_vcpu: 0 }, { total_vcpu: "80" }])(
    "does not substitute published defaults for missing or invalid account limits: %s", async (limits) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        success: true, result: { limits },
      })));
      await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
        .readAccountLimits()).rejects.toThrow("unavailable");
    },
  );
});

describe("inactive runner target drain admission", () => {
  const response = (state: string) => new Response(JSON.stringify({
    success: true,
    result: [{ current_placement: { status: { container_status: state } } }],
  }));

  it("permits reuse only when the provider reports stopped instances", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response("stopped"));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
      .assertDrained("inactive-app")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(["running", "stopping", "unknown"])("keeps %s instances protected until they stop", async (state) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(state))
      .mockResolvedValueOnce(response("stopped"));
    const work = createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
      .assertDrained("inactive-app");
    await work;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not infer a drained target from failed or incomplete provider evidence", async () => {
    for (const body of [{ success: false }, { success: true, result: {} }, {
      success: true, result: [], result_info: { next_page_token: "next-page" },
    }]) {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
      await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
        .assertDrained("inactive-app")).rejects.toThrow("unavailable");
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
});
