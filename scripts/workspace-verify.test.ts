import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workspaceVerify = readFileSync(
  path.join(repoRoot, "scripts", "workspace-verify.sh"),
  "utf8",
);

function extractWorkspaceVerifyFunction(functionName: string): string {
  const functionSource = workspaceVerify.match(
    new RegExp(`^${functionName}\\(\\) \\{[\\s\\S]*?^\\}`, "m"),
  )?.[0];

  if (!functionSource) {
    throw new Error(`Could not find ${functionName} in workspace-verify.sh`);
  }

  return functionSource;
}

function runShellHarness(source: string) {
  const harnessDir = mkdtempSync(
    path.join(os.tmpdir(), "murph-workspace-verify-function-"),
  );
  const harnessPath = path.join(harnessDir, "harness.sh");

  try {
    writeFileSync(harnessPath, source, "utf8");
    return spawnSync("bash", [harnessPath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 10_000,
    });
  } finally {
    rmSync(harnessDir, { force: true, recursive: true });
  }
}

describe("workspace verification orchestration", () => {
  it("holds the parent artifact lock for commands that write or concurrently consume shared outputs", () => {
    const lockRouting = workspaceVerify.match(
      /command_requires_workspace_artifact_lock\(\) \{[\s\S]*?^\}/m,
    )?.[0];

    expect(lockRouting).toContain('"test"');
    expect(lockRouting).toContain('"test:packages"');
    expect(lockRouting).toContain('"test:apps"');
    expect(lockRouting).toContain('"test:diff"');
    expect(workspaceVerify).toContain("run_test_apps_with_workspace_artifact_lock");
    expect(workspaceVerify).toContain('pnpm --dir "apps/web" prisma:generate');
    expect(workspaceVerify).toContain("generate_health_commons_artifacts_with_retry");
  });

  it("acquires checkout artifact locks before shared-host admission", () => {
    const cloudflareVerify = readFileSync(
      path.join(repoRoot, "apps", "cloudflare", "scripts", "verify-fast.sh"),
      "utf8",
    );
    const preparedRuntimeBuild = readFileSync(
      path.join(repoRoot, "scripts", "build-test-runtime-prepared.mjs"),
      "utf8",
    );

    for (const [label, source, artifactMarker, hostMarker] of [
      [
        "workspace verification",
        workspaceVerify,
        'MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}',
        'MURPH_VERIFY_HOST_SLOT_HELD:-0}',
      ],
      [
        "Cloudflare verification",
        cloudflareVerify,
        'MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}',
        'MURPH_VERIFY_HOST_SLOT_HELD:-0}',
      ],
      [
        "prepared runtime build",
        preparedRuntimeBuild,
        'MURPH_WORKSPACE_ARTIFACT_LOCK_HELD !== "1"',
        'MURPH_VERIFY_HOST_SLOT_HELD !== "1"',
      ],
    ] as const) {
      const artifactIndex = source.indexOf(artifactMarker);
      const hostIndex = source.indexOf(hostMarker);
      expect(artifactIndex, `${label} artifact lock`).toBeGreaterThanOrEqual(0);
      expect(hostIndex, `${label} host slot`).toBeGreaterThan(artifactIndex);
    }

    const rootPackage = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const benchmarkScript = rootPackage.scripts["benchmark:typescript"];
    expect(benchmarkScript.indexOf("run-with-workspace-artifact-lock.mjs"))
      .toBeLessThan(benchmarkScript.indexOf("run-with-host-verification-slot.mjs"));
  });

  it("sets only the matching app typecheck reuse flag", () => {
    const runAppVerify = extractWorkspaceVerifyFunction(
      "run_app_verify_command_with_retry",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -uo pipefail

run_command_with_retry() {
  shift
  printf '%s\\n' "$*"
}

${runAppVerify}

run_app_verify_command_with_retry apps/web 1 1 1
run_app_verify_command_with_retry apps/cloudflare 1 1 1
run_app_verify_command_with_retry apps/web 0 0 0
run_app_verify_command_with_retry apps/cloudflare 0 0 0
`);

    expect(result.status, result.stderr).toBe(0);
    const [preparedWeb, preparedCloudflare, standaloneWeb, standaloneCloudflare] =
      result.stdout.trim().split("\n");

    expect(preparedWeb).toContain("MURPH_HOSTED_WEB_VERIFY_SKIP_TYPECHECK=1");
    expect(preparedWeb).not.toContain("MURPH_CLOUDFLARE_VERIFY_SKIP_TYPECHECK");
    expect(preparedCloudflare).toContain("MURPH_CLOUDFLARE_VERIFY_SKIP_TYPECHECK=1");
    expect(preparedCloudflare).not.toContain("MURPH_HOSTED_WEB_VERIFY_SKIP_TYPECHECK");
    expect(standaloneWeb).not.toContain("VERIFY_SKIP_TYPECHECK");
    expect(standaloneCloudflare).not.toContain("VERIFY_SKIP_TYPECHECK");
  });

  it("prepares shared app inputs once before overlapping both app verifications", () => {
    const harnessDir = mkdtempSync(
      path.join(os.tmpdir(), "murph-workspace-verify-apps-"),
    );
    const fakeBinDir = path.join(harnessDir, "bin");
    const eventLogPath = path.join(harnessDir, "events.log");

    try {
      mkdirSync(fakeBinDir);

      const fakePnpmPath = path.join(fakeBinDir, "pnpm");
      writeFileSync(
        fakePnpmPath,
        `#!/usr/bin/env bash
set -euo pipefail

event_log="\${MURPH_VERIFY_TEST_EVENT_LOG:?}"

case "$*" in
  *"health-commons:generate"*)
    printf 'health-commons:generate\\n' >> "$event_log"
    ;;
  *"prisma:generate"*)
    printf 'prisma:generate\\n' >> "$event_log"
    ;;
  *"apps/web verify"*)
    app="web"
    ;;
  *"apps/cloudflare verify"*)
    app="cloudflare"
    ;;
  *)
    printf 'unexpected:%s\\n' "$*" >> "$event_log"
    exit 1
    ;;
