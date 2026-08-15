import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
  NATIVE_IOS_HOSTED_E2E_LANE_MARKER,
  runPrLifecycle,
} from "./native-ios-hosted-e2e.mjs";
import {
  buildDedicatedDatabasePoolOptions,
  buildJunctionClientUserId,
  inspectDedicatedJunctionUsers,
  inspectE2eDatabaseUrls,
  inspectFreshPrivyPrincipal,
  inspectJunctionAppleHealthConnection,
} from "./native-ios-hosted-e2e-identity.mjs";
import {
  buildDispatchInputs,
  inspectCurrentProductionSha,
  inspectPrivateDispatchTag,
  inspectPrivateRun,
} from "./native-ios-hosted-e2e-native.mjs";
import { inspectBoundedCommandResult } from "./native-ios-hosted-e2e-support.mjs";
import {
  inspectPublicCandidateResponse,
  inspectRetirableE2eDeployment,
  inspectVercelCustomEnvironment,
  inspectVercelDeployment,
} from "./native-ios-hosted-e2e-vercel.mjs";

const SHA = "a".repeat(40);

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


test("Junction cleanup enumerates one dedicated team and recovers an orphan user", () => {
  const expectedTeamId = "11111111-1111-4111-8111-111111111111";
  const expectedClientUserId = "murph_expected_client";
  const sole = {
    client_user_id: expectedClientUserId,
    team_id: expectedTeamId,
    user_id: "22222222-2222-4222-8222-222222222222",
  };
  assert.deepEqual(inspectDedicatedJunctionUsers({
    limit: 2,
    offset: 0,
    total: 1,
    users: [sole],
  }, { expectedClientUserId, expectedTeamId }), {
    clientUserId: expectedClientUserId,
    userId: sole.user_id,
  });
  assert.deepEqual(inspectDedicatedJunctionUsers({
    limit: 2,
    offset: 0,
    total: 1,
    users: [sole],
  }, { expectedClientUserId: null, expectedTeamId }), {
    clientUserId: expectedClientUserId,
    userId: sole.user_id,
  });
  assert.equal(inspectDedicatedJunctionUsers({
    limit: 2,
    offset: 0,
    total: 0,
    users: [],
  }, { expectedClientUserId: null, expectedTeamId }), null);
  assert.throws(() => inspectDedicatedJunctionUsers({
    limit: 2,
    offset: 0,
    total: 1,
    users: [{ ...sole, client_user_id: "murph_unexpected_client" }],
  }, { expectedClientUserId, expectedTeamId }), /unexpected client user/u);
  assert.throws(() => inspectDedicatedJunctionUsers({
    limit: 2,
    offset: 0,
    total: 1,
    users: [{ ...sole, team_id: "33333333-3333-4333-8333-333333333333" }],
  }, { expectedClientUserId: null, expectedTeamId }), /unexpected team/u);
  assert.throws(() => inspectDedicatedJunctionUsers({
    limit: 2,
    offset: 0,
    total: 2,
    users: [sole, { ...sole, user_id: "44444444-4444-4444-8444-444444444444" }],
  }, { expectedClientUserId: null, expectedTeamId }), /more than one user/u);
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

test("Junction cleanup uses the production client-user identity derivation", () => {
  assert.equal(
    buildJunctionClientUserId("junction-client-user-id-secret", "owner-internal-id-123"),
    "murph_jnqpm4zu2il556kgyffrxngz26",
  );
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
  }), /final cleanup did not complete/u);
});
