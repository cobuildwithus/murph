import { describe, expect, it } from "vitest";

import {
  buildNativeIosHostedE2eDispatchInputs,
  classifyNativeIosHostedE2ePaths,
  inspectPrivateWorkflowDispatchTag,
  inspectPrivateWorkflowRun,
  inspectVercelE2eCustomEnvironment,
  inspectVercelE2eDeployment,
  NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET_ENV,
  readVercelDeploymentId,
  readWorkflowDispatchRunId,
} from "./native-ios-hosted-e2e-control.mjs";

const WEB_SHA = "a".repeat(40);
const IOS_SHA = "b".repeat(40);

function readyDeployment(overrides: Record<string, unknown> = {}) {
  return {
    customEnvironmentId: "env_native_e2e",
    gitSource: {
      ref: "feature/native-ios-auth",
      sha: WEB_SHA,
      type: "github",
    },
    id: "dpl_exact",
    projectId: "prj_native_e2e",
    readyState: "READY",
    target: null,
    url: "native-e2e-abc.vercel.app",
    ...overrides,
  };
}

describe("native iOS hosted E2E path selection", () => {
  it("selects auth, companion, device-sync, database, and control owners", () => {
    expect(classifyNativeIosHostedE2ePaths([
      "apps/web/src/lib/hosted-onboarding/request-auth.ts",
      "apps/web/app/api/device-sync/companion/sign-in-token/route.ts",
      "apps/web/app/api/legal/consent/accept/route.ts",
      "apps/web/app/api/settings/sensitive-action-challenge/route.ts",
      "packages/device-syncd/src/junction.ts",
      "apps/web/prisma/migrations/20260815_contract/migration.sql",
      "apps/web/scripts/run-native-ios-hosted-e2e-migrations.ts",
      "apps/web/src/lib/prisma.ts",
      ".github/workflows/repo-hygiene.yml",
      ".github/workflows/native-ios-hosted-e2e.yml",
    ])).toEqual({
      matchedPaths: [
        "apps/web/src/lib/hosted-onboarding/request-auth.ts",
        "apps/web/app/api/device-sync/companion/sign-in-token/route.ts",
        "apps/web/app/api/legal/consent/accept/route.ts",
        "apps/web/app/api/settings/sensitive-action-challenge/route.ts",
        "packages/device-syncd/src/junction.ts",
        "apps/web/prisma/migrations/20260815_contract/migration.sql",
        "apps/web/scripts/run-native-ios-hosted-e2e-migrations.ts",
        "apps/web/src/lib/prisma.ts",
        ".github/workflows/repo-hygiene.yml",
        ".github/workflows/native-ios-hosted-e2e.yml",
      ],
      selected: true,
    });
  });

  it("leaves postdeploy contract cleanup with its separate production owner", () => {
    expect(classifyNativeIosHostedE2ePaths([
      "apps/web/prisma/contract-migrations/20260815_cleanup/migration.sql",
    ])).toEqual({ matchedPaths: [], selected: false });
  });

  it("does not select unrelated documentation", () => {
    expect(classifyNativeIosHostedE2ePaths(["README.md", "docs/cli.md"]))
      .toEqual({ matchedPaths: [], selected: false });
  });
});

describe("native iOS hosted E2E dispatch contract", () => {
  it("binds PR proof to user-owned deletion and the exact preview target", () => {
    expect(buildNativeIosHostedE2eDispatchInputs({
      correlationId: "murph-pr-exact",
      mode: "pr",
      webBaseUrl: "https://native-e2e.vercel.app",
      webDeploymentRef: "dpl_exact",
      webSha: WEB_SHA,
    })).toEqual({
      account_lifecycle: "user_owned_delete",
      contract_version: "1",
      correlation_id: "murph-pr-exact",
      mode: "pr",
      web_base_url: "https://native-e2e.vercel.app",
      web_deployment_ref: "dpl_exact",
      web_environment: "native-ios-e2e",
      web_sha: WEB_SHA,
    });
  });

  it("binds production proof to the non-destructive persistent identity lifecycle", () => {
    expect(buildNativeIosHostedE2eDispatchInputs({
      correlationId: "murph-prod-exact",
      mode: "production_canary",
      webBaseUrl: "https://app.example.test",
      webDeploymentRef: `production-alias:${WEB_SHA}`,
      webSha: WEB_SHA,
    })).toEqual(expect.objectContaining({
      account_lifecycle: "existing_identity_non_destructive",
      mode: "production_canary",
      web_environment: "production",
      web_sha: WEB_SHA,
    }));
  });

  it("rejects non-origin URLs and non-exact SHAs", () => {
    expect(() => buildNativeIosHostedE2eDispatchInputs({
      correlationId: "bad-url",
      mode: "pr",
      webBaseUrl: "https://native-e2e.vercel.app/path",
      webDeploymentRef: "dpl_exact",
      webSha: WEB_SHA,
    })).toThrow("origin-only HTTPS");
    expect(() => buildNativeIosHostedE2eDispatchInputs({
      correlationId: "bad-sha",
      mode: "pr",
      webBaseUrl: "https://native-e2e.vercel.app",
      webDeploymentRef: "dpl_exact",
      webSha: "main",
    })).toThrow("40-character Git SHA");
  });
});

