import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const workflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "junction-wearable-canary.yml"),
  "utf8",
);
const browserRunner = readFileSync(
  path.join(
    repoRoot,
    "apps",
    "web",
    "scripts",
    "run-hosted-local-junction-wearable-browser.ts",
  ),
  "utf8",
);

describe("live Junction wearable canary workflow", () => {
  it("admits the private controller only for protected-main provider proof", () => {
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("      - main");
    expect(workflow).toContain("  schedule:");
    expect(workflow).toContain("  workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s*(pull_request|pull_request_target|repository_dispatch):/mu);
    expect(workflow).toContain("if: ${{ github.ref == 'refs/heads/main' && github.ref_protected }}");
    expect(workflow).toContain("environment: temporal-compatibility");
    expect(workflow).toContain("group: live-junction-wearable-canary");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("keeps all provider credentials and private source out of the public controller", () => {
    const secretNames = [...workflow.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/gu)]
      .map((match) => match[1]);
    expect(secretNames).toEqual(["TEMPORAL_COMPATIBILITY_GITHUB_APP_PRIVATE_KEY"]);
    expect(workflow).toContain("repositories: murph-cloud");
    expect(workflow).toContain("permission-actions: write");
    expect(workflow).toContain("permission-contents: read");
    expect(workflow).not.toMatch(/JUNCTION_API_KEY|GARMIN_CANARY_PASSWORD|KERNEL_API_KEY|actions\/(?:upload|download)-artifact/u);
    expect(workflow).not.toContain("pnpm install");
    expect(workflow).not.toContain("repository: cobuildwithus/murph-cloud");
  });

  it("requires the exact private canonical-data receipt with pinned controller actions", () => {
    expect(workflow).toContain("run: node scripts/github-wearable-canary.mjs");
    expect(workflow).toContain("ref: ${{ github.sha }}");
    expect(workflow).toContain("persist-credentials: false");
    const actionRefs = [...workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gmu)];
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const actionRef of actionRefs) expect(actionRef[1]).toMatch(/^[a-f0-9]{40}$/u);
  });

  it("confirms the required Vital disclosure before waiting for provider authorization", () => {
    const disclosureOffset = browserRunner.indexOf(
      'stage = "murph_vital_disclosure";',
    );
    const connectOffset = browserRunner.indexOf('stage = "murph_connect_start";');

    expect(disclosureOffset).toBeGreaterThan(0);
    expect(connectOffset).toBeGreaterThan(disclosureOffset);
    const disclosureStep = browserRunner.slice(disclosureOffset, connectOffset);
    expect(disclosureStep).toContain('.getByRole("dialog")');
    expect(disclosureStep).toContain(
      'name: `Continue to ${config.disclosureSourceName}`',
    );
    expect(disclosureStep).toContain(".click({ timeout: config.timeoutMs })");
    expect(browserRunner).toContain(
      'disclosureSourceName: source === "garmin"',
    );
  });

  it("keeps provider authorization automated and fail-closed", () => {
    expect(browserRunner).toContain(
      'const manualAuthorizationAllowed = !headless && ci !== "1" && ci !== "true";',
    );
    expect(browserRunner).toContain(
      "if (source === \"oura\" && !manualAuthorizationAllowed && !otp)",
    );
    expect(browserRunner).toContain(
      'browserChannel: browserTransport === "local"',
    );
    expect(browserRunner).toContain("const session = await openBrowserSession(config);");
    expect(browserRunner).toContain("await chromium.connectOverCDP(kernelBrowser.cdpWsUrl");
    expect(browserRunner).toContain("buildKernelTunnelArguments(input.sessionId, input.port)");

    const clickedBranchOffset = browserRunner.indexOf("if (clicked) {");
    const blockedWindowResetOffset = browserRunner.indexOf(
      "automationBlockedObservedAt = null;",
      clickedBranchOffset,
    );
    const challengeClassificationResetOffset = browserRunner.indexOf(
      "blockedWindowObservedChallenge = false;",
      blockedWindowResetOffset,
    );
    const automatedProgressOffset = browserRunner.indexOf(
      "await page.waitForTimeout(750);",
      challengeClassificationResetOffset,
    );
    const manualRecoveryOffset = browserRunner.indexOf(
      "if (config.manualAuthorizationAllowed) {",
      automatedProgressOffset,
    );
    expect(clickedBranchOffset).toBeGreaterThan(0);
    expect(blockedWindowResetOffset).toBeGreaterThan(clickedBranchOffset);
    expect(challengeClassificationResetOffset).toBeGreaterThan(
      blockedWindowResetOffset,
    );
    expect(automatedProgressOffset).toBeGreaterThan(
      challengeClassificationResetOffset,
    );
    expect(manualRecoveryOffset).toBeGreaterThan(automatedProgressOffset);
  });

  it("keeps Playwright's closing quote out of redacted navigation URLs", () => {
    expect(browserRunner).toContain(
      'message.replace(/(?:https?|wss?):\\/\\/[^\\s)"\']+/gu, (rawUrl) => {',
    );
  });
});
