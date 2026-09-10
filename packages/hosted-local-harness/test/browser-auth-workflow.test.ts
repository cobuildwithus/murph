import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { HOSTED_BROWSER_AUTH_ENV_KEYS } from "../src/browser-auth-live-config.ts";

const workflow = readFileSync(new URL("../../../.github/workflows/hosted-browser-auth.yml", import.meta.url), "utf8");
const guard = /        run: \|\n((?:          .*\n)+)/u.exec(workflow)?.[1];
if (!guard) throw new Error("Browser auth workflow must expose its admission shell.");

describe("protected browser authentication workflow", () => {
  it.each(["push", "schedule", "workflow_dispatch"])("admits main for %s", (event) => {
    expect(runGuard("refs/heads/main", event)).toBe(0);
  });

  it.each([
    ["refs/heads/feature", "workflow_dispatch"],
    ["refs/heads/main", "pull_request"],
    ["refs/heads/main", "pull_request_target"],
    ["refs/pull/123/merge", "push"],
  ])("rejects untrusted ref/event %s %s", (ref, event) => {
    expect(runGuard(ref, event)).not.toBe(0);
  });

  it("keeps provider authority on its isolated live step without raw browser artifacts", () => {
    const liveStep = workflow.indexOf("      - name: Prove the real browser journey");
    expect(liveStep).toBeGreaterThan(0);
    const preparation = workflow.slice(0, liveStep);
    for (const key of HOSTED_BROWSER_AUTH_ENV_KEYS) {
      expect(preparation).not.toContain(key);
      expect(workflow.slice(liveStep)).toContain(key);
    }
    expect(workflow).toContain("environment: hosted-browser-auth-sandbox");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toMatch(/^  pull_request(?:_target)?:/mu);
    expect(workflow).not.toContain("upload-artifact");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).toContain("pnpm hosted-local e2e hosted-web-auth-journey");
  });
});

function runGuard(ref: string, event: string): number | null {
  return spawnSync("bash", ["-e", "-c", guard!], {
    env: { PATH: process.env.PATH, SOURCE_REF: ref, SOURCE_EVENT: event },
    stdio: "ignore",
  }).status;
}
