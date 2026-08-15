import { describe, expect, it } from "vitest";

import {
  inspectNativeIosHostedE2eBoundary,
  readNativeIosHostedE2eSources,
} from "./check-native-ios-hosted-e2e-ci.mjs";

function issueCodes(sources: Awaited<ReturnType<typeof readNativeIosHostedE2eSources>>): string[] {
  return inspectNativeIosHostedE2eBoundary(sources).map((issue) => issue.code);
}

describe("native iOS hosted E2E CI boundary", () => {
  it("accepts the checked-in trusted hosted/native control plane", async () => {
    expect(issueCodes(await readNativeIosHostedE2eSources())).toEqual([]);
  });

  it("requires read-only pull-request API authority for selection", async () => {
    const sources = await readNativeIosHostedE2eSources();
    expect(issueCodes({
      ...sources,
      workflow: sources.workflow.replace("  pull-requests: read\n", ""),
    })).toContain("missing-pr-read-authority");
  });

  it("rejects running secret authority directly from pull_request_target", async () => {
    const sources = await readNativeIosHostedE2eSources();
    expect(issueCodes({
      ...sources,
      workflow: sources.workflow.replace("  workflow_run:\n", "  pull_request_target:\n  workflow_run:\n"),
    })).toContain("unsafe-direct-pr-trigger");
  });

  it("rejects checking out the PR head onto the secret-bearing runner", async () => {
    const sources = await readNativeIosHostedE2eSources();
    expect(issueCodes({
      ...sources,
      workflow: sources.workflow.replace(
        "ref: ${{ github.sha }}",
        "ref: ${{ needs.classify-pr.outputs.head_sha }}",
      ),
    })).toContain("unsafe-untrusted-checkout");
  });

  it("rejects losing exact Web deployment or exact private iOS pinning", async () => {
    const sources = await readNativeIosHostedE2eSources();
    const workflow = sources.workflow
      .replace('--sha "${PR_HEAD_SHA}"', '--sha "main"')
      .replaceAll("NATIVE_IOS_E2E_IOS_EXPECTED_SHA", "REMOVED_IOS_EXPECTED_SHA");
    expect(issueCodes({ ...sources, workflow })).toEqual(expect.arrayContaining([
      "missing-exact-web-sha",
      "missing-private-sha-pin",
    ]));
  });

  it("rejects dropping the custom-environment id from the deployment step", async () => {
    const sources = await readNativeIosHostedE2eSources();
    const deploymentStepPrefix = `      - name: Deploy exact PR SHA to dedicated hosted E2E Web project
        id: web
        env:
          NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID: \${{ vars.NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID }}`;
    expect(sources.workflow).toContain(deploymentStepPrefix);
    const workflow = sources.workflow.replace(
      deploymentStepPrefix,
      `      - name: Deploy exact PR SHA to dedicated hosted E2E Web project
        id: web
        env:`,
    );
    expect(issueCodes({ ...sources, workflow }))
      .toContain("missing-vercel-custom-environment-id-config");
  });

  it("rejects losing the exact configured Vercel custom-environment identity", async () => {
    const sources = await readNativeIosHostedE2eSources();
    const control = sources.control
      .replace("inspectVercelE2eCustomEnvironment(customEnvironment", "removedCustomEnvironmentProof(customEnvironment")
      .replace("readString(raw.customEnvironmentId) !== expected.expectedCustomEnvironmentId", "false");
    expect(issueCodes({ ...sources, control })).toEqual(expect.arrayContaining([
      "missing-vercel-custom-environment-lookup",
      "missing-vercel-custom-environment-proof",
    ]));
  });

  it("rejects delaying the Vercel deployment id past the fail-closed provenance boundary", async () => {
    const sources = await readNativeIosHostedE2eSources();
    const control = sources.control.replace(
      'await writeGithubOutput("deployment_id", deploymentId);',
      'await delayedCleanupOutput("deployment_id", deploymentId);',
    );
    expect(issueCodes({ ...sources, control }))
      .toContain("missing-early-vercel-cleanup-id");
  });

  it("rejects dispatching before resolving the protected private tag to the approved SHA", async () => {
    const sources = await readNativeIosHostedE2eSources();
    const control = sources.control
      .replace("/git/ref/tags/${tagPath}", "/commits/${tagPath}")
      .replace("inspectPrivateWorkflowDispatchTag(dispatchTag", "removedPrivateTagProof(dispatchTag");
    expect(issueCodes({ ...sources, control })).toEqual(expect.arrayContaining([
      "missing-private-tag-preflight",
      "missing-private-tag-sha-proof",
    ]));
  });

  it("rejects private logs/artifacts or native capture artifacts crossing the boundary", async () => {
    const sources = await readNativeIosHostedE2eSources();
    const workflow = `${sources.workflow}\n- uses: actions/upload-artifact@deadbeef\n  with:\n    path: result.xcresult\n# /logs screenshot recordVideo startTracing\n`;
    expect(issueCodes({ ...sources, workflow })).toEqual(expect.arrayContaining([
      "forbidden-artifact-upload",
      "forbidden-private-log-read",
      "forbidden-xcresult-boundary",
      "forbidden-screenshot-boundary",
      "forbidden-video-boundary",
      "forbidden-trace-boundary",
    ]));
  });

  it("rejects replacing the hosted deployment with hosted-local", async () => {
    const sources = await readNativeIosHostedE2eSources();
    expect(issueCodes({
      ...sources,
      workflow: `${sources.workflow}\n# pnpm hosted-local e2e\n`,
    })).toContain("forbidden-hermetic-hosted-substitute");
  });

  it("rejects cleanup cancellation or removal", async () => {
    const sources = await readNativeIosHostedE2eSources();
    const workflow = sources.workflow
      .replaceAll("cancel-in-progress: false", "cancel-in-progress: true")
      .replace("if: ${{ always() && steps.web.outputs.deployment_id != '' }}", "if: ${{ success() }}");
    expect(issueCodes({ ...sources, workflow })).toEqual(expect.arrayContaining([
      "unsafe-live-cancellation",
      "missing-preview-cleanup",
    ]));
  });

  it("rejects losing the real custom-environment database/public-URL boundary", async () => {
    const sources = await readNativeIosHostedE2eSources();
    expect(issueCodes({
      ...sources,
      e2eMigration: sources.e2eMigration
        .replace('nativeIosHostedE2eVercelTargetEnvironment = "native-ios-e2e"', 'nativeIosHostedE2eVercelTargetEnvironment = "preview"')
        .replace('MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS: "1"', 'MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS: "0"')
        .replace("const divergentMigrations = findNativeIosHostedE2eDivergentAppliedMigrations(", "const divergentMigrations = removedHistoryCheck("),
      publicUrl: sources.publicUrl.replace(
        "source.VERCEL_URL",
        "source.VERCEL_PROJECT_PRODUCTION_URL",
      ),
    })).toEqual(expect.arrayContaining([
      "missing-e2e-migration-target",
      "missing-e2e-direct-database",
      "missing-prisma-ledger-source-check",
      "missing-e2e-exact-public-url",
    ]));
  });

  it("rejects removing the custom-environment migration from the normal Vercel build", async () => {
    const sources = await readNativeIosHostedE2eSources();
    const parsed = JSON.parse(sources.vercel) as { buildCommand: string };
    parsed.buildCommand = parsed.buildCommand.replace(
      "pnpm release:native-ios-hosted-e2e:migrate && ",
      "",
    );
    expect(issueCodes({ ...sources, vercel: JSON.stringify(parsed) }))
      .toContain("missing-e2e-migration-build-owner");
  });

  it("rejects production auto-deployment of arbitrary Web branches", async () => {
    const sources = await readNativeIosHostedE2eSources();
    const parsed = JSON.parse(sources.vercel) as { git: { deploymentEnabled: Record<string, boolean> } };
    parsed.git.deploymentEnabled["*"] = true;
    expect(issueCodes({ ...sources, vercel: JSON.stringify(parsed) }))
      .toContain("unsafe-vercel-branch-auto-deploy");
  });


  it("rejects losing the dispatch receipt API pin or exposing Vercel build output", async () => {
    const sources = await readNativeIosHostedE2eSources();
    const control = sources.control
      .replace('const GITHUB_API_VERSION = "2026-03-10";', 'const GITHUB_API_VERSION = "legacy";')
      .replace("public: false", "public: true");
    expect(issueCodes({ ...sources, control })).toEqual(expect.arrayContaining([
      "missing-github-api-version",
      "missing-private-vercel-build-output",
    ]));
  });

  it("rejects over-reading the private workflow instead of consuming only status/conclusion", async () => {
    const sources = await readNativeIosHostedE2eSources();
    expect(issueCodes({
      ...sources,
      control: `${sources.control}\nconst forbidden = "/actions/runs/1/logs"; void forbidden;\n`,
    })).toContain("private-result-overread:/logs");
  });
});
