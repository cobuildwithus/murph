import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
  NATIVE_IOS_HOSTED_E2E_LANE_MARKER,
  runPrLifecycle,
} from "./native-ios-hosted-e2e.mjs";
import {
  buildDedicatedDatabasePoolOptions,
  buildJunctionClientUserId,
  cleanupE2e,
  inspectDedicatedMemberIdentity,
  inspectE2eDatabaseUrls,
  inspectFreshPrivyPrincipal,
  inspectJunctionAppleHealthConnection,
  inspectNamespacedJunctionUsers,
  inspectResolvedJunctionUser,
} from "./native-ios-hosted-e2e-identity.mjs";
import {
  buildDispatchInputs,
  inspectCurrentProductionSha,
  inspectPrivateDispatchTag,
  inspectPrivateRun,
} from "./native-ios-hosted-e2e-native.mjs";
import {
  inspectBoundedCommandResult,
  runBoundedCommand,
} from "./native-ios-hosted-e2e-support.mjs";
import {
  createE2eDeployment,
  inspectPublicCandidateResponse,
  inspectRetirableE2eDeployment,
  inspectVercelCustomEnvironment,
  inspectVercelDeployment,
  inspectVercelJunctionNamespaceVariable,
} from "./native-ios-hosted-e2e-vercel.mjs";

const SHA = "a".repeat(40);
const TEST_PHONE = ["+1", "202", "555", "0100"].join("");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ROOT = path.join(REPO_ROOT, "apps", "web");
const VERCEL_BUILD_SCRIPT = path.join(WEB_ROOT, "scripts", "vercel-build.sh");
const COMMAND_TREE_FIXTURE = path.join(
  REPO_ROOT,
  "scripts",
  "fixtures",
  "native-ios-hosted-e2e-command-tree.mjs",
);
const TRUSTED_DEFAULT_BRANCH_CONTROLLERS = [
  "scripts/native-ios-hosted-e2e-identity.mjs",
  "scripts/native-ios-hosted-e2e-native.mjs",
  "scripts/native-ios-hosted-e2e-support.mjs",
  "scripts/native-ios-hosted-e2e-vercel.mjs",
  "scripts/native-ios-hosted-e2e.mjs",
];

test("cross-repo contract is minimal, versioned, and names lifecycle ownership truthfully", () => {
  assert.equal(NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION, "3");
  assert.deepEqual(buildDispatchInputs({
    correlationId: "murph-pr-123",
    mode: "pr",
    webBaseUrl: "https://native-e2e.example.test",
    webSha: SHA,
  }), {
    contract_version: "3",
    correlation_id: "murph-pr-123",
    identity_lifecycle: "orchestrator_owned_reset",
    mode: "pr",
    web_base_url: "https://native-e2e.example.test",
    web_sha: SHA,
  });
  assert.equal(buildDispatchInputs({
    correlationId: "murph-production-canary",
    mode: "production_canary",
    webBaseUrl: "https://murph.ai",
    webSha: SHA,
  }).identity_lifecycle, "non_destructive_existing_identity");
});

test("PR selector targets Web candidates and leaves controller rollout to trusted default branch", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "native-ios-hosted-e2e.yml"),
    "utf8",
  );
  assert.ok(
    workflow.includes("--jq '.[] | .filename, (.previous_filename // empty)'"),
    "renamed paths must be evaluated through previous_filename",
  );
  assert.equal(runWorkflowSelector(workflow, "apps/web/app/page.tsx"), "selected");
  assert.equal(TRUSTED_DEFAULT_BRANCH_CONTROLLERS.length, 5);
  for (const controller of TRUSTED_DEFAULT_BRANCH_CONTROLLERS) {
    assert.equal(runWorkflowSelector(workflow, controller), "neutral", controller);
  }
  assert.equal(
    runWorkflowSelector(workflow, "scripts/native-ios-hosted-e2e.test.mjs"),
    "neutral",
  );
  assert.equal(
    runWorkflowSelector(workflow, "agent-docs/product-specs/companion-app.md"),
    "neutral",
  );
});

test("Vercel custom environment proof binds the dedicated id and slug", () => {
  assert.equal(inspectVercelCustomEnvironment({
    id: "env_e2e",
    slug: "native-ios-e2e",
    type: "preview",
  }, { customEnvironmentId: "env_e2e" }), true);
  for (const mutation of [
    { id: "env_other" },
    { slug: "production" },
    { type: "production" },
  ]) {
    assert.throws(() => inspectVercelCustomEnvironment({
      id: "env_e2e",
      slug: "native-ios-e2e",
      type: "preview",
      ...mutation,
    }, { customEnvironmentId: "env_e2e" }), /dedicated E2E target/u);
  }
});

