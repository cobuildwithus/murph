import { describe, expect, it } from "vitest";

import { findHostedTemporalGuardFindings } from "./check-hosted-temporal-orchestration-guards.ts";

describe("check-hosted-temporal-orchestration-guards", () => {
  it("flags legacy Cloudflare scheduler Durable Object methods in production source", () => {
    expect(
      findHostedTemporalGuardFindings(
        "apps/cloudflare/src/user-runner.ts",
        "async nudgeHostedRunnerForUser() { return null; }",
      ),
    ).toEqual([
      {
        filePath: "apps/cloudflare/src/user-runner.ts",
        label: "legacy Cloudflare runtime scheduler Durable Object method",
        line: 1,
        token: "nudgeHostedRunnerForUser",
      },
    ]);
  });

  it("flags legacy Vercel hosted nudge workflow helpers in web source", () => {
    expect(
      findHostedTemporalGuardFindings(
        "apps/web/src/lib/hosted-orchestration/runtime.ts",
        "await startHostedWebhookNudgeWorkflow(input);",
      ),
    ).toEqual([
      {
        filePath: "apps/web/src/lib/hosted-orchestration/runtime.ts",
        label: "legacy hosted Vercel nudge workflow",
        line: 1,
        token: "startHostedWebhookNudgeWorkflow",
      },
    ]);
  });

  it("flags business payload fields in the shared Temporal orchestration contract", () => {
    expect(
      findHostedTemporalGuardFindings(
        "packages/hosted-execution/src/orchestration-control.ts",
        "export interface BadSignal { prompt: string; }",
      ),
    ).toEqual([
      {
        filePath: "packages/hosted-execution/src/orchestration-control.ts",
        label: "business payload in Temporal workflow history surface",
        line: 1,
        token: "prompt",
      },
    ]);
  });

  it("does not flag allowed hosted demand source identifiers", () => {
    expect(
      findHostedTemporalGuardFindings(
        "apps/web/src/lib/hosted-orchestration/runtime-demand.ts",
        'const source = "browser_vault_refresh";',
      ),
    ).toEqual([]);
  });
});
