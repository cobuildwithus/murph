import { describe, expect, it, vi } from "vitest";

import {
  handleUserDataDeleteRoute,
} from "../src/worker/route-handlers/user-data-delete.ts";

describe("hosted user-data deletion R2 upload drain", () => {
  it("returns a retryable 503 without claiming deletion success", async () => {
    const deleteHostedUserData = vi.fn(async () => ({
      ok: false as const,
      reason: "r2_upload_drain_pending" as const,
      retryAfterSeconds: 300,
      userId: "member_delete",
    }));
    const response = await handleUserDataDeleteRoute({
      env: {
        USER_RUNNER: {
          getByName: () => ({ deleteHostedUserData }),
        },
      },
      request: new Request("https://worker.test/internal/users/member_delete/data", {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "DELETE",
      }),
    } as never, "member_delete");

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(await response.json()).toEqual({
      code: "r2_upload_drain_pending",
      retryAfterSeconds: 300,
    });
    expect(deleteHostedUserData).toHaveBeenCalledWith("member_delete");
  });
});