test("Vercel owns the one Junction namespace read by cleanup and the candidate", async () => {
  assert.equal(inspectVercelJunctionNamespaceVariable({
    customEnvironmentIds: ["env_e2e"],
    decrypted: true,
    id: "env_var_e2e_namespace",
    key: "JUNCTION_CLIENT_USER_ID_NAMESPACE",
    target: [],
    type: "encrypted",
    value: "e2e",
  }, {
    customEnvironmentId: "env_e2e",
    environmentVariableId: "env_var_e2e_namespace",
  }), "e2e");
  for (const mutation of [
    { id: "env_var_other" },
    { key: "JUNCTION_CLIENT_USER_ID_SECRET" },
    { type: "sensitive" },
    { decrypted: false },
    { target: ["production"] },
    { customEnvironmentIds: ["env_other"] },
    { value: "" },
    { value: "dev" },
  ]) {
    assert.throws(() => inspectVercelJunctionNamespaceVariable({
      customEnvironmentIds: ["env_e2e"],
      decrypted: true,
      id: "env_var_e2e_namespace",
      key: "JUNCTION_CLIENT_USER_ID_NAMESPACE",
      target: [],
      type: "encrypted",
      value: "e2e",
      ...mutation,
    }, {
      customEnvironmentId: "env_e2e",
      environmentVariableId: "env_var_e2e_namespace",
    }), /Junction namespace variable/u);
  }

  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "native-ios-hosted-e2e.yml"),
    "utf8",
  );
  assert.match(workflow, /NATIVE_IOS_E2E_VERCEL_JUNCTION_NAMESPACE_ENV_ID/u);
  assert.doesNotMatch(workflow, /NATIVE_IOS_E2E_JUNCTION_CLIENT_USER_ID_NAMESPACE/u);

  const controller = await readFile(
    path.join(REPO_ROOT, "scripts", "native-ios-hosted-e2e.mjs"),
    "utf8",
  );
  const runPrStart = controller.indexOf("async function runPr(args)");
  const namespaceRead = controller.indexOf("readE2eJunctionClientUserIdNamespace()", runPrStart);
  const lifecycleStart = controller.indexOf("await runPrLifecycle", runPrStart);
  assert.ok(
    runPrStart >= 0 && namespaceRead > runPrStart && lifecycleStart > namespaceRead,
    "the Vercel namespace preflight must finish before cleanup, retirement, deployment, or dispatch",
  );
});

test("Vercel proof binds project, custom environment, ref, and exact PR SHA", () => {
  const expected = {
    customEnvironmentId: "env_e2e",
    projectId: "prj_e2e",
    ref: "feature/native-e2e",
    sha: SHA,
  };
  assert.deepEqual(inspectVercelDeployment({
    customEnvironment: { id: "env_e2e" },
    gitSource: { ref: expected.ref, sha: SHA },
    id: "dpl_123",
    projectId: "prj_e2e",
    readyState: "READY",
    target: "preview",
    url: "native-e2e.vercel.app",
  }, expected), {
    baseUrl: "https://native-e2e.vercel.app",
    failed: false,
    id: "dpl_123",
    ready: true,
  });
  for (const mutation of [
    { customEnvironment: { id: "env_other" } },
    { gitSource: { ref: expected.ref, sha: "b".repeat(40) } },
    { projectId: "prj_other" },
    { target: "production" },
  ]) {
    assert.throws(() => inspectVercelDeployment({
      customEnvironment: { id: "env_e2e" },
      gitSource: { ref: expected.ref, sha: SHA },
      id: "dpl_123",
      projectId: "prj_e2e",
      readyState: "READY",
      target: "preview",
      url: "native-e2e.vercel.app",
      ...mutation,
    }, expected));
  }
});

