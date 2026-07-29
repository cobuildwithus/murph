import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginHostedGroupJoinProviderRequest,
  createHostedGroupJoinProviderFenceState,
} from "@/src/lib/hosted-groups/group-join-provider-fence";

describe("hosted group-join provider fence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows provider entry only while a full request and commit margin remain", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(3_999);
    const state = createHostedGroupJoinProviderFenceState();

    beginHostedGroupJoinProviderRequest(state);

    expect(state.providerRequestStarted).toBe(true);
  });

  it("refuses provider entry after the bounded transaction budget is spent", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(4_001);
    const state = createHostedGroupJoinProviderFenceState();

    expect(() => beginHostedGroupJoinProviderRequest(state)).toThrow(
      expect.objectContaining({
        code: "HOSTED_LINQ_PROVIDER_FENCE_BUDGET_EXHAUSTED",
        retryable: true,
      }),
    );
    expect(state.providerRequestStarted).toBe(false);
  });
});
