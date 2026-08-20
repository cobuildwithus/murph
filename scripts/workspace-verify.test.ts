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
import { pathToFileURL } from "node:url";

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

function runShellHarness(source: string, timeout = 10_000) {
  const harnessDir = mkdtempSync(
    path.join(os.tmpdir(), "murph-workspace-verify-function-"),
  );
  const harnessPath = path.join(harnessDir, "harness.sh");

  try {
    writeFileSync(harnessPath, source, "utf8");
    return spawnSync("bash", [harnessPath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout,
    });
  } finally {
    rmSync(harnessDir, { force: true, recursive: true });
  }
}

function readSanitizedCrabboxVerificationEnvironment(): Record<string, string> {
  const runnerUrl = pathToFileURL(
    path.join(repoRoot, "scripts", "crabbox", "run-verification.mjs"),
  ).href;
  const source = `
    const module = await import(${JSON.stringify(runnerUrl)});
    const environment = module.buildSanitizedVerificationEnvironment({
      HOME: "/home/crabbox",
      PATH: "/usr/bin:/bin",
    });
    process.stdout.write(JSON.stringify(environment));
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, string>;
}

describe("workspace verification orchestration", () => {
  it("detects macOS physical memory in MiB", () => {
    const detectPhysicalMemory = extractWorkspaceVerifyFunction(
      "detect_physical_memory_mib",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

sysctl() {
  [[ "$1" == "-n" && "$2" == "hw.memsize" ]]
  printf '34359738368\\n'
}

${detectPhysicalMemory}

detect_physical_memory_mib
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("32768\n");
  });

  it("enables composed acceptance only for resource-qualified non-CI hosts", () => {
    const resolveComposedAcceptanceDefault = extractWorkspaceVerifyFunction(
      "resolve_composed_acceptance_parallel_default",
    );
    const staticSshComposedAcceptanceAvailable = extractWorkspaceVerifyFunction(
      "static_ssh_composed_acceptance_available",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

detected_cpus=4
detected_memory_mib=32768
detect_logical_cpu_count() { printf '%s\\n' "$detected_cpus"; }
detect_physical_memory_mib() { printf '%s\\n' "$detected_memory_mib"; }

${staticSshComposedAcceptanceAvailable}
${resolveComposedAcceptanceDefault}

CI=
shared_host_mode=1
verification_command=verify:acceptance
resolve_composed_acceptance_parallel_default

detected_cpus=8
resolve_composed_acceptance_parallel_default

detected_cpus=12
resolve_composed_acceptance_parallel_default

detected_cpus=16
resolve_composed_acceptance_parallel_default

shared_host_mode=0
resolve_composed_acceptance_parallel_default

verification_command=test:coverage
resolve_composed_acceptance_parallel_default

CI=1
verification_command=verify:acceptance
resolve_composed_acceptance_parallel_default

CI=
verification_profile=static-ssh
detected_cpus=9
resolve_composed_acceptance_parallel_default

detected_cpus=10
detected_memory_mib=24575
resolve_composed_acceptance_parallel_default

detected_memory_mib=24576
resolve_composed_acceptance_parallel_default
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("0\n0\n1\n1\n1\n0\n0\n0\n0\n1\n");
  });

  it("resolves package coverage concurrency to one value in every environment", () => {
    const resolveConcurrencyDefault = extractWorkspaceVerifyFunction(
      "resolve_package_coverage_concurrency_default",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

local_concurrency_default() {
  printf '%s\\n' "$1"
}

${resolveConcurrencyDefault}

CI=1
shared_host_mode=0
composed_acceptance_parallel=0
resolve_package_coverage_concurrency_default

CI=
shared_host_mode=1
resolve_package_coverage_concurrency_default

shared_host_mode=0
resolve_package_coverage_concurrency_default

composed_acceptance_parallel=1
resolve_package_coverage_concurrency_default

verification_profile=static-ssh
composed_acceptance_parallel=0
resolve_package_coverage_concurrency_default

composed_acceptance_parallel=1
resolve_package_coverage_concurrency_default
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("1\n2\n6\n5\n2\n3\n");
  });

  it("leaves subprocess headroom while CLI coverage is active", () => {
    const resolveCliActiveConcurrency = extractWorkspaceVerifyFunction(
      "resolve_package_coverage_cli_active_concurrency_default",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

${resolveCliActiveConcurrency}

CI=1
shared_host_mode=0
composed_acceptance_parallel=0
resolve_package_coverage_cli_active_concurrency_default

CI=
shared_host_mode=1
resolve_package_coverage_cli_active_concurrency_default

shared_host_mode=0
resolve_package_coverage_cli_active_concurrency_default

composed_acceptance_parallel=1
resolve_package_coverage_cli_active_concurrency_default

verification_profile=static-ssh
composed_acceptance_parallel=0
resolve_package_coverage_cli_active_concurrency_default

composed_acceptance_parallel=1
resolve_package_coverage_cli_active_concurrency_default
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("1\n1\n4\n2\n1\n2\n");
  });

  it("reserves capable-host CPU headroom for overlapping app work", () => {
    const resolvePackageWorkers = extractWorkspaceVerifyFunction(
      "resolve_package_coverage_vitest_max_workers_default",
    );
    const resolveAppWorkers = extractWorkspaceVerifyFunction(
      "resolve_acceptance_app_vitest_max_workers_default",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

detected_cpus=16
detect_logical_cpu_count() { printf '%s\\n' "$detected_cpus"; }
normalize_positive_integer() {
  if [[ "$1" =~ ^[1-9][0-9]*$ ]]; then printf '%s\\n' "$1"; else printf '%s\\n' "$2"; fi
}
local_worker_budget_default() { printf 'unexpected\\n'; }

${resolvePackageWorkers}
${resolveAppWorkers}

CI=
verification_profile=default
composed_acceptance_parallel=1
package_coverage_concurrency_limit=5
resolve_package_coverage_vitest_max_workers_default
resolve_acceptance_app_vitest_max_workers_default

detected_cpus=12
resolve_package_coverage_vitest_max_workers_default
resolve_acceptance_app_vitest_max_workers_default

verification_profile=static-ssh
detected_cpus=10
resolve_package_coverage_vitest_max_workers_default
resolve_acceptance_app_vitest_max_workers_default

composed_acceptance_parallel=0
resolve_acceptance_app_vitest_max_workers_default
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("2\n2\n1\n1\n2\n1\n2\n");
  });

  it("bounds CLI workers during composed acceptance", () => {
    const resolveCliWorkers = extractWorkspaceVerifyFunction(
      "resolve_package_coverage_cli_vitest_max_workers_default",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

detected_cpus=16
detect_logical_cpu_count() { printf '%s\\n' "$detected_cpus"; }
normalize_positive_integer() {
  if [[ "$1" =~ ^[1-9][0-9]*$ ]]; then printf '%s\\n' "$1"; else printf '%s\\n' "$2"; fi
}

${resolveCliWorkers}

unset MURPH_PACKAGE_COVERAGE_VITEST_MAX_WORKERS
verification_profile=default
composed_acceptance_parallel=1
package_coverage_vitest_max_workers=2
resolve_package_coverage_cli_vitest_max_workers_default

detected_cpus=12
resolve_package_coverage_cli_vitest_max_workers_default

composed_acceptance_parallel=0
resolve_package_coverage_cli_vitest_max_workers_default

composed_acceptance_parallel=1
MURPH_PACKAGE_COVERAGE_VITEST_MAX_WORKERS=4
package_coverage_vitest_max_workers=4
resolve_package_coverage_cli_vitest_max_workers_default

unset MURPH_PACKAGE_COVERAGE_VITEST_MAX_WORKERS
verification_profile=static-ssh
detected_cpus=10
package_coverage_vitest_max_workers=2
resolve_package_coverage_cli_vitest_max_workers_default
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("4\n3\n2\n4\n3\n");
  });

  it("reports an internally controlled 10-core static SSH profile", () => {
    const normalizePositiveInteger = extractWorkspaceVerifyFunction(
      "normalize_positive_integer",
    );
    const localConcurrencyDefault = extractWorkspaceVerifyFunction(
      "local_concurrency_default",
    );
    const localWorkerBudgetDefault = extractWorkspaceVerifyFunction(
      "local_worker_budget_default",
    );
    const staticSshComposedAcceptanceAvailable = extractWorkspaceVerifyFunction(
      "static_ssh_composed_acceptance_available",
    );
    const resolveComposedAcceptanceDefault = extractWorkspaceVerifyFunction(
      "resolve_composed_acceptance_parallel_default",
    );
    const resolvePackageConcurrencyDefault = extractWorkspaceVerifyFunction(
      "resolve_package_coverage_concurrency_default",
    );
    const resolvePackageWorkersDefault = extractWorkspaceVerifyFunction(
      "resolve_package_coverage_vitest_max_workers_default",
    );
    const resolveCliWorkersDefault = extractWorkspaceVerifyFunction(
      "resolve_package_coverage_cli_vitest_max_workers_default",
    );
    const resolveAppWorkersDefault = extractWorkspaceVerifyFunction(
      "resolve_acceptance_app_vitest_max_workers_default",
    );
    const resolveLocalParallelDefault = extractWorkspaceVerifyFunction(
      "resolve_local_parallel_default",
    );
    const resolveCliActiveConcurrencyDefault = extractWorkspaceVerifyFunction(
      "resolve_package_coverage_cli_active_concurrency_default",
    );
    const resolveProfileControlledValue = extractWorkspaceVerifyFunction(
      "resolve_profile_controlled_value",
    );
    const logAcceptanceResourcePlan = extractWorkspaceVerifyFunction(
      "log_acceptance_resource_plan",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

${normalizePositiveInteger}
${localConcurrencyDefault}
${localWorkerBudgetDefault}
${staticSshComposedAcceptanceAvailable}
${resolveComposedAcceptanceDefault}
${resolvePackageConcurrencyDefault}
${resolvePackageWorkersDefault}
${resolveCliWorkersDefault}
${resolveAppWorkersDefault}
${resolveLocalParallelDefault}
${resolveCliActiveConcurrencyDefault}
${resolveProfileControlledValue}
${logAcceptanceResourcePlan}

detect_logical_cpu_count() { printf '10\\n'; }
detect_physical_memory_mib() { printf '32768\\n'; }
verify_log() { printf '[workspace-verify] %s\\n' "$*"; }

CI=
shared_host_mode=0
verification_command=verify:acceptance
verification_profile=static-ssh
composed_acceptance_parallel="$(resolve_composed_acceptance_parallel_default)"
package_coverage_concurrency_default="$(resolve_package_coverage_concurrency_default)"
package_coverage_concurrency_limit="$(resolve_profile_controlled_value 99 "$package_coverage_concurrency_default")"
package_coverage_cli_active_concurrency_default="$(resolve_package_coverage_cli_active_concurrency_default)"
package_coverage_cli_active_concurrency_limit="$(resolve_profile_controlled_value 99 "$package_coverage_cli_active_concurrency_default")"
unset MURPH_PACKAGE_COVERAGE_VITEST_MAX_WORKERS
package_coverage_vitest_max_workers_default="$(resolve_package_coverage_vitest_max_workers_default)"
package_coverage_vitest_max_workers="$(resolve_profile_controlled_value 99 "$package_coverage_vitest_max_workers_default")"
package_coverage_cli_vitest_max_workers_default="$(resolve_package_coverage_cli_vitest_max_workers_default)"
package_coverage_cli_vitest_max_workers="$(resolve_profile_controlled_value 99 "$package_coverage_cli_vitest_max_workers_default")"
acceptance_app_vitest_max_workers="$(resolve_acceptance_app_vitest_max_workers_default)"
app_verify_parallel_default="$(resolve_local_parallel_default)"
app_verify_parallel="$(resolve_profile_controlled_value 1 "$app_verify_parallel_default")"
acceptance_app_verify_with_coverage="$(resolve_profile_controlled_value 1 "$app_verify_parallel_default")"
test_lane_parallel="$(resolve_profile_controlled_value 1 "$app_verify_parallel_default")"

log_acceptance_resource_plan
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "[workspace-verify] resources cpus=10 memory_mib=32768 composed_parallel=1 package_processes=3 cli_package_processes=2 package_workers=2 cli_workers=3 app_workers=1 app_overlap=1 profile=static-ssh test_lanes=1 app_parallel=1\n",
    );
  });

  it("runs static package coverage before app and fixture verification", () => {
    const runTestCoverage = extractWorkspaceVerifyFunction("run_test_coverage");
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

sandbox="$(mktemp -d)"
trap 'rm -rf -- "$sandbox"' EXIT
event_log="$sandbox/events"

verify_log() { return 0; }
bash() { return 0; }
run_timed_step() {
  local label="$1"
  shift
  printf '%s\\n' "$label" >>"$event_log"
  "$@"
}
run_repo_acceptance_guards() { return 0; }
prepare_repo_vitest_runtime_artifacts() { return 0; }
run_package_coverage_cleanup_and_hygiene() { return 0; }
run_test_packages_coverage() {
  [[ ! -f "$event_log.app" && ! -f "$event_log.fixture" ]]
  : >"$event_log.package"
}
run_test_apps() {
  [[ -f "$event_log.package" && ! -f "$event_log.fixture" ]]
  : >"$event_log.app"
}
run_fixture_smoke_verification() {
  [[ -f "$event_log.app" ]]
  : >"$event_log.fixture"
}

${runTestCoverage}

test_lane_parallel=0
composed_acceptance_parallel=0
acceptance_app_verify_with_coverage=0
acceptance_early_cloudflare_verify=0
run_test_coverage 1
cat "$event_log"
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "Doc gardening\n" +
        "Package coverage suite\n" +
        "App verification\n" +
        "Fixture smoke coverage\n",
    );
  });

  it("keeps ordinary shared-host and CI lanes conservative", () => {
    const resolveLocalParallelDefault = extractWorkspaceVerifyFunction(
      "resolve_local_parallel_default",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

${resolveLocalParallelDefault}

CI=
shared_host_mode=1
composed_acceptance_parallel=0
resolve_local_parallel_default

composed_acceptance_parallel=1
resolve_local_parallel_default

shared_host_mode=0
resolve_local_parallel_default

CI=1
resolve_local_parallel_default

CI=
verification_profile=static-ssh
composed_acceptance_parallel=1
resolve_local_parallel_default

composed_acceptance_parallel=0
resolve_local_parallel_default
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("0\n1\n1\n0\n1\n0\n");
  });

  it("overlaps independent capable-host acceptance preparation", () => {
    const runTestCoverage = extractWorkspaceVerifyFunction("run_test_coverage");

    expect(runTestCoverage).toContain(
      'run_timed_step "Doc gardening" bash "scripts/doc-gardening.sh" --fail-on-issues &',
    );
    expect(runTestCoverage).toContain(
      'run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts "$acceptance_typechecked" &',
    );
    expect(runTestCoverage).toContain(
      'wait_for_background_jobs "$doc_gardening_pid" "$runtime_artifacts_pid"',
    );
    expect(runTestCoverage).toContain("prepared_runtime_artifacts=1");
  });

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

  it("keeps scoped diff verification out of the heavyweight host lane", () => {
    const artifactRouting = extractWorkspaceVerifyFunction(
      "command_requires_workspace_artifact_lock",
    );
    const hostRouting = extractWorkspaceVerifyFunction(
      "command_requires_host_verification_slot",
    );

    expect(artifactRouting).toContain('"test:diff"');
    expect(hostRouting).not.toContain('"test:diff"');
    expect(hostRouting).toContain('"verify:acceptance"');
    expect(hostRouting).toContain('"test:apps"');
  });

  it("caps scoped Codex diff verification without changing human defaults", () => {
    const resolveTypecheckDefault = extractWorkspaceVerifyFunction(
      "resolve_typecheck_workspace_concurrency_default",
    );
    const resolveVitestDefault = extractWorkspaceVerifyFunction(
      "resolve_test_diff_vitest_max_workers_default",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

local_concurrency_default() { printf '8\\n'; }
local_worker_budget_default() { printf '4\\n'; }

${resolveTypecheckDefault}
${resolveVitestDefault}

CI=
shared_host_mode=1
composed_acceptance_parallel=0
verification_command=test:diff
test_diff_workspace_concurrency=1
resolve_typecheck_workspace_concurrency_default
resolve_test_diff_vitest_max_workers_default

shared_host_mode=0
resolve_typecheck_workspace_concurrency_default
resolve_test_diff_vitest_max_workers_default

CI=1
resolve_typecheck_workspace_concurrency_default
resolve_test_diff_vitest_max_workers_default
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("1\n1\n8\n4\n2\n50%\n");
  });

  it("keeps ordinary shared-host typecheck capped while capable acceptance composes", () => {
    const resolveTypecheckDefault = extractWorkspaceVerifyFunction(
      "resolve_typecheck_workspace_concurrency_default",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

local_concurrency_default() { printf '8\\n'; }

${resolveTypecheckDefault}

CI=
shared_host_mode=1
composed_acceptance_parallel=0
verification_command=typecheck
resolve_typecheck_workspace_concurrency_default

verification_command=verify:acceptance
composed_acceptance_parallel=1
resolve_typecheck_workspace_concurrency_default

shared_host_mode=0
composed_acceptance_parallel=0
verification_command=typecheck
resolve_typecheck_workspace_concurrency_default

CI=1
resolve_typecheck_workspace_concurrency_default
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("2\n8\n8\n2\n");
  });

  it("passes the scoped worker budget to every repo-tools diff route", () => {
    const resolveVitestDefault = extractWorkspaceVerifyFunction(
      "resolve_test_diff_vitest_max_workers_default",
    );
    const runRepoTools = extractWorkspaceVerifyFunction(
      "run_test_diff_repo_tools_tests",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

local_worker_budget_default() { printf '4\\n'; }
pnpm() {
  printf 'workers=%s command=%s\\n' "\${MURPH_VITEST_MAX_WORKERS:-}" "$*"
}

${resolveVitestDefault}
${runRepoTools}

CI=
CODEX_THREAD_ID=test-thread
shared_host_mode=1
test_diff_workspace_concurrency=1
test_diff_vitest_max_workers="$(resolve_test_diff_vitest_max_workers_default)"
run_test_diff_repo_tools_tests

MURPH_VERIFY_SHARED_HOST=0
shared_host_mode="$MURPH_VERIFY_SHARED_HOST"
test_diff_workspace_concurrency=4
test_diff_vitest_max_workers="$(resolve_test_diff_vitest_max_workers_default)"
run_test_diff_repo_tools_tests
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "workers=1 command=test:repo-tools\nworkers=4 command=test:repo-tools\n",
    );
    expect(
      workspaceVerify.match(
        /run_timed_step "Repo tools tests" run_test_diff_repo_tools_tests/gu,
      ),
    ).toHaveLength(2);
  });

  it("acquires checkout artifact locks before shared-host admission", () => {
    const webVerify = readFileSync(
      path.join(repoRoot, "apps", "web", "scripts", "verify-fast.sh"),
      "utf8",
    );
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
        "Web verification",
        webVerify,
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

    for (const source of [webVerify, cloudflareVerify]) {
      expect(source).toContain('-n "${CODEX_THREAD_ID:-}"');
      expect(source).toContain('export MURPH_VERIFY_SHARED_HOST="$shared_host_mode"');
      expect(source).toContain('[[ "$shared_host_mode" == "1"');
    }
    expect(preparedRuntimeBuild).toContain(
      "const sharedHostMode = resolveSharedHostMode(process.env)",
    );
    expect(preparedRuntimeBuild).toContain(
      "process.env.MURPH_VERIFY_SHARED_HOST = sharedHostMode",
    );

    const rootPackage = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const benchmarkScript = rootPackage.scripts["benchmark:typescript"];
    expect(benchmarkScript.indexOf("run-with-workspace-artifact-lock.mjs"))
      .toBeLessThan(benchmarkScript.indexOf("run-with-host-verification-slot.mjs"));

    for (const scriptName of [
      "build:workspace:clean",
      "build:workspace:incremental",
      "build:test-runtime",
    ]) {
      const script = rootPackage.scripts[scriptName];
      expect(script).toContain("run-with-host-verification-slot.mjs");
      expect(script.indexOf("run-with-host-verification-slot.mjs"))
        .toBeLessThan(script.indexOf("packages/importers build"));
    }

    const cloudflareWorkersConfig = readFileSync(
      path.join(repoRoot, "apps", "cloudflare", "vitest.workers.config.ts"),
      "utf8",
    );
    expect(cloudflareWorkersConfig).toContain(
      "maxWorkers: resolveMurphAppVitestMaxWorkers()",
    );
    const repoToolsConfig = readFileSync(
      path.join(repoRoot, "scripts", "vitest.config.ts"),
      "utf8",
    );
    expect(repoToolsConfig).toContain(
      "maxWorkers: resolveMurphVitestMaxWorkers()",
    );
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

composed_acceptance_parallel=0
acceptance_app_vitest_max_workers=2
acceptance_cli_coverage_ready_file=
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

  it("passes one bounded app worker budget while keeping Cloudflare steps serial", () => {
    const runAppVerify = extractWorkspaceVerifyFunction(
      "run_app_verify_command_with_retry",
    );
    const crabboxEnvironment = readSanitizedCrabboxVerificationEnvironment();

    expect(crabboxEnvironment).not.toHaveProperty("MURPH_VERIFY_STEP_PARALLEL");
    const result = runShellHarness(`#!/usr/bin/env bash
set -uo pipefail

unset MURPH_APP_VITEST_MAX_WORKERS
${crabboxEnvironment.MURPH_VERIFY_STEP_PARALLEL
  ? `export MURPH_VERIFY_STEP_PARALLEL=${crabboxEnvironment.MURPH_VERIFY_STEP_PARALLEL}`
  : "unset MURPH_VERIFY_STEP_PARALLEL"}
composed_acceptance_parallel=1
acceptance_app_vitest_max_workers=2
acceptance_cli_coverage_ready_file=/tmp/murph-cli-ready-test

run_command_with_retry() {
  shift
  printf '%s\\n' "$*"
}

${runAppVerify}

run_app_verify_command_with_retry apps/web 1 1 1
run_app_verify_command_with_retry apps/cloudflare 1 1 1
`);

    expect(result.status, result.stderr).toBe(0);
    const [web, cloudflare] = result.stdout.trim().split("\n");

    expect(web).toContain("MURPH_APP_VITEST_MAX_WORKERS=2");
    expect(web).toContain("MURPH_VERIFY_STEP_PARALLEL=1");
    expect(web).toContain("MURPH_ACCEPTANCE_CLI_COVERAGE_READY_FILE=/tmp/murph-cli-ready-test");
    expect(cloudflare).toContain("MURPH_APP_VITEST_MAX_WORKERS=2");
    expect(cloudflare).toContain("MURPH_VERIFY_STEP_PARALLEL=0");
    expect(cloudflare).toContain("MURPH_ACCEPTANCE_CLI_COVERAGE_READY_FILE=/tmp/murph-cli-ready-test");
  });

  it("forces the static app worker budget over caller tuning", () => {
    const runAppVerify = extractWorkspaceVerifyFunction(
      "run_app_verify_command_with_retry",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -uo pipefail

export MURPH_APP_VITEST_MAX_WORKERS=99
verification_profile=static-ssh
composed_acceptance_parallel=1
acceptance_app_vitest_max_workers=1
acceptance_cli_coverage_ready_file=

run_command_with_retry() {
  shift
  printf '%s\\n' "$*"
}

${runAppVerify}

run_app_verify_command_with_retry apps/web 1 1 1
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("MURPH_APP_VITEST_MAX_WORKERS=1");
    expect(result.stdout).not.toContain("MURPH_APP_VITEST_MAX_WORKERS=99");
  });

  it("holds Cloudflare tests, but not setup, until CLI coverage completes", () => {
    const cloudflareVerify = readFileSync(
      path.join(repoRoot, "apps", "cloudflare", "scripts", "verify-fast.sh"),
      "utf8",
    );

    const waitIndex = cloudflareVerify.indexOf("wait_for_acceptance_cli_coverage\n");
    expect(waitIndex).toBeGreaterThan(
      cloudflareVerify.indexOf('if [[ "$skip_typecheck" == "1" ]]'),
    );
    expect(waitIndex).toBeLessThan(
      cloudflareVerify.indexOf('if [[ "$verify_step_parallel" != "1" ]]'),
    );
  });

  it("publishes the CLI coverage readiness marker only when configured", () => {
    const markCliCoverageComplete = extractWorkspaceVerifyFunction(
      "mark_acceptance_cli_coverage_complete",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

${markCliCoverageComplete}

ready_dir="$(mktemp -d)"
acceptance_cli_coverage_ready_file=
mark_acceptance_cli_coverage_complete

acceptance_cli_coverage_ready_file="$ready_dir/ready"
mark_acceptance_cli_coverage_complete
[[ -f "$acceptance_cli_coverage_ready_file" ]]
printf 'ready\\n'
rm -rf -- "$ready_dir"
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("ready\n");
  });

  it("releases apps and expands package fanout after CLI success or failure", () => {
    const markCliCoverageComplete = extractWorkspaceVerifyFunction(
      "mark_acceptance_cli_coverage_complete",
    );
    const runAllPackageCoverage = extractWorkspaceVerifyFunction(
      "run_all_package_coverage",
    );
    const cloudflareVerify = readFileSync(
      path.join(repoRoot, "apps", "cloudflare", "scripts", "verify-fast.sh"),
      "utf8",
    );
    const waitForAcceptanceCliCoverage = cloudflareVerify.match(
      /^wait_for_acceptance_cli_coverage\(\) \{[\s\S]*?^\}/m,
    )?.[0];

    expect(waitForAcceptanceCliCoverage).toBeTruthy();
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

${markCliCoverageComplete}

${runAllPackageCoverage}

${waitForAcceptanceCliCoverage}

register_background_pid() { return 0; }
unregister_background_pid() { return 0; }
verify_log() { return 0; }

run_workspace_package_coverage() {
  local package_dir="$1"

  case "$package_dir" in
    "packages/cli")
      : >"$cli_started_file"
      while [[ ! -f "$cli_release_file" ]]; do
        command sleep 0.01
      done
      [[ "$cli_should_fail" != "1" ]]
      ;;
    "packages/assistant-engine")
      : >"$first_peer_started_file"
      while [[ ! -f "$first_peer_release_file" ]]; do
        command sleep 0.01
      done
      ;;
    "packages/assistant-runtime")
      : >"$second_peer_started_file"
      while [[ ! -f "$refill_release_file" ]]; do
        command sleep 0.01
      done
      ;;
    "packages/core")
      : >"$third_peer_started_file"
      while [[ ! -f "$refill_release_file" ]]; do
        command sleep 0.01
      done
      ;;
    "packages/setup-cli")
      : >"$fourth_peer_started_file"
      while [[ ! -f "$refill_release_file" ]]; do
        command sleep 0.01
      done
      ;;
  esac
}

exercise_interlock() {
  local case_name="$1"
  local cli_should_fail="$2"
  local expected_status="$3"
  local case_dir="$sandbox/$case_name"
  local scheduler_status=0
  local observed_status
  mkdir -p "$case_dir"

  cli_started_file="$case_dir/cli-started"
  cli_release_file="$case_dir/release-cli"
  first_peer_started_file="$case_dir/first-peer-started"
  first_peer_release_file="$case_dir/release-first-peer"
  second_peer_started_file="$case_dir/second-peer-started"
  third_peer_started_file="$case_dir/third-peer-started"
  fourth_peer_started_file="$case_dir/fourth-peer-started"
  refill_release_file="$case_dir/release-refill"
  acceptance_cli_coverage_ready_file="$case_dir/cli-ready"
  export MURPH_ACCEPTANCE_CLI_COVERAGE_READY_FILE="$acceptance_cli_coverage_ready_file"

  (
    wait_for_acceptance_cli_coverage
    : >"$case_dir/app-released"
  ) 2>"$case_dir/app-wait.log" &
  local app_pid="$!"

  (
    run_all_package_coverage 1 || scheduler_status="$?"
    printf '%s\n' "$scheduler_status" >"$case_dir/scheduler-status"
  ) &
  local scheduler_pid="$!"

  for _ in {1..400}; do
    if [[
      -f "$cli_started_file"
      && -f "$first_peer_started_file"
      && -f "$case_dir/app-wait.log"
    ]] && grep -q "wait for CLI coverage" "$case_dir/app-wait.log"; then
      break
    fi
    command sleep 0.01
  done

  [[ -f "$cli_started_file" ]]
  [[ -f "$first_peer_started_file" ]]
  grep -q "wait for CLI coverage" "$case_dir/app-wait.log"
  command sleep 0.05
  [[ ! -f "$case_dir/app-released" ]]
  [[ ! -f "$acceptance_cli_coverage_ready_file" ]]
  [[ ! -f "$second_peer_started_file" ]]
  [[ ! -f "$third_peer_started_file" ]]
  [[ ! -f "$fourth_peer_started_file" ]]

  : >"$cli_release_file"

  for _ in {1..400}; do
    if [[
      -f "$case_dir/app-released"
      && -f "$second_peer_started_file"
      && -f "$third_peer_started_file"
    ]]; then
      break
    fi
    command sleep 0.01
  done

  [[ -f "$case_dir/app-released" ]]
  [[ -f "$acceptance_cli_coverage_ready_file" ]]
  [[ -f "$second_peer_started_file" ]]
  [[ -f "$third_peer_started_file" ]]
  command sleep 0.05
  [[ ! -f "$fourth_peer_started_file" ]]

  : >"$first_peer_release_file"
  for _ in {1..400}; do
    if [[ -f "$fourth_peer_started_file" ]]; then
      break
    fi
    command sleep 0.01
  done
  [[ -f "$fourth_peer_started_file" ]]

  : >"$refill_release_file"
  wait "$scheduler_pid"
  wait "$app_pid"

  observed_status="$(<"$case_dir/scheduler-status")"
  [[ "$observed_status" == "$expected_status" ]]
}

sandbox="$(mktemp -d)"
trap 'rm -rf -- "$sandbox"' EXIT
package_coverage_concurrency_limit=3
package_coverage_cli_active_concurrency_limit=2

exercise_interlock success 0 0
exercise_interlock failure 1 1
printf 'interlock-covered\n'
`, 30_000);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("interlock-covered\n");
  });

  it("keeps hosted-web parallel cleanup safe after every child is reaped", () => {
    const webVerify = readFileSync(
      path.join(repoRoot, "apps", "web", "scripts", "verify-fast.sh"),
      "utf8",
    );
    const cleanupBackgroundJobs = webVerify.match(
      /^cleanup_background_jobs\(\) \{[\s\S]*?^\}/m,
    )?.[0];
    const runNextBuild = webVerify.match(
      /^run_next_build\(\) \{[\s\S]*?^\}/m,
    )?.[0];

    expect(cleanupBackgroundJobs).toBeTruthy();
    expect(runNextBuild).toBeTruthy();
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

owned_background_job_pids=()
terminate_owned_background_job() { return 99; }

${cleanupBackgroundJobs}

cleanup_background_jobs
printf 'clean\\n'
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("clean\n");
    expect(runNextBuild!.indexOf("wait_for_acceptance_cli_coverage"))
      .toBeLessThan(runNextBuild!.indexOf('"${next_build_command[@]}"'));
  });

  it("gives only the Assistant Engine root project the repository-owned heap", () => {
    const runRepoVitest = extractWorkspaceVerifyFunction("run_repo_vitest");
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

pnpm() {
  printf 'heap=%s command=%s\n' "\${NODE_OPTIONS-unset}" "$*"
}

unset NODE_OPTIONS

${runRepoVitest}

run_repo_vitest --no-coverage
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "heap=unset command=exec vitest run --config vitest.config.ts --project=!assistant-engine --no-coverage\n" +
        "heap=--max-old-space-size=6144 command=exec vitest run --config vitest.config.ts --project=assistant-engine --no-coverage\n",
    );
  });

  it("keeps release checks free of a process-wide Node heap", () => {
    const releaseWorkflow = readFileSync(
      path.join(repoRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );
    const releaseCheckStep = releaseWorkflow.match(
      /^      - name: Run release checks[\s\S]*?(?=^      - name: )/m,
    )?.[0];

    expect(releaseCheckStep).toBeTruthy();
    expect(releaseCheckStep).toContain("run: pnpm release:check");
    expect(releaseWorkflow).not.toContain("NODE_OPTIONS");
  });

  it("gives only Assistant Engine package coverage the repository-owned heap", () => {
    const runWorkspacePackageCoverage = extractWorkspaceVerifyFunction(
      "run_workspace_package_coverage",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

unset NODE_OPTIONS
package_coverage_vitest_max_workers=2

run_timed_step() {
  shift
  [[ "$1" == "env" ]]
  shift
  local heap=unset
  local workers=unset
  while [[ "$1" == *=* ]]; do
    case "$1" in
      NODE_OPTIONS=*) heap="\${1#NODE_OPTIONS=}" ;;
      MURPH_VITEST_MAX_WORKERS=*) workers="\${1#MURPH_VITEST_MAX_WORKERS=}" ;;
    esac
    shift
  done
  printf 'heap=%s workers=%s command=%s\n' "$heap" "$workers" "$*"
}

${runWorkspacePackageCoverage}

run_workspace_package_coverage packages/assistant-engine 'Assistant Engine coverage'
run_workspace_package_coverage packages/core 'Core coverage'
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "heap=--max-old-space-size=6144 workers=2 command=pnpm --dir packages/assistant-engine test:coverage\n" +
        "heap=unset workers=2 command=pnpm --dir packages/core test:coverage\n",
    );
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
            MURPH_VERIFY_HOST_SLOT_HELD: "1",
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

  it("prepares reverse-dependent CLI artifacts without enabling release packaging", () => {
    const diffScopeResult = spawnSync(
      process.execPath,
      [
        "scripts/workspace-diff-scope.mjs",
        "packages/health-commons/src/runtime.ts",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    expect(diffScopeResult.status, diffScopeResult.stderr).toBe(0);
    const diffScope = JSON.parse(diffScopeResult.stdout) as {
      runVerifyCli: boolean;
      testDirs: string[];
    };
    expect(diffScope.runVerifyCli).toBe(false);
    expect(diffScope.testDirs).toContain("packages/health-commons");
    expect(diffScope.testDirs).toContain("packages/cli");

    const runTestDiffPackageTests = extractWorkspaceVerifyFunction(
      "run_test_diff_package_tests",
    );
    const selectedPackageDirs = diffScope.testDirs
      .map((packageDir) => JSON.stringify(packageDir))
      .join(" ");
    const result = runShellHarness(`#!/usr/bin/env bash
set -euo pipefail

test_diff_workspace_concurrency=2
test_diff_vitest_max_workers=1

run_timed_step() {
  local label="$1"
  shift
  printf 'step:%s\n' "$label"
  "$@"
}

prepare_repo_vitest_runtime_artifacts() {
  printf 'artifacts:prepared\n'
}

run_command_with_retry() {
  printf '%s | %s\n' "$1" "\${*:2}"
}

run_diff_contracts_test_with_workspace_artifact_lock() {
  return 0
}

run_diff_package_boundary_verification() {
  printf 'boundary:%s\n' "$1"
}

${runTestDiffPackageTests}

run_test_diff_package_tests ${selectedPackageDirs}
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "step:Prepared CLI runtime artifacts for affected package tests\n",
    );
    expect(result.stdout).toContain("artifacts:prepared\n");
    expect(result.stdout).toContain(
      "Affected package tests | env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS=1 pnpm -r --no-sort --workspace-concurrency=2",
    );
    expect(result.stdout).toContain("--filter ./packages/health-commons");
    expect(result.stdout).toContain("--filter ./packages/cli");
    expect(result.stdout).not.toContain("MURPH_CLI_RELEASE_TARBALL_TEST");
    expect(result.stdout.indexOf("artifacts:prepared\n")).toBeLessThan(
      result.stdout.indexOf("Affected package tests |"),
    );
    expect(result.stdout.match(/artifacts:prepared/gu)).toHaveLength(1);

    const releaseCoverageAudit = readFileSync(
      path.join(
        repoRoot,
        "packages",
        "cli",
        "test",
        "release-script-coverage-audit.test.ts",
      ),
      "utf8",
    );
    expect(releaseCoverageAudit).toContain(
      "it.skipIf(process.env.MURPH_CLI_RELEASE_TARBALL_TEST !== '1')",
    );
    expect(releaseCoverageAudit).not.toContain(
      "it.skipIf(process.env.MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS !== '1')",
    );
  });

  it("gives affected Assistant Engine tests the proven heap ceiling", () => {
    const runTestDiffPackageTests = extractWorkspaceVerifyFunction(
      "run_test_diff_package_tests",
    );
    const result = runShellHarness(`#!/usr/bin/env bash
set -uo pipefail

test_diff_workspace_concurrency=1
test_diff_vitest_max_workers=1

run_command_with_retry() {
  printf '%s | %s\\n' "$1" "\${*:2}"
  return 0
}

run_diff_contracts_test_with_workspace_artifact_lock() {
  return 0
}

run_diff_package_boundary_verification() {
  return 0
}

${runTestDiffPackageTests}

run_test_diff_package_tests packages/assistant-engine packages/core
`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "Affected package test for packages/assistant-engine | env NODE_OPTIONS=--max-old-space-size=6144 MURPH_VITEST_MAX_WORKERS=1 pnpm --dir packages/assistant-engine test\n",
    );
    expect(result.stdout).toContain(
      "Affected package tests | env MURPH_VITEST_MAX_WORKERS=1 pnpm -r --no-sort --workspace-concurrency=1 --filter ./packages/core test\n",
    );
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

  it("applies bounded worker budgets and preserves safe root CLI grouping", () => {
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
    expect(workspaceVerify).toContain("worker_budget=$((cpu_count / 8))");
    expect(workspaceVerify).toContain("worker_budget=$((cpu_count / 4))");
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
