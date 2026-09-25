import * as runtimeUserControl from "../src/runtime-user-control.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  handleUserDataDeleteRoute,
} from "../src/worker/route-handlers/user-data-delete.ts";

afterEach(() => vi.restoreAllMocks());

describe("hosted user-data deletion R2 upload drain", () => {
  it("returns a retryable 503 without claiming deletion success", async () => {
    const deleteHostedUserData = vi.spyOn(runtimeUserControl, "deletePostgresRunnerUserData").mockResolvedValue({
      ok: false as const,
      reason: "r2_upload_drain_pending" as const,
      retryAfterSeconds: 300,
      userId: "member_delete",
    });
    const response = await handleUserDataDeleteRoute({
      env: {
        USER_RUNNER: {
          getByName: () => { throw new Error("Deletion must not access legacy state."); },
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
    expect(deleteHostedUserData).toHaveBeenCalledWith(expect.any(Object), "member_delete");
  });
});
