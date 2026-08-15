import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED_DOC = "agent-docs/references/native-ios-hosted-e2e.md";
const REQUIRED_WORKFLOW = ".github/workflows/native-ios-hosted-e2e.yml";
const CONTROL_SOURCE = "scripts/native-ios-hosted-e2e-control.mjs";
const E2E_MIGRATION_SOURCE = "apps/web/scripts/run-native-ios-hosted-e2e-migrations.ts";
const PUBLIC_URL_SOURCE = "apps/web/src/lib/hosted-web/public-url.ts";

/**
 * @typedef {{ code: string; message: string }} NativeIosHostedE2eIssue
 * @typedef {{ control: string; docs: string; e2eMigration: string; publicUrl: string; repoHygiene: string; vercel: string; webPackage: string; workflow: string }} NativeIosHostedE2eSources
 */

/**
 * @param {NativeIosHostedE2eSources} sources
 * @returns {NativeIosHostedE2eIssue[]}
 */
export function inspectNativeIosHostedE2eBoundary(sources) {
  /** @type {NativeIosHostedE2eIssue[]} */
  const issues = [];
  const requireText = (source, code, needle, message) => {
    if (!source.includes(needle)) {
      issues.push({ code, message });
    }
  };

  requireText(
    sources.workflow,
    "missing-trusted-workflow-run",
    "  workflow_run:\n    workflows:\n      - Repo Hygiene\n",
    "Secret-bearing PR proof must be entered from the trusted default-branch Repo Hygiene workflow_run.",
  );
  requireText(
    sources.workflow,
    "missing-production-deployment-trigger",
    "  deployment_status:\n",
    "The non-destructive production canary must follow real deployment_status events.",
  );
  if (/^\s{2}pull_request(?:_target)?:/mu.test(sources.workflow)) {
    issues.push({
      code: "unsafe-direct-pr-trigger",
      message: "The protected live workflow must not run directly from pull_request or pull_request_target.",
    });
  }
  if (sources.workflow.includes("workflow_dispatch:")) {
    issues.push({
      code: "unsafe-manual-live-trigger",
      message: "The main-repo protected workflow must not expose an arbitrary manual live dispatch ref.",
    });
  }
  requireText(
    sources.workflow,
    "missing-pr-read-authority",
    "  pull-requests: read\n",
    "The trusted selector needs read-only pull-request metadata/files authority.",
  );
  requireText(
    sources.workflow,
    "missing-status-authority",
    "  statuses: write\n",
    "The trusted controller must publish the stable required commit status.",
  );
  requireText(
    sources.workflow,
    "missing-pr-environment",
    "environment: native-ios-hosted-e2e",
    "PR live proof must use its protected GitHub Environment.",
  );
  requireText(
    sources.workflow,
    "missing-production-environment",
    "environment: native-ios-production-canary",
    "Production canary proof must use its separate protected GitHub Environment.",
  );
  requireText(
    sources.workflow,
    "missing-trusted-pr-checkout",
    "ref: ${{ github.sha }}",
    "workflow_run jobs must execute the exact trusted default-branch control revision, not the PR checkout.",
  );
  requireText(
    sources.workflow,
    "missing-trusted-production-checkout",
    "ref: ${{ github.event.repository.default_branch }}",
    "deployment_status jobs must checkout trusted default-branch control before inspecting the deployed SHA.",
  );
  const checkoutRefs = sources.workflow
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("ref: "));
  const allowedCheckoutRefs = new Set([
    "ref: ${{ github.sha }}",
    "ref: ${{ github.event.repository.default_branch }}",
  ]);
  if (checkoutRefs.length === 0 || checkoutRefs.some((line) => !allowedCheckoutRefs.has(line))) {
    issues.push({
      code: "unsafe-untrusted-checkout",
      message: "Every checkout ref in the secret-bearing workflow must resolve only to trusted default-branch control.",
    });
  }
  requireText(
    sources.workflow,
    "missing-pr-head-anchor",
    'github.event.workflow_run.pull_requests[0].head.sha',
    "PR freshness and required status must anchor to the associated pull-request head, not the source workflow merge SHA.",
  );
  requireText(
    sources.workflow,
    "missing-live-head-revalidation",
    'Revalidate current PR head before live authority',
    "The protected live job must reject a PR head that changed after the source Repo Hygiene run.",
  );
  requireText(
    sources.workflow,
    "missing-exact-web-sha",
    '--sha "${PR_HEAD_SHA}"',
    "The dedicated hosted deployment must be created from the exact selected PR SHA.",
  );
  requireText(
    sources.workflow,
    "missing-exact-web-ref",
    '--ref "${PR_HEAD_REF}"',
    "The dedicated hosted deployment must retain the exact selected PR ref for provenance.",
  );
  const customEnvironmentIdEnvLine =
    "NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID: ${{ vars.NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID }}";
  const customEnvironmentIdEnvLineOccurrences = sources.workflow
    .split(customEnvironmentIdEnvLine).length - 1;
  const customEnvironmentIdRequiredListEntry =
    "\n            NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID\n";
  if (
    customEnvironmentIdEnvLineOccurrences < 2
    || !sources.workflow.includes(customEnvironmentIdRequiredListEntry)
  ) {
    issues.push({
      code: "missing-vercel-custom-environment-id-config",
      message: "The protected PR environment must preflight and pass the exact dedicated Vercel Custom Environment id into deployment creation.",
    });
  }
  requireText(
    sources.workflow,
    "missing-private-sha-pin",
    "NATIVE_IOS_E2E_IOS_EXPECTED_SHA",
    "The controller must pin and verify the exact approved private iOS workflow commit.",
  );
  requireText(
    sources.workflow,
    "missing-repository-scoped-app-token",
    "repositories: ${{ vars.NATIVE_IOS_E2E_IOS_REPOSITORY_NAME }}",
    "Cross-repository authority must be scoped to the configured private iOS repository.",
  );
  requireText(
    sources.workflow,
    "missing-private-actions-token-permission",
    "permission-actions: write",
    "Cross-repository token must request only the Actions write authority required to dispatch and read the exact run.",
  );
  requireText(
    sources.workflow,
    "missing-private-contents-token-permission",
    "permission-contents: read",
    "Cross-repository token must request only read access to resolve the protected lightweight tag.",
  );
  requireText(
    sources.workflow,
    "missing-preview-cleanup",
    "if: ${{ always() && steps.web.outputs.deployment_id != '' }}",
    "The isolated hosted PR deployment must be retired even after native failure.",
  );
  requireText(
    sources.workflow,
    "missing-production-alias-proof",
    "scripts/resolve-vercel-production-alias-sha.ts",
    "Production canary must prove that the canonical alias still resolves to the deployment event SHA.",
  );
  requireText(
    sources.workflow,
    "missing-production-nondestructive-mode",
    "--mode production_canary",
    "Production dispatch must use the non-destructive canary contract.",
  );
  requireText(
    sources.workflow,
    "missing-required-status-publisher",
    "Publish stable required commit status",
    "Relevant PRs need one stable status context that branch protection can require.",
  );
  if (/cancel-in-progress:\s*true/mu.test(sources.workflow)) {
    issues.push({
      code: "unsafe-live-cancellation",
      message: "Live proof must not be canceled before provider/account/deployment cleanup completes.",
    });
  }

  for (const forbidden of [
    ["actions/upload-artifact", "artifact-upload"],
    ["/logs", "private-log-read"],
    ["/jobs", "private-job-read"],
    ["/artifacts", "private-artifact-read"],
    ["xcresult", "xcresult-boundary"],
    ["screenshot", "screenshot-boundary"],
    ["recordVideo", "video-boundary"],
    ["startTracing", "trace-boundary"],
    ["hosted-local", "hermetic-hosted-substitute"],
    ["localhost", "local-provider-substitute"],
  ]) {
    if (sources.workflow.toLowerCase().includes(forbidden[0].toLowerCase())) {
      issues.push({
        code: `forbidden-${forbidden[1]}`,
        message: `Protected native iOS hosted E2E workflow contains forbidden boundary ${forbidden[0]}.`,
      });
    }
  }

  requireText(
    sources.control,
    "missing-contract-version",
    'NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION = "1"',
    "Dispatch contract version must be explicit and stable.",
  );
  requireText(
    sources.control,
    "missing-pr-owned-deletion",
    'account_lifecycle: "user_owned_delete"',
    "Repeatable PR signup must finish through the existing user-owned deletion boundary.",
  );
  requireText(
    sources.control,
    "missing-pr-environment-contract",
    'web_environment: "native-ios-e2e"',
    "PR dispatch must name the exact dedicated hosted environment rather than a generic preview class.",
  );
  requireText(
    sources.control,
    "missing-production-lifecycle",
    'account_lifecycle: "existing_identity_non_destructive"',
    "Production canary must retain a persistent non-destructive identity lifecycle.",
  );
  requireText(
    sources.control,
    "missing-github-api-version",
    'const GITHUB_API_VERSION = "2026-03-10";',
    "Controller must pin the GitHub API version whose workflow-dispatch response carries the run receipt.",
  );
  requireText(
    sources.control,
    "missing-private-tag-preflight",
    "/git/ref/tags/${tagPath}",
    "Controller must resolve the configured private lightweight tag before dispatching protected native authority.",
  );
  requireText(
    sources.control,
    "missing-private-tag-sha-proof",
    "inspectPrivateWorkflowDispatchTag(dispatchTag",
    "Controller must prove the private dispatch tag already resolves to the approved iOS commit before dispatch.",
  );
  requireText(
    sources.control,
    "missing-github-run-receipt",
    "workflow_run_id",
    "Controller must bind the private result to the exact dispatch receipt.",
  );
  requireText(
    sources.control,
    "missing-private-event-proof",
    'readString(raw.event) !== "workflow_dispatch"',
    "Controller must verify the returned private run came from workflow_dispatch.",
  );
  requireText(
    sources.control,
    "missing-private-head-proof",
    "readString(raw.head_sha) !== expected.expectedHeadSha",
    "Controller must verify the returned private run executed the approved iOS SHA.",
  );
  requireText(
    sources.control,
    "missing-vercel-project-proof",
    "projectId !== expected.expectedProjectId",
    "Controller must verify the hosted deployment belongs to the dedicated E2E project.",
  );
  requireText(
    sources.control,
    "missing-vercel-custom-environment-proof",
    "readString(raw.customEnvironmentId) !== expected.expectedCustomEnvironmentId",
    "Controller must verify the hosted deployment belongs to the exact configured custom environment.",
  );
  requireText(
    sources.control,
    "missing-vercel-custom-environment-lookup",
    "inspectVercelE2eCustomEnvironment(customEnvironment",
    "Controller must resolve the configured Vercel custom-environment id and verify its required slug/project before deployment.",
  );
  requireText(
    sources.control,
    "missing-vercel-sha-proof",
    "readString(raw.gitSource.sha) !== expected.expectedSha",
    "Controller must verify Vercel reports the exact requested Web SHA.",
  );
  requireText(
    sources.control,
    "missing-production-target-rejection",
    'readString(raw.target) === "production"',
    "PR E2E deployment creation must fail closed if Vercel reports a production target.",
  );
  requireText(
    sources.control,
    "missing-vercel-custom-environment",
    'customEnvironmentSlugOrId: customEnvironmentId',
    "PR E2E deployment must target the exact protected Vercel Custom Environment id.",
  );
  requireText(
    sources.control,
    "missing-early-vercel-cleanup-id",
    'await writeGithubOutput("deployment_id", deploymentId);',
    "Controller must publish the new Vercel deployment id before provenance polling so always-run cleanup can retire failed-close deployments.",
  );
  requireText(
    sources.control,
    "missing-vercel-custom-environment-name",
    'NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET_ENV = "native-ios-e2e"',
    "The hosted E2E Vercel Custom Environment slug is a stable control-plane contract.",
  );
  requireText(
    sources.control,
    "missing-private-vercel-build-output",
    "public: false",
    "The dedicated E2E deployment must keep its Vercel source and build output private.",
  );
  requireText(
    sources.control,
    "missing-vercel-cleanup-api",
    'method: "DELETE"',
    "Controller must retire its exact temporary hosted deployment.",
  );
  for (const forbidden of ["/logs", "/jobs", "/artifacts"]) {
    if (sources.control.includes(forbidden)) {
      issues.push({
        code: `private-result-overread:${forbidden}`,
        message: `Controller must not read private workflow ${forbidden}; status/conclusion is the result boundary.`,
      });
    }
  }

  requireText(
    sources.e2eMigration,
    "missing-e2e-migration-target",
    'nativeIosHostedE2eVercelTargetEnvironment = "native-ios-e2e"',
    "Hosted E2E Prisma migrations must admit only the dedicated Vercel Custom Environment.",
  );
  requireText(
    sources.e2eMigration,
    "missing-e2e-migration-vercel-proof",
    'environment.VERCEL !== "1"',
    "Hosted E2E migrations must fail outside Vercel authority.",
  );
  requireText(
    sources.e2eMigration,
    "missing-e2e-production-rejection",
    'environment.VERCEL_ENV === "production"',
    "Hosted E2E migration admission must reject canonical production.",
  );
  requireText(
    sources.e2eMigration,
    "missing-e2e-exact-git-sha",
    "environment.VERCEL_GIT_COMMIT_SHA",
    "Hosted E2E migrations must require Vercel to identify an exact Git SHA.",
  );
  requireText(
    sources.e2eMigration,
    "missing-e2e-direct-database",
    'MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS: "1"',
    "Hosted E2E Prisma migrations must reuse the direct-database migration-owner guard.",
  );
  requireText(
    sources.e2eMigration,
    "missing-real-prisma-migration-owner",
    "runHostedWebPrismaMigrateDeploy",
    "Hosted E2E database setup must execute the real hosted Web Prisma migration owner.",
  );
  requireText(
    sources.e2eMigration,
    "missing-exact-prisma-history-proof",
    "assertNativeIosHostedE2eMigrationHistoryMatchesSource",
    "Hosted E2E database setup must reject migration history that the exact Web source cannot produce.",
  );
  requireText(
    sources.e2eMigration,
    "missing-prisma-ledger-source-check",
    "const divergentMigrations = findNativeIosHostedE2eDivergentAppliedMigrations(",
    "Hosted E2E database setup must compare applied Prisma migration history to the exact source tree.",
  );
  requireText(
    sources.e2eMigration,
    "missing-prisma-ledger-checksum",
    'createHash("sha256").update(migrationSql).digest("hex")',
    "Hosted E2E database setup must verify the exact migration script bytes, not names alone.",
  );
  requireText(
    sources.e2eMigration,
    "missing-prisma-ledger-checksum-query",
    "SELECT migration_name, checksum",
    "Hosted E2E database setup must read Prisma's stored migration checksum for exact-source verification.",
  );

  requireText(
    sources.publicUrl,
    "missing-e2e-exact-public-url-target",
    'hostedNativeIosE2eVercelTargetEnvironment = "native-ios-e2e"',
    "Hosted E2E public URL resolution must recognize the same dedicated Vercel Custom Environment.",
  );
  requireText(
    sources.publicUrl,
    "missing-e2e-exact-public-url",
    "source.VERCEL_URL",
    "Hosted E2E public/device-sync URLs must bind provider callbacks to the exact Vercel deployment URL.",
  );
  requireText(
    sources.publicUrl,
    "missing-e2e-device-sync-exact-origin",
    'appendHostedPath(readHostedPublicOrigin(source), "/api/device-sync")',
    "Hosted E2E device-sync callbacks must remain on the exact deployed Web origin.",
  );

  let webPackage;
  try {
    webPackage = JSON.parse(sources.webPackage);
  } catch {
    issues.push({
      code: "invalid-web-package",
      message: "apps/web/package.json must remain valid JSON.",
    });
  }
  if (webPackage) {
    const script = webPackage.scripts?.["release:native-ios-hosted-e2e:migrate"];
    if (
      script !==
      "pnpm --dir ../.. exec tsx apps/web/scripts/run-native-ios-hosted-e2e-migrations.ts"
    ) {
      issues.push({
        code: "missing-e2e-migration-script",
        message: "Hosted Web package scripts must retain the native iOS E2E real-migration entrypoint.",
      });
    }
  }

  let vercelConfig;
  try {
    vercelConfig = JSON.parse(sources.vercel);
  } catch {
    issues.push({
      code: "invalid-vercel-config",
      message: "apps/web/vercel.json must remain valid JSON.",
    });
  }
  if (vercelConfig) {
    // Current repo authority intentionally allows automatic deployment only for main.
    // Support both Vercel config spellings if the repo migrates the key in place.
    const deploymentEnabled = vercelConfig.git?.deploymentEnabled ?? vercelConfig.github?.deploymentEnabled;
    if (
      !deploymentEnabled
      || deploymentEnabled.main !== true
      || deploymentEnabled["*"] !== false
    ) {
      issues.push({
        code: "unsafe-vercel-branch-auto-deploy",
        message: "The canonical Web project must remain main-only; PR proof uses its separate E2E project.",
      });
    }
    if (
      vercelConfig.buildCommand !==
      "pnpm release:native-ios-hosted-e2e:migrate && pnpm release:production:migrate && MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS=1 pnpm build"
    ) {
      issues.push({
        code: "missing-e2e-migration-build-owner",
        message: "Hosted Web builds must run the guarded E2E migration owner before the unchanged production migration/build chain.",
      });
    }
  }

  requireText(
    sources.repoHygiene,
    "missing-repo-hygiene-guard",
    "pnpm native-ios-e2e:ci-guard",
    "Repo Hygiene must prove the protected native iOS E2E control boundary on every PR.",
  );

  for (const needle of [
    "real Privy OTP authority",
    "real Junction/Vital SDK",
    "real iOS HealthKit permission UI",
    "user-owned account deletion",
    "existing_identity_non_destructive",
    "Native iOS hosted E2E",
    "must not upload screenshots, videos, raw xcresult bundles, traces, response bodies, or log tails",
    "repository-ruleset-protected immutable",
  ]) {
    requireText(
      sources.docs,
      `missing-doc-contract:${needle}`,
      needle,
      `Durable native E2E reference must retain: ${needle}.`,
    );
  }
  return issues;
}

export async function readNativeIosHostedE2eSources() {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [
    control,
    docs,
    e2eMigration,
    publicUrl,
    repoHygiene,
    vercel,
    webPackage,
    workflow,
  ] = await Promise.all([
    read(CONTROL_SOURCE),
    read(REQUIRED_DOC),
    read(E2E_MIGRATION_SOURCE),
    read(PUBLIC_URL_SOURCE),
    read(".github/workflows/repo-hygiene.yml"),
    read("apps/web/vercel.json"),
    read("apps/web/package.json"),
    read(REQUIRED_WORKFLOW),
  ]);
  return {
    control,
    docs,
    e2eMigration,
    publicUrl,
    repoHygiene,
    vercel,
    webPackage,
    workflow,
  };
}

async function main() {
  const issues = inspectNativeIosHostedE2eBoundary(await readNativeIosHostedE2eSources());
  if (issues.length === 0) {
    console.log("Native iOS hosted E2E control boundary guard passed.");
    return;
  }
  for (const issue of issues) {
    console.error(`[${issue.code}] ${issue.message}`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
