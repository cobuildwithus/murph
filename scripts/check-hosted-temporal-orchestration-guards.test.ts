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

  it("flags legacy Cloudflare local ensure loop state in production source", () => {
    for (const token of [
      "localEnsureInFlight",
      "retiredEnsurePromises",
      "retireCurrentEnsurePromise",
    ]) {
      expect(
        findHostedTemporalGuardFindings(
          "apps/cloudflare/src/user-runner.ts",
          `private ${token}: Promise<unknown> | null = null;`,
        ),
      ).toEqual([
        {
          filePath: "apps/cloudflare/src/user-runner.ts",
          label: "legacy Cloudflare local ensure loop state",
          line: 1,
          token,
        },
      ]);
    }
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

  it("flags broad hosted-execution parser imports inside Temporal workflow code", () => {
    expect(
      findHostedTemporalGuardFindings(
        "packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts",
        'import { parseHostedRuntimeSignal } from "@murphai/hosted-execution/parsers";',
      ),
    ).toEqual([
      {
        filePath:
          "packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts",
        label: "Node-only hosted-execution parser import in Temporal workflow bundle",
        line: 1,
        token: 'from "@murphai/hosted-execution/parsers"',
      },
    ]);
  });

  it("flags legacy hosted runtime demand decision helpers", () => {
    expect(
      findHostedTemporalGuardFindings(
        "apps/web/src/lib/hosted-orchestration/runtime-demand.ts",
        "export async function " + "readRuntime" + "Demand" + "() { return null; }",
      ),
    ).toEqual([
      {
        filePath: "apps/web/src/lib/hosted-orchestration/runtime-demand.ts",
        label: "legacy hosted runtime demand decision surface",
        line: 1,
        token: "readRuntime" + "Demand",
      },
    ]);
  });

  it("flags legacy direct hosted runtime demand signals", () => {
    expect(
      findHostedTemporalGuardFindings(
        "packages/hosted-execution/src/orchestration-control.ts",
        'const kind = "' + "browser_vault_refresh" + '_requested";',
      ),
    ).toEqual([
      {
        filePath: "packages/hosted-execution/src/orchestration-control.ts",
        label: "legacy direct hosted runtime demand signal",
        line: 1,
        token: "browser_vault_refresh" + "_requested",
      },
    ]);
  });
});