describe("exact hosted deployment proof", () => {
  it("reads only the deployment id from the create response before read-back proof", () => {
    expect(readVercelDeploymentId({ id: "dpl_exact" })).toBe("dpl_exact");
    expect(() => readVercelDeploymentId({})).toThrow("did not include id");
  });

  it("pins the dedicated Vercel custom environment slug", () => {
    expect(NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET_ENV).toBe("native-ios-e2e");
  });

  it("pins the configured Vercel custom-environment id to the required slug/project", () => {
    expect(() => inspectVercelE2eCustomEnvironment({
      id: "env_native_e2e",
      projectId: "prj_native_e2e",
      slug: "native-ios-e2e",
    }, {
      expectedEnvironmentId: "env_native_e2e",
      expectedProjectId: "prj_native_e2e",
    })).not.toThrow();
    expect(() => inspectVercelE2eCustomEnvironment({
      id: "env_native_e2e",
      projectId: "prj_native_e2e",
      slug: "preview",
    }, {
      expectedEnvironmentId: "env_native_e2e",
      expectedProjectId: "prj_native_e2e",
    })).toThrow("required native iOS E2E slug");
    expect(() => inspectVercelE2eCustomEnvironment({
      id: "env_wrong",
      projectId: "prj_native_e2e",
      slug: "native-ios-e2e",
    }, {
      expectedEnvironmentId: "env_native_e2e",
      expectedProjectId: "prj_native_e2e",
    })).toThrow("protected configuration");
    expect(() => inspectVercelE2eCustomEnvironment({
      id: "env_native_e2e",
      projectId: "prj_wrong",
      slug: "native-ios-e2e",
    }, {
      expectedEnvironmentId: "env_native_e2e",
      expectedProjectId: "prj_native_e2e",
    })).toThrow("unexpected project");
  });

  it("accepts only the requested E2E project, SHA, and ref", () => {
    expect(inspectVercelE2eDeployment(readyDeployment(), {
      expectedCustomEnvironmentId: "env_native_e2e",
      expectedProjectId: "prj_native_e2e",
      expectedRef: "feature/native-ios-auth",
      expectedSha: WEB_SHA,
    })).toEqual({
      baseUrl: "https://native-e2e-abc.vercel.app",
      deploymentId: "dpl_exact",
      ready: true,
      terminalFailure: false,
    });
  });

  it("rejects a deployment for another SHA, project, ref, or production target", () => {
    const expected = {
      expectedCustomEnvironmentId: "env_native_e2e",
      expectedProjectId: "prj_native_e2e",
      expectedRef: "feature/native-ios-auth",
      expectedSha: WEB_SHA,
    };
    expect(() => inspectVercelE2eDeployment(readyDeployment({
      gitSource: { ref: "feature/native-ios-auth", sha: "c".repeat(40) },
    }), expected)).toThrow("requested PR SHA");
    expect(() => inspectVercelE2eDeployment(readyDeployment({ projectId: "prj_prod" }), expected))
      .toThrow("unexpected project");
    expect(() => inspectVercelE2eDeployment(readyDeployment({ customEnvironmentId: "env_other" }), expected))
      .toThrow("unexpected custom environment");
    expect(() => inspectVercelE2eDeployment(readyDeployment({ customEnvironmentId: undefined }), expected))
      .toThrow("unexpected custom environment");
    expect(() => inspectVercelE2eDeployment(readyDeployment({
      gitSource: { ref: "other", sha: WEB_SHA },
    }), expected)).toThrow("requested PR ref");
    expect(() => inspectVercelE2eDeployment(readyDeployment({ target: "production" }), expected))
      .toThrow("must never target a production");
  });
});

describe("private workflow receipt/result proof", () => {
  it("admits dispatch only from the configured lightweight tag at the approved SHA", () => {
    expect(() => inspectPrivateWorkflowDispatchTag({
      object: { sha: IOS_SHA, type: "commit" },
      ref: "refs/tags/native-ios-e2e/v1",
    }, {
      expectedRef: "native-ios-e2e/v1",
      expectedSha: IOS_SHA,
    })).not.toThrow();

    expect(() => inspectPrivateWorkflowDispatchTag({
      object: { sha: "c".repeat(40), type: "commit" },
      ref: "refs/tags/native-ios-e2e/v1",
    }, {
      expectedRef: "native-ios-e2e/v1",
      expectedSha: IOS_SHA,
    })).toThrow("approved commit SHA");
    expect(() => inspectPrivateWorkflowDispatchTag({
      object: { sha: IOS_SHA, type: "tag" },
      ref: "refs/tags/native-ios-e2e/v1",
    }, {
      expectedRef: "native-ios-e2e/v1",
      expectedSha: IOS_SHA,
    })).toThrow("lightweight commit tag");
  });

  it("reads the exact dispatch receipt and accepts only the pinned workflow run", () => {
    const runId = readWorkflowDispatchRunId({ workflow_run_id: 12345 });
    expect(runId).toBe(12345);
    expect(inspectPrivateWorkflowRun({
      conclusion: "success",
      event: "workflow_dispatch",
      head_sha: IOS_SHA,
      id: runId,
      status: "completed",
    }, {
      expectedHeadSha: IOS_SHA,
      expectedRunId: runId,
    })).toEqual({ completed: true, conclusion: "success" });
  });

  it("rejects a result from another run, event, or iOS SHA", () => {
    expect(() => inspectPrivateWorkflowRun({
      conclusion: null,
      event: "workflow_dispatch",
      head_sha: IOS_SHA,
      id: 99,
      status: "queued",
    }, { expectedHeadSha: IOS_SHA, expectedRunId: 100 })).toThrow("unexpected workflow run id");
    expect(() => inspectPrivateWorkflowRun({
      conclusion: null,
      event: "push",
      head_sha: IOS_SHA,
      id: 100,
      status: "queued",
    }, { expectedHeadSha: IOS_SHA, expectedRunId: 100 })).toThrow("workflow_dispatch");
    expect(() => inspectPrivateWorkflowRun({
      conclusion: null,
      event: "workflow_dispatch",
      head_sha: "c".repeat(40),
      id: 100,
      status: "queued",
    }, { expectedHeadSha: IOS_SHA, expectedRunId: 100 })).toThrow("unexpected commit SHA");
  });
});
