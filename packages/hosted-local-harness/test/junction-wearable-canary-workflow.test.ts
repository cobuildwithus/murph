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
  it("admits secrets only after protected main updates or manual retries", () => {
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toMatch(
      /^on:\n  push:\n    branches:\n      - main\n  workflow_dispatch:/mu,
    );
    expect(workflow).not.toMatch(
      /^\s*(pull_request|pull_request_target|repository_dispatch|schedule):/mu,
    );
    expect(workflow).toContain(
      "if: ${{ github.ref == 'refs/heads/main' && github.ref_protected }}",
    );
    expect(workflow).toContain("environment: junction-wearable-canary");
    expect(workflow).toContain("group: live-junction-wearable-canary");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("keeps the credential set step-scoped and artifact-free", () => {
    const liveStepMarker = "      - name: Run live Junction wearable browser canary\n";
    const liveStepOffset = workflow.indexOf(liveStepMarker);
    expect(liveStepOffset).toBeGreaterThan(0);
    expect(workflow.slice(0, liveStepOffset)).not.toContain("${{ secrets.");

    const secretNames = [...workflow.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/gu)]
      .map((match) => match[1])
      .sort();
    expect(secretNames).toEqual([
      "GARMIN_CANARY_EMAIL",
      "GARMIN_CANARY_PASSWORD",
      "JUNCTION_API_KEY",
      "JUNCTION_CLIENT_USER_ID_SECRET",
      "KERNEL_API_KEY",
    ]);
    expect(workflow).not.toContain("actions/upload-artifact");
    expect(workflow).not.toContain("WHOOP_CLIENT_ID");
    expect(workflow).not.toContain("WHOOP_CLIENT_SECRET");
    expect(workflow).not.toContain("OURA_CLIENT_ID");
    expect(workflow).not.toContain("OURA_CLIENT_SECRET");
  });

  it("exposes the repository-pinned Codex CLI before hosted-local starts", () => {
    const installStepMarker =
      "      - name: Expose pinned workspace Codex CLI for hosted-local model catalog\n";
    const liveStepMarker = "      - name: Run live Junction wearable browser canary\n";
    const installStepOffset = workflow.indexOf(installStepMarker);
    const liveStepOffset = workflow.indexOf(liveStepMarker);
    expect(installStepOffset).toBeGreaterThan(0);
    expect(liveStepOffset).toBeGreaterThan(installStepOffset);

    const installStep = workflow.slice(installStepOffset, liveStepOffset);
    expect(installStep).toContain(
      'codex_bin_dir="$GITHUB_WORKSPACE/packages/assistant-engine/node_modules/.bin"',
    );
    expect(installStep).toContain('echo "${codex_bin_dir}" >> "$GITHUB_PATH"');
    expect(installStep).toContain('"${codex_bin_dir}/codex" --version');
    expect(installStep).not.toContain("npm install");
    expect(installStep).not.toContain("${{ secrets.");
    expect(workflow).not.toMatch(/@openai\/codex@\d/u);
  });

  it("runs only the sandbox browser proof with pinned actions", () => {
    expect(workflow).toContain("JUNCTION_ENV: sandbox");
    expect(workflow).toContain("MURPH_DEV_TEMPORAL: disabled");
    expect(workflow).toContain('MURPH_E2E_JUNCTION_WEARABLE_LIVE: "1"');
    expect(workflow).toContain("MURPH_E2E_JUNCTION_WEARABLE_SOURCES: garmin");
    expect(workflow).toContain("MURPH_E2E_PROVIDER_BROWSER: kernel");
    expect(workflow).toContain('MURPH_E2E_WEARABLE_HEADLESS: "1"');
    expect(workflow).toContain("      - name: Prepare pinned Kernel tunnel tools\n");
    expect(workflow).toContain(
      "https://github.com/kernel/cli/releases/download/v0.31.0/kernel_0.31.0_linux_amd64.tar.gz",
    );
    expect(workflow).toContain(
      "8a0e41c96b61396f53e2e9e6593a3f987f836cdd39870ed2649916f711b9377c",
    );
    expect(workflow).toContain('"${tools_dir}/kernel" --version');
    expect(workflow).toContain(
      'echo "MURPH_E2E_KERNEL_CLI_PATH=${tools_dir}/kernel" >> "$GITHUB_ENV"',
    );
    expect(workflow).toContain(
      "https://github.com/vi/websocat/releases/download/v1.14.1/websocat.x86_64-unknown-linux-musl",
    );
    expect(workflow).toContain(
      "66f8dd3a0394761556339117f8bb5123bddefd44e087af2a72ec22b0bd08d514",
    );
    expect(workflow).toContain("sha256sum --check --strict");
    expect(workflow).not.toContain("playwright install");
    expect(workflow).not.toContain("google-chrome");
    expect(workflow).not.toContain("xvfb-run");
    expect(workflow).toContain("run: pnpm hosted-local e2e device-connect");
    expect(workflow).toContain("image: public.ecr.aws/docker/library/postgres:17");

    const actionRefs = [...workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gmu)];
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const actionRef of actionRefs) {
      expect(actionRef[1]).toMatch(/^[a-f0-9]{40}$/u);
    }
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
