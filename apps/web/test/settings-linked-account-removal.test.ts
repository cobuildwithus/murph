import { afterEach, describe, expect, it, vi } from "vitest";

import {
  finishHostedLinkedAccountRemovalWithRetry,
  toHostedLinkedAccountRemovalErrorMessage,
} from "../src/components/settings/hosted-linked-account-removal";

describe("settings linked-account removal client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries provider propagation without repeating the provider unlink", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: "PRIVY_ACCOUNT_UNLINK_NOT_READY",
          message: "Still linked.",
          retryable: true,
        },
      }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        changed: true,
        method: "telegram",
        ok: true,
        runTriggered: true,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(finishHostedLinkedAccountRemovalWithRetry({
      expectedIdentity: "456",
      method: "telegram",
      sleepImpl: async () => undefined,
    })).resolves.toMatchObject({
      changed: true,
      method: "telegram",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/settings/linked-account",
      expect.objectContaining({
        body: JSON.stringify({
          expectedIdentity: "456",
          method: "telegram",
        }),
        method: "DELETE",
      }),
    );
  });

  it("makes post-provider failures explicit", () => {
    expect(toHostedLinkedAccountRemovalErrorMessage(
      new Error("Murph sync unavailable."),
      true,
    )).toBe("Murph sync unavailable.");
    expect(toHostedLinkedAccountRemovalErrorMessage(
      null,
      true,
    )).toContain("sign-in was removed");
  });
});
