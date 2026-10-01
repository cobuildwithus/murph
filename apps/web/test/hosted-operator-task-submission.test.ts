import { describe, expect, it, vi } from "vitest";

import { resolveOperatorTaskSubmissionIdentity } from "../src/lib/hosted-ops/operator-task-submission.ts";

describe("operator task submission identity", () => {
  it("reuses one key for an unchanged retry", () => {
    const createKey = vi.fn(() => "retry-key");
    const first = resolveOperatorTaskSubmissionIdentity(
      null,
      "same-request",
      createKey,
    );
    const retry = resolveOperatorTaskSubmissionIdentity(
      first,
      "same-request",
      createKey,
    );

    expect(retry).toBe(first);
    expect(createKey).toHaveBeenCalledOnce();
  });

  it("rotates the key when the request changes", () => {
    const createKey = vi.fn()
      .mockReturnValueOnce("first-key")
      .mockReturnValueOnce("second-key");
    const first = resolveOperatorTaskSubmissionIdentity(
      null,
      "first-request",
      createKey,
    );
    const changed = resolveOperatorTaskSubmissionIdentity(
      first,
      "changed-request",
      createKey,
    );

    expect(changed.key).toBe("second-key");
    expect(createKey).toHaveBeenCalledTimes(2);
  });
});
