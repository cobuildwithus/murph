import { describe, expect, it, vi } from "vitest";
import { createRunnerReleaseProvider } from "../scripts/runner-release-provider.ts";

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));

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