test("Vercel deployment creation sends only current strict API fields", async () => {
  const env = {
    GITHUB_REPOSITORY_ID: "123456789",
    NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID: "env_e2e",
    NATIVE_IOS_E2E_VERCEL_PROJECT_ID: "prj_e2e",
    NATIVE_IOS_E2E_VERCEL_PROJECT_NAME: "murph-native-ios-e2e",
    NATIVE_IOS_E2E_VERCEL_TOKEN: "vercel_test_token",
  };
  const originalEnv = new Map(Object.keys(env).map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  let requestBody;
  try {
    Object.assign(process.env, env);
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "dpl_123" }), {
        headers: { "content-type": "application/json" },
      });
    };
    console.log = () => undefined;

    assert.deepEqual(await createE2eDeployment({
      correlationId: "murph-pr-test",
      ref: "feature/native-e2e",
      sha: SHA,
    }), { id: "dpl_123" });
    assert.deepEqual(requestBody, {
      customEnvironmentSlugOrId: "env_e2e",
      gitSource: {
        ref: "feature/native-e2e",
        repoId: 123456789,
        sha: SHA,
        type: "github",
      },
      meta: {
        murphNativeIosE2e: NATIVE_IOS_HOSTED_E2E_LANE_MARKER,
        murphNativeIosE2eContract: NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
        murphNativeIosE2eCorrelationId: "murph-pr-test",
      },
      name: "murph-native-ios-e2e",
      project: "prj_e2e",
    });
    assert.equal(Object.hasOwn(requestBody, "public"), false);
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Vercel native E2E migration failure stops ordinary migration and build", async () => {
  const config = JSON.parse(await readFile(path.join(WEB_ROOT, "vercel.json"), "utf8"));
  assert.equal(config.buildCommand, "sh scripts/vercel-build.sh");
  assert.ok(config.buildCommand.length <= 256);

  const result = await runVercelBuild({
    FAIL_PNPM_COMMAND: "prisma:migrate:deploy",
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "native-ios-e2e",
  });
  assert.equal(result.status, 42, result.stderr);
  assert.deepEqual(result.calls, [
    "prisma:migrate:deploy|direct=1|generated=",
  ]);
});

test("Vercel native E2E migration success preserves custom, ordinary, build order", async () => {
  const result = await runVercelBuild({
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "native-ios-e2e",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    "prisma:migrate:deploy|direct=1|generated=",
    "release:production:migrate|direct=|generated=",
    "build|direct=|generated=1",
  ]);
});

