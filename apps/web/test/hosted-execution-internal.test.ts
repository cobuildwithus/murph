import { afterEach, describe, expect, it } from "vitest";

import { requireHostedExecutionSchedulerToken } from "@/src/lib/hosted-execution/internal";

describe("hosted execution internal auth", () => {
  const originalSchedulerTokens = process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS;
  const originalCronSecret = process.env.CRON_SECRET;

  afterEach(() => {
    if (originalSchedulerTokens === undefined) {
      delete process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS;
    } else {
      process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS = originalSchedulerTokens;
    }

    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it("accepts CRON_SECRET as a scheduler fallback token", () => {
    delete process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS;
    process.env.CRON_SECRET = "cron-secret";

    expect(() =>
      requireHostedExecutionSchedulerToken(
        new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron", {
          headers: {
            authorization: "Bearer cron-secret",
          },
        }),
      ),
    ).not.toThrow();
  });

  it("fails with the combined scheduler credential message when neither token source is configured", () => {
    delete process.env.HOSTED_EXECUTION_SCHEDULER_TOKENS;
    delete process.env.CRON_SECRET;

    expect(() =>
      requireHostedExecutionSchedulerToken(
        new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron"),
      ),
    ).toThrow(
      "HOSTED_EXECUTION_SCHEDULER_TOKENS or CRON_SECRET must be configured for scheduled hosted execution drains.",
    );
  });
});