esac

if [[ -n "\${app:-}" ]]; then
  printf '%s:start:health=%s:prisma=%s\\n' \
    "$app" \
    "\${MURPH_HEALTH_COMMONS_GENERATED_PREPARED:-0}" \
    "\${MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED:-0}" >> "$event_log"

  for _attempt in {1..100}; do
    start_count="$(grep -c ':start:' "$event_log" || true)"
    if [[ "$start_count" -ge 2 ]]; then
      printf '%s:end\\n' "$app" >> "$event_log"
      exit 0
    fi
    sleep 0.02
  done

  printf '%s:serialized\\n' "$app" >> "$event_log"
  exit 1
fi
`,
        "utf8",
      );
      chmodSync(fakePnpmPath, 0o755);

      const result = spawnSync(
        "bash",
        ["scripts/workspace-verify.sh", "test:apps"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            MURPH_APP_VERIFY_PARALLEL: "1",
            MURPH_VERIFY_RETRY_COUNT: "0",
            MURPH_VERIFY_TEST_EVENT_LOG: eventLogPath,
            MURPH_WORKSPACE_ARTIFACT_LOCK_HELD: "1",
            PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
          },
          timeout: 10_000,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const events = readFileSync(eventLogPath, "utf8").trim().split("\n");

      expect(events.slice(0, 2)).toEqual([
        "health-commons:generate",
        "prisma:generate",
      ]);
      expect(
        events.filter((event) => event === "health-commons:generate"),
      ).toHaveLength(1);
      expect(
        events.filter((event) => event === "prisma:generate"),
      ).toHaveLength(1);
      expect(events).toContain("web:start:health=1:prisma=1");
      expect(events).toContain("cloudflare:start:health=1:prisma=1");
      expect(events).toContain("web:end");
      expect(events).toContain("cloudflare:end");
      expect(events.some((event) => event.endsWith(":serialized"))).toBe(false);
    } finally {
      rmSync(harnessDir, { force: true, recursive: true });
    }
  });

  it("uses bounded recursive fanout for affected typechecks and package tests", () => {
    const typecheckFanout = workspaceVerify.match(
      /run_typecheck_packages\(\) \{[\s\S]*?^\}/m,
    )?.[0];

    expect(typecheckFanout).toBeTruthy();
    expect(typecheckFanout!.indexOf("run_diff_contracts_build_with_workspace_artifact_lock")).toBeLessThan(
      typecheckFanout!.indexOf('pnpm -r --no-sort --workspace-concurrency="$typecheck_workspace_concurrency"'),
    );
    expect(workspaceVerify).toContain(
      'run_typecheck_packages "${typecheck_dirs[@]}"',
    );
    expect(workspaceVerify).toContain(
      'pnpm -r --no-sort --workspace-concurrency="$test_diff_workspace_concurrency" "${filter_args[@]}" test',
    );
    expect(workspaceVerify).toContain(
      'MURPH_VITEST_MAX_WORKERS="$test_diff_vitest_max_workers"',
    );
    expect(workspaceVerify).toContain("run_diff_contracts_test_with_workspace_artifact_lock");
    expect(workspaceVerify).toContain("run_diff_package_boundary_verification");
  });

  it("propagates affected package fanout failures before boundary checks", () => {
    const runTestDiffPackageTests = extractWorkspaceVerifyFunction(
      "run_test_diff_package_tests",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -uo pipefail

test_diff_workspace_concurrency=2
test_diff_vitest_max_workers=1

run_command_with_retry() {
  printf 'fanout-called\\n'
  return 23
}

run_diff_contracts_test_with_workspace_artifact_lock() {
  return 0
}

run_diff_package_boundary_verification() {
  printf 'boundary-called\\n'
  return 0
}

${runTestDiffPackageTests}

run_test_diff_package_tests packages/core
`);

    expect(result.status, result.stderr).toBe(23);
    expect(result.stdout).toContain("fanout-called\n");
    expect(result.stdout).not.toContain("boundary-called");
  });

  it("propagates both-app verification failures", () => {
    const runTestDiffAppVerification = extractWorkspaceVerifyFunction(
      "run_test_diff_app_verification",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -uo pipefail

run_test_apps_with_workspace_artifact_lock() {
  printf 'both-apps-called\\n'
  return 29
}

run_package_command_without_node_v8_coverage_with_retry() {
  printf 'single-app-called\\n'
  return 0
}

${runTestDiffAppVerification}

run_test_diff_app_verification apps/web apps/cloudflare
`);

    expect(result.status, result.stderr).toBe(29);
    expect(result.stdout).toContain("both-apps-called\n");
    expect(result.stdout).not.toContain("single-app-called");
  });

  it("keeps clean acceptance proof while using warm-safe local test prerequisites", () => {
    const contractsPackage = JSON.parse(
      readFileSync(path.join(repoRoot, "packages", "contracts", "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const contractsScriptsConfig = JSON.parse(
      readFileSync(
        path.join(repoRoot, "packages", "contracts", "tsconfig.scripts.json"),
        "utf8",
      ),
    ) as { compilerOptions: Record<string, boolean | string> };

    expect(workspaceVerify).toContain(
      'pnpm --dir "packages/contracts" test:artifacts:incremental',
    );
    expect(contractsPackage.scripts["test:artifacts"]).toBe(
      "node --run build && node ./dist/scripts/verify.js",
    );
    expect(contractsPackage.scripts.build).toContain(
      "rm-paths.mjs dist tsconfig.build.tsbuildinfo tsconfig.scripts.tsbuildinfo",
    );
    expect(contractsPackage.scripts["test:artifacts:incremental"]).toContain(
      "node --run build:incremental",
    );
    expect(contractsScriptsConfig.compilerOptions.incremental).toBe(true);
    expect(contractsScriptsConfig.compilerOptions.tsBuildInfoFile).toBe(
      "tsconfig.scripts.tsbuildinfo",
    );
  });

  it("applies one worker budget and preserves safe root CLI grouping", () => {
    const rootVitestConfig = readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8");

    expect(rootVitestConfig).toContain("maxWorkers: rootRepoVitestMaxWorkers");
    for (const projectName of [
      "cli-health-tail",
      "cli-read-model",
      "cli-assistant",
      "cli-expansions",
    ]) {
      expect(rootVitestConfig).toContain(`"${projectName}"`);
    }
    expect(rootVitestConfig).toContain("ROOT_PARALLEL_CLI_PROJECTS.has");
    expect(workspaceVerify).toContain(
      'local_worker_budget_default "$package_coverage_concurrency_limit" 1',
    );
  });

  it("keeps the root tools incremental cache disposable", () => {
    const toolsTsconfig = JSON.parse(
      readFileSync(path.join(repoRoot, "tsconfig.tools.json"), "utf8"),
    ) as { compilerOptions: Record<string, boolean | string> };
    const rootPackage = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(toolsTsconfig.compilerOptions.incremental).toBe(true);
    expect(toolsTsconfig.compilerOptions.tsBuildInfoFile).toBe(
      "tsconfig.tools.tsbuildinfo",
    );
    expect(rootPackage.scripts.clean).toContain("tsconfig.tools.tsbuildinfo");
  });
});