test("Vercel native E2E target rejects production before any command", async () => {
  const result = await runVercelBuild({
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "native-ios-e2e",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /native-ios-e2e must not use Vercel production/u);
  assert.deepEqual(result.calls, []);
});

test("public PR candidate must be anonymously reachable without redirects or protection", () => {
  assert.equal(inspectPublicCandidateResponse({
    baseUrl: "https://native-e2e.example.test",
    location: null,
    responseUrl: "https://native-e2e.example.test/",
    status: 200,
  }), true);
  assert.throws(() => inspectPublicCandidateResponse({
    baseUrl: "https://native-e2e.example.test",
    location: null,
    responseUrl: "https://native-e2e.example.test/",
    status: 401,
  }), /cannot be reached anonymously/u);
  assert.throws(() => inspectPublicCandidateResponse({
    baseUrl: "https://native-e2e.example.test",
    location: "https://login.example.test/",
    responseUrl: "https://native-e2e.example.test/",
    status: 302,
  }), /cross-origin redirect/u);
  assert.throws(() => inspectPublicCandidateResponse({
    baseUrl: "https://native-e2e.example.test",
    location: null,
    responseUrl: "https://other.example.test/",
    status: 200,
  }), /crossed origins/u);
  assert.throws(() => inspectPublicCandidateResponse({
    baseUrl: "https://native-e2e.example.test",
    location: null,
    responseUrl: "https://native-e2e.example.test/",
    status: 500,
  }), /HTTP 500/u);
});

test("destructive reset admits only lane-owned non-production deployments in the dedicated target", () => {
  const expected = { customEnvironmentId: "env_e2e", projectId: "prj_e2e" };
  assert.equal(inspectRetirableE2eDeployment({
    customEnvironment: { id: "env_e2e" },
    id: "dpl_123",
    meta: { murphNativeIosE2e: NATIVE_IOS_HOSTED_E2E_LANE_MARKER },
    projectId: "prj_e2e",
    target: null,
  }, expected), "dpl_123");
  for (const mutation of [
    { customEnvironment: { id: "env_other" } },
    { meta: { murphNativeIosE2e: "foreign-lane" } },
    { projectId: "prj_other" },
    { target: "production" },
  ]) {
    assert.throws(() => inspectRetirableE2eDeployment({
      customEnvironment: { id: "env_e2e" },
      id: "dpl_123",
      meta: { murphNativeIosE2e: NATIVE_IOS_HOSTED_E2E_LANE_MARKER },
      projectId: "prj_e2e",
      target: null,
      ...mutation,
    }, expected), /unrelated active deployment/u);
  }
});

test("private workflow proof pins the immutable tag and returned run SHA", () => {
  assert.equal(inspectPrivateDispatchTag({
    object: { sha: SHA, type: "commit" },
    ref: "refs/tags/native-e2e-v3",
  }, { expectedSha: SHA, ref: "native-e2e-v3" }), SHA);
  assert.throws(() => inspectPrivateDispatchTag({
    object: { sha: SHA, type: "commit" },
    ref: "refs/tags/native-e2e-v3",
  }, { expectedSha: "b".repeat(40), ref: "native-e2e-v3" }), /reviewed pinned SHA/u);
  assert.deepEqual(inspectPrivateRun({
    conclusion: "success",
    event: "workflow_dispatch",
    head_sha: SHA,
    id: 42,
    status: "completed",
  }, { runId: 42, sha: SHA }), { complete: true, conclusion: "success" });
  assert.throws(() => inspectPrivateRun({
    conclusion: "success",
    event: "workflow_dispatch",
    head_sha: "b".repeat(40),
    id: 42,
    status: "completed",
  }, { runId: 42, sha: SHA }), /does not match/u);
});

test("production canary admits only the deployment still behind the production alias", () => {
  assert.equal(inspectCurrentProductionSha(SHA, SHA), true);
  assert.throws(
    () => inspectCurrentProductionSha("b".repeat(40), SHA),
    /Production alias no longer resolves/u,
  );
});

test("destructive database reset is limited to an explicitly E2E-named database", () => {
  assert.equal(inspectE2eDatabaseUrls({
    databaseUrl: "postgresql://runtime@pool.example.test/native_ios_e2e?sslmode=require",
    directDatabaseUrl: "postgresql://owner@db.example.test/native_ios_e2e?sslmode=require",
  }), "native_ios_e2e");
  assert.throws(() => inspectE2eDatabaseUrls({
    databaseUrl: "postgresql://runtime@pool.example.test/native_ios_e2e",
    directDatabaseUrl: "postgresql://owner@db.example.test/other_e2e",
  }), /must target the same database/u);
  for (const databaseName of ["production", "contest", "nativeios-prod"]) {
    assert.throws(() => inspectE2eDatabaseUrls({
      databaseUrl: `postgresql://runtime@pool.example.test/${databaseName}`,
      directDatabaseUrl: `postgresql://owner@db.example.test/${databaseName}`,
    }), /explicitly E2E\/test database/u);
  }
});

test("Junction cleanup isolates one E2E namespace inside a shared sandbox team", () => {
  const expectedTeamId = "11111111-1111-4111-8111-111111111111";
  const owned = {
    client_user_id: "murph_e2e_expectedclient",
    team_id: expectedTeamId,
    user_id: "22222222-2222-4222-8222-222222222222",
  };
  const unrelated = {
    client_user_id: "murph_existingdeveloper",
    team_id: expectedTeamId,
    user_id: "33333333-3333-4333-8333-333333333333",
  };
  assert.deepEqual(inspectNamespacedJunctionUsers({
    limit: 500,
    offset: 0,
    total: 2,
    users: [unrelated, owned],
  }, { expectedNamespace: "e2e", expectedTeamId }), {
    clientUserId: owned.client_user_id,
    userId: owned.user_id,
  });
  assert.equal(inspectNamespacedJunctionUsers({
    limit: 500,
    offset: 0,
    total: 1,
    users: [unrelated],
  }, { expectedNamespace: "e2e", expectedTeamId }), null);
  assert.throws(() => inspectNamespacedJunctionUsers({
    limit: 500,
    offset: 0,
    total: 1,
    users: [{ ...unrelated, team_id: "44444444-4444-4444-8444-444444444444" }],
  }, { expectedNamespace: "e2e", expectedTeamId }), /unexpected team/u);
  assert.throws(() => inspectNamespacedJunctionUsers({
    limit: 500,
    offset: 0,
    total: 2,
    users: [
      owned,
      { ...owned, user_id: "55555555-5555-4555-8555-555555555555" },
    ],
  }, { expectedNamespace: "e2e", expectedTeamId }), /more than one user/u);
  assert.throws(() => inspectNamespacedJunctionUsers({
    limit: 500,
    offset: 0,
    total: 2,
    users: [unrelated],
  }, { expectedNamespace: "e2e", expectedTeamId }), /incomplete/u);
  assert.throws(() => inspectNamespacedJunctionUsers({
    limit: 500,
    offset: 0,
    total: 1,
    users: [{ ...unrelated, client_user_id: null }],
  }, { expectedNamespace: "e2e", expectedTeamId }), /client user id/u);
  assert.throws(() => inspectNamespacedJunctionUsers({
    limit: 500,
    offset: 0,
    total: 0,
    users: [],
  }, { expectedNamespace: "", expectedTeamId }), /non-empty client user namespace/u);
});

test("cleanup ownership enumerates the namespace before and after deletion", async () => {

  const identitySource = await readFile(
    path.join(REPO_ROOT, "scripts", "native-ios-hosted-e2e-identity.mjs"),
    "utf8",
  );
  const cleanupStart = identitySource.indexOf("export async function cleanupE2e(junctionClientUserIdNamespace)");
  const cleanupConfigStart = identitySource.indexOf("function e2eCleanupConfig(junctionClientUserIdNamespace)", cleanupStart);
  const identityConfigStart = identitySource.indexOf("function e2eIdentityConfig(junctionClientUserIdNamespace)", cleanupConfigStart);
  const cleanupSource = identitySource.slice(cleanupStart, cleanupConfigStart);
  const cleanupConfigSource = identitySource.slice(cleanupConfigStart, identityConfigStart);
  assert.ok(cleanupStart >= 0 && cleanupConfigStart > cleanupStart && identityConfigStart > cleanupConfigStart);
  assert.equal(
    cleanupSource.match(/listNamespacedJunctionUser/gu)?.length,
    2,
    "cleanup must enumerate the exact namespace before and after deletion",
  );
  assert.doesNotMatch(cleanupSource, /buildJunctionClientUserId|e2eIdentityConfig/u);
  const resetIndex = cleanupSource.indexOf("resetDedicatedDatabase");
  const postResetReadIndex = cleanupSource.indexOf("readDedicatedMemberRecord");
  assert.ok(
    resetIndex >= 0 && postResetReadIndex > resetIndex,
    "database contents may be read only after the isolated reset",
  );
  assert.doesNotMatch(
    cleanupConfigSource,
    /NATIVE_IOS_E2E_JUNCTION_CLIENT_USER_ID_SECRET|NATIVE_IOS_E2E_PRIVY_TEST_PHONE/u,
  );
  assert.doesNotMatch(
    cleanupConfigSource,
    /NATIVE_IOS_E2E_JUNCTION_CLIENT_USER_ID_NAMESPACE/u,
  );
});

test("database reset failure emits only the allowlisted command reason", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-ios-database-reset-"));
  const binDir = path.join(tempDir, "bin");
  const fakePnpm = path.join(binDir, "pnpm");
  const envNames = [
    "NATIVE_IOS_E2E_DATABASE_URL",
    "NATIVE_IOS_E2E_DIRECT_DATABASE_URL",
    "NATIVE_IOS_E2E_JUNCTION_API_KEY",
    "NATIVE_IOS_E2E_JUNCTION_TEAM_ID",
    "PATH",
  ];
  const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs = [];
  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(fakePnpm, [
      "#!/bin/sh",
      "printf 'provider output must stay hidden\\n' >&2",
      "exit 42",
    ].join("\n") + "\n", { mode: 0o755 });
    process.env.NATIVE_IOS_E2E_DATABASE_URL = "postgresql://owner@db.example.test/native_ios_e2e";
    process.env.NATIVE_IOS_E2E_DIRECT_DATABASE_URL = "postgresql://owner@db.example.test/native_ios_e2e";
    process.env.NATIVE_IOS_E2E_JUNCTION_API_KEY = "sk_us_test";
    process.env.NATIVE_IOS_E2E_JUNCTION_TEAM_ID = "11111111-1111-4111-8111-111111111111";
    process.env.PATH = `${binDir}:${originalEnv.get("PATH") ?? ""}`;
    globalThis.fetch = async () => new Response(JSON.stringify({
      limit: 500,
      offset: 0,
      total: 0,
      users: [],
    }), { headers: { "content-type": "application/json" } });
    console.log = (...args) => logs.push(args.join(" "));

    await assert.rejects(() => cleanupE2e("e2e"), /E2E database reset failed/u);
    assert.deepEqual(logs, [
      "::notice::native-ios-e2e stage=junction_cleanup result=absent",
      "::notice::native-ios-e2e stage=database_reset result=started",
      "::error::native-ios-e2e stage=database_reset result=failure reason=command_exit",
    ]);
    assert.doesNotMatch(logs.join("\n"), /provider output/u);
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("database validator declares its PostgreSQL runtime at the controller root", async () => {
  const rootPackage = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(rootPackage.devDependencies?.pg, "8.20.0");
  assert.equal(typeof (await import("pg")).default?.Pool, "function");
});

test("database and child-command timeout contracts are explicit and fail closed", () => {
  assert.deepEqual(buildDedicatedDatabasePoolOptions("postgresql://owner@db.example.test/native_ios_e2e"), {
    connectionString: "postgresql://owner@db.example.test/native_ios_e2e",
    connectionTimeoutMillis: 5_000,
    max: 1,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  });
  assert.equal(inspectBoundedCommandResult({
    code: 0,
    label: "test command",
    maxOutputChars: 200,
    outputLength: 40,
    timedOut: false,
  }), true);
  assert.throws(() => inspectBoundedCommandResult({
    code: null,
    label: "test command",
    timedOut: true,
  }), /timed out/u);
  assert.throws(() => inspectBoundedCommandResult({
    code: 0,
    label: "test command",
    maxOutputChars: 200,
    outputLength: 201,
    timedOut: false,
  }), /more output than expected/u);
  assert.throws(() => inspectBoundedCommandResult({
    code: 1,
    label: "test command",
    timedOut: false,
  }), /failed/u);
});

test("bounded command timeout reaps its wrapper and grandchild", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-ios-command-timeout-"));
  const pidFile = path.join(tempDir, "pids.json");
  try {
    await assert.rejects(() => runBoundedCommand({
      argv: [COMMAND_TREE_FIXTURE, "wrapper", "timeout", pidFile],
      command: process.execPath,
      env: process.env,
      label: "wrapper timeout",
      timeoutMs: 1_500,
    }), /timed out/u);
    await assertOwnedProcessesGone(pidFile);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("bounded command output overflow reaps its wrapper and grandchild", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-ios-command-overflow-"));
  const pidFile = path.join(tempDir, "pids.json");
  try {
    await assert.rejects(() => runBoundedCommand({
      argv: [COMMAND_TREE_FIXTURE, "wrapper", "overflow", pidFile],
      captureStdout: true,
      command: process.execPath,
      env: process.env,
      label: "wrapper overflow",
      maxOutputChars: 128,
      timeoutMs: 5_000,
    }), /more output than expected/u);
    await assertOwnedProcessesGone(pidFile);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("bounded command success waits for its wrapper and grandchild", {
  skip: process.platform === "win32",
}, async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-ios-command-success-"));
  const pidFile = path.join(tempDir, "pids.json");
  try {
    assert.equal(await runBoundedCommand({
      argv: [COMMAND_TREE_FIXTURE, "wrapper", "success", pidFile],
      captureStdout: true,
      command: process.execPath,
      env: process.env,
      label: "wrapper success",
      maxOutputChars: 200,
      timeoutMs: 5_000,
    }), "grandchild:success\nwrapper:success\n");
    await assertOwnedProcessesGone(pidFile);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("Privy postcondition requires the fixed principal to have been freshly created", () => {
  const startedAtMs = 1_700_000_000_000;
  assert.deepEqual(inspectFreshPrivyPrincipal({
    created_at: startedAtMs / 1000 + 5,
    id: "did:privy:e2e",
  }, {
    observedAtMs: startedAtMs + 10_000,
    startedAtMs,
  }), {
    createdAtMs: startedAtMs + 5_000,
    id: "did:privy:e2e",
  });
  assert.throws(() => inspectFreshPrivyPrincipal({
    created_at: (startedAtMs - 10 * 60_000) / 1000,
    id: "did:privy:old",
  }, {
    observedAtMs: startedAtMs + 10_000,
    startedAtMs,
  }), /not freshly created during this run/u);
});

test("Junction postcondition requires a connected real Apple Health provider", () => {
  assert.equal(inspectJunctionAppleHealthConnection({
    providers: [{ slug: "apple_health_kit", status: "connected" }],
  }), true);
  for (const providers of [
    [],
    [{ slug: "apple_health_kit", status: "disconnected" }],
    [{ slug: "oura", status: "connected" }],
  ]) {
    assert.throws(() => inspectJunctionAppleHealthConnection({ providers }), /Apple Health connection/u);
  }
});

test("candidate postconditions bind phone derivation, Junction client id, and Apple Health", () => {
  const expectedTeamId = "11111111-1111-4111-8111-111111111111";
  const member = inspectDedicatedMemberIdentity({
    maskedPhoneNumberHint: "*** 0100",
    memberId: "owner-internal-id-123",
  }, { testPhone: TEST_PHONE });
  const expectedClientUserId = buildJunctionClientUserId(
    "junction-client-user-id-secret",
    member.memberId,
    "e2e",
  );
  assert.equal(expectedClientUserId, "murph_e2e_jnqpm4zu2il556kgyffrxn");
  assert.deepEqual(inspectResolvedJunctionUser({
    client_user_id: expectedClientUserId,
    team_id: expectedTeamId,
    user_id: "22222222-2222-4222-8222-222222222222",
  }, { expectedClientUserId, expectedTeamId }), {
    userId: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(inspectJunctionAppleHealthConnection({
    providers: [{ slug: "apple_health_kit", status: "connected" }],
  }), true);
  assert.throws(() => inspectDedicatedMemberIdentity({
    maskedPhoneNumberHint: "*** 9999",
    memberId: member.memberId,
  }, { testPhone: TEST_PHONE }), /fixed test phone hint/u);
  assert.throws(() => inspectResolvedJunctionUser({
    client_user_id: "candidate-created-wrong-client-id",
    team_id: expectedTeamId,
    user_id: "22222222-2222-4222-8222-222222222222",
  }, { expectedClientUserId, expectedTeamId }), /dedicated team identity/u);
});

test("bad candidate identity stays red, final cleanup succeeds, and the next lifecycle deploys", async () => {
  const expectedTeamId = "11111111-1111-4111-8111-111111111111";
  const secret = "junction-client-user-id-secret";
  const namespace = "e2e";
  const unrelatedUser = {
    client_user_id: "murph_existingdeveloper",
    team_id: expectedTeamId,
    user_id: "33333333-3333-4333-8333-333333333333",
  };
  const emptyJunctionNamespace = () => ({
    limit: 500,
    offset: 0,
    total: 1,
    users: [unrelatedUser],
  });
  let databaseMember = null;
  let deployments = 0;
  let junctionTeam = emptyJunctionNamespace();

  const cleanup = async () => {
    const owned = inspectNamespacedJunctionUsers(junctionTeam, {
      expectedNamespace: namespace,
      expectedTeamId,
    });
    if (owned) junctionTeam = emptyJunctionNamespace();
    databaseMember = null;
  };
  const deploy = async () => {
    deployments += 1;
    assert.equal(databaseMember, null, "deployment must start after database cleanup");
    assert.equal(
      inspectNamespacedJunctionUsers(junctionTeam, {
        expectedNamespace: namespace,
        expectedTeamId,
      }),
      null,
      "deployment must start after Junction cleanup",
    );
    databaseMember = {
      maskedPhoneNumberHint: deployments === 1 ? "*** 9999" : "*** 0100",
      memberId: `member-${deployments}`,
    };
    const expectedClientUserId = buildJunctionClientUserId(
      secret,
      databaseMember.memberId,
      namespace,
    );
    junctionTeam = {
      limit: 500,
      offset: 0,
      total: 2,
      users: [unrelatedUser, {
        client_user_id: deployments === 1
          ? "murph_e2e_candidatewrongid"
          : expectedClientUserId,
        team_id: expectedTeamId,
        user_id: "22222222-2222-4222-8222-222222222222",
      }],
    };
    return `https://candidate-${deployments}.example`;
  };
  const postconditions = async () => {
    const expectedClientUserId = buildJunctionClientUserId(
      secret,
      databaseMember.memberId,
      namespace,
    );
    const listed = junctionTeam.users[1];
    if (deployments === 1) {
      assert.throws(() => inspectDedicatedMemberIdentity(
        databaseMember,
        { testPhone: TEST_PHONE },
      ), /fixed test phone hint/u);
      assert.throws(() => inspectResolvedJunctionUser(listed, {
        expectedClientUserId,
        expectedTeamId,
      }), /dedicated team identity/u);
      throw new Error("candidate identity postconditions failed");
    }
    const member = inspectDedicatedMemberIdentity(
      databaseMember,
      { testPhone: TEST_PHONE },
    );
    assert.equal(member.memberId, "member-2");
    assert.deepEqual(inspectResolvedJunctionUser(listed, {
      expectedClientUserId,
      expectedTeamId,
    }), { userId: listed.user_id });
    assert.equal(inspectJunctionAppleHealthConnection({
      providers: [{ slug: "apple_health_kit", status: "connected" }],
    }), true);
  };
  const lifecycle = () => runPrLifecycle({
    cleanup,
    deploy,
    dispatch: async () => undefined,
    now: () => 123,
    postconditions,
    retire: async () => undefined,
  });

  await assert.rejects(lifecycle, /candidate identity postconditions failed/u);
  assert.equal(databaseMember, null);
  assert.equal(inspectNamespacedJunctionUsers(junctionTeam, {
    expectedNamespace: namespace,
    expectedTeamId,
  }), null);

  await lifecycle();
  assert.equal(deployments, 2);
});

test("PR lifecycle proves backend state before retirement and cleans in fail-closed order", async () => {
  const calls = [];
  await runPrLifecycle({
    cleanup: async () => calls.push("cleanup"),
    deploy: async () => { calls.push("deploy"); return "https://candidate.example"; },
    dispatch: async (url) => calls.push(`dispatch:${url}`),
    now: () => { calls.push("boundary"); return 123; },
    postconditions: async (startedAtMs) => calls.push(`postconditions:${startedAtMs}`),
    retire: async () => calls.push("retire"),
  });
  assert.deepEqual(calls, [
    "retire",
    "cleanup",
    "boundary",
    "deploy",
    "dispatch:https://candidate.example",
    "postconditions:123",
    "retire",
    "cleanup",
  ]);
});

test("PR lifecycle stays red when final cleanup fails", async () => {
  let cleanupCalls = 0;
  await assert.rejects(() => runPrLifecycle({
    cleanup: async () => {
      cleanupCalls += 1;
      if (cleanupCalls === 2) throw new Error("cleanup failed");
    },
    deploy: async () => "https://candidate.example",
    dispatch: async () => undefined,
    now: () => 123,
    postconditions: async () => undefined,
    retire: async () => undefined,
  }), /finalization failed at cleanup_after_run/u);
});

test("PR lifecycle retains secret-safe primary and finalization stage names", async () => {
  let cleanupCalls = 0;
  await assert.rejects(() => runPrLifecycle({
    cleanup: async () => {
      cleanupCalls += 1;
      if (cleanupCalls === 2) throw new Error("provider payload must stay hidden");
    },
    deploy: async () => { throw new Error("candidate payload must stay hidden"); },
    dispatch: async () => undefined,
    now: () => 123,
    postconditions: async () => undefined,
    retire: async () => undefined,
  }), (error) => {
    assert.equal(
      error.message,
      "Native iOS E2E failed at deploy; fail-closed finalization failed at cleanup_after_run.",
    );
    assert.doesNotMatch(error.message, /provider payload|candidate payload/u);
    return true;
  });
});

function runWorkflowSelector(workflow, file) {
  const match = /case "\$\{file\}" in\n(?<patterns>[\s\S]*?)\)\n\s+selected=true\n\s+break/u.exec(workflow);
  assert.ok(match?.groups?.patterns, "workflow selector case was not found");
  const script = [
    "set -euo pipefail",
    'file="$1"',
    'case "${file}" in',
    `${match.groups.patterns})`,
    '  printf "selected\\n"',
    "  ;;",
    "*)",
    '  printf "neutral\\n"',
    "  ;;",
    "esac",
  ].join("\n");
  const result = spawnSync("bash", ["-c", script, "selector", file], {
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function runVercelBuild(environment) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "native-ios-vercel-build-"));
  const binDir = path.join(tempDir, "bin");
  const logFile = path.join(tempDir, "pnpm.log");
  const fakePnpm = path.join(binDir, "pnpm");
  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(fakePnpm, [
      "#!/bin/sh",
      "set -eu",
      "printf '%s|direct=%s|generated=%s\\n' \"$*\" \"${MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS:-}\" \"${MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS:-}\" >> \"${PNPM_LOG}\"",
      "if [ -n \"${FAIL_PNPM_COMMAND:-}\" ] && [ \"$*\" = \"${FAIL_PNPM_COMMAND}\" ]; then",
      "  exit 42",
      "fi",
    ].join("\n") + "\n", { mode: 0o755 });
    const result = spawnSync("sh", [VERCEL_BUILD_SCRIPT], {
      cwd: WEB_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        FAIL_PNPM_COMMAND: "",
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        PNPM_LOG: logFile,
        VERCEL_ENV: "",
        VERCEL_TARGET_ENV: "",
        ...environment,
      },
    });
    let calls = [];
    try {
      calls = (await readFile(logFile, "utf8")).split("\n").filter(Boolean);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return {
      calls,
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function assertOwnedProcessesGone(pidFile) {
  const pids = JSON.parse(await readFile(pidFile, "utf8"));
  for (const [label, pid] of Object.entries(pids)) {
    assert.equal(Number.isSafeInteger(pid) && pid > 0, true, `${label} pid was invalid`);
    assert.equal(processExists(pid), false, `${label} process ${pid} was still running`);
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}
