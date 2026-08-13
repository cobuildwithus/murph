import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const hostedExecutionMocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: hostedExecutionMocks.emitHostedExecutionStructuredLog,
  };
});

import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedSecureBoxAad,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  sealHostedSecureBox,
  serializeHostedEmailThreadTarget,
  serializeHostedSecureBoxEnvelope,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import {
  sha256HostedBundleHex,
} from "@murphai/runtime-state/node/hosted-bundle-codec";
import {
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  isHostedRuntimePrivateImageDeliveryUrl,
  type HostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedExecutionWorkingSnapshotRef,
} from "@murphai/hosted-execution/parsers";
import {
  createAssistantUsageReportingUserId,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH,
} from "@murphai/hosted-execution/assistant-personalization";
import {
  buildHostedComputerRunOperationPath,
  HOSTED_COMPUTER_RUNS_PATH,
  isHostedComputerWebControlRequest,
} from "@murphai/hosted-execution/computer-use";
import {
  HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
  HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
} from "@murphai/hosted-execution/clinical-records";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  createHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  wrapHostedWorkspaceSnapshotV2DataKey,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  HOSTED_RUNTIME_ACTION_APPROVAL_CONSUME_PATH,
  HOSTED_RUNTIME_ACTION_APPROVAL_READ_PATH,
  HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH,
  HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
  HOSTED_RUNTIME_CODEX_AUTH_PATH,
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_CRYPTO_ROOT_PATH,
  HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH,
  HOSTED_RUNTIME_GROUP_TOOL_PATH,
  HOSTED_RUNTIME_LATENCY_TRACE_PATH,
  HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH,
  HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH,
  HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH,
  HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH,
  HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
  HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH,
  HOSTED_RUNTIME_USAGE_RECORD_PATH,
  HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import {
  HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS,
  HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER,
} from "@murphai/hosted-execution/vault-share";
import {
  encryptHostedStorageEnvelope,
  type R2PutValueLike,
} from "../src/crypto.ts";
import {
  HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA,
  type HostedBrowserVaultReplicaOrphanCandidate,
} from "../src/browser-vault-store.ts";
import {
  writeHostedEmailRawMessage,
} from "../src/hosted-email.ts";
import {
  createHostedArtifactStore,
  createHostedBundleStore,
} from "../src/bundle-store.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { clearHostedRuntimeCryptoContextEnvelopeCacheForTests } from "../src/hosted-crypto/runtime-user-crypto-context.ts";
import {
  handleRunnerOutboundRequest,
  type RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import {
  HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_HEADER,
  HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_HEADER,
  HOSTED_WEB_CONTROL_FORWARDED_RESPONSE_HEADER,
} from "../src/runner-outbound/headers.ts";
import {
  resolveRunnerOutboundUserCryptoContext,
  resolveRunnerOutboundUserRunnerStub,
  resetRunnerOutboundSharedCachesForTest,
} from "../src/runner-outbound/shared.ts";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
  isAllowedHostedRunnerWebControlRequest,
  readHostedRunnerWebControlRoute,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import {
  handleRunnerGeneratedImageUploadRequest,
} from "../src/runner-outbound/generated-images.ts";
import {
  handleRunnerPrivateImageUrlPublishRequest,
} from "../src/runner-outbound/private-image-urls.ts";
import type {
  HostedPrivateMediaPublishResult,
} from "../src/private-media.ts";
import {
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH,
} from "../src/runtime-mailbox-payload-decode-contract.ts";
import {
  HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH,
  HOSTED_EXECUTION_RUNNER_PRIVATE_IMAGE_URL_PUBLISH_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
} from "../src/runner-effects-contract.ts";
import {
  HOSTED_R2_CHECKSUM_MODE_ENABLED,
  HOSTED_R2_CHECKSUM_MODE_HEADER,
} from "../src/r2-presigned-url.ts";
import {
  hostedArtifactObjectKey,
  hostedBrowserVaultReplicaUserPrefix,
  hostedWorkspaceSnapshotObjectKey,
} from "../src/storage-paths.ts";
import {
  HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
  HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
  type HostedWorkspaceSnapshotOrphanCandidate,
  type HostedWorkspaceSnapshotUploadSession,
} from "../src/workspace-snapshot-store.ts";
import {
  asWorkerStringEnvironment,
} from "../src/worker-contracts.ts";
import {
  verifyHostedWebCallbackSignatureHeaders,
} from "../src/web-callback-auth.ts";
import type {
  WorkerBindUserRunnerStubLike,
  WorkerUserRunnerStubLike,
  WorkerUserRunnerNamespaceLike,
} from "../src/worker-contracts.ts";
import {
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK_JSON,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
  TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
} from "./hosted-execution-fixtures.ts";

const hostedEmailRoutes = vi.hoisted(() => ({
  createHostedEmailUserAddress: vi.fn(async () => "reply@example.com"),
}));

vi.mock("../src/hosted-email/routes.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/hosted-email/routes.ts")>(
    "../src/hosted-email/routes.ts",
  );

  return {
    ...actual,
    createHostedEmailUserAddress: hostedEmailRoutes.createHostedEmailUserAddress,
  };
});

const RUNNER_PROXY_TOKEN = "proxy-token";
const RUNNER_PROXY_TOKEN_HEADER = "x-hosted-execution-runner-proxy-token";
const MISSING_ARTIFACT_URL = `http://artifacts.worker/objects/${"a".repeat(64)}`;
const HEARTBEAT_URL = "http://runner-control.worker/internal/active-invocation/heartbeat";
const PRIVATE_MEDIA_PUBLISH_EXPIRES_AT = "2033-05-18T03:33:20.000Z";
const PRIVATE_MEDIA_PUBLISH_URL =
  `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}?exp=2000000000`;
const ALLOWLISTED_WEB_CONTROL_CASES = [
  {
    body: {
      action: "upgrade_edge",
      assistantInputId: `ain_${"a".repeat(32)}`,
    },
    name: "hosted subscription tool",
    path: HOSTED_RUNTIME_SUBSCRIPTION_TOOL_PATH,
  },
  {
    body: {},
    name: "hosted plan usage tool",
    path: HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH,
  },
  {
    body: { generation: 1, runId: "clinical_run_1" },
    name: "clinical records read run",
    path: HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
  },
  {
    body: {
      cursor: null,
      generation: 1,
      requestId: "clinical_request_1",
      resourceType: "Observation",
      runId: "clinical_run_1",
    },
    name: "clinical records fetch page",
    path: HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
  },
  {
    body: {
      counts: {
        createdCount: 0,
        executableDecisionCount: 0,
        fetchedPageCount: 1,
        fetchedResourceFamilyCount: 1,
        rawFileCount: 2,
        retractedCount: 0,
        reviewDecisionCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      },
      generation: 1,
      runId: "clinical_run_1",
      status: "completed",
    },
    name: "clinical records record outcome",
    path: HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
  },
  {
    body: {
      connectionId: "conn_123",
      includeCredentialMaterial: false,
      userId: "member_123",
    },
    name: "device-sync runtime snapshot",
    path: "/api/internal/device-sync/runtime/snapshot",
  },
  {
    body: {
      changes: [],
      connectionId: "conn_123",
      expectedRevision: "12",
      userId: "member_123",
    },
    name: "device-sync runtime apply",
    path: "/api/internal/device-sync/runtime/apply",
  },
  {
    body: {
      limit: 1,
      userId: "member_123",
    },
    name: "device-sync dirty pending",
    path: "/api/internal/device-sync/runtime/dirty-pending",
  },
  {
    body: {
      connectionId: "conn_123",
      processedRevision: "12",
      userId: "member_123",
    },
    name: "device-sync dirty ack",
    path: "/api/internal/device-sync/runtime/dirty-ack",
  },
  {
    body: {
      connectionId: "conn_123",
    },
    name: "device-sync reconcile",
    path: "/api/internal/device-sync/reconcile",
  },
  {
    body: {
      bytes: 17,
      eventId: "evt_123",
    },
    name: "hosted execution usage recording",
    path: "/api/internal/hosted-execution/usage/record",
  },
  {
    body: {
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_interest",
        relatedChangelogItemIds: ["native-message-formatting"],
        summary: "Interested in native message formatting.",
      },
    },
    name: "hosted product feedback recording",
    path: HOSTED_RUNTIME_PRODUCT_FEEDBACK_RECORD_PATH,
  },
  {
    body: { action: "read" },
    name: "hosted assistant personalization tool",
    path: HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH,
  },
  {
    body: {
      provider: "google",
      returnPath: "/settings/sync",
    },
    name: "device-sync connect-target connect-link",
    path: "/api/internal/device-sync/connect-targets/google/connect-link",
  },
  {
    body: {},
    name: "hosted email recipient authority",
    path: HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH,
  },
  {
    body: {
      channel: "telegram",
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    },
    name: "hosted external thread route authority",
    path: HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH,
  },
  {
    body: {
      target: "chat_123",
      targetKind: "thread",
    },
    name: "hosted Linq egress authority",
    path: HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH,
  },
  {
    body: {
      acceptedAt: "2026-04-26T00:00:04.000Z",
      attemptedAt: "2026-04-26T00:00:03.000Z",
      idempotencyKey: "assistant-outbox:intent_123",
      providerMessageId: "linq_message_sent",
      providerThreadId: "linq_chat_123",
      target: "linq_chat_123",
      targetKind: "thread",
    },
    name: "hosted Linq delivery outcome",
    path: HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH,
  },
  {
    body: {
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      requestId: "request_mailbox_1",
    },
    name: "hosted mailbox fetch",
    path: "/api/internal/hosted-mailbox/fetch",
  },
  {
    body: {
      itemId: "mailbox_item_123",
      payloadRef: {
        kind: "hosted-mailbox-payload",
        payloadId: "payload_123",
      },
      requestId: "request_payload_1",
    },
    name: "hosted mailbox payload fetch",
    path: "/api/internal/hosted-mailbox/payload/fetch",
  },
  {
    body: {
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      reason: "import",
    },
    name: "hosted workspace checkpoint",
    path: "/api/internal/hosted-workspace/checkpoint",
  },
  {
    body: {
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          component: "mailbox",
          eventCode: "mailbox.imported",
          level: "info",
          phase: "import",
          redactedJson: {
            importedCount: 1,
          },
        },
      ],
    },
    name: "hosted runtime log",
    path: "/api/internal/hosted-runtime/log",
  },
  {
    body: {
      event: {
        assistantInputId: "input_1",
        at: "2026-04-26T00:00:03.000Z",
        mailboxItemId: "mailbox_item_1",
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_input_staged",
      },
    },
    name: "hosted runtime latency trace",
    path: HOSTED_RUNTIME_LATENCY_TRACE_PATH,
  },
  {
    body: {
      attemptId: "hca_abcdefghijklmnop",
      phase: "connected",
    },
    name: "hosted Codex auth update",
    path: HOSTED_RUNTIME_CODEX_AUTH_PATH,
  },
  {
    body: {
      component: "mailbox",
      detailsJson: {},
      environment: "production",
      fingerprint: "mailbox.unexpected",
      issueKind: "unexpected-mailbox-item",
      occurredAt: "2026-04-26T00:00:03.000Z",
      phase: "import",
      severity: "warning",
      summary: "Unexpected mailbox item",
    },
    name: "hosted issue recording",
    path: "/api/internal/hosted-execution/issues/record",
  },
  {
    body: {
      goal: "Book a dentist appointment.",
      resumeAfterMailboxItemId: null,
      resumeDeliveryContext: null,
      startUrl: "https://example.test",
    },
    name: "hosted computer open",
    path: HOSTED_COMPUTER_RUNS_PATH,
  },
  {
    body: {
      action: "click",
      locator: {
        by: "role",
        exact: false,
        name: "Submit",
        role: "button",
      },
      timeoutMs: 25000,
    },
    name: "hosted computer act",
    path: buildHostedComputerRunOperationPath({
      operation: "act",
      runId: "run_123",
    }),
  },
  {
    body: {
      action: "clickMouse",
      x: 120,
      y: 240,
    },
    name: "hosted computer os control",
    path: buildHostedComputerRunOperationPath({
      operation: "os-control",
      runId: "run_123",
    }),
  },
  {
    body: {
      reason: "final_confirmation",
      suggestedReply: "yes",
    },
    name: "hosted computer pause for user",
    path: buildHostedComputerRunOperationPath({
      operation: "pause-for-user",
      runId: "run_123",
    }),
  },
  {
    body: {
      outcome: "completed",
      summary: "Appointment booked.",
    },
    name: "hosted computer finish",
    path: buildHostedComputerRunOperationPath({
      operation: "finish",
      runId: "run_123",
    }),
  },
] as const;

describe("handleRunnerOutboundRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    hostedExecutionMocks.emitHostedExecutionStructuredLog.mockReset();
    vi.useRealTimers();
    clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
    resetRunnerOutboundSharedCachesForTest();
  });

  it("returns the outbound stub without a bindUser round trip", async () => {
    type ReceiverSensitiveStub = WorkerBindUserRunnerStubLike & {
      marker: string;
    };
    const stub: ReceiverSensitiveStub = {
      marker: "runner-outbound-stub",
      bindUser: vi.fn(async function (
        this: ReceiverSensitiveStub,
        userId: string,
      ) {
        expect(this.marker).toBe("runner-outbound-stub");
        return { userId };
      }),
    };
    const env = createDirectRunnerOutboundEnv({
      USER_RUNNER: {
        getByName() {
          return stub;
        },
      },
    });

    const resolvedStub = await resolveRunnerOutboundUserRunnerStub(env, "member_123");

    expect(resolvedStub).toBe(stub);
    expect(stub.bindUser).not.toHaveBeenCalled();
  });

  it("resolves fresh outbound stubs without binding the runner", async () => {
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const getByName = vi.fn(() => ({
      bindUser,
    }));
    const env = createDirectRunnerOutboundEnv({
      USER_RUNNER: {
        getByName,
      },
    });

    const firstStub = await resolveRunnerOutboundUserRunnerStub(env, "member_123");
    const secondStub = await resolveRunnerOutboundUserRunnerStub(env, "member_123");
    const thirdStub = await resolveRunnerOutboundUserRunnerStub(env, "member_123");

    expect(firstStub).not.toBe(secondStub);
    expect(secondStub).not.toBe(thirdStub);
    expect(getByName).toHaveBeenCalledTimes(3);
    expect(bindUser).not.toHaveBeenCalled();
  });

  it("does not call failing bindUser hooks while resolving outbound stubs", async () => {
    const bindUser = vi.fn()
      .mockRejectedValueOnce(new Error("bind failed"))
      .mockResolvedValueOnce({ userId: "member_123" });
    const env = createDirectRunnerOutboundEnv({
      USER_RUNNER: {
        getByName() {
          return { bindUser };
        },
      },
    });

    await expect(resolveRunnerOutboundUserRunnerStub(env, "member_123")).resolves.toMatchObject({
      bindUser,
    });

    expect(bindUser).not.toHaveBeenCalled();
  });

  it("defers runner method validation until a hot-path route needs it", async () => {
    const env = createDirectRunnerOutboundEnv({
      USER_RUNNER: {
        getByName() {
          return {} as never;
        },
      },
    });

    await expect(resolveRunnerOutboundUserRunnerStub(env, "member_123")).resolves.toEqual({});
  });

  it("returns 404 for removed Cloudflare-owned device-sync runtime hosts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      body: undefined,
      name: "hosted runtime crypto context",
      path: HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
    },
    {
      body: {
        domain: "ingress",
        rootKeyId: "udrk:ingress:test-root",
      },
      name: "hosted runtime crypto root",
      path: HOSTED_RUNTIME_CRYPTO_ROOT_PATH,
    },
  ])("rejects raw crypto web-control proxy path: $name", async ({ body, path }) => {
    expect(isAllowedHostedRunnerWebControlRequest({
      method: "POST",
      path,
    })).toBe(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: createRunnerProxyHeaders(
          body === undefined
            ? {}
            : {
                "content-type": "application/json; charset=utf-8",
              },
        ),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for removed Cloudflare-owned device-sync connect-link hosts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/connect-targets/whoop/connect-link", {
        headers: createRunnerProxyHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allowlists hosted action approval request, read, and consume routes", () => {
    expect(isAllowedHostedRunnerWebControlRequest({
      method: "POST",
      path: HOSTED_RUNTIME_ACTION_APPROVAL_REQUEST_PATH,
    })).toBe(true);
    expect(isAllowedHostedRunnerWebControlRequest({
      method: "POST",
      path: HOSTED_RUNTIME_ACTION_APPROVAL_READ_PATH,
    })).toBe(true);
    expect(isAllowedHostedRunnerWebControlRequest({
      method: "POST",
      path: HOSTED_RUNTIME_ACTION_APPROVAL_CONSUME_PATH,
    })).toBe(true);
  });

  it.each(ALLOWLISTED_WEB_CONTROL_CASES)(
    "proxies allowlisted hosted web-control path: $name",
    async ({ body, path }) => {
      expect(isAllowedHostedRunnerWebControlRequest({
        method: "POST",
        path,
      })).toBe(true);

      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      const fetchMock = vi.fn(async (
        ..._args: Parameters<typeof fetch>
      ): Promise<Response> =>
        new Response(
          JSON.stringify(
            path === "/api/internal/hosted-workspace/checkpoint"
              ? createHostedWorkspaceCheckpointResponse("5")
              : {
                  ok: true,
                  path,
                },
          ),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        ));
      vi.stubGlobal("fetch", fetchMock);

      const response = await handleRunnerOutboundRequest(
        new Request(`http://web-control.worker${path}`, {
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          headers: createRunnerWriteFenceProxyHeaders({
            ...(body === undefined
              ? {}
              : {
                  "content-type": "application/json; charset=utf-8",
                  authorization: "Bearer child-supplied-token",
                  "x-api-key": "child-supplied-key",
                  "x-hosted-execution-signature": "child-signature",
                  "x-hosted-execution-user-id": "member_spoofed",
                  "x-hosted-runner-bound-user-id": "member_spoofed",
                }),
          }),
          method: "POST",
        }),
        createRunnerOutboundEnv({
          HOSTED_WEB_BASE_URL: "https://web.example.test",
          HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "50000",
          HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "45000",
        }),
        "member_123" ,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(
        path === "/api/internal/hosted-workspace/checkpoint"
          ? createHostedWorkspaceCheckpointResponse("5")
          : {
              ok: true,
              path,
            },
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstCall = fetchMock.mock.calls[0];
      if (!firstCall) {
        throw new Error("Expected the allowlisted web-control fetch to run.");
      }
      const [url, init] = firstCall;
      expect(String(url)).toBe(`https://web.example.test${path}`);
      expect(init?.method).toBe("POST");
      const snapshotIncludeCredentialMaterial = (() => {
        if (
          !body
          || typeof body !== "object"
          || !("includeCredentialMaterial" in body)
        ) {
          return true;
        }

        return typeof body.includeCredentialMaterial === "boolean"
          ? body.includeCredentialMaterial
          : true;
      })();
      const expectedForwardedBody = path === "/api/internal/device-sync/runtime/snapshot"
        ? JSON.stringify({
            ...body,
            includeCredentialMaterial: snapshotIncludeCredentialMaterial,
          })
        : body === undefined ? undefined : JSON.stringify(body);
      expect(init?.body).toBe(expectedForwardedBody);
      const headers = new Headers(init?.headers);
      expect(headers.get("content-type")).toBe(body === undefined ? null : "application/json");
      expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("x-api-key")).toBeNull();
      expect(headers.get("x-hosted-execution-signature")).toBeTruthy();
      expect(headers.get("x-hosted-execution-signature")).not.toBe("child-signature");
      expect(headers.get("x-hosted-runner-bound-user-id")).toBeNull();
      if (
        path === HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH
        || path === HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH
        || path === HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH
      ) {
        expect(headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
        expect(headers.get("x-hosted-runtime-lease-generation")).toBe("9");
      }
      expect(timeoutSpy).toHaveBeenCalledWith(45_000);
    },
  );

  it("rejects assistant personalization without the active runtime fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createAssistantPersonalizationRunnerRequest(),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return { validateRuntimeWriteFence };
          },
        },
      }),
      "member_personalization_target",
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      attemptId: "attempt_stale",
      generation: "9",
      name: "stale attempt",
    },
    {
      attemptId: "attempt_active",
      generation: "8",
      name: "wrong generation",
    },
  ])("rejects assistant personalization with a $name fence", async ({
    attemptId,
    generation,
  }) => {
    const validateRuntimeWriteFence = vi.fn(async (input: {
      attemptId: string;
      generation: string;
      userId: string;
    }) =>
      input.attemptId === "attempt_active"
      && input.generation === "9"
      && input.userId === "member_personalization_target"
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createAssistantPersonalizationRunnerRequest({
        "x-hosted-runtime-attempt-id": attemptId,
        "x-hosted-runtime-lease-generation": generation,
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return { validateRuntimeWriteFence };
          },
        },
      }),
      "member_personalization_target",
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId,
      generation,
      userId: "member_personalization_target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects assistant personalization when the fence belongs to another user", async () => {
    const validateRuntimeWriteFence = vi.fn(async (input: {
      attemptId: string;
      generation: string;
      userId: string;
    }) =>
      input.attemptId === "attempt_fence_owner"
      && input.generation === "9"
      && input.userId === "member_fence_owner"
    );
    const getByName = vi.fn(() => ({ validateRuntimeWriteFence }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createAssistantPersonalizationRunnerRequest({
        "x-hosted-runtime-attempt-id": "attempt_fence_owner",
        "x-hosted-runtime-lease-generation": "9",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: { getByName },
      }),
      "member_personalization_target",
    );

    expect(response.status).toBe(401);
    expect(getByName).toHaveBeenCalledWith("member_personalization_target");
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_fence_owner",
      generation: "9",
      userId: "member_personalization_target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards and signs assistant personalization only for the fence-bound user", async () => {
    const boundUserId = "member_personalization_bound";
    const payload = JSON.stringify({ action: "read" });
    const assistantInputSearch =
      "?assistantInputId=ain_0123456789abcdef0123456789abcdef";
    const validateRuntimeWriteFence = vi.fn(async (input: {
      attemptId: string;
      generation: string;
      userId: string;
    }) =>
      input.attemptId === "attempt_active"
      && input.generation === "9"
      && input.userId === boundUserId
    );
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(JSON.stringify({
      action: "read",
      result: {
        model: "gpt-5.6-terra",
        solAvailable: false,
        tone: "formal",
        voice: "warm",
      },
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const env = createRunnerOutboundEnv({
      USER_RUNNER: {
        getByName() {
          return { validateRuntimeWriteFence };
        },
      },
    });

    const response = await handleRunnerOutboundRequest(
      createAssistantPersonalizationRunnerRequest({
        "x-hosted-execution-signature": "child-supplied-signature",
        "x-hosted-execution-user-id": "member_spoofed",
        "x-hosted-runner-bound-user-id": "member_spoofed",
        "x-hosted-runtime-attempt-id": "attempt_active",
        "x-hosted-runtime-lease-generation": "9",
      }, assistantInputSearch),
      env,
      boundUserId,
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_active",
      generation: "9",
      userId: boundUserId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the personalization callback to be forwarded.");
    }
    const [url, init] = firstCall;
    const headers = new Headers(init?.headers);
    expect(String(url)).toBe(
      `https://web.example.test${HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH}${assistantInputSearch}`,
    );
    expect(init?.body).toBe(payload);
    expect(headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_active");
    expect(headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(headers.get("x-hosted-execution-user-id")).toBe(boundUserId);
    expect(headers.get("x-hosted-runner-bound-user-id")).toBeNull();
    expect(headers.get("x-hosted-execution-signature")).not.toBe(
      "child-supplied-signature",
    );

    const privateKeyJwkJson = env.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK;
    if (typeof privateKeyJwkJson !== "string") {
      throw new Error("Expected the callback signing fixture.");
    }
    const forwardedRequest = new Request(String(url), {
      headers,
      method: "POST",
    });
    const nonceStore = { consume: vi.fn(async () => true) };
    const signatureInput = {
      environment: {
        keyId: "v1",
        privateKeyJwkJson,
      },
      method: "POST",
      nonceStore,
      path: HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH,
      payload,
      request: forwardedRequest,
      search: assistantInputSearch,
    };
    await expect(verifyHostedWebCallbackSignatureHeaders({
      ...signatureInput,
      userId: "member_spoofed",
    })).resolves.toBe(false);
    await expect(verifyHostedWebCallbackSignatureHeaders({
      ...signatureInput,
      userId: boundUserId,
    })).resolves.toBe(true);
    expect(nonceStore.consume).toHaveBeenCalledTimes(1);
    expect(nonceStore.consume).toHaveBeenCalledWith(
      expect.objectContaining({ userId: boundUserId }),
    );
  });

  it.each([
    HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH,
    HOSTED_CLINICAL_RECORDS_RUNTIME_FETCH_PAGE_PATH,
    HOSTED_CLINICAL_RECORDS_RUNTIME_RECORD_OUTCOME_PATH,
  ])("rejects clinical web-control requests without the active runtime fence: %s", async (path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${path}`, {
        body: JSON.stringify({ generation: 1, runId: "clinical_run_1" }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not inspect sensitive clinical response bodies in proxy diagnostics", async () => {
    const sensitiveDetail = "Private provider response must remain opaque.";
    const upstreamResponse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sensitiveDetail));
        controller.close();
      },
    }), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 503,
    });
    const cloneSpy = vi.spyOn(upstreamResponse, "clone");
    const fetchMock = vi.fn(async () => upstreamResponse);
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(
        `http://web-control.worker${HOSTED_CLINICAL_RECORDS_RUNTIME_READ_RUN_PATH}`,
        {
          body: JSON.stringify({ generation: 1, runId: "clinical_run_1" }),
          headers: createRunnerProxyHeaders({
            "content-type": "application/json; charset=utf-8",
            "x-hosted-runtime-attempt-id": "attempt_1",
            "x-hosted-runtime-lease-generation": "9",
          }),
          method: "POST",
        },
      ),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
    );

    expect(response.status).toBe(503);
    expect(cloneSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls))
      .not.toContain(sensitiveDetail);
  });

  it("rejects device-sync runtime snapshots without the active runtime fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH}`, {
        body: JSON.stringify({
          connectionId: "conn_123",
          includeCredentialMaterial: true,
          userId: "member_123",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects runtime latency traces without the active runtime fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_LATENCY_TRACE_PATH}`, {
        body: JSON.stringify({
          event: {
            assistantInputId: "input_1",
            at: "2026-04-26T00:00:03.000Z",
            mailboxItemId: "mailbox_item_1",
            runtimeAttemptId: "attempt_1",
            source: "linq",
            type: "assistant_input_staged",
          },
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq egress authority assertions without the active runtime fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH}`, {
        body: JSON.stringify({
          target: "chat_123",
          targetKind: "thread",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Linq delivery outcomes without the active runtime fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH}`, {
        body: JSON.stringify({
          acceptedAt: "2026-04-26T00:00:04.000Z",
          attemptedAt: "2026-04-26T00:00:03.000Z",
          idempotencyKey: "assistant-outbox:intent_123",
          providerMessageId: "linq_message_sent",
          providerThreadId: "linq_chat_123",
          target: "linq_chat_123",
          targetKind: "thread",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects hosted Codex auth updates without the active runtime fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_CODEX_AUTH_PATH}`, {
        body: JSON.stringify({
          attemptId: "hca_abcdefghijklmnop",
          phase: "connected",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects hosted computer-use requests without the active runtime fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_COMPUTER_RUNS_PATH}`, {
        body: JSON.stringify({
          goal: "Book a dentist appointment.",
          startUrl: "https://example.test",
          taskKind: "appointment",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards hosted computer-use requests after active runtime fence validation", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> =>
      new Response(JSON.stringify({
        result: { clicked: true },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const path = buildHostedComputerRunOperationPath({
      operation: "act",
      runId: "run_123",
    });

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${path}`, {
        body: JSON.stringify({
          action: "click",
          locator: {
            by: "role",
            exact: false,
            name: "Submit",
            role: "button",
          },
          timeoutMs: 25000,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
  });

  it("rejects hosted computer-use requests when the runtime fence is stale", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const path = buildHostedComputerRunOperationPath({
      operation: "pause-for-user",
      runId: "run_123",
    });

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${path}`, {
        body: JSON.stringify({
          reason: "final_confirmation",
          suggestedReply: "yes",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects vault-share deliveries without the active runtime fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH}`, {
        body: JSON.stringify({
          projectionKind: "sleep-times.v0",
          records: [
            {
              data: {
                date: "2026-06-09",
                sleepEndAt: "2026-06-10T06:31:00.000Z",
                sleepStartAt: "2026-06-09T22:04:00.000Z",
              },
              occurredAt: "2026-06-09T00:00:00.000Z",
              recordKey: "2026-06-09",
            },
          ],
        }),
        headers: createVaultShareRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards vault-share deliveries after active runtime fence validation", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> =>
      new Response(JSON.stringify({
        status: "delivered",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH}`, {
        body: JSON.stringify({
          projectionKind: "sleep-times.v0",
          records: [
            {
              data: {
                date: "2026-06-09",
                sleepEndAt: "2026-06-10T06:31:00.000Z",
                sleepStartAt: "2026-06-09T22:04:00.000Z",
              },
              occurredAt: "2026-06-09T00:00:00.000Z",
              recordKey: "2026-06-09",
            },
          ],
        }),
        headers: createVaultShareRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get(HOSTED_WEB_CONTROL_FORWARDED_RESPONSE_HEADER)).toBe("1");
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(headers.get(HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER)).toMatch(/^\d{13}$/u);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
  });

  it("rejects vault-share deliveries when the runtime fence is stale", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH}`, {
        body: JSON.stringify({
          projectionKind: "sleep-times.v0",
          records: [
            {
              data: {
                date: "2026-06-09",
                sleepEndAt: "2026-06-10T06:31:00.000Z",
                sleepStartAt: "2026-06-09T22:04:00.000Z",
              },
              occurredAt: "2026-06-09T00:00:00.000Z",
              recordKey: "2026-06-09",
            },
          ],
        }),
        headers: createVaultShareRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects hosted group tool requests without the active runtime fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_GROUP_TOOL_PATH}`, {
        body: JSON.stringify({
          action: "read_current",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects hosted plan usage reads when the caller fence does not belong to the target member", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_PLAN_USAGE_TOOL_PATH}`, {
        body: JSON.stringify({}),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runner-bound-user-id": "member_target",
          "x-hosted-runtime-attempt-id": "caller_attempt",
          "x-hosted-runtime-lease-generation": "3",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_target",
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "caller_attempt",
      generation: "3",
      userId: "member_target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards hosted group tool requests after active runtime fence validation", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> =>
      new Response(JSON.stringify({
        action: "read_current",
        result: { status: "ok" },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_GROUP_TOOL_PATH}`, {
        body: JSON.stringify({
          action: "read_current",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
  });

  it("rejects hosted group tool requests when the runtime fence is stale", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_GROUP_TOOL_PATH}`, {
        body: JSON.stringify({
          action: "read_current",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upgrades device-sync runtime snapshots after active runtime fence validation", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH}`, {
        body: JSON.stringify({
          connectionId: "conn_123",
          includeCredentialMaterial: false,
          userId: "member_123",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit?.body).toBe(JSON.stringify({
      connectionId: "conn_123",
      includeCredentialMaterial: false,
      userId: "member_123",
    }));
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("x-hosted-runtime-attempt-id")).toBe("attempt_1");
    expect(headers.get("x-hosted-runtime-lease-generation")).toBe("9");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
  });

  it("rejects device-sync runtime snapshots when the runtime fence is stale", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH}`, {
        body: JSON.stringify({
          connectionId: "conn_123",
          includeCredentialMaterial: false,
          userId: "member_123",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds hosted usage reporting attribution inside the Worker web-control proxy", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const usage = {
      memberId: "member_child_controlled",
      provider: "codex-cli",
      reportingUserId: "musr_child_controlled",
      schema: "murph.assistant-usage.v1",
      usageId: "turn_123.attempt-1",
    };
    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_USAGE_RECORD_PATH}`, {
        body: JSON.stringify({ usage }),
        headers: createRunnerWriteFenceProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_AI_USAGE_REPORTING_SECRET: "usage-reporting-secret",
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the usage web-control fetch to run.");
    }
    const [, init] = firstCall;
    expect(init?.body).toBe(JSON.stringify({
      usage: {
        ...usage,
        reportingUserId: createAssistantUsageReportingUserId({
          memberId: "member_123",
          reportingSecret: "usage-reporting-secret",
        }),
      },
    }));
  });

  it("clears hosted usage reporting attribution when the Worker secret is absent", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const usage = {
      memberId: "member_child_controlled",
      provider: "codex-cli",
      reportingUserId: "musr_child_controlled",
      schema: "murph.assistant-usage.v1",
      usageId: "turn_123.attempt-1",
    };
    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_USAGE_RECORD_PATH}`, {
        body: JSON.stringify({ usage }),
        headers: createRunnerWriteFenceProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the usage web-control fetch to run.");
    }
    const [, init] = firstCall;
    expect(init?.body).toBe(JSON.stringify({
      usage: {
        ...usage,
        reportingUserId: null,
      },
    }));
  });

  it("rejects oversized allowlisted hosted web-control bodies before proxying", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_USAGE_RECORD_PATH}`, {
        body: JSON.stringify({
          usage: {
            payload: "x".repeat((256 * 1024) + 1),
          },
        }),
        headers: createRunnerWriteFenceProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body too large.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies workspace checkpoints after live lease validation", async () => {
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const getByName = vi.fn(() => ({
      bindUser,
      ownsActiveInvocationLease,
    }));
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(
      JSON.stringify(createHostedWorkspaceCheckpointResponse("5")),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-workspace/checkpoint", {
        body: JSON.stringify({
          attemptId: "attempt_1",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "9",
          reason: "import",
          snapshotRef: null,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName,
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(getByName).toHaveBeenCalledOnce();
    expect(bindUser).not.toHaveBeenCalled();
    expect(ownsActiveInvocationLease).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
    });
  });

  it("proxies workspace checkpoints when only the checkpoint body carries workspace version", async () => {
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(
      JSON.stringify(createHostedWorkspaceCheckpointResponse("5")),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-workspace/checkpoint", {
        body: JSON.stringify({
          attemptId: "attempt_1",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "9",
          reason: "import",
          snapshotRef: null,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(ownsActiveInvocationLease).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
    });
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(requestInit?.headers).get("x-hosted-runtime-workspace-version")).toBe("4");
  });

  it("rejects browser-vault replica publishes when the workspace version header is missing", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH}`, {
        body: JSON.stringify({
          replicaRef: createBrowserVaultReplicaRef("c".repeat(64)),
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts artifact writes after a checkpoint advances the child workspace version", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const checkpointFetch = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(
      JSON.stringify(createHostedWorkspaceCheckpointResponse("5")),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));
    vi.stubGlobal("fetch", checkpointFetch);

    const checkpointResponse = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-workspace/checkpoint", {
        body: JSON.stringify({
          attemptId: "attempt_1",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "9",
          reason: "import",
          snapshotRef: null,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "POST",
      }),
      env,
      "member_123" ,
    );
    expect(checkpointResponse.status).toBe(200);

    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);
    const artifactResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "5",
      }),
      env,
      "member_123" ,
    );

    expect(artifactResponse.status).toBe(200);
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("prefers runtime write-fence validation over the legacy active-invocation method", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const ownsActiveInvocationLease = vi.fn(async () => {
      throw new Error("legacy active-invocation validation should not be used");
    });
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(
      JSON.stringify(createHostedWorkspaceCheckpointResponse("5")),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-workspace/checkpoint", {
        body: JSON.stringify({
          attemptId: "attempt_1",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "9",
          reason: "import",
          snapshotRef: null,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              ownsActiveInvocationLease,
              validateRuntimeWriteFence,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(ownsActiveInvocationLease).not.toHaveBeenCalled();
  });

  it("rejects workspace checkpoints when the live invocation lease is stale", async () => {
    const ownsActiveInvocationLease = vi.fn(async () => false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-workspace/checkpoint", {
        body: JSON.stringify({
          attemptId: "attempt_1",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "9",
          reason: "import",
          snapshotRef: null,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects workspace checkpoints when lease headers do not match the checkpoint body", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-workspace/checkpoint", {
        body: JSON.stringify({
          attemptId: "attempt_stale",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "9",
          reason: "import",
          snapshotRef: null,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease: vi.fn(async () => false),
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps workspace version enforcement on workspace checkpoints", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-workspace/checkpoint", {
        body: JSON.stringify({
          attemptId: "attempt_1",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "9",
          reason: "import",
          snapshotRef: null,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "5",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects mailbox payload decode requests that do not use POST", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`, {
        headers: createRunnerProxyHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv(),
      "member_123" ,
    );

    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects mailbox payload decode requests when the invocation proxy token is missing", async () => {
    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`, {
        method: "POST",
      }),
      createRunnerOutboundEnv(),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects mailbox payload decode requests for the wrong user", async () => {
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`, {
        body: JSON.stringify((await createMailboxPayloadDecodeBody({
          itemUserId: "member_other",
          wakeUserId: "member_other",
        })).request),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(ownsActiveInvocationLease).toHaveBeenCalledOnce();
  });

  it("rejects mailbox payload decode requests without active lease headers", async () => {
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`, {
        body: JSON.stringify((await createMailboxPayloadDecodeBody()).request),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(ownsActiveInvocationLease).not.toHaveBeenCalled();
  });

  it("rejects mailbox payload decode requests when the live invocation lease is stale", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture({
      userId: "member_123",
    });
    const ownsActiveInvocationLease = vi.fn(async () => false);
    vi.stubGlobal("fetch", fixture.fetchMock);
    const body = await createMailboxPayloadDecodeBody();

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`, {
        body: JSON.stringify(body.request),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("decodes mailbox payloads through Worker-owned ingress crypto without returning key material", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture({
      userId: "member_123",
    });
    const runner = createWorkspaceVersionAwareUserRunner();
    vi.stubGlobal("fetch", fixture.fetchMock);
    const body = await createMailboxPayloadDecodeBody();
    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`, {
        body: JSON.stringify(body.request),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        ...fixture.env,
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    const decoded = await response.json();
    expect(decoded).toEqual({
      status: "decoded",
      wake: body.expectedWake,
    });
    const serialized = JSON.stringify(decoded);
    expect(serialized).not.toContain(body.request.payloadCiphertext);
    expect(serialized).not.toContain("udrk:ingress:test-root");
    expect(serialized).not.toContain("PRIVATE_JWK");
    expect(serialized).not.toContain("fixture-callback");
    expect(serialized).not.toContain("rootKey");
  });

  it("returns a narrow HTTP error when mailbox payload decode fails", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture({
      userId: "member_123",
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const body = await createMailboxPayloadDecodeBody();
    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`, {
        body: JSON.stringify({
          ...body.request,
          payloadCiphertext: "not-a-hosted-secure-box",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv(fixture.env),
      "member_123" ,
    );

    expect(response.status).toBe(502);
    const errorBody = await response.json();
    expect(errorBody).toEqual({
      error: "Mailbox payload decode failed.",
    });
    const serialized = JSON.stringify(errorBody);
    expect(serialized).not.toContain("not-a-hosted-secure-box");
    expect(serialized).not.toContain("rootKey");
    expect(serialized).not.toContain("PRIVATE_JWK");
  });

  it("returns a narrow HTTP error when mailbox payload parsing fails", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture({
      userId: "member_123",
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const body = await createMailboxPayloadDecodeBody();
    const itemRef = body.request.itemRef;
    const metadata = {
      dedupeKey: itemRef.dedupeKey,
      itemId: itemRef.id,
      kind: itemRef.kind,
      lane: itemRef.lane,
      laneSeq: itemRef.laneSeq,
      occurredAt: itemRef.occurredAt,
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadStorage: "inline" as const,
      userId: itemRef.userId,
    };
    const scope = buildHostedMailboxPayloadScope(metadata.payloadStorage);
    const malformedPayloadCiphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
      aad: buildHostedSecureBoxAad({
        ...buildHostedMailboxPayloadSecureBoxAad(metadata),
        domain: "ingress",
        lane: "mailbox-payload",
        scope,
        userId: itemRef.userId,
      }),
      domain: "ingress",
      lane: "mailbox-payload",
      plaintext: new TextEncoder().encode("{\"kind\":\"member.channels.updated\"}"),
      rootKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      rootKeyId: "udrk:ingress:test-root",
      scope,
    }));

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`, {
        body: JSON.stringify({
          ...body.request,
          payloadCiphertext: malformedPayloadCiphertext,
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv(fixture.env),
      "member_123" ,
    );

    expect(response.status).toBe(502);
    const errorBody = await response.json();
    expect(errorBody).toEqual({
      error: "Mailbox payload decode failed.",
    });
    const serialized = JSON.stringify(errorBody);
    expect(serialized).not.toContain(malformedPayloadCiphertext);
    expect(serialized).not.toContain("rootKey");
    expect(serialized).not.toContain("PRIVATE_JWK");
  });

  it("blocks decoded mailbox payloads whose wake user does not match the route user", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture({
      userId: "member_123",
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH}`, {
        body: JSON.stringify((await createMailboxPayloadDecodeBody({
          wakeUserId: "member_other",
        })).request),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv(fixture.env),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    });
  });

  it("rejects Telegram file effect requests without active lease headers", async () => {
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://results.worker${HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH}`, {
        body: JSON.stringify({
          fileId: "telegram_file_123",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(ownsActiveInvocationLease).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Telegram file effects when the live invocation lease is stale", async () => {
    const ownsActiveInvocationLease = vi.fn(async () => false);
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const getByName = vi.fn(() => ({
      bindUser,
      ownsActiveInvocationLease,
    }));
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => new Response(null, {
      status: 204,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://results.worker${HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH}`, {
        body: JSON.stringify({
          fileId: "telegram_file_123",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        TELEGRAM_BOT_TOKEN: "telegram-token",
        USER_RUNNER: {
          getByName,
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(getByName).toHaveBeenCalledOnce();
    expect(bindUser).not.toHaveBeenCalled();
    expect(ownsActiveInvocationLease).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authorizes Telegram file effects when the workspace version header is stale", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => new Response(JSON.stringify({
      ok: true,
      result: {
        file_id: "telegram_file_123",
        file_path: "photos/file.jpg",
        file_size: 1234,
        file_unique_id: "telegram_unique_123",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://results.worker${HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH}`, {
        body: JSON.stringify({
          fileId: "telegram_file_123",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        TELEGRAM_BOT_TOKEN: "telegram-token",
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("authorizes email sends after live lease validation and ignores legacy identityId payloads", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const emailSendMock = vi.fn(async (_message: unknown) => undefined);

    const response = await handleRunnerOutboundRequest(
      new Request("http://results.worker/send", {
        body: JSON.stringify({
          // Regression: older runners forwarded the privacy-blinded binding
          // identity. It must be ignored, not rejected as a sender override.
          identityId: "hid_0123456789abcdef0123456789abcdef",
          message: "hello",
          target: "assistant@example.com",
          targetKind: "explicit",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_EMAIL: {
          send: emailSendMock,
        },
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
        HOSTED_EMAIL_SIGNING_SECRET: "fixture-signing-key",
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
    });
    expect(emailSendMock).toHaveBeenCalledOnce();
    expect(emailSendMock.mock.calls[0]?.[0]).toMatchObject({
      from: "assistant@mail.example.test",
    });
  });

  it("rejects raw email reads when the claimed member does not own the active fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://results.worker/messages/raw_message_123", {
        headers: createRunnerProxyHeaders({
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return { validateRuntimeWriteFence };
          },
        },
      }),
      "member_456",
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_456",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves planned group recipient ids across the runner send response", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const emailSendMock = vi.fn(async (_message: unknown) => undefined);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      recipients: [
        { address: "one@example.test", memberId: "member_one" },
        { address: "two@example.test", memberId: "member_two" },
      ],
    }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://results.worker/send", {
        body: JSON.stringify({
          message: "group reply",
          planGroupFanout: true,
          subject: "Group subject",
          target: "group_123",
          targetKind: "group",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_EMAIL: {
          send: emailSendMock,
        },
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
        HOSTED_EMAIL_SIGNING_SECRET: "fixture-signing-key",
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      delivery: null,
      fanoutRecipientMemberIds: ["member_one", "member_two"],
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(emailSendMock).not.toHaveBeenCalled();
  });

  it("marks group-recipient resolution failures as retryable before provider entry", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const emailSendMock = vi.fn(async (_message: unknown) => undefined);
    const fetchMock = vi.fn(async () => new Response("temporarily unavailable", {
      status: 503,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const recipientTarget = serializeHostedEmailThreadTarget({
      groupId: "group_123",
      recipientMemberId: "member_one",
      subject: "Group subject",
      targetKind: "group",
    });

    const response = await handleRunnerOutboundRequest(
      new Request("http://results.worker/send", {
        body: JSON.stringify({
          message: "group reply",
          planGroupFanout: true,
          target: recipientTarget,
          targetKind: "thread",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_EMAIL: {
          send: emailSendMock,
        },
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
        HOSTED_EMAIL_SIGNING_SECRET: "fixture-signing-key",
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "ASSISTANT_EMAIL_PROVIDER_ENTRY_FAILED",
      deliveryMayHaveSucceeded: false,
      error: "Hosted email delivery failed before provider entry.",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(emailSendMock).not.toHaveBeenCalled();
  });

  it("authorizes thread reply email sends that carry legacy identityId and timeoutMs fields", async () => {
    // Incident regression: hosted email replies (targetKind "thread") from
    // older runner bundles carried the privacy-blinded binding identity as
    // identityId (plus a dead timeoutMs field) and failed HTTP 400. Legacy
    // reply payloads must still send from the config-owned sender.
    const runner = createWorkspaceVersionAwareUserRunner();
    const emailSendMock = vi.fn(async (_message: unknown) => undefined);
    const env = createRunnerOutboundEnv({
      HOSTED_EMAIL: {
        send: emailSendMock,
      },
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_SIGNING_SECRET: "fixture-signing-key",
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });

    const firstResponse = await handleRunnerOutboundRequest(
      new Request("http://results.worker/send", {
        body: JSON.stringify({
          message: "hello",
          target: "owner@example.com",
          targetKind: "explicit",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      env,
      "member_123",
    );
    expect(firstResponse.status).toBe(200);
    const firstPayload = await firstResponse.json() as { target: string };
    expect(firstPayload.target.length).toBeGreaterThan(0);

    const replyResponse = await handleRunnerOutboundRequest(
      new Request("http://results.worker/send", {
        body: JSON.stringify({
          identityId: "hid_0123456789abcdef0123456789abcdef",
          message: "reply from murph",
          target: firstPayload.target,
          targetKind: "thread",
          timeoutMs: 45_000,
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      env,
      "member_123",
    );

    expect(replyResponse.status).toBe(200);
    expect(emailSendMock).toHaveBeenCalledTimes(2);
    expect(emailSendMock.mock.calls[1]?.[0]).toMatchObject({
      from: "assistant@mail.example.test",
      to: "owner@example.com",
    });
  });

  it("authorizes email sends when the workspace version header is stale", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const emailSendMock = vi.fn(async () => undefined);

    const response = await handleRunnerOutboundRequest(
      new Request("http://results.worker/send", {
        body: JSON.stringify({
          message: "hello",
          target: "assistant@example.com",
          targetKind: "explicit",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_EMAIL: {
          send: emailSendMock,
        },
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
        HOSTED_EMAIL_SIGNING_SECRET: "fixture-signing-key",
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
    });
    expect(emailSendMock).toHaveBeenCalledOnce();
  });

  it("tombstones generated-image URL uploads after the write fence", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const uploadRequest = new Request(
      `http://results.worker${HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH}`,
      {
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      },
    );
    const response = await handleRunnerOutboundRequest(
      uploadRequest,
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(410);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error:
        "Legacy generated-image URL uploads have moved to private provider attachments.",
    });
  });

  it("sends the minimal image payload through the serialized UserRunner publisher", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const response = await handleRunnerPrivateImageUrlPublishRequest({
      env: createRunnerOutboundEnv({
        USER_RUNNER: { getByName: runner.getByName },
      }),
      request: new Request(
        `http://results.worker${HOSTED_EXECUTION_RUNNER_PRIVATE_IMAGE_URL_PUBLISH_PATH}`,
        {
          body: JSON.stringify({
            bytesBase64: Buffer.from(pngBytes).toString("base64"),
            contentType: "image/png",
          }),
          headers: createMailboxPayloadDecodeHeaders(),
          method: "POST",
        },
      ),
      userId: "member_123",
    });

    expect(response.status).toBe(200);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(runner.publishHostedPrivateMedia).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      bytes: pngBytes,
      contentType: "image/png",
      generation: "9",
      userId: "member_123",
    });
    const payload = await response.json() as {
      expiresAt: string;
      url: string;
    };
    expect(payload.expiresAt).toBe(PRIVATE_MEDIA_PUBLISH_EXPIRES_AT);
    expect(isHostedRuntimePrivateImageDeliveryUrl(new URL(payload.url))).toBe(
      true,
    );
  });

  it("invokes the private image publisher directly on its Durable Object stub", async () => {
    let stub: WorkerUserRunnerStubLike;
    const publishHostedPrivateMedia = vi.fn(async function (
      this: WorkerUserRunnerStubLike,
    ): Promise<HostedPrivateMediaPublishResult> {
      if (this !== stub) {
        throw new Error("Durable Object RPC receiver was detached.");
      }
      return {
        expiresAt: PRIVATE_MEDIA_PUBLISH_EXPIRES_AT,
        ok: true,
        url: PRIVATE_MEDIA_PUBLISH_URL,
      };
    });
    stub = { publishHostedPrivateMedia };

    const response = await handleRunnerPrivateImageUrlPublishRequest({
      env: createDirectRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return stub;
          },
        },
      }),
      request: new Request(
        `http://results.worker${HOSTED_EXECUTION_RUNNER_PRIVATE_IMAGE_URL_PUBLISH_PATH}`,
        {
          body: JSON.stringify({
            bytesBase64: Buffer.from(new Uint8Array([
              0x89, 0x50, 0x4e, 0x47,
              0x0d, 0x0a, 0x1a, 0x0a,
            ])).toString("base64"),
            contentType: "image/png",
          }),
          headers: createMailboxPayloadDecodeHeaders(),
          method: "POST",
        },
      ),
      userId: "member_123",
    });

    expect(response.status).toBe(200);
    expect(publishHostedPrivateMedia).toHaveBeenCalledOnce();
  });

  it("retries a lost publish response with the same minimal image payload", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      USER_RUNNER: { getByName: runner.getByName },
    });
    const createRequest = () =>
      new Request(
        `http://results.worker${HOSTED_EXECUTION_RUNNER_PRIVATE_IMAGE_URL_PUBLISH_PATH}`,
        {
          body: JSON.stringify({
            bytesBase64: Buffer.from(new Uint8Array([
              0x89, 0x50, 0x4e, 0x47,
              0x0d, 0x0a, 0x1a, 0x0a,
            ])).toString("base64"),
            contentType: "image/png",
          }),
          headers: createMailboxPayloadDecodeHeaders(),
          method: "POST",
        },
      );

    const first = await handleRunnerPrivateImageUrlPublishRequest({
      env,
      request: createRequest(),
      userId: "member_123",
    });
    const retry = await handleRunnerPrivateImageUrlPublishRequest({
      env,
      request: createRequest(),
      userId: "member_123",
    });

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(runner.publishHostedPrivateMedia).toHaveBeenCalledTimes(2);
    expect(runner.publishHostedPrivateMedia.mock.calls[0]?.[0]).toEqual(
      runner.publishHostedPrivateMedia.mock.calls[1]?.[0],
    );
  });

  it("rejects email sends when the live invocation lease is stale", async () => {
    const runner = createWorkspaceVersionAwareUserRunner({
      attemptId: "attempt_current",
    });
    const emailSendMock = vi.fn(async () => undefined);

    const response = await handleRunnerOutboundRequest(
      new Request("http://results.worker/send", {
        body: JSON.stringify({
          message: "hello",
          target: "assistant@example.com",
          targetKind: "explicit",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_EMAIL: {
          send: emailSendMock,
        },
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
        HOSTED_EMAIL_SIGNING_SECRET: "fixture-signing-key",
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(emailSendMock).not.toHaveBeenCalled();
  });

  it("rejects malformed Telegram file effect request JSON", async () => {
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://results.worker${HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH}`, {
        body: "{not-json",
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Malformed provider effect request.",
    });
    expect(ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-POST Telegram file effect requests", async () => {
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://results.worker${HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH}`, {
        headers: createMailboxPayloadDecodeHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(405);
    expect(ownsActiveInvocationLease).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "/telegram/send",
    "/telegram/chat-action",
    "/linq/send",
    "/linq/chat-action",
    "/linq/chats/mark-read",
    "/linq/messages/delete",
  ])("does not route legacy provider delivery effect path %s", async (path) => {
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://results.worker${path}`, {
        body: JSON.stringify({ ok: true }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease,
            };
          },
        },
      }),
      "member_123" ,
    );

    expect(response.status).toBe(404);
    expect(ownsActiveInvocationLease).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks up Telegram files through Worker-owned provider env", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => new Response(JSON.stringify({
      ok: true,
      result: {
        file_id: "telegram_file_123",
        file_path: "photos/file.jpg",
        file_size: 1234,
        file_unique_id: "telegram_unique_123",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://results.worker${HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH}`, {
        body: JSON.stringify({
          fileId: "telegram_file_123",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        TELEGRAM_BOT_TOKEN: "telegram-token",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      file: {
        file_id: "telegram_file_123",
        file_path: "photos/file.jpg",
        file_size: 1234,
        file_unique_id: "telegram_unique_123",
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const telegramRequest = fetchMock.mock.calls[0]?.[0];
    expect(String(telegramRequest)).toBe(
      "https://api.telegram.org/bottelegram-token/getFile?file_id=telegram_file_123",
    );
  });

  it("downloads Telegram files as bounded normalized file responses", async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const fetchMock = vi.fn(async () => new Response(bytes, {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://results.worker${HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH}`, {
        body: JSON.stringify({
          filePath: "photos/cat.jpg",
        }),
        headers: createMailboxPayloadDecodeHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        TELEGRAM_BOT_TOKEN: "telegram-token",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      file: {
        bytesBase64: "AQID",
        contentType: null,
        fileName: "cat.jpg",
        sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      },
    });
  });

  it("proxies the hosted workspace read route through web-control GET", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      workspace: null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        headers: createRunnerWriteFenceProxyHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "50000",
        HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "45000",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      workspace: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the workspace read web-control fetch to run.");
    }
    const [url, init] = firstCall;
    expect(String(url)).toBe(`https://web.example.test${HOSTED_RUNTIME_WORKSPACE_PATH}`);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          bodyPresent: false,
          callbackSigningConfigured: true,
          hostedWebBaseUrlHost: "web.example.test",
          hostedWebBaseUrlProtocol: "https",
          method: "GET",
          operation: "workspace_read",
          workspaceCheckpoint: false,
        }),
        message: "Hosted runner web-control request forwarding.",
        phase: "wake.running",
      }),
    );
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          method: "GET",
          operation: "workspace_read",
          responseOk: true,
          responseStatus: 200,
          workspaceCheckpoint: false,
        }),
        message: "Hosted runner web-control response received.",
        phase: "wake.running",
      }),
    );
  });

  it("logs non-OK hosted web-control responses without response bodies", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response("Not found", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 404,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        headers: createRunnerWriteFenceProxyHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://www.withmurph.ai",
      }),
      "member_123",
    );

    expect(response.status).toBe(404);
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          contentTypePresent: true,
          method: "GET",
          operation: "workspace_read",
          responseBodyBytes: 9,
          responseBodyKind: "text",
          responseOk: false,
          responseStatus: 404,
        }),
        level: "warn",
        message: "Hosted runner web-control response received.",
        phase: "wake.running",
      }),
    );
    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain("Not found");
    expect(serializedLogs).not.toContain("member_123");
  });

  it("logs non-OK hosted web-control JSON error shape without response bodies", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(JSON.stringify({
      error: {
        code: "route_not_found",
        message: "Route was not found",
      },
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 404,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        headers: createRunnerWriteFenceProxyHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://www.withmurph.ai",
      }),
      "member_123",
    );

    expect(response.status).toBe(404);
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          method: "GET",
          operation: "workspace_read",
          responseBodyKind: "json",
          responseErrorCode: "route_not_found",
          responseErrorShape: "object_error",
          responseOk: false,
          responseStatus: 404,
        }),
        level: "warn",
        message: "Hosted runner web-control response received.",
      }),
    );
    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain("Route was not found");
    expect(serializedLogs).not.toContain("member_123");
  });

  it("selects ingress or runtime roots from the signed hosted crypto context", async () => {
    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const signer = await generateP256SigningKeyPair();
    const env = createRunnerOutboundEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/g, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    });
    env.USER_RUNNER = {
      getByName() {
        return {
          async bindUser(userId: string) {
            return { userId };
          },
        };
      },
    };

    const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 101 + index);
    const context = {
      envelopes: {
        ingress: await createSignedWorkerEnvelope({
          domain: "ingress",
          publicJwk: cloudflareRecipient.publicJwk,
          rootKey: ingressRoot,
          signer: signer.privateKey,
          userId: "member_123",
        }),
        runtime: await createSignedWorkerEnvelope({
          domain: "runtime",
          publicJwk: cloudflareRecipient.publicJwk,
          rootKey: runtimeRoot,
          signer: signer.privateKey,
          userId: "member_123",
        }),
      },
      schema: "murph.hosted-runtime-crypto-context.v1" as const,
      userId: "member_123",
    };
    const fetchMock = vi.fn(async (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      const [url, init] = args;
      assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`);
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, undefined);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-hosted-execution-user-id"), "member_123");
      assert.equal(headers.has("x-hosted-execution-signature"), true);
      return new Response(JSON.stringify(context), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    const runtime = await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });
    const ingress = await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "ingress",
      env,
      environment,
      userId: "member_123",
    });

    assert.deepEqual(runtime.rootKey, runtimeRoot);
    assert.equal(runtime.rootKeyId, "udrk:runtime:test-root");
    assert.deepEqual(ingress.rootKey, ingressRoot);
    assert.equal(ingress.rootKeyId, "udrk:ingress:test-root");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("authorizes artifact PUTs after live lease validation", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const getByName = vi.fn(() => ({
      bindUser,
      ownsActiveInvocationLease,
    }));
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    const firstResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );
    const secondResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(secondResponse.status).toBe(200);
    expect(firstResponse.status).toBe(200);
    expect(ownsActiveInvocationLease).toHaveBeenCalledTimes(2);
    expect(ownsActiveInvocationLease).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
    });
    expect(getByName).toHaveBeenCalledTimes(2);
    expect(bindUser).not.toHaveBeenCalled();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          artifactAuthorized: true,
          method: "PUT",
          operation: "artifact_upload",
          userIdPresent: true,
        }),
        message: "Hosted runner artifact write fence validation completed.",
        phase: "wake.running",
      }),
    );
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          artifactAuthorized: true,
          artifactByteLength: 3,
          method: "PUT",
          operation: "artifact_upload",
          userIdPresent: true,
        }),
        message: "Hosted runner artifact request body read completed.",
        phase: "wake.running",
      }),
    );
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          artifactAuthorized: true,
          artifactByteLength: 3,
          method: "PUT",
          operation: "artifact_upload",
          userIdPresent: true,
        }),
        message: "Hosted runner artifact write completed.",
        phase: "wake.running",
      }),
    );
    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain("member_123");
    expect(serializedLogs).not.toContain(sha256);
  });

  it("logs missing artifact GETs without artifact keys or user ids", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const artifactFetchCorrelationId = "123e4567-e89b-42d3-a456-426614174000";
    const response = await handleRunnerOutboundRequest(
      new Request(MISSING_ARTIFACT_URL, {
        headers: {
          ...createRunnerWriteFenceProxyHeaders(),
          [HOSTED_RUNTIME_ARTIFACT_FETCH_CORRELATION_ID_HEADER]:
            artifactFetchCorrelationId,
          [HOSTED_RUNTIME_ARTIFACT_READ_PURPOSE_HEADER]: "workspace_restore",
        },
        method: "GET",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(404);
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          artifactFound: false,
          artifactFetchCorrelationId,
          artifactReadPurpose: "workspace_restore",
          method: "GET",
          operation: "artifact_fetch",
          responseStatus: 404,
          userIdPresent: true,
        }),
        level: "warn",
        message: "Hosted runner artifact request completed.",
        phase: "wake.running",
      }),
    );
    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain("member_123");
    expect(serializedLogs).not.toContain("a".repeat(64));
  });

  it("reports a persistently unreadable encrypted artifact as terminal", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const baseEnv = createRunnerOutboundEnv(fixture.env);
    const envelope = await encryptHostedStorageEnvelope({
      key: Uint8Array.from({ length: 32 }, (_, index) => 101 + index),
      keyId: fixture.context.envelopes.runtime.rootKeyId,
      plaintext: new TextEncoder().encode("persisted artifact"),
      scope: "artifact",
    });
    const malformedEnvelope = new TextEncoder().encode(JSON.stringify({
      ...envelope,
      keyId: `${envelope.keyId}\0bad`,
    }));
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      BUNDLES: {
        ...baseEnv.BUNDLES,
        async get() {
          return {
            async arrayBuffer() {
              return toArrayBuffer(malformedEnvelope);
            },
            key: "redacted-artifact-key",
            size: malformedEnvelope.byteLength,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(MISSING_ARTIFACT_URL, {
        headers: createRunnerWriteFenceProxyHeaders(),
        method: "GET",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Artifact is unreadable.",
    });
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          artifactReadable: false,
          operation: "artifact_fetch",
          responseStatus: 422,
        }),
        message: "Hosted runner artifact request completed.",
      }),
    );
  });

  it("rejects artifact reads when the claimed member does not own the active fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(MISSING_ARTIFACT_URL, {
        headers: createRunnerWriteFenceProxyHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return { validateRuntimeWriteFence };
          },
        },
      }),
      "member_456",
    );

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_456",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a later artifact write after rejecting missing lease headers", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    const deniedResponse = await handleRunnerOutboundRequest(
      new Request(`http://artifacts.worker/objects/${sha256}`, {
        body: toArrayBuffer(bytes),
        headers: createRunnerProxyHeaders(),
        method: "PUT",
      }),
      env,
      "member_123" ,
    );

    expect(deniedResponse.status).toBe(401);
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    const secondResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123" ,
    );

    expect(secondResponse.status).toBe(200);
    expect(ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(bindUser).not.toHaveBeenCalled();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("accepts artifact PUTs when the workspace version header is stale", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    const firstResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123" ,
    );
    const secondResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "5",
      }),
      env,
      "member_123" ,
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledTimes(2);
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("accepts artifact PUTs without a workspace version header", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    const response = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: null,
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("live-validates repeated artifact writes with the same workspace version", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            async bindUser(userId: string) {
              return { userId };
            },
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123" ,
    );
    await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123" ,
    );

    expect(ownsActiveInvocationLease).toHaveBeenCalledTimes(2);
  });

  it("rejects missing artifact write lease headers before accepting a later PUT", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            async bindUser(userId: string) {
              return { userId };
            },
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    const deniedResponse = await handleRunnerOutboundRequest(
      new Request(`http://artifacts.worker/objects/${sha256}`, {
        body: toArrayBuffer(bytes),
        headers: createRunnerProxyHeaders(),
        method: "PUT",
      }),
      env,
      "member_123" ,
    );
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    const allowedResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123" ,
    );

    expect(deniedResponse.status).toBe(401);
    expect(allowedResponse.status).toBe(200);
    expect(ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects artifact PUTs when the live invocation lease is stale", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const ownsActiveInvocationLease = vi.fn(async () => false);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    const response = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(bindUser).not.toHaveBeenCalled();
    expect(ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects artifact PUTs with missing lease headers before resolving crypto", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://artifacts.worker/objects/${sha256}`, {
        body: toArrayBuffer(bytes),
        headers: createRunnerProxyHeaders(),
        method: "PUT",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(bindUser).not.toHaveBeenCalled();
    expect(ownsActiveInvocationLease).not.toHaveBeenCalled();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("starts direct-R2 workspace snapshot upload sessions without a presigned PUT URL", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        workspaceVersion: "4",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(200);
    const body = requireTestObject(await response.json(), "workspace snapshot start response");
    const objectKey = requireTestString(body.objectKey, "workspace snapshot start objectKey");
    const snapshotId = requireTestString(body.snapshotId, "workspace snapshot start snapshotId");
    const encryption = requireTestObject(body.encryption, "workspace snapshot start encryption");
    expect(body).toEqual(expect.objectContaining({
      expiresAt: expect.stringMatching(/^20/u),
      objectKey: expect.stringMatching(/^users\/hsn_[0-9a-f]{24}\/workspace-snapshots\/snapshot_[A-Za-z0-9._-]+\.snapshot\.enc$/u),
      snapshotId: expect.stringMatching(/^snapshot_/u),
    }));
    expect(body).not.toHaveProperty("putUrl");
    expect(body.limits).toEqual({
      maxSinglePartEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
      warnEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
    });
    expect(body.encryption).toEqual(expect.objectContaining({
      aad: expect.objectContaining({
        objectKey,
        snapshotId,
        userId: "member_123",
      }),
      dataKeyBase64: expect.any(String),
      ivBase64: expect.any(String),
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: expect.any(String),
    }));
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(runner.createHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    const session = runner.workspaceSnapshotUploadSessions.get(snapshotId);
    expect(session).toEqual(expect.objectContaining({
      attemptId: "attempt_1",
      encryption: expect.objectContaining({
        aad: expect.objectContaining({
          objectKey,
          snapshotId,
        }),
        ivBase64: encryption.ivBase64,
        wrappedDataKey: encryption.wrappedDataKey,
      }),
      expectedWorkspaceVersion: "4",
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
      snapshotId,
      workspaceVersion: "4",
    }));
    expect(session).not.toHaveProperty("dataKeyBase64");
    expect(session).not.toHaveProperty("putUrl");

    const secondResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );
    expect(secondResponse.status).toBe(200);
    const secondBody = requireTestObject(await secondResponse.json(), "second workspace snapshot start response");
    const secondEncryption = requireTestObject(secondBody.encryption, "second workspace snapshot start encryption");
    expect(secondBody.snapshotId).not.toBe(snapshotId);
    expect(secondBody.objectKey).not.toBe(objectKey);
    expect(secondEncryption.dataKeyBase64).not.toBe(encryption.dataKeyBase64);
    expect(secondEncryption.ivBase64).not.toBe(encryption.ivBase64);
    expect(secondEncryption.wrappedDataKey).not.toBe(encryption.wrappedDataKey);
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.workspaceSnapshotUploadSessions.has(requireTestString(
      secondBody.snapshotId,
      "second workspace snapshot id",
    ))).toBe(true);
  });

  it("refreshes only the write-fence-owned workspace snapshot handoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: { getByName: runner.getByName },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const startResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );
    const startBody = requireTestObject(
      await startResponse.json(),
      "workspace snapshot heartbeat start",
    );
    const snapshotId = requireTestString(startBody.snapshotId, "snapshotId");
    vi.setSystemTime(new Date("2026-04-27T00:00:29.000Z"));

    const response = await handleRunnerOutboundRequest(
      new Request(
        `http://workspace-snapshots.worker/workspace-snapshots/${snapshotId}/heartbeat`,
        {
          body: JSON.stringify({ snapshotId }),
          headers: createRunnerWriteFenceProxyHeaders(),
          method: "POST",
        },
      ),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(runner.heartbeatHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      leaseGeneration: "9",
      snapshotId,
      userId: "member_123",
    });
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)).toMatchObject({
      checkpointHandoffHeartbeatAt: "2026-04-27T00:00:29.000Z",
    });
  });

  it("keeps workspace snapshot upload-session RPCs bound to the Durable Object stub", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner({
      requireSnapshotRpcReceiver: true,
    });
    const startEnv = createDirectRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const startResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        workspaceVersion: "4",
      }),
      startEnv,
      "member_123",
    );
    expect(startResponse.status).toBe(200);
    const startBody = requireTestObject(
      await startResponse.json(),
      "receiver-sensitive workspace snapshot start response",
    );
    const snapshotId = requireTestString(
      startBody.snapshotId,
      "receiver-sensitive workspace snapshot id",
    );
    const objectKey = requireTestString(
      startBody.objectKey,
      "receiver-sensitive workspace snapshot object key",
    );
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256: sha256Hex(bytes),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_receiver_sensitive_previous";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const deleteObject = vi.fn(async () => {});
    const env = createDirectRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: bytes.byteLength }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: bytes.byteLength,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: replacedSnapshotRef,
      onCheckpoint: (args) => {
        const checkpointRequest = readTestFetchBodyObject(
          args,
          "receiver-sensitive workspace snapshot checkpoint request",
        );
        return new Response(
          JSON.stringify({
            ...createHostedWorkspaceCheckpointResponseWithSnapshotRef(
              "5",
              checkpointRequest.snapshotRef,
            ),
            replacedSnapshotRef,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      },
    }));

    const completeResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );
    expect(completeResponse.status).toBe(200);
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)).toMatchObject({
      checkpointHandoffCompletedAt: expect.any(String),
      replacedSnapshotRef,
      snapshotId,
    });
    expect(runner.completeHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();

    const abortResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotAbortRequest({
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );
    expect(abortResponse.status).toBe(200);
    expect(runner.createHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.readHostedWorkspaceSnapshotUploadSession).toHaveBeenCalled();
    expect(runner.rememberHostedWorkspaceSnapshotReplacedRef).toHaveBeenCalledOnce();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith(objectKey);
  });

  it("does not let a stale snapshot start replace the active owner's upload session", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const activeSnapshotId = "snapshot_active_owner";
    const activeObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey: activeObjectKey,
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeSession = {
      ...createWorkspaceSnapshotUploadSession(activeSnapshotRef, {
        workspaceVersion: "5",
      }),
      attemptId: "attempt_2",
      leaseGeneration: "10",
    };
    fixture.fetchMock.mockImplementationOnce(async () => {
      runner.setActiveWriteFence({
        attemptId: activeSession.attemptId,
        leaseGeneration: activeSession.leaseGeneration,
      });
      await runner.createHostedWorkspaceSnapshotUploadSession(activeSession);
      return new Response(JSON.stringify(fixture.context), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
    expect(runner.workspaceSnapshotUploadSessions.size).toBe(1);
    expect(runner.workspaceSnapshotUploadSessions.get(activeSnapshotId)).toEqual(activeSession);
    expect(runner.workspaceSnapshotOrphanCandidates.size).toBe(0);
  });

  it("rejects direct-R2 workspace snapshot sessions for canonical runtime commits", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        reason: "canonical_runtime_commit",
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot start reason must be idle_shutdown.",
    });
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(runner.createHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.size).toBe(0);
  });

  it("presigns direct-R2 workspace snapshot PUT URLs only after encrypted metadata is known", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        workspaceVersion: "4",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(200);
    const body = requireTestObject(await response.json(), "workspace snapshot start response");
    const snapshotId = requireTestString(body.snapshotId, "workspace snapshot start snapshotId");
    const objectKey = requireTestString(body.objectKey, "workspace snapshot start objectKey");
    const encryptedObjectSha256 = "a".repeat(64);

    const presignResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignPutRequest({
        encryptedByteSize: 4,
        encryptedObjectSha256,
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(presignResponse.status).toBe(200);
    const presignBody = requireTestObject(await presignResponse.json(), "workspace snapshot presign response");
    const putUrl = new URL(requireTestString(presignBody.putUrl, "workspace snapshot putUrl"));
    expect(putUrl.hostname).toBe("r2accounttest.r2.cloudflarestorage.com");
    expect(putUrl.pathname).toBe(`/bundles-test/${objectKey}`);
    expect(putUrl.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;if-none-match;x-amz-checksum-sha256;x-amz-meta-encryptedsha256;x-amz-meta-schema;x-amz-meta-snapshotid",
    );
    expect(putUrl.searchParams.get("X-Amz-Signature")).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
    expect(presignBody.expiresAt).toEqual(expect.stringMatching(/^20/u));
    expect(runner.createHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
  });

  it("records snapshot PUT drain deadlines and rejects stale drain writes", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    const body = requireTestObject(await response.json(), "snapshot start response");
    const snapshotId = requireTestString(body.snapshotId, "snapshot id");
    const objectKey = requireTestString(body.objectKey, "snapshot objectKey");

    const presignResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignPutRequest({
        encryptedByteSize: 4,
        encryptedObjectSha256: "a".repeat(64),
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(presignResponse.status).toBe(200);
    const presignBody = requireTestObject(
      await presignResponse.json(),
      "snapshot presign response",
    );
    const putUrl = new URL(requireTestString(presignBody.putUrl, "snapshot putUrl"));
    expect(putUrl.pathname).toBe(`/bundles-test/${objectKey}`);
    expect(runner.rememberHostedWorkspaceSnapshotPresignedPut).toHaveBeenCalledWith(
      expect.objectContaining({
        drainUntil: expect.stringMatching(/^20/u),
        expectedSession: expect.objectContaining({
          objectKey,
          snapshotId,
        }),
        expiresAt: presignBody.expiresAt,
      }),
    );
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)).toMatchObject({
      r2PutDrainUntil: expect.stringMatching(/^20/u),
      r2PutExpiresAt: presignBody.expiresAt,
    });

    runner.rememberHostedWorkspaceSnapshotPresignedPut.mockResolvedValueOnce(null);
    const staleResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignPutRequest({
        encryptedByteSize: 4,
        encryptedObjectSha256: "a".repeat(64),
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
  });

  it("rejects direct-R2 workspace snapshot PUT presigns at the single-part limit before session lookup", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const snapshotId = "snapshot_presign_oversized";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignPutRequest({
        encryptedByteSize: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        encryptedObjectSha256: "a".repeat(64),
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot exceeds the single-part size limit.",
    });
    expect(runner.readHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("presigns direct-R2 workspace snapshot PUT URLs with hosted-local dev MinIO env", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "hosted-local-r2-access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "hosted-local-r2-account",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-local-r2-bundles",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:39000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "hosted-local-r2-secret-key",
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    const body = requireTestObject(await response.json(), "workspace snapshot start response");
    const snapshotId = requireTestString(body.snapshotId, "workspace snapshot start snapshotId");
    const objectKey = requireTestString(body.objectKey, "workspace snapshot start objectKey");

    const presignResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignPutRequest({
        encryptedByteSize: 4,
        encryptedObjectSha256: "a".repeat(64),
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(presignResponse.status).toBe(200);
    const presignBody = requireTestObject(await presignResponse.json(), "workspace snapshot presign response");
    const putUrl = new URL(requireTestString(presignBody.putUrl, "workspace snapshot putUrl"));
    expect(putUrl.protocol).toBe("http:");
    expect(putUrl.host).toBe("host.docker.internal:39000");
    expect(putUrl.pathname).toBe(`/hosted-local-r2-bundles/${objectKey}`);
    expect(putUrl.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;if-none-match;x-amz-checksum-sha256;x-amz-meta-encryptedsha256;x-amz-meta-schema;x-amz-meta-snapshotid",
    );
    expect(putUrl.searchParams.get("X-Amz-Signature")).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
  });

  it("caps direct-R2 presigned PUT expiry to the remaining upload session window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"));
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_presign_near_expiry";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(
      snapshotRef,
      { expiresAt: "2026-05-20T00:01:00.000Z" },
    ));
    const env = createRunnerOutboundEnv({
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignPutRequest({
        encryptedByteSize: 4,
        encryptedObjectSha256: snapshotRef.archive.encryptedObjectSha256,
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    const body = requireTestObject(await response.json(), "workspace snapshot presign response");
    const putUrl = new URL(requireTestString(body.putUrl, "workspace snapshot putUrl"));
    expect(putUrl.searchParams.get("X-Amz-Expires")).toBe("60");
  });

  it("rejects direct-R2 presign requests when the upload session is too close to expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"));
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_presign_too_late";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(
      snapshotRef,
      { expiresAt: "2026-05-20T00:00:20.000Z" },
    ));
    const env = createRunnerOutboundEnv({
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignPutRequest({
        encryptedByteSize: 4,
        encryptedObjectSha256: snapshotRef.archive.encryptedObjectSha256,
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is too close to expiry.",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
  });

  it("unwraps workspace snapshot data keys only through the bound AAD", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const startResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );
    expect(startResponse.status).toBe(200);
    const startBody = requireTestObject(await startResponse.json(), "workspace snapshot start response");
    const encryption = requireTestObject(startBody.encryption, "workspace snapshot start encryption");
    const rawAad = requireTestObject(encryption.aad, "workspace snapshot start AAD");
    const objectKey = requireTestString(rawAad.objectKey, "workspace snapshot start AAD objectKey");
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId: requireTestString(rawAad.snapshotId, "workspace snapshot start AAD snapshotId"),
      userId: requireTestString(rawAad.userId, "workspace snapshot start AAD userId"),
    });
    const snapshotId = requireTestString(startBody.snapshotId, "workspace snapshot start snapshotId");
    const wrappedDataKey = requireTestString(encryption.wrappedDataKey, "wrappedDataKey");
    hostedExecutionMocks.emitHostedExecutionStructuredLog.mockClear();

    const response = await handleRunnerOutboundRequest(
      new Request(`http://workspace-snapshots.worker/workspace-snapshots/${snapshotId}/data-key/unwrap`, {
        body: JSON.stringify({
          aad,
          rootKeyId: encryption.rootKeyId,
          wrappedDataKey,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "POST",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dataKey: encryption.dataKeyBase64,
    });
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          aadMatchesExpected: true,
          cryptoContextVersionPresent: true,
          method: "POST",
          operation: "workspace_snapshot_data_key_unwrap",
          rootKeyMatchesCryptoContext: true,
          rootLookupAttempted: false,
          rootResolved: true,
          unwrapSucceeded: true,
          userIdPresent: true,
          workspaceVersionPresent: true,
          wrappedRootMatchesBody: true,
        }),
        level: "info",
        message: "Hosted workspace snapshot data key unwrap completed.",
        phase: "wake.running",
      }),
    );
    let serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain("member_123");
    expect(serializedLogs).not.toContain(snapshotId);
    expect(serializedLogs).not.toContain(objectKey);
    expect(serializedLogs).not.toContain(requireTestString(encryption.rootKeyId, "rootKeyId"));
    expect(serializedLogs).not.toContain(wrappedDataKey);
    hostedExecutionMocks.emitHostedExecutionStructuredLog.mockClear();

    const rejected = await handleRunnerOutboundRequest(
      new Request(`http://workspace-snapshots.worker/workspace-snapshots/${snapshotId}/data-key/unwrap`, {
        body: JSON.stringify({
          aad: {
            ...aad,
            objectKey: "users/hsn_other/workspace-snapshots/snapshot_other.snapshot.enc",
          },
          rootKeyId: encryption.rootKeyId,
          wrappedDataKey,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "POST",
      }),
      env,
      "member_123",
    );

    expect(rejected.status).toBe(403);
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          aadMatchesExpected: false,
          aadObjectKeyMatchesExpected: false,
          aadSnapshotIdMatchesRoute: true,
          aadUserMatchesBoundUser: true,
          method: "POST",
          operation: "workspace_snapshot_data_key_unwrap",
          userIdPresent: true,
          workspaceVersionPresent: true,
        }),
        level: "warn",
        message: "Hosted workspace snapshot data key unwrap rejected.",
        phase: "wake.running",
      }),
    );
    serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain("member_123");
    expect(serializedLogs).not.toContain(snapshotId);
    expect(serializedLogs).not.toContain(objectKey);
    expect(serializedLogs).not.toContain("snapshot_other");
    expect(serializedLogs).not.toContain(wrappedDataKey);
  });

  it("logs keyed diagnostics when workspace snapshot data key root lookup misses", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const missingRootKeyId = "udrk:runtime:missing-root";
    const logFingerprintSecret = "test-diagnostic-secret";
    const fetchMock = vi.fn(async (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      const [url, init] = args;
      if (String(url) === `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`) {
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify(fixture.context), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_ROOT_PATH}`);
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, JSON.stringify({
        domain: "runtime",
        rootKeyId: missingRootKeyId,
      }));
      return new Response(JSON.stringify({
        error: "HOSTED_RUNTIME_CRYPTO_ROOT_NOT_FOUND",
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 404,
      });
    });
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      HOSTED_LOG_FINGERPRINT_SECRET: logFingerprintSecret,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const startResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "4",
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );
    expect(startResponse.status).toBe(200);
    const startBody = requireTestObject(await startResponse.json(), "workspace snapshot start response");
    const encryption = requireTestObject(startBody.encryption, "workspace snapshot start encryption");
    const rawAad = requireTestObject(encryption.aad, "workspace snapshot start AAD");
    const objectKey = requireTestString(rawAad.objectKey, "workspace snapshot start AAD objectKey");
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId: requireTestString(rawAad.snapshotId, "workspace snapshot start AAD snapshotId"),
      userId: requireTestString(rawAad.userId, "workspace snapshot start AAD userId"),
    });
    const snapshotId = requireTestString(startBody.snapshotId, "workspace snapshot start snapshotId");
    const dataKey = createHostedWorkspaceSnapshotV2DataKey();
    const wrappedDataKey = await wrapHostedWorkspaceSnapshotV2DataKey({
      aad,
      dataKey,
      rootKey: Uint8Array.from({ length: 32 }, (_, index) => 200 + index),
      rootKeyId: missingRootKeyId,
    });
    dataKey.fill(0);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://workspace-snapshots.worker/workspace-snapshots/${snapshotId}/data-key/unwrap`, {
        body: JSON.stringify({
          aad,
          rootKeyId: missingRootKeyId,
          wrappedDataKey,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "POST",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(404);
    const diagnosticLog = hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) =>
        input.message === "Hosted workspace snapshot data key root unavailable."
      );
    expect(diagnosticLog).toEqual(expect.objectContaining({
      component: "runner",
      details: expect.objectContaining({
        aadMatchesExpected: true,
        cryptoContextRootKeyFingerprint: createDiagnosticFingerprint(
          logFingerprintSecret,
          `runtime-root:${fixture.context.envelopes.runtime.rootKeyId}`,
        ),
        cryptoContextRootKeyFingerprintPresent: true,
        cryptoContextVersionPresent: true,
        diagnosticFingerprintKind: "hmac-sha256-96",
        method: "POST",
        operation: "workspace_snapshot_data_key_unwrap",
        rootKeyFingerprint: createDiagnosticFingerprint(
          logFingerprintSecret,
          `runtime-root:${missingRootKeyId}`,
        ),
        rootKeyFingerprintPresent: true,
        rootKeyMatchesCryptoContext: false,
        rootLookupAttempted: true,
        rootResolved: false,
        snapshotFingerprint: createDiagnosticFingerprint(
          logFingerprintSecret,
          `workspace-snapshot:${snapshotId}`,
        ),
        snapshotFingerprintPresent: true,
        userIdPresent: true,
        workspaceVersionPresent: true,
        wrappedRootMatchesBody: true,
      }),
      level: "warn",
      phase: "wake.running",
      userId: null,
    }));
    const serializedDiagnostic = JSON.stringify(diagnosticLog);
    expect(serializedDiagnostic).not.toContain(snapshotId);
    expect(serializedDiagnostic).not.toContain(missingRootKeyId);
    expect(serializedDiagnostic).not.toContain(fixture.context.envelopes.runtime.rootKeyId);
    expect(serializedDiagnostic).not.toContain("member_123");
    expect(serializedDiagnostic).not.toContain(objectKey);
    expect(serializedDiagnostic).not.toContain(wrappedDataKey);

    hostedExecutionMocks.emitHostedExecutionStructuredLog.mockClear();
    const envWithoutFingerprint = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const responseWithoutFingerprint = await handleRunnerOutboundRequest(
      new Request(`http://workspace-snapshots.worker/workspace-snapshots/${snapshotId}/data-key/unwrap`, {
        body: JSON.stringify({
          aad,
          rootKeyId: missingRootKeyId,
          wrappedDataKey,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "POST",
      }),
      envWithoutFingerprint,
      "member_123",
    );

    expect(responseWithoutFingerprint.status).toBe(404);
    const noFingerprintDiagnostic = hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) =>
        input.message === "Hosted workspace snapshot data key root unavailable."
      );
    expect(noFingerprintDiagnostic).toEqual(expect.objectContaining({
      details: expect.objectContaining({
        cryptoContextRootKeyFingerprintPresent: false,
        diagnosticFingerprintKind: "none",
        rootKeyFingerprintPresent: false,
        snapshotFingerprintPresent: false,
      }),
    }));
    const noFingerprintDetails = requireTestObject(
      noFingerprintDiagnostic?.details,
      "root unavailable no-fingerprint diagnostic details",
    );
    expect(noFingerprintDetails).not.toHaveProperty("snapshotFingerprint");
    expect(noFingerprintDetails).not.toHaveProperty("rootKeyFingerprint");
    expect(noFingerprintDetails).not.toHaveProperty("cryptoContextRootKeyFingerprint");
    const serializedNoFingerprintDiagnostic = JSON.stringify(noFingerprintDiagnostic);
    expect(serializedNoFingerprintDiagnostic).not.toContain(snapshotId);
    expect(serializedNoFingerprintDiagnostic).not.toContain(missingRootKeyId);
    expect(serializedNoFingerprintDiagnostic).not.toContain(fixture.context.envelopes.runtime.rootKeyId);
    expect(serializedNoFingerprintDiagnostic).not.toContain("member_123");
    expect(serializedNoFingerprintDiagnostic).not.toContain(objectKey);
    expect(serializedNoFingerprintDiagnostic).not.toContain(wrappedDataKey);
  });

  it("rejects workspace snapshot data-key unwrap without a workspace version header", async () => {
    const missingVersionRunner = createWorkspaceVersionAwareUserRunner();
    const missingVersionResponse = await handleRunnerOutboundRequest(
      new Request("http://workspace-snapshots.worker/workspace-snapshots/snapshot_missing/data-key/unwrap", {
        body: JSON.stringify({}),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName: missingVersionRunner.getByName,
        },
      }),
      "member_123",
    );
    expect(missingVersionResponse.status).toBe(401);
    expect(missingVersionRunner.validateRuntimeWriteFence).not.toHaveBeenCalled();
  });

  it("presigns direct-R2 workspace snapshot GET URLs instead of streaming bodies through the Worker", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_read_stream";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const bucket = createRunnerOutboundEnv().BUNDLES;
    const env = createRunnerOutboundEnv({
      BUNDLES: bucket,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    await bucket.put(objectKey, new Uint8Array([1, 2, 3, 4]));

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignGetRequest({
        objectKey,
        snapshotRef,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    const body = requireTestObject(await response.json(), "workspace snapshot presign GET response");
    const getUrl = new URL(requireTestString(body.getUrl, "workspace snapshot getUrl"));
    expect(getUrl.hostname).toBe("r2accounttest.r2.cloudflarestorage.com");
    expect(getUrl.pathname).toBe(`/bundles-test/${objectKey}`);
    expect(getUrl.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(getUrl.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(getUrl.searchParams.get("X-Amz-Signature")).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
    expect(body.expiresAt).toEqual(expect.stringMatching(/^20/u));
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          method: "POST",
          objectKeyMatchesExpected: true,
          operation: "workspace_snapshot_presign_get",
          presignSucceeded: true,
          refParsed: true,
          snapshotIdMatchesRoute: true,
          userIdPresent: true,
          workspaceVersionPresent: true,
        }),
        level: "info",
        message: "Hosted workspace snapshot presign GET completed.",
        phase: "wake.running",
      }),
    );
    let serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain("member_123");
    expect(serializedLogs).not.toContain(snapshotId);
    expect(serializedLogs).not.toContain(objectKey);

    const workerBodyResponse = await handleRunnerOutboundRequest(
      new Request(`http://workspace-snapshots.worker/workspace-snapshots/${snapshotId}`, {
        headers: createRunnerProxyHeaders({
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "GET",
      }),
      env,
      "member_123",
    );

    expect(workerBodyResponse.status).toBe(405);
  });

  it("locates hosted-local direct-R2 snapshots through the local S3 control endpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:34:56.000Z"));
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_read_local_s3";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const bindingHead = vi.fn(async () => {
      throw new Error("hosted-local restore should use local S3 HEAD");
    });
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        bindingHead,
      ),
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:39000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn(async (
      request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      const method = init?.method ?? (request instanceof Request ? request.method : "GET");
      if (url.origin === "http://127.0.0.1:39000" && method === "HEAD") {
        const bucketName = decodeURIComponent(url.pathname.split("/")[1] ?? "");
        verifyLocalS3SigV4QueryUrl({
          accessKeyId: "r2_access_fixture_test",
          amzDate: "20260520T123456Z",
          bucketName,
          checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
          endpoint: "http://127.0.0.1:39000",
          expiresSeconds: 60,
          key: objectKey,
          method: "HEAD",
          secretAccessKey: "r2_signing_fixture_test",
          url,
        });
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected hosted-local snapshot restore fetch ${method} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignGetRequest({
        objectKey,
        snapshotRef,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    const body = requireTestObject(
      await response.json(),
      "hosted-local workspace snapshot presign GET response",
    );
    expect(new URL(requireTestString(body.getUrl, "hosted-local snapshot getUrl")).pathname)
      .toBe(`/bundles-test/${objectKey}`);
    expect(bindingHead).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("rejects direct-R2 workspace snapshot GET presigns without a matching v2 ref", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_read_ref_bound";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const missingRefResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignGetRequest({
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123",
    );

    expect(missingRefResponse.status).toBe(400);
    await expect(missingRefResponse.json()).resolves.toEqual({
      error: "Hosted workspace snapshot presign ref is invalid.",
    });
    expect(hostedExecutionMocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        details: expect.objectContaining({
          method: "POST",
          operation: "workspace_snapshot_presign_get",
          refParsed: false,
          rejectionReason: "invalid_ref",
          snapshotIdMatchesRoute: true,
          userIdPresent: true,
          workspaceVersionPresent: true,
        }),
        level: "warn",
        message: "Hosted workspace snapshot presign GET rejected.",
        phase: "wake.running",
      }),
    );
    let serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain("member_123");
    expect(serializedLogs).not.toContain(snapshotId);
    expect(serializedLogs).not.toContain(objectKey);
    hostedExecutionMocks.emitHostedExecutionStructuredLog.mockClear();

    const mismatchedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "other_member",
    });
    const mismatchedRefResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignGetRequest({
        objectKey: mismatchedObjectKey,
        snapshotRef: createWorkspaceSnapshotV2Ref({
          encryptedByteSize: 4,
          encryptedObjectSha256: "a".repeat(64),
          objectKey,
          snapshotId,
          userId: "member_123",
        }),
        snapshotId,
        workspaceVersion: "4",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123",
    );

    expect(mismatchedRefResponse.status).toBe(403);
    await expect(mismatchedRefResponse.json()).resolves.toEqual({
      error: "Hosted workspace snapshot presign ref does not match its route.",
    });

    const mismatchedUserResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignGetRequest({
        objectKey,
        snapshotRef: createWorkspaceSnapshotV2Ref({
          encryptedByteSize: 4,
          encryptedObjectSha256: "a".repeat(64),
          objectKey,
          snapshotId,
          userId: "other_member",
        }),
        snapshotId,
        workspaceVersion: "4",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123",
    );
    expect(mismatchedUserResponse.status).toBe(403);
    await expect(mismatchedUserResponse.json()).resolves.toEqual({
      error: "Hosted workspace snapshot presign ref does not match its route.",
    });

    const mismatchedAadRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const mismatchedAadResponse = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotPresignGetRequest({
        objectKey,
        snapshotRef: {
          ...mismatchedAadRef,
          encryption: {
            ...mismatchedAadRef.encryption,
            aad: {
              ...mismatchedAadRef.encryption.aad,
              objectKey: mismatchedObjectKey,
            },
          },
        },
        snapshotId,
        workspaceVersion: "4",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123",
    );
    expect(mismatchedAadResponse.status).toBe(400);
    await expect(mismatchedAadResponse.json()).resolves.toEqual({
      error: "Hosted workspace snapshot presign ref is invalid.",
    });

    const routeMismatchResponse = await handleRunnerOutboundRequest(
      new Request("http://workspace-snapshots.worker/workspace-snapshots/snapshot_other/presign-get", {
        body: JSON.stringify({
          objectKey,
          ref: createWorkspaceSnapshotV2Ref({
            encryptedByteSize: 4,
            encryptedObjectSha256: "a".repeat(64),
            objectKey,
            snapshotId,
            userId: "member_123",
          }),
          snapshotId,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
          "x-hosted-runtime-workspace-version": "4",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123",
    );
    expect(routeMismatchResponse.status).toBe(400);
    await expect(routeMismatchResponse.json()).resolves.toEqual({
      error: "Hosted workspace snapshot presign snapshotId does not match its route.",
    });
  });

  it("rejects direct-R2 workspace snapshot GET presigns without a workspace version header", async () => {
    const snapshotId = "snapshot_read_stale";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });

    const missingVersionRunner = createWorkspaceVersionAwareUserRunner();
    const missingVersionResponse = await handleRunnerOutboundRequest(
      new Request(`http://workspace-snapshots.worker/workspace-snapshots/${snapshotId}/presign-get`, {
        body: JSON.stringify({
          objectKey,
          snapshotId,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
          "x-hosted-runtime-attempt-id": "attempt_1",
          "x-hosted-runtime-lease-generation": "9",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName: missingVersionRunner.getByName,
        },
      }),
      "member_123",
    );
    expect(missingVersionResponse.status).toBe(401);
    expect(missingVersionRunner.validateRuntimeWriteFence).not.toHaveBeenCalled();
  });

  it("rejects workspace snapshot starts with malformed workspace versions before session creation", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "not-a-version",
        workspaceVersion: "not-a-version",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123",
    );

    expect(response.status).toBe(401);
    expect(runner.validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(runner.createHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.size).toBe(0);
  });

  it("does not expose a test-gated Worker body upload route for workspace snapshots", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const request = new Request("http://workspace-snapshots.worker/__test/r2-presigned-put/users/test/snapshot.enc", {
      body: toArrayBuffer(new Uint8Array([1, 2, 3, 4, 5])),
      headers: createRunnerProxyHeaders({
        "content-type": HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
        "if-none-match": "*",
        "x-hosted-runtime-attempt-id": "attempt_1",
        "x-hosted-runtime-lease-generation": "9",
        "x-hosted-runtime-workspace-version": "4",
      }),
      method: "PUT",
    });
    const arrayBufferSpy = vi.spyOn(request, "arrayBuffer");

    const response = await handleRunnerOutboundRequest(
      request,
      env,
      "member_123" ,
    );

    expect(response.status).toBe(404);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(runner.validateRuntimeWriteFence).not.toHaveBeenCalled();
  });

  it("does not expose a Worker body upload route for workspace snapshots", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const request = new Request("http://workspace-snapshots.worker/workspace-snapshots/snapshot_no_upload", {
      body: toArrayBuffer(new Uint8Array([1, 2, 3, 4])),
      headers: createRunnerProxyHeaders({
        "content-type": "application/octet-stream",
        "x-hosted-runtime-attempt-id": "attempt_1",
        "x-hosted-runtime-lease-generation": "9",
        "x-hosted-runtime-workspace-version": "4",
      }),
      method: "PUT",
    });
    const env = createRunnerOutboundEnv({
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const arrayBufferSpy = vi.spyOn(request, "arrayBuffer");

    const response = await handleRunnerOutboundRequest(
      request,
      env,
      "member_123" ,
    );

    expect(response.status).toBe(405);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(runner.ownsActiveInvocationLease).not.toHaveBeenCalled();
  });

  it("starts a workspace snapshot with the request workspace version", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotStartRequest({
        expectedWorkspaceVersion: "5",
        workspaceVersion: "5",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(runner.createHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "member_123",
        workspaceVersion: "5",
      }),
    );
  });

  it("completes workspace snapshot refs only after matching object size is present", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const encryptedObjectSha256 = sha256Hex(bytes);
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256,
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(
      snapshotId,
      createWorkspaceSnapshotUploadSession(snapshotRef, { workspaceVersion: "5" }),
    );
    const head = vi.fn(async (key: string) => ({
      key,
      size: bytes.byteLength,
    }));
    const env = createRunnerOutboundEnv({
      BUNDLES: createBridgeWorkspaceSnapshotBucket(
        async (key) => ({ key, size: bytes.byteLength }),
        async (key) => {
          const object = await head(key);
          return object
            ? {
                ...object,
                checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
                customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
              }
            : null;
        },
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      onCheckpoint: (args) => {
        const checkpointRequest = readTestFetchBodyObject(args, "workspace snapshot checkpoint request");
        return new Response(
          JSON.stringify(createHostedWorkspaceCheckpointResponseWithSnapshotRef(
            "5",
            checkpointRequest.snapshotRef,
          )),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "5",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    const responseBody = requireTestObject(await response.json(), "workspace snapshot complete response");
    expect(responseBody.ok).toBe(true);
    expect(responseBody.snapshotRef).toEqual(expect.objectContaining({
      archive: snapshotRef.archive,
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
      snapshotId,
      upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    }));
    expect(responseBody.checkpoint).toEqual(expect.objectContaining({
      checkpointed: true,
      workspace: expect.objectContaining({
        snapshotRef: responseBody.snapshotRef,
        userId: "member_123",
        version: "5",
      }),
    }));
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://web.example.test/api/internal/hosted-workspace");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://web.example.test/api/internal/hosted-workspace/checkpoint");
    const checkpointInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(checkpointInit?.body))).toEqual(expect.objectContaining({
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "5",
      leaseGeneration: "9",
      reason: "idle_shutdown",
      snapshotRef: expect.objectContaining({
        objectKey,
        snapshotId,
      }),
    }));
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(head).toHaveBeenCalledWith(objectKey);
  });

  it("retains the replaced successful workspace snapshot for delayed cleanup after checkpoint CAS", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete_replaces_previous";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256: sha256Hex(bytes),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_previous_success";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: bytes.byteLength }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: bytes.byteLength,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: replacedSnapshotRef,
      onCheckpoint: (args) => {
        const checkpointRequest = readTestFetchBodyObject(args, "workspace snapshot checkpoint request");
        return new Response(
          JSON.stringify({
            ...createHostedWorkspaceCheckpointResponseWithSnapshotRef(
              "5",
              checkpointRequest.snapshotRef,
            ),
            replacedSnapshotRef,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      },
    }));

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotOrphanCandidates.has(replacedSnapshotId)).toBe(false);
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)).toMatchObject({
      replacedSnapshotRef,
      snapshotId,
    });
  });

  it("retains replaced legacy workspace snapshot bundles for delayed cleanup after checkpoint CAS", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete_replaces_legacy";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256: sha256Hex(bytes),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const bucket = createWorkspaceSnapshotBundleTestBucket({
      snapshotBytes: bytes,
      snapshotRef,
    });
    const runtimeRootKey = Uint8Array.from({ length: 32 }, (_, index) => 101 + index);
    const runtimeRootKeyId = "udrk:runtime:test-root";
    const artifactStore = createHostedArtifactStore({
      bucket: bucket.api,
      key: runtimeRootKey,
      keyId: runtimeRootKeyId,
      userId: "member_123",
    });
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: runtimeRootKey,
      keyId: runtimeRootKeyId,
      userId: "member_123",
    });
    const legacyArtifactBytes = Uint8Array.from(Buffer.from("legacy-audio"));
    const legacyArtifactSha = sha256HostedBundleHex(legacyArtifactBytes);
    await artifactStore.writeArtifact(legacyArtifactSha, legacyArtifactBytes);
    const legacyBaseRef = await bundleStore.writeBundle(
      "vault",
      createArtifactOnlyWorkspaceBundleForTest(
        legacyArtifactSha,
        legacyArtifactBytes.byteLength,
      ),
    );
    const legacyDeltaRef = await bundleStore.writeBundle(
      "vault",
      createArtifactOnlyWorkspaceBundleForTest("", 0),
    );
    const legacyArtifactKey = await hostedArtifactObjectKey({
      sha256: legacyArtifactSha,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(
      snapshotId,
      createWorkspaceSnapshotUploadSession(snapshotRef),
    );
    const replacedSnapshotRef = buildHostedExecutionWorkingSnapshotRef({
      base: legacyBaseRef,
      delta: legacyDeltaRef,
    });
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      BUNDLES: bucket.api,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: replacedSnapshotRef,
      onCheckpoint: async (args) => {
      if (String(args[0]) === `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`) {
        return await fixture.fetchMock(...args);
      }
      const checkpointRequest = readTestFetchBodyObject(args, "workspace snapshot checkpoint request");
      return new Response(
        JSON.stringify({
          ...createHostedWorkspaceCheckpointResponseWithSnapshotRef(
            "5",
            checkpointRequest.snapshotRef,
          ),
          replacedSnapshotRef,
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      );
      },
    }));

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(bucket.objects.has(legacyBaseRef.key)).toBe(true);
    expect(bucket.objects.has(legacyDeltaRef.key)).toBe(true);
    expect(bucket.objects.has(legacyArtifactKey)).toBe(true);
    expect(bucket.deleted).toEqual([]);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotOrphanCandidates.has(`legacy-${snapshotId}`)).toBe(false);
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)).toMatchObject({
      replacedSnapshotRef,
      snapshotId,
    });
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("does not attempt direct replaced snapshot deletion after checkpoint CAS", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete_replaces_previous_delete_fails";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256: sha256Hex(bytes),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_previous_delete_retry";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {
      throw new Error("delete failed");
    });
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: bytes.byteLength }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: bytes.byteLength,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: replacedSnapshotRef,
      onCheckpoint: (args) => {
        const checkpointRequest = readTestFetchBodyObject(args, "workspace snapshot checkpoint request");
        return new Response(
          JSON.stringify({
            ...createHostedWorkspaceCheckpointResponseWithSnapshotRef(
              "5",
              checkpointRequest.snapshotRef,
            ),
            replacedSnapshotRef,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      },
    }));

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)).toMatchObject({
      replacedSnapshotRef,
      snapshotId,
    });
  });

  it("preserves the selected restore object when post-checkpoint completion becomes stale", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete_stale_cleanup_owner";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256: sha256Hex(bytes),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const staleSession = createWorkspaceSnapshotUploadSession(snapshotRef);
    await runner.createHostedWorkspaceSnapshotUploadSession(staleSession);

    const replacedSnapshotId = "snapshot_stale_cleanup_previous";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const activeSnapshotId = "snapshot_stale_cleanup_active";
    const activeObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 6,
      encryptedObjectSha256: "c".repeat(64),
      objectKey: activeObjectKey,
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeSession = {
      ...createWorkspaceSnapshotUploadSession(activeSnapshotRef, {
        workspaceVersion: "5",
      }),
      attemptId: "attempt_2",
      leaseGeneration: "10",
    };
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: bytes.byteLength }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: bytes.byteLength,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: replacedSnapshotRef,
      onCheckpoint: async (args) => {
        const checkpointRequest = readTestFetchBodyObject(
          args,
          "stale cleanup checkpoint request",
        );
        runner.setActiveWriteFence({
          attemptId: activeSession.attemptId,
          leaseGeneration: activeSession.leaseGeneration,
        });
        await runner.createHostedWorkspaceSnapshotUploadSession(activeSession);
        return new Response(
          JSON.stringify({
            ...createHostedWorkspaceCheckpointResponseWithSnapshotRef(
              "5",
              checkpointRequest.snapshotRef,
            ),
            replacedSnapshotRef,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(runner.rememberHostedWorkspaceSnapshotReplacedRef).toHaveBeenCalledWith({
      expectedSession: staleSession,
      replacedSnapshotRef,
    });
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.workspaceSnapshotUploadSessions.get(activeSnapshotId)).toEqual(activeSession);
    expect(runner.workspaceSnapshotUploadSessions.get(activeSnapshotId)?.replacedSnapshotRef)
      .toBeUndefined();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotOrphanCandidates.has(activeSnapshotId)).toBe(false);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("does not checkpoint when the replaced snapshot cleanup ref cannot be persisted first", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete_replaced_ref_recording_fails";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256: sha256Hex(bytes),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_previous_ref_recording_fails";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    runner.rememberHostedWorkspaceSnapshotReplacedRef.mockImplementationOnce(async () => {
      throw new Error("session write failed");
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: bytes.byteLength }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: bytes.byteLength,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: replacedSnapshotRef,
      onCheckpoint: () => {
        throw new Error("checkpoint should not run without durable cleanup state");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace replaced snapshot cleanup state is unavailable.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(runner.rememberHostedWorkspaceSnapshotReplacedRef).toHaveBeenCalledOnce();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)).toMatchObject({
      snapshotId,
    });
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)?.replacedSnapshotRef).toBeUndefined();
  });

  it("retains delayed cleanup when completion retry sees the new snapshot already current", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete_retry_replaced_cleanup";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256: sha256Hex(bytes),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_previous_retry_cleanup";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(
      snapshotId,
      createWorkspaceSnapshotUploadSession(snapshotRef, { replacedSnapshotRef }),
    );
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: bytes.byteLength }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: bytes.byteLength,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: snapshotRef,
      onCheckpoint: (args) => {
        const checkpointRequest = readTestFetchBodyObject(
          args,
          "workspace snapshot checkpoint retry request",
        );
        return new Response(
          JSON.stringify({
            ...createHostedWorkspaceCheckpointResponseWithSnapshotRef(
              "5",
              checkpointRequest.snapshotRef,
            ),
            checkpointConflictReason: "workspace_version",
            checkpointed: false,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      },
    }));

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    const responseBody = requireTestObject(await response.json(), "workspace snapshot cleanup retry response");
    expect(response.status).toBe(200);
    expect(responseBody.checkpoint).toEqual(expect.objectContaining({
      checkpointed: true,
      replacedSnapshotRef,
      workspace: expect.objectContaining({
        snapshotRef: expect.objectContaining({
          objectKey,
          snapshotId,
        }),
        version: "5",
      }),
    }));
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)).toMatchObject({
      replacedSnapshotRef,
      snapshotId,
    });
  });

  it("ignores replaced successful workspace snapshots outside the bound user namespace", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete_replaces_foreign_previous";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256: sha256Hex(bytes),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_foreign_previous";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_456",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: bytes.byteLength }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: bytes.byteLength,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: replacedSnapshotRef,
      onCheckpoint: (args) => {
        const checkpointRequest = readTestFetchBodyObject(args, "workspace snapshot checkpoint request");
        return new Response(
          JSON.stringify({
            ...createHostedWorkspaceCheckpointResponseWithSnapshotRef(
              "5",
              checkpointRequest.snapshotRef,
            ),
            replacedSnapshotRef,
          }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      },
    }));

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotOrphanCandidates.has(replacedSnapshotId)).toBe(false);
  });

  it("verifies hosted-local direct-R2 snapshot objects through the local S3-compatible endpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:34:56.000Z"));
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete_local_s3";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const encryptedObjectSha256 = sha256Hex(bytes);
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256,
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const bindingHead = vi.fn(async () => {
      throw new Error("hosted-local completion should use local S3 HEAD");
    });
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: bytes.byteLength }),
        bindingHead,
      ),
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:39000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn(async (
      request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      const method = init?.method ?? (request instanceof Request ? request.method : "GET");
      if (url.origin === "http://127.0.0.1:39000" && method === "HEAD") {
        verifyLocalS3SigV4QueryUrl({
          accessKeyId: "r2_access_fixture_test",
          amzDate: "20260520T123456Z",
          bucketName: "bundles-test",
          checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
          endpoint: "http://127.0.0.1:39000",
          expiresSeconds: 60,
          key: objectKey,
          method: "HEAD",
          secretAccessKey: "r2_signing_fixture_test",
          url,
        });
        return new Response(null, {
          headers: {
            "content-length": String(bytes.byteLength),
            "x-amz-checksum-sha256": encryptedObjectSha256,
            "x-amz-meta-encryptedsha256": encryptedObjectSha256,
            "x-amz-meta-schema": HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
            "x-amz-meta-snapshotid": snapshotId,
          },
          status: 200,
        });
      }
      if (url.href === `https://web.example.test${HOSTED_RUNTIME_WORKSPACE_PATH}` && method === "GET") {
        return createHostedWorkspaceReadFetchResponse();
      }
      if (
        url.href === "https://web.example.test/api/internal/hosted-workspace/checkpoint"
        && method === "POST"
      ) {
        const checkpointRequest = readTestFetchBodyObject(
          [request, init] as Parameters<typeof fetch>,
          "hosted-local workspace snapshot checkpoint request",
        );
        return new Response(
          JSON.stringify(createHostedWorkspaceCheckpointResponseWithSnapshotRef(
            "5",
            checkpointRequest.snapshotRef,
          )),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      }
      throw new Error(`Unexpected hosted-local snapshot fetch ${method} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(bindingHead).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const headUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    verifyLocalS3SigV4QueryUrl({
      accessKeyId: "r2_access_fixture_test",
      amzDate: "20260520T123456Z",
      bucketName: "bundles-test",
      checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
      endpoint: "http://127.0.0.1:39000",
      expiresSeconds: 60,
      key: objectKey,
      method: "HEAD",
      secretAccessKey: "r2_signing_fixture_test",
      url: headUrl,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: {
        [HOSTED_R2_CHECKSUM_MODE_HEADER]: HOSTED_R2_CHECKSUM_MODE_ENABLED,
      },
      method: "HEAD",
    }));
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
  });

  it("rejects hosted-local workspace snapshot completion when HEAD omits the checksum header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:34:56.000Z"));
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete_local_s3_missing_checksum";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const encryptedObjectSha256 = sha256Hex(bytes);
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256,
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const bindingHead = vi.fn(async () => {
      throw new Error("hosted-local completion should use local S3 HEAD");
    });
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: bytes.byteLength }),
        bindingHead,
      ),
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:39000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn(async (
      request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      const method = init?.method ?? (request instanceof Request ? request.method : "GET");
      if (url.origin === "http://127.0.0.1:39000" && method === "HEAD") {
        verifyLocalS3SigV4QueryUrl({
          accessKeyId: "r2_access_fixture_test",
          amzDate: "20260520T123456Z",
          bucketName: "bundles-test",
          checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
          endpoint: "http://127.0.0.1:39000",
          expiresSeconds: 60,
          key: objectKey,
          method: "HEAD",
          secretAccessKey: "r2_signing_fixture_test",
          url,
        });
        return new Response(null, {
          headers: {
            "content-length": String(bytes.byteLength),
            "x-amz-meta-encryptedsha256": encryptedObjectSha256,
            "x-amz-meta-schema": HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
            "x-amz-meta-snapshotid": snapshotId,
          },
          status: 200,
        });
      }
      if (url.origin === "http://127.0.0.1:39000" && method === "DELETE") {
        verifyLocalS3SigV4QueryUrl({
          accessKeyId: "r2_access_fixture_test",
          amzDate: "20260520T123456Z",
          bucketName: "bundles-test",
          endpoint: "http://127.0.0.1:39000",
          expiresSeconds: 60,
          key: objectKey,
          method: "DELETE",
          secretAccessKey: "r2_signing_fixture_test",
          url,
        });
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected hosted-local missing checksum fetch ${method} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot object metadata does not match its ref.",
    });
    expect(bindingHead).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: {
        [HOSTED_R2_CHECKSUM_MODE_HEADER]: HOSTED_R2_CHECKSUM_MODE_ENABLED,
      },
      method: "HEAD",
    }));
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
  });

  it("does not fall back to the R2 binding when hosted-local S3 control endpoint is missing", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const snapshotId = "snapshot_complete_local_s3_missing_control";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const encryptedObjectSha256 = sha256Hex(bytes);
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: bytes.byteLength,
      encryptedObjectSha256,
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const bindingHead = vi.fn(async () => ({
      checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
      customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
      key: objectKey,
      size: bytes.byteLength,
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      createRunnerOutboundEnv({
        BUNDLES: createWorkspaceSnapshotBucket(
          async (key) => ({ key, size: bytes.byteLength }),
          bindingHead,
        ),
        HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
        HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
        USER_RUNNER: {
          getByName: runner.getByName,
        },
      }),
      "member_123",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Hosted workspace snapshot local S3 control endpoint is required when local R2 presign endpoint mode is enabled.",
    });
    expect(bindingHead).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
  });

  it("rejects malformed hosted-local S3 content-length values before checkpointing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:34:56.000Z"));
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_local_s3_bad_length";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
      ),
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:39000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn(async (
      request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      const method = init?.method ?? (request instanceof Request ? request.method : "GET");
      if (url.origin === "http://127.0.0.1:39000" && method === "HEAD") {
        verifyLocalS3SigV4QueryUrl({
          accessKeyId: "r2_access_fixture_test",
          amzDate: "20260520T123456Z",
          bucketName: "bundles-test",
          checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
          endpoint: "http://127.0.0.1:39000",
          expiresSeconds: 60,
          key: objectKey,
          method: "HEAD",
          secretAccessKey: "r2_signing_fixture_test",
          url,
        });
        return new Response(null, {
          headers: {
            "content-length": "4abc",
            "x-amz-meta-encryptedsha256": snapshotRef.archive.encryptedObjectSha256,
            "x-amz-meta-schema": HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
            "x-amz-meta-snapshotid": snapshotId,
          },
          status: 200,
        });
      }
      if (url.origin === "http://127.0.0.1:39000" && method === "DELETE") {
        verifyLocalS3SigV4QueryUrl({
          accessKeyId: "r2_access_fixture_test",
          amzDate: "20260520T123456Z",
          bucketName: "bundles-test",
          endpoint: "http://127.0.0.1:39000",
          expiresSeconds: 60,
          key: objectKey,
          method: "DELETE",
          secretAccessKey: "r2_signing_fixture_test",
          url,
        });
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected hosted-local malformed length fetch ${method} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot object size is unavailable.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: {
        [HOSTED_R2_CHECKSUM_MODE_HEADER]: HOSTED_R2_CHECKSUM_MODE_ENABLED,
      },
      method: "HEAD",
    }));
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
  });

  it("aborts workspace snapshot upload sessions and deletes any uploaded object", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_abort";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createBridgeWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({ key, size: 4 }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotAbortRequest({
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      aborted: true,
      ok: true,
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith(objectKey);
  });

  it("does not abort a snapshot after its active fence changes during the session read", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_abort_stale_session_read";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const staleSession = createWorkspaceSnapshotUploadSession(snapshotRef);
    await runner.createHostedWorkspaceSnapshotUploadSession(staleSession);
    const activeSnapshotId = "snapshot_abort_active_replacement";
    const activeObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: activeObjectKey,
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeSession = {
      ...createWorkspaceSnapshotUploadSession(activeSnapshotRef, {
        workspaceVersion: "5",
      }),
      attemptId: "attempt_2",
      leaseGeneration: "10",
    };
    runner.readHostedWorkspaceSnapshotUploadSession.mockImplementationOnce(async () => {
      runner.setActiveWriteFence({
        attemptId: activeSession.attemptId,
        leaseGeneration: activeSession.leaseGeneration,
      });
      await runner.createHostedWorkspaceSnapshotUploadSession(activeSession);
      return staleSession;
    });
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({ key, size: 4 }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotAbortRequest({
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledTimes(2);
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.workspaceSnapshotUploadSessions.get(activeSnapshotId)).toEqual(activeSession);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
  });

  it("retains uploaded snapshot cleanup before deleting an aborted session when object deletion fails", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_abort_delete_failure";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {
      throw new Error("R2 delete failed");
    });
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({ key, size: 4 }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotAbortRequest({
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      aborted: true,
      ok: true,
    });
    expect(deleteObject).toHaveBeenCalledWith(objectKey);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).toHaveBeenCalledWith({
      createdAt: expect.stringMatching(/^20/u),
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId,
      userId: "member_123",
    });
    expect(runner.workspaceSnapshotOrphanCandidates.get(snapshotId)).toEqual(
      expect.objectContaining({
        objectKey,
        snapshotId,
        userId: "member_123",
      }),
    );
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
  });

  it("rejects a stale invocation abort before session or object access", async () => {
    const runner = createWorkspaceVersionAwareUserRunner({
      leaseGeneration: "10",
    });
    const snapshotId = "snapshot_abort_after_lease_change";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({ key, size: 4 }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotAbortRequest({
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(runner.readHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("rejects aborts when the request workspace version differs from the active upload session", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_abort_stale_headers";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, {
      ...createWorkspaceSnapshotUploadSession(snapshotRef),
      workspaceVersion: "8",
    });
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({ key, size: 4 }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotAbortRequest({
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("rejects stale abort headers without deleting an expired different upload session", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_abort_expired_stale_headers";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, {
      ...createWorkspaceSnapshotUploadSession(snapshotRef, {
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
      leaseGeneration: "10",
      workspaceVersion: "8",
    });
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({ key, size: 4 }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotAbortRequest({
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("aborts hosted-local workspace snapshot upload sessions through local S3-compatible DELETE", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:34:56.000Z"));
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_abort_local_s3";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const bindingDelete = vi.fn(async () => {
      throw new Error("hosted-local abort should use local S3 DELETE");
    });
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({ key, size: 4 }),
        bindingDelete,
      ),
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:39000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn(async (
      request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      const method = init?.method ?? (request instanceof Request ? request.method : "GET");
      if (url.origin === "http://127.0.0.1:39000" && method === "DELETE") {
        verifyLocalS3SigV4QueryUrl({
          accessKeyId: "r2_access_fixture_test",
          amzDate: "20260520T123456Z",
          bucketName: "bundles-test",
          endpoint: "http://127.0.0.1:39000",
          expiresSeconds: 60,
          key: objectKey,
          method: "DELETE",
          secretAccessKey: "r2_signing_fixture_test",
          url,
        });
        return new Response(null, { status: 404 });
      }
      throw new Error(`Unexpected hosted-local abort fetch ${method} ${url.href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotAbortRequest({
        objectKey,
        snapshotId,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    expect(bindingDelete).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const deleteUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    verifyLocalS3SigV4QueryUrl({
      accessKeyId: "r2_access_fixture_test",
      amzDate: "20260520T123456Z",
      bucketName: "bundles-test",
      endpoint: "http://127.0.0.1:39000",
      expiresSeconds: 60,
      key: objectKey,
      method: "DELETE",
      secretAccessKey: "r2_signing_fixture_test",
      url: deleteUrl,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "DELETE",
    }));
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
  });

  it("rejects stale complete headers without deleting a different active upload session", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_stale_session";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, {
      ...createWorkspaceSnapshotUploadSession(snapshotRef),
      leaseGeneration: "8",
    });
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({ key, size: 4 }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retire an oversized completion after its active fence changes during the session read", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_stale_session_read";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const staleSession = createWorkspaceSnapshotUploadSession(snapshotRef);
    await runner.createHostedWorkspaceSnapshotUploadSession(staleSession);

    const activeSnapshotId = "snapshot_complete_session_read_active_replacement";
    const activeObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: activeObjectKey,
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeCleanupSnapshotId = "snapshot_complete_session_read_active_cleanup";
    const activeCleanupObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: activeCleanupSnapshotId,
      userId: "member_123",
    });
    const activeCleanupSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "c".repeat(64),
      objectKey: activeCleanupObjectKey,
      snapshotId: activeCleanupSnapshotId,
      userId: "member_123",
    });
    const activeSession = {
      ...createWorkspaceSnapshotUploadSession(activeSnapshotRef, {
        replacedSnapshotRef: activeCleanupSnapshotRef,
        workspaceVersion: "5",
      }),
      attemptId: "attempt_2",
      leaseGeneration: "10",
    };
    runner.readHostedWorkspaceSnapshotUploadSession.mockImplementationOnce(async () => {
      runner.setActiveWriteFence({
        attemptId: activeSession.attemptId,
        leaseGeneration: activeSession.leaseGeneration,
      });
      await runner.createHostedWorkspaceSnapshotUploadSession(activeSession);
      return staleSession;
    });

    const deleteObject = vi.fn(async () => {});
    const headObject = vi.fn();
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES }),
        headObject,
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledTimes(2);
    expect(runner.readHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.workspaceSnapshotUploadSessions.get(activeSnapshotId)).toEqual(activeSession);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(headObject).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects stale complete headers without deleting an expired different active upload session", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_expired_stale_headers";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, {
      ...createWorkspaceSnapshotUploadSession(snapshotRef, {
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
      leaseGeneration: "10",
      workspaceVersion: "8",
    });
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({ key, size: 4 }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains expired non-current completion object cleanup instead of deleting inline", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_expired_non_current_cleanup";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(
      snapshotId,
      createWorkspaceSnapshotUploadSession(snapshotRef, {
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: null,
      onCheckpoint: () => {
        throw new Error("expired completion should not checkpoint again");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session expired.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).toHaveBeenCalledWith({
      createdAt: expect.stringMatching(/^20/u),
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId,
      userId: "member_123",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledWith({
      snapshotId,
      userId: "member_123",
    });
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
  });

  it("deletes replaced state without deleting the current snapshot", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_expired_current_retry";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_complete_expired_current_replaced";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(
      snapshotId,
      createWorkspaceSnapshotUploadSession(snapshotRef, {
        expiresAt: "2000-01-01T00:00:00.000Z",
        replacedSnapshotRef,
      }),
    );
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createBridgeWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: snapshotRef,
      currentWorkspaceVersion: "5",
      onCheckpoint: () => {
        throw new Error("expired current retry should not checkpoint again");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    const responseBody = requireTestObject(await response.json(), "expired current retry response");
    expect(response.status).toBe(200);
    expect(responseBody.checkpoint).toEqual(expect.objectContaining({
      checkpointed: true,
      replacedSnapshotRef,
      workspace: expect.objectContaining({
        snapshotRef: expect.objectContaining({
          objectKey,
          snapshotId,
        }),
      }),
    }));
    expect(responseBody.snapshotRef).toEqual(expect.objectContaining({
      objectKey,
      snapshotId,
    }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledWith(replacedObjectKey);
    expect(deleteObject).not.toHaveBeenCalledWith(objectKey);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledWith({
      snapshotId,
      userId: "member_123",
    });
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
  });

  it("rejects an expired retry before session or web access when the active fence moved", async () => {
    const runner = createWorkspaceVersionAwareUserRunner({
      leaseGeneration: "10",
    });
    const snapshotId = "snapshot_complete_expired_current_moved_fence";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(
      snapshotId,
      createWorkspaceSnapshotUploadSession(snapshotRef, {
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: snapshotRef,
      currentWorkspaceVersion: "5",
      onCheckpoint: () => {
        throw new Error("expired current retry should not checkpoint again");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
  });

  it("keeps an expired current workspace snapshot retry when web has not advanced past the session version", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_expired_current_pre_checkpoint";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(
      snapshotId,
      createWorkspaceSnapshotUploadSession(snapshotRef, {
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: snapshotRef,
      currentWorkspaceVersion: "4",
      onCheckpoint: () => {
        throw new Error("expired current retry should not checkpoint again");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledTimes(2);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
  });

  it("keeps an expired current workspace snapshot retry when replaced cleanup still fails", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_expired_current_retry_cleanup_fails";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_complete_expired_current_replaced_cleanup_fails";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    runner.recordHostedWorkspaceSnapshotOrphanCandidate.mockImplementationOnce(async () => {
      throw new Error("orphan recording failed");
    });
    runner.workspaceSnapshotUploadSessions.set(
      snapshotId,
      createWorkspaceSnapshotUploadSession(snapshotRef, {
        expiresAt: "2000-01-01T00:00:00.000Z",
        replacedSnapshotRef,
      }),
    );
    const deleteObject = vi.fn(async () => {
      throw new Error("R2 delete failed");
    });
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: snapshotRef,
      currentWorkspaceVersion: "5",
      onCheckpoint: () => {
        throw new Error("expired current retry should not checkpoint again");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace replaced snapshot cleanup failed.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledWith(replacedObjectKey);
    expect(deleteObject).not.toHaveBeenCalledWith(objectKey);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).toHaveBeenCalledOnce();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)).toMatchObject({
      replacedSnapshotRef,
      snapshotId,
    });
  });

  it("rejects stale completion before session, object, web, or cleanup access", async () => {
    const runner = createWorkspaceVersionAwareUserRunner({
      leaseGeneration: "10",
    });
    const snapshotId = "snapshot_complete_replaced_write_fence";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const headObject = vi.fn(async (key: string) => ({
      checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
      customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
      key,
      size: 4,
    }));
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        headObject,
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      generation: "9",
      userId: "member_123",
    });
    expect(runner.readHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(headObject).not.toHaveBeenCalled();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the replacement owner when the active fence changes during object metadata read", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_replaced_write_fence";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    await runner.createHostedWorkspaceSnapshotUploadSession(
      createWorkspaceSnapshotUploadSession(snapshotRef),
    );
    const activeSnapshotId = "snapshot_complete_head_active_replacement";
    const activeObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: activeObjectKey,
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeSession = {
      ...createWorkspaceSnapshotUploadSession(activeSnapshotRef, {
        workspaceVersion: "5",
      }),
      attemptId: "attempt_2",
      leaseGeneration: "10",
    };
    const deleteObject = vi.fn(async () => {});
    const headObject = vi.fn(async (key: string) => {
      runner.setActiveWriteFence({
        attemptId: activeSession.attemptId,
        leaseGeneration: activeSession.leaseGeneration,
      });
      await runner.createHostedWorkspaceSnapshotUploadSession(activeSession);
      return {
        checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
        customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
        key,
        size: 4,
      };
    });
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        headObject,
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      onCheckpoint: () => {
        throw new Error("stale completion must not checkpoint");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledTimes(3);
    expect(runner.readHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(headObject).toHaveBeenCalledWith(objectKey);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.workspaceSnapshotUploadSessions.get(activeSnapshotId)).toEqual(activeSession);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
  });

  it("keeps a replacement owner's upload session when the fence changes during the web read", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_stale_during_web_read";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const activeSnapshotId = "snapshot_complete_active_replacement";
    const activeObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const activeSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: activeObjectKey,
      snapshotId: activeSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_complete_previous_checkpoint";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "c".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const staleSession = createWorkspaceSnapshotUploadSession(snapshotRef);
    await runner.createHostedWorkspaceSnapshotUploadSession(staleSession);
    const deleteObject = vi.fn(async () => {});
    const headObject = vi.fn(async (key: string) => ({
      checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
      customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
      key,
      size: 4,
    }));
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        headObject,
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const activeSession = {
      ...createWorkspaceSnapshotUploadSession(activeSnapshotRef, {
        workspaceVersion: "5",
      }),
      attemptId: "attempt_2",
      leaseGeneration: "10",
    };
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      currentSnapshotRef: replacedSnapshotRef,
      currentWorkspaceVersion: "5",
      async onCheckpoint() {
        runner.setActiveWriteFence({
          attemptId: activeSession.attemptId,
          leaseGeneration: activeSession.leaseGeneration,
        });
        await runner.createHostedWorkspaceSnapshotUploadSession(activeSession);
        return new Response("invalid checkpoint response", {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot upload session is stale.",
    });
    expect(runner.rememberHostedWorkspaceSnapshotReplacedRef).toHaveBeenCalledWith({
      expectedSession: staleSession,
      replacedSnapshotRef,
    });
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.workspaceSnapshotUploadSessions.get(activeSnapshotId)).toEqual(activeSession);
    expect(runner.workspaceSnapshotOrphanCandidates.has(activeSnapshotId)).toBe(false);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).not.toHaveBeenCalled();
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("retires workspace snapshot upload sessions when the checkpoint request fails", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_cas_failed";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      onCheckpoint: () => new Response(
        JSON.stringify({
          error: "stale checkpoint",
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 409,
        },
      ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot checkpoint failed.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).toHaveBeenCalledWith({
      createdAt: expect.stringMatching(/^20/u),
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId,
      userId: "member_123",
    });
    expect(runner.workspaceSnapshotOrphanCandidates.get(snapshotId)).toMatchObject({
      objectKey,
      snapshotId,
    });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("retires workspace snapshot upload sessions without deleting the object when checkpoint fetch is ambiguous", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_checkpoint_ambiguous";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      onCheckpoint: () => {
        throw new Error("ambiguous checkpoint failure");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot checkpoint failed.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).toHaveBeenCalledWith(expect.objectContaining({
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId,
      userId: "member_123",
    }));
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("records the replaced snapshot before retiring an ambiguous checkpoint upload session", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_checkpoint_ambiguous_replaced";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_ambiguous_replaced_previous";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(
      snapshotId,
      createWorkspaceSnapshotUploadSession(snapshotRef, { replacedSnapshotRef }),
    );
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      onCheckpoint: () => {
        throw new Error("ambiguous checkpoint failure");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot checkpoint failed.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).toHaveBeenCalledWith(expect.objectContaining({
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId,
      userId: "member_123",
    }));
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).toHaveBeenCalledWith(expect.objectContaining({
      objectKey: replacedObjectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    }));
    expect(runner.workspaceSnapshotOrphanCandidates.get(snapshotId)).toMatchObject({
      objectKey,
      snapshotId,
    });
    expect(runner.workspaceSnapshotOrphanCandidates.get(replacedSnapshotId)).toMatchObject({
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
    });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous checkpoint upload session when replaced snapshot recording fails", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_checkpoint_ambiguous_recording_fails";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const replacedSnapshotId = "snapshot_ambiguous_previous_recording_fails";
    const replacedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    const replacedSnapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 5,
      encryptedObjectSha256: "b".repeat(64),
      objectKey: replacedObjectKey,
      snapshotId: replacedSnapshotId,
      userId: "member_123",
    });
    runner.recordHostedWorkspaceSnapshotOrphanCandidate
      .mockImplementationOnce(async (candidate) => {
        runner.workspaceSnapshotOrphanCandidates.set(candidate.snapshotId, candidate);
        return candidate;
      })
      .mockImplementationOnce(async () => {
        throw new Error("orphan recording failed");
      });
    runner.workspaceSnapshotUploadSessions.set(
      snapshotId,
      createWorkspaceSnapshotUploadSession(snapshotRef, { replacedSnapshotRef }),
    );
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      onCheckpoint: () => {
        throw new Error("ambiguous checkpoint failure");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot cleanup state is unavailable.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
    expect(runner.workspaceSnapshotUploadSessions.get(snapshotId)).toMatchObject({
      replacedSnapshotRef,
      snapshotId,
    });
    expect(runner.workspaceSnapshotOrphanCandidates.get(snapshotId)).toMatchObject({
      objectKey,
      snapshotId,
    });
    expect(runner.workspaceSnapshotOrphanCandidates.has(replacedSnapshotId)).toBe(false);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("fails complete and retires the upload session when checkpoint CAS returns false", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_checkpoint_false";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
	const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
		onCheckpoint: () => new Response(
			JSON.stringify({
				...createHostedWorkspaceCheckpointResponse("5", null),
				checkpointConflictReason: "workspace_version",
				checkpointed: false,
			}),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot checkpoint CAS failed.",
    });
    const diagnosticLog = hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls
      .map(([input]) => input)
      .find((input) =>
        input.message === "Hosted workspace snapshot checkpoint CAS conflict."
      );
    expect(diagnosticLog).toEqual(expect.objectContaining({
      component: "runner",
		details: expect.objectContaining({
			checkpointConflictReason: "workspace_version",
			checkpointWorkspaceVersion: "5",
			expectedWorkspaceVersion: "4",
			method: "POST",
			operation: "workspace_snapshot_complete",
      }),
      level: "warn",
      phase: "wake.running",
    }));
    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain("member_123");
    expect(serializedLogs).not.toContain(snapshotId);
    expect(serializedLogs).not.toContain(objectKey);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).toHaveBeenCalledWith(expect.objectContaining({
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId,
      userId: "member_123",
    }));
	expect(deleteObject).not.toHaveBeenCalled();
});

it("logs checkpoint CAS conflicts before ambiguous cleanup failures", async () => {
	const runner = createWorkspaceVersionAwareUserRunner();
	const snapshotId = "snapshot_complete_checkpoint_false_cleanup_fails";
	const objectKey = await hostedWorkspaceSnapshotObjectKey({
		snapshotId,
		userId: "member_123",
	});
	const snapshotRef = createWorkspaceSnapshotV2Ref({
		encryptedByteSize: 4,
		encryptedObjectSha256: "a".repeat(64),
		objectKey,
		snapshotId,
		userId: "member_123",
	});
	runner.recordHostedWorkspaceSnapshotOrphanCandidate.mockImplementationOnce(async () => {
		throw new Error("orphan recording failed");
	});
	runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
	const deleteObject = vi.fn(async () => {});
	const env = createRunnerOutboundEnv({
		BUNDLES: createWorkspaceSnapshotBucket(
			async (key) => ({ key, size: 4 }),
			async (key) => ({
				checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
				customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
				key,
				size: 4,
			}),
			deleteObject,
		),
		USER_RUNNER: {
			getByName: runner.getByName,
		},
	});
	const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
		onCheckpoint: () => new Response(
			JSON.stringify({
				...createHostedWorkspaceCheckpointResponse("5", null),
				checkpointConflictReason: "workspace_version",
				checkpointed: false,
			}),
			{
				headers: {
					"content-type": "application/json; charset=utf-8",
				},
				status: 200,
			},
		),
	});
	vi.stubGlobal("fetch", fetchMock);

	const response = await handleRunnerOutboundRequest(
		createWorkspaceSnapshotCompleteRequest({
			snapshotId,
			snapshotRef,
			workspaceVersion: "4",
		}),
		env,
		"member_123",
	);

	expect(response.status).toBe(503);
	await expect(response.json()).resolves.toEqual({
		error: "Hosted workspace snapshot cleanup state is unavailable.",
	});
	const diagnosticLog = hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls
		.map(([input]) => input)
		.find((input) =>
			input.message === "Hosted workspace snapshot checkpoint CAS conflict."
		);
	expect(diagnosticLog).toEqual(expect.objectContaining({
		component: "runner",
		details: expect.objectContaining({
			checkpointConflictReason: "workspace_version",
			checkpointWorkspaceVersion: "5",
			expectedWorkspaceVersion: "4",
			method: "POST",
			operation: "workspace_snapshot_complete",
		}),
		level: "warn",
		phase: "wake.running",
	}));
	const serializedLogs = JSON.stringify(
		hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
	);
	expect(serializedLogs).not.toContain("member_123");
	expect(serializedLogs).not.toContain(snapshotId);
	expect(serializedLogs).not.toContain(objectKey);
	expect(fetchMock).toHaveBeenCalledTimes(2);
	expect(runner.deleteHostedWorkspaceSnapshotUploadSession).not.toHaveBeenCalled();
	expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(true);
	expect(deleteObject).not.toHaveBeenCalled();
});

it("returns foreground-pending checkpoint responses from snapshot completion without failing the invocation", async () => {
	const runner = createWorkspaceVersionAwareUserRunner();
	const snapshotId = "snapshot_complete_foreground_pending";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      onCheckpoint: () => new Response(
        JSON.stringify({
          ...createHostedWorkspaceCheckpointResponse("4", null),
          checkpointConflictReason: "foreground_pending",
          checkpointed: false,
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(200);
    const responseBody = requireTestObject(await response.json(), "workspace snapshot foreground pending response");
    expect(responseBody.ok).toBe(true);
    expect(responseBody.snapshotRef).toEqual(expect.objectContaining({
      objectKey,
      snapshotId,
    }));
    expect(responseBody.checkpoint).toEqual(expect.objectContaining({
      checkpointConflictReason: "foreground_pending",
      checkpointed: false,
      workspace: expect.objectContaining({
        snapshotRef: null,
        userId: "member_123",
        version: "4",
      }),
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).toHaveBeenCalledWith(expect.objectContaining({
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId,
      userId: "member_123",
    }));
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("rejects workspace snapshot completion when checkpoint returns a mutated v2 ref", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_checkpoint_ref_mutated";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = createWorkspaceSnapshotCompleteWebFetchMock({
      onCheckpoint: (args) => {
        const checkpointRequest = readTestFetchBodyObject(args, "mutated checkpoint request");
        const publishedRef = requireTestObject(checkpointRequest.snapshotRef, "mutated checkpoint ref");
        const archive = requireTestObject(publishedRef.archive, "mutated checkpoint ref archive");
        const mutatedRef = {
          ...publishedRef,
          archive: {
            ...archive,
            plaintextArchiveSha256: "d".repeat(64),
          },
        };
        return new Response(
          JSON.stringify(createHostedWorkspaceCheckpointResponseWithSnapshotRef("5", mutatedRef)),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        );
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot checkpoint ref mismatch.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(runner.recordHostedWorkspaceSnapshotOrphanCandidate).toHaveBeenCalledWith(expect.objectContaining({
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId,
      userId: "member_123",
    }));
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("rejects workspace snapshot completion when object size mismatches", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_mismatch";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          key,
          size: 5,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledTimes(3);
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith(objectKey);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects workspace snapshot completion when R2 HEAD metadata mismatches", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_metadata_mismatch";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: {
            ...createWorkspaceSnapshotHeadMetadata(snapshotRef),
            encryptedsha256: "b".repeat(64),
          },
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot object metadata does not match its ref.",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith(objectKey);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects workspace snapshot completion when R2 HEAD checksum mismatches", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_checksum_mismatch";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: { sha256: hexToBytes("b".repeat(64)) },
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot object metadata does not match its ref.",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith(objectKey);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects canonical runtime commit workspace snapshot completion", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_non_idle";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({
          checksums: createWorkspaceSnapshotHeadChecksums(snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(snapshotRef),
          key,
          size: 4,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        reason: "canonical_runtime_commit",
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot checkpoint reason must be idle_shutdown.",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith(objectKey);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized workspace snapshot refs before checkpoint publication", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_oversized";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES }),
        async (key) => ({
          key,
          size: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot exceeds the single-part size limit.",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith(objectKey);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized plain workspace snapshot refs before checkpoint publication", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_plain_oversized";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 128,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      totalPlainBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const deleteObject = vi.fn(async () => {});
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 128 }),
        async (key) => ({ key, size: 128 }),
        deleteObject,
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace snapshot exceeds the total plain size limit.",
    });
    expect(runner.deleteHostedWorkspaceSnapshotUploadSession).toHaveBeenCalledOnce();
    expect(runner.workspaceSnapshotUploadSessions.has(snapshotId)).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith(objectKey);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects workspace snapshot completion when R2 HEAD omits object size", async () => {
    const runner = createWorkspaceVersionAwareUserRunner();
    const snapshotId = "snapshot_complete_missing_size";
    const objectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId: "member_123",
    });
    const snapshotRef = createWorkspaceSnapshotV2Ref({
      encryptedByteSize: 4,
      encryptedObjectSha256: "a".repeat(64),
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    runner.workspaceSnapshotUploadSessions.set(snapshotId, createWorkspaceSnapshotUploadSession(snapshotRef));
    const env = createRunnerOutboundEnv({
      BUNDLES: createWorkspaceSnapshotBucket(
        async (key) => ({ key, size: 4 }),
        async (key) => ({ key }),
      ),
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      createWorkspaceSnapshotCompleteRequest({
        snapshotId,
        snapshotRef,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
    );

    expect(response.status).toBe(503);
    expect(runner.validateRuntimeWriteFence).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("writes browser-vault replicas after live lease validation", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const events: string[] = [];
    runner.recordHostedBrowserVaultReplicaOrphanCandidate.mockImplementation(async (candidate) => {
      events.push(`record:${candidate.objectKey}`);
      runner.browserVaultReplicaOrphanCandidates.set(candidate.objectKey, candidate);
      return candidate;
    });
    const defaultEnv = createRunnerOutboundEnv();
    const bucket = {
      ...defaultEnv.BUNDLES,
      async put(key: string, value: R2PutValueLike) {
        events.push(`put:${key}`);
        await defaultEnv.BUNDLES.put(key, value);
      },
    };
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      BUNDLES: bucket,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const sourceBundleHash = "c".repeat(64);
    const replacedReplicaRef = {
      ...createBrowserVaultReplicaRef("b".repeat(64)),
      objectKey: `${await hostedBrowserVaultReplicaUserPrefix({
        userId: "member_123",
      })}${"a".repeat(48)}.json`,
    };

    const response = await handleRunnerOutboundRequest(
      createBrowserVaultReplicaWriteRequest({
        replica: createBrowserVaultReplica(sourceBundleHash),
        replacedReplicaRef,
        workspaceVersion: "5",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      replicaRef: expect.objectContaining({
        replicaSchema: "murph.browser-vault-replica",
        schema: "murph.hosted-browser-vault-replica-ref.v1",
        sourceBundleHash,
      }),
    });
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
    expect(runner.recordHostedBrowserVaultReplicaOrphanCandidate).toHaveBeenCalledTimes(2);
    expect(runner.recordHostedBrowserVaultReplicaOrphanCandidate).toHaveBeenNthCalledWith(1, {
      createdAt: expect.any(String),
      objectKey: replacedReplicaRef.objectKey,
      schema: HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA,
      userId: "member_123",
    });
    const plannedReplicaCandidate = runner.recordHostedBrowserVaultReplicaOrphanCandidate.mock
      .calls[1]?.[0];
    expect(plannedReplicaCandidate).toMatchObject({
      createdAt: expect.any(String),
      schema: HOSTED_BROWSER_VAULT_REPLICA_ORPHAN_CANDIDATE_SCHEMA,
      userId: "member_123",
    });
    expect(events).toEqual([
      `record:${replacedReplicaRef.objectKey}`,
      `record:${plannedReplicaCandidate?.objectKey}`,
      `put:${plannedReplicaCandidate?.objectKey}`,
    ]);
  });

  it("accepts browser-vault replica writes when the workspace version header is stale", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const runner = createWorkspaceVersionAwareUserRunner();
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName: runner.getByName,
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      createBrowserVaultReplicaWriteRequest({
        replica: createBrowserVaultReplica("c".repeat(64)),
        workspaceVersion: "4",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(runner.ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });






  it("rejects browser-vault replica writes when the live invocation lease is stale", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const ownsActiveInvocationLease = vi.fn(async () => false);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      createBrowserVaultReplicaWriteRequest({
        replica: createBrowserVaultReplica("f".repeat(64)),
        workspaceVersion: "4",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(bindUser).not.toHaveBeenCalled();
    expect(ownsActiveInvocationLease).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects browser-vault replica writes when the invocation proxy token is missing", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://browser-vault.worker/replicas", {
        body: JSON.stringify({
          replica: createBrowserVaultReplica("e".repeat(64)),
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(bindUser).not.toHaveBeenCalled();
    expect(ownsActiveInvocationLease).not.toHaveBeenCalled();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects browser-vault replica writes with missing lease headers before resolving crypto", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://browser-vault.worker/replicas", {
        body: JSON.stringify({
          replica: createBrowserVaultReplica("d".repeat(64)),
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      env,
      "member_123" ,
    );

    expect(response.status).toBe(401);
    expect(bindUser).not.toHaveBeenCalled();
    expect(ownsActiveInvocationLease).not.toHaveBeenCalled();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("does not retain resolved outbound plaintext crypto contexts", async () => {
    const fetchedAt = "2026-05-04T00:00:00.000Z";
    const fixture = await createHostedRuntimeCryptoContextFixture({
      cacheMaxAgeMs: 10_000,
      cryptoContextVersion: "ctx-no-plaintext-cache",
      fetchedAt,
    });
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fetchedAt));
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    const firstContext = await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });
    firstContext.rootKey[0] = 255;
    const secondContext = await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });

    expect(firstContext.rootKeyId).toBe("udrk:runtime:test-root");
    expect(secondContext.rootKeyId).toBe("udrk:runtime:test-root");
    expect(secondContext).not.toBe(firstContext);
    expect(secondContext.rootKey).not.toBe(firstContext.rootKey);
    expect(secondContext.rootKey[0]).toBe(101);
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
    expect(bindUser).not.toHaveBeenCalled();
  });

  it("coalesces concurrent outbound runtime crypto cold fetches without binding the runner", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture({
      cacheMaxAgeMs: 10_000,
      cryptoContextVersion: "ctx-pending-single-flight",
      fetchedAt: "2026-05-04T00:00:00.000Z",
    });
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T00:00:00.000Z"));
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    const firstContext = resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });
    const secondContext = resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });

    const [firstResolved, secondResolved] = await Promise.all([firstContext, secondContext]);

    expect(firstResolved.rootKeyId).toBe("udrk:runtime:test-root");
    expect(secondResolved.rootKeyId).toBe("udrk:runtime:test-root");
    expect(secondResolved).toBe(firstResolved);

    const thirdResolved = await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });

    expect(thirdResolved).not.toBe(firstResolved);
    expect(bindUser).not.toHaveBeenCalled();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("does not reuse outbound runtime crypto envelopes across hosted environment identity", async () => {
    const fetchedAt = "2026-05-04T00:00:00.000Z";
    const firstFixture = await createHostedRuntimeCryptoContextFixture({
      cacheMaxAgeMs: 10_000,
      cryptoContextVersion: "ctx-first-env",
      fetchedAt,
      runtimeRootKeyId: "udrk:runtime:first-root",
    });
    const secondFixture = await createHostedRuntimeCryptoContextFixture({
      authoritySignKeyVersion:
        "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/2",
      automationKeyId: "cf-key-v2",
      cacheMaxAgeMs: 10_000,
      cryptoContextVersion: "ctx-second-env",
      cryptoEnv: "staging",
      fetchedAt,
      runtimeRootKeyId: "udrk:runtime:second-root",
    });
    const firstEnv = createRunnerOutboundEnv({
      ...firstFixture.env,
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
    });
    const secondEnv = createRunnerOutboundEnv({
      ...secondFixture.env,
      HOSTED_WEB_BASE_URL: "https://web-staging.example.test",
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v2",
    });
    const contextsByUrl = new Map([
      [`https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`, firstFixture.context],
      [
        `https://web-staging.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`,
        secondFixture.context,
      ],
    ]);
    const fetchMock = vi.fn(async (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      const [url, init] = args;
      const context = contextsByUrl.get(String(url));
      assert.ok(context);
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-hosted-execution-user-id"), "member_123");
      return new Response(JSON.stringify(context), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fetchedAt));

    const firstContext = await resolveRunnerOutboundUserCryptoContext({
      bucket: firstEnv.BUNDLES,
      domain: "runtime",
      env: firstEnv,
      environment: readHostedExecutionEnvironment(asWorkerStringEnvironment(firstEnv)),
      userId: "member_123",
    });
    const secondContext = await resolveRunnerOutboundUserCryptoContext({
      bucket: secondEnv.BUNDLES,
      domain: "runtime",
      env: secondEnv,
      environment: readHostedExecutionEnvironment(asWorkerStringEnvironment(secondEnv)),
      userId: "member_123",
    });

    expect(firstContext.rootKeyId).toBe("udrk:runtime:first-root");
    expect(secondContext.rootKeyId).toBe("udrk:runtime:second-root");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches outbound runtime crypto envelopes after the envelope cache TTL", async () => {
    const fetchedAt = "2026-05-04T00:00:00.000Z";
    const fixture = await createHostedRuntimeCryptoContextFixture({
      cacheMaxAgeMs: 2_000,
      cryptoContextVersion: "ctx-short-envelope-ttl",
      fetchedAt,
    });
    const env = createRunnerOutboundEnv({
      ...fixture.env,
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fetchedAt));
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });

    expect(fixture.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not poison outbound runtime crypto context cache after a rejected fetch", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("unavailable", { status: 503 });
      }

      return new Response(JSON.stringify(fixture.context), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const env = createRunnerOutboundEnv({
      ...fixture.env,
    });
    vi.stubGlobal("fetch", fetchMock);
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    await expect(resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    })).rejects.toThrow(/Hosted runtime crypto context fetch failed/u);
    await expect(resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    })).resolves.toMatchObject({
      rootKeyId: "udrk:runtime:test-root",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects absolute web-control runtime routes before allowlist checks", () => {
    expect(readHostedRunnerWebControlRoute(
      `${HOSTED_RUNTIME_WORKSPACE_PATH}?requestId=request_123`,
    )).toEqual({
      pathAndSearch: `${HOSTED_RUNTIME_WORKSPACE_PATH}?requestId=request_123`,
      pathname: HOSTED_RUNTIME_WORKSPACE_PATH,
    });

    expect(() => readHostedRunnerWebControlRoute(
      `https://example.test${HOSTED_RUNTIME_WORKSPACE_PATH}`,
    )).toThrow("Hosted runtime web-control route must be relative.");
  });

  it("rejects deleted share payload proxy calls", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response("unexpected", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(
        "http://web-control.worker/api/internal/hosted-execution/share/share_123/payload?requestId=request_share_1&eventId=event_accepted_123&ownerUserId=member_sender",
        {
          headers: createRunnerProxyHeaders(),
          method: "GET",
        },
      ),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects deleted share import proxy calls", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response("unexpected", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-execution/share/import", {
        body: JSON.stringify({
          eventId: "event_accepted_123",
          importedAt: "2026-04-26T00:00:05.000Z",
          ownerUserId: "member_sender",
          shareId: "share_123",
          status: "imported",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects the retired Linq contact-card callback before proxying", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response("unexpected", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(
        "http://web-control.worker/api/internal/hosted-runtime/linq/contact-card/share-after-outbound",
        {
          body: JSON.stringify({
            authority: {
              accountLookupKey: "hbidx:phone:v1:account",
              channel: "linq",
              containerMemberId: "member_123",
              threadId: "linq_chat_123",
            },
            chatId: "linq_chat_123",
            service: "iMessage",
            threadIsDirect: true,
          }),
          headers: createRunnerProxyHeaders({
            "content-type": "application/json; charset=utf-8",
          }),
          method: "POST",
        },
      ),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores legacy signed-user override headers on web-control proxy paths", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      workspace: null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        headers: createRunnerWriteFenceProxyHeaders({
          "x-hosted-runtime-web-control-user-id": "member_sender",
        }),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the workspace web-control fetch to run.");
    }
    const [_url, init] = firstCall;
    const headers = new Headers(init?.headers);
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
  });

  it("rejects method mismatches on otherwise allowlisted web-control proxy paths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const getPostOnlyResponse = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-runtime/log", {
        headers: createRunnerProxyHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );
    const postGetOnlyResponse = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        body: JSON.stringify({
          requestId: "request_workspace_1",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );

    expect(getPostOnlyResponse.status).toBe(404);
    expect(postGetOnlyResponse.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for non-allowlisted web-control proxy paths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-mailbox/status", {
        body: JSON.stringify({
          eventId: "evt_123",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the AI usage gate off the runtime web-control proxy", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-execution/usage/gate", {
        body: "{}",
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not proxy generic loopback host traffic through runner outbound handling", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://127.0.0.1:8788/health?from=runner", {
        headers: createRunnerProxyHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-loopback-token",
      }),
      "member_123" ,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createRunnerProxyHeaders(headers: Record<string, string> = {}) {
  return {
    [RUNNER_PROXY_TOKEN_HEADER]: RUNNER_PROXY_TOKEN,
    ...headers,
  };
}

function createVaultShareRunnerProxyHeaders(
  headers: Record<string, string> = {},
) {
  return createRunnerProxyHeaders({
    [HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER]: String(
      Date.now() + HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS,
    ),
    ...headers,
  });
}

function createAssistantPersonalizationRunnerRequest(
  headers: Record<string, string> = {},
  search = "",
): Request {
  return new Request(
    `http://web-control.worker${HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH}${search}`,
    {
      body: JSON.stringify({ action: "read" }),
      headers: createRunnerProxyHeaders({
        "content-type": "application/json; charset=utf-8",
        ...headers,
      }),
      method: "POST",
    },
  );
}

function createRunnerWriteFenceProxyHeaders(headers: Record<string, string> = {}) {
  return createRunnerProxyHeaders({
    "x-hosted-runtime-attempt-id": "attempt_1",
    "x-hosted-runtime-lease-generation": "9",
    "x-hosted-runtime-workspace-version": "4",
    ...headers,
  });
}

function createMailboxPayloadDecodeHeaders(headers: Record<string, string> = {}) {
  return createRunnerProxyHeaders({
    "content-type": "application/json; charset=utf-8",
    "x-hosted-runtime-attempt-id": "attempt_1",
    "x-hosted-runtime-lease-generation": "9",
    "x-hosted-runtime-workspace-version": "4",
    ...headers,
  });
}

async function createMailboxPayloadDecodeBody(input: {
  itemUserId?: string;
  wakeUserId?: string;
} = {}) {
  const itemUserId = input.itemUserId ?? "member_123";
  const wakeUserId = input.wakeUserId ?? itemUserId;
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const rootKeyId = "udrk:ingress:test-root";
  const itemRef = {
    dedupeKey: "event:mailbox-decode-route",
    id: "mailbox_item_decode_route",
    kind: "member.channels.updated",
    lane: "system",
    laneSeq: "1",
    occurredAt: "2026-05-01T00:00:00.000Z",
    userId: itemUserId,
  };
  const expectedWake = {
    eventId: itemRef.dedupeKey,
    kind: itemRef.kind,
    memberChannels: {
      email: true,
      linq: false,
      telegram: false,
    },
    occurredAt: itemRef.occurredAt,
    userId: wakeUserId,
  };
  const metadata = {
    dedupeKey: itemRef.dedupeKey,
    itemId: itemRef.id,
    kind: itemRef.kind,
    lane: itemRef.lane,
    laneSeq: itemRef.laneSeq,
    occurredAt: itemRef.occurredAt,
    payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
    payloadStorage: "inline" as const,
    userId: itemRef.userId,
  };
  const scope = buildHostedMailboxPayloadScope(metadata.payloadStorage);
  const payloadCiphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
    aad: buildHostedSecureBoxAad({
      ...buildHostedMailboxPayloadSecureBoxAad(metadata),
      domain: "ingress",
      lane: "mailbox-payload",
      scope,
      userId: itemRef.userId,
    }),
    domain: "ingress",
    lane: "mailbox-payload",
    plaintext: new TextEncoder().encode(JSON.stringify(expectedWake)),
    rootKey,
    rootKeyId,
    scope,
  }));

  return {
    expectedWake,
    request: {
      itemRef,
      payloadCiphertext,
      payloadRequestId: "request_decode_route",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadSource: "inline" as const,
    },
  };
}

function createArtifactPutRequest(input: {
  bytes: Uint8Array;
  sha256: string;
  workspaceVersion: string | null;
}): Request {
  return new Request(`http://artifacts.worker/objects/${input.sha256}`, {
    body: toArrayBuffer(input.bytes),
    headers: createRunnerProxyHeaders({
      "x-hosted-runtime-attempt-id": "attempt_1",
      "x-hosted-runtime-lease-generation": "9",
      ...(input.workspaceVersion === null
        ? {}
        : { "x-hosted-runtime-workspace-version": input.workspaceVersion }),
    }),
    method: "PUT",
  });
}

function createWorkspaceSnapshotStartRequest(input: {
  expectedWorkspaceVersion: string;
  reason?: "canonical_runtime_commit" | "idle_shutdown";
  workspaceVersion: string;
}): Request {
  return new Request("http://workspace-snapshots.worker/workspace-snapshots/start", {
    body: JSON.stringify({
      expectedWorkspaceVersion: input.expectedWorkspaceVersion,
      nextWakeAt: null,
      nextWakeReason: null,
      reason: input.reason ?? "idle_shutdown",
    }),
    headers: createRunnerProxyHeaders({
      "content-type": "application/json; charset=utf-8",
      "x-hosted-runtime-attempt-id": "attempt_1",
      "x-hosted-runtime-lease-generation": "9",
      "x-hosted-runtime-workspace-version": input.workspaceVersion,
    }),
    method: "POST",
  });
}

function createWorkspaceSnapshotCompleteRequest(input: {
  snapshotId: string;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
  workspaceVersion: string;
  reason?: "canonical_runtime_commit" | "idle_shutdown" | "import";
}): Request {
  return new Request(
    `http://workspace-snapshots.worker/workspace-snapshots/${input.snapshotId}/complete`,
    {
      body: JSON.stringify({
        archive: input.snapshotRef.archive,
        checkpointRequest: {
          attemptId: "attempt_1",
          expectedWorkspaceVersion: input.workspaceVersion,
          leaseGeneration: "9",
          nextWakeAt: null,
          nextWakeReason: null,
          reason: input.reason ?? "idle_shutdown",
          redactedStatus: null,
          snapshotRef: null,
        },
        objectKey: input.snapshotRef.objectKey,
        snapshotId: input.snapshotId,
      }),
      headers: createRunnerProxyHeaders({
        "content-type": "application/json; charset=utf-8",
        "x-hosted-runtime-attempt-id": "attempt_1",
        "x-hosted-runtime-lease-generation": "9",
        "x-hosted-runtime-workspace-version": input.workspaceVersion,
      }),
      method: "POST",
    },
  );
}

function createWorkspaceSnapshotPresignPutRequest(input: {
  encryptedByteSize: number;
  encryptedObjectSha256: string;
  objectKey: string;
  snapshotId: string;
  workspaceVersion: string;
}): Request {
  return new Request(
    `http://workspace-snapshots.worker/workspace-snapshots/${input.snapshotId}/presign-put`,
    {
      body: JSON.stringify({
        encryptedByteSize: input.encryptedByteSize,
        encryptedObjectSha256: input.encryptedObjectSha256,
        objectKey: input.objectKey,
        snapshotId: input.snapshotId,
      }),
      headers: createRunnerProxyHeaders({
        "content-type": "application/json; charset=utf-8",
        "x-hosted-runtime-attempt-id": "attempt_1",
        "x-hosted-runtime-lease-generation": "9",
        "x-hosted-runtime-workspace-version": input.workspaceVersion,
      }),
      method: "POST",
    },
  );
}

function createWorkspaceSnapshotPresignGetRequest(input: {
  objectKey: string;
  snapshotRef?: HostedWorkspaceSnapshotV2Ref;
  snapshotId: string;
  workspaceVersion: string;
}): Request {
  return new Request(
    `http://workspace-snapshots.worker/workspace-snapshots/${input.snapshotId}/presign-get`,
    {
      body: JSON.stringify({
        objectKey: input.objectKey,
        ...(input.snapshotRef === undefined ? {} : { ref: input.snapshotRef }),
        snapshotId: input.snapshotId,
      }),
      headers: createRunnerProxyHeaders({
        "content-type": "application/json; charset=utf-8",
        "x-hosted-runtime-attempt-id": "attempt_1",
        "x-hosted-runtime-lease-generation": "9",
        "x-hosted-runtime-workspace-version": input.workspaceVersion,
      }),
      method: "POST",
    },
  );
}

function createWorkspaceSnapshotAbortRequest(input: {
  objectKey: string;
  snapshotId: string;
  workspaceVersion: string;
}): Request {
  return new Request(
    `http://workspace-snapshots.worker/workspace-snapshots/${input.snapshotId}`,
    {
      body: JSON.stringify({
        objectKey: input.objectKey,
        snapshotId: input.snapshotId,
      }),
      headers: createRunnerProxyHeaders({
        "content-type": "application/json; charset=utf-8",
        "x-hosted-runtime-attempt-id": "attempt_1",
        "x-hosted-runtime-lease-generation": "9",
        "x-hosted-runtime-workspace-version": input.workspaceVersion,
      }),
      method: "DELETE",
    },
  );
}

function createWorkspaceSnapshotV2Ref(input: {
  encryptedByteSize: number;
  encryptedObjectSha256: string;
  objectKey: string;
  snapshotId: string;
  totalPlainBytes?: number;
  userId: string;
}): HostedWorkspaceSnapshotV2Ref {
  return {
    archive: {
      compression: "zstd",
      encryptedByteSize: input.encryptedByteSize,
      encryptedObjectSha256: input.encryptedObjectSha256,
      fileCount: 1,
      format: "tar",
      plaintextArchiveSha256: "c".repeat(64),
      totalPlainBytes: input.totalPlainBytes ?? input.encryptedByteSize,
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey: input.objectKey,
        snapshotId: input.snapshotId,
        userId: input.userId,
      }),
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId: "root_key_test",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_test",
    },
    objectKey: input.objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
    snapshotId: input.snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId: input.userId,
  };
}

function createWorkspaceSnapshotHeadMetadata(
  snapshotRef: HostedWorkspaceSnapshotV2Ref,
): Record<string, string> {
  return {
    encryptedsha256: snapshotRef.archive.encryptedObjectSha256,
    schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
    snapshotid: snapshotRef.snapshotId,
  };
}

function createWorkspaceSnapshotHeadChecksums(
  snapshotRef: HostedWorkspaceSnapshotV2Ref,
): { sha256: Uint8Array } {
  return {
    sha256: hexToBytes(snapshotRef.archive.encryptedObjectSha256),
  };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function createWorkspaceSnapshotUploadSession(
  snapshotRef: HostedWorkspaceSnapshotV2Ref,
  input: {
    expiresAt?: string;
    replacedSnapshotRef?: HostedWorkspaceSnapshotUploadSession["replacedSnapshotRef"];
    workspaceVersion?: string;
  } = {},
): HostedWorkspaceSnapshotUploadSession {
  const workspaceVersion = input.workspaceVersion ?? "4";
  const session = {
    attemptId: "attempt_1",
    createdAt: "2026-05-01T00:00:00.000Z",
    encryption: snapshotRef.encryption,
    expectedWorkspaceVersion: workspaceVersion,
    expiresAt: input.expiresAt ?? "9999-01-01T00:00:00.000Z",
    leaseGeneration: "9",
    objectKey: snapshotRef.objectKey,
    ...(input.replacedSnapshotRef ? { replacedSnapshotRef: input.replacedSnapshotRef } : {}),
    schema: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
    snapshotId: snapshotRef.snapshotId,
    userId: snapshotRef.userId,
    workspaceVersion,
  } satisfies HostedWorkspaceSnapshotUploadSession;
  return session;
}

function createWorkspaceSnapshotBundleTestBucket(input: {
  snapshotBytes: Uint8Array;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
}) {
  const objects = new Map<string, Uint8Array>([
    [input.snapshotRef.objectKey, input.snapshotBytes],
  ]);
  const deleted: string[] = [];
  const api: RunnerOutboundEnvironmentSource["BUNDLES"] = {
    async delete(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      for (const item of keys) {
        deleted.push(item);
        objects.delete(item);
      }
    },
    async get(key: string) {
      const value = objects.get(key);
      if (value === undefined) {
        return null;
      }
      return {
        async arrayBuffer() {
          return toArrayBuffer(value);
        },
        key,
        size: value.byteLength,
      };
    },
    async head(key: string) {
      const value = objects.get(key);
      if (value === undefined) {
        return null;
      }
      if (key === input.snapshotRef.objectKey) {
        return {
          checksums: createWorkspaceSnapshotHeadChecksums(input.snapshotRef),
          customMetadata: createWorkspaceSnapshotHeadMetadata(input.snapshotRef),
          key,
          size: value.byteLength,
        };
      }
      return {
        key,
        size: value.byteLength,
      };
    },
    async put(key: string, value: R2PutValueLike) {
      objects.set(key, await readTestR2PutValue(value));
    },
  };

  return {
    api,
    deleted,
    objects,
  };
}

function createArtifactOnlyWorkspaceBundleForTest(
  sha256: string,
  byteSize: number,
): Uint8Array {
  return Uint8Array.from(
    gzipSync(
      Buffer.from(JSON.stringify({
        files: sha256.length === 0
          ? []
          : [
              {
                artifact: {
                  byteSize,
                  sha256,
                },
                path: "raw/inbox/legacy-audio.m4a",
                root: "vault",
              },
            ],
        kind: "vault",
        schema: "murph.hosted-bundle.v1",
      })),
    ),
  );
}

function createWorkspaceSnapshotBucket(
  get: (key: string) => Promise<{ key: string; size?: number } | null>,
  head?: (key: string) => Promise<{
    checksums?: { sha256: Uint8Array };
    customMetadata?: Record<string, string>;
    key: string;
    size?: number;
  } | null>,
  deleteObject?: (key: string) => Promise<void>,
): RunnerOutboundEnvironmentSource["BUNDLES"] {
  return {
    ...(deleteObject ? { delete: deleteObject } : {}),
    async get(key: string) {
      const object = await get(key);
      if (!object) {
        return null;
      }
      return {
        ...object,
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      };
    },
    ...(head ? { head } : {}),
    async put() {},
  };
}

function createBridgeWorkspaceSnapshotBucket(
  get: (key: string) => Promise<{ key: string; size?: number } | null>,
  head: (key: string) => Promise<{
    checksums?: { sha256: Uint8Array };
    customMetadata?: Record<string, string>;
    key: string;
    size?: number;
  } | null>,
  deleteObject: (key: string) => Promise<void> = async () => {},
): RunnerOutboundEnvironmentSource["BUNDLES"] {
  return {
    ...createWorkspaceSnapshotBucket(get, head, deleteObject),
    async list() {
      return {
        objects: [],
        truncated: false,
      };
    },
  };
}

function createBrowserVaultReplicaWriteRequest(input: {
  replica: unknown;
  replacedReplicaRef?: unknown;
  workspaceVersion: string;
}): Request {
  return new Request("http://browser-vault.worker/replicas", {
    body: JSON.stringify({
      replica: input.replica,
      ...(input.replacedReplicaRef === undefined
        ? {}
        : { replacedReplicaRef: input.replacedReplicaRef }),
    }),
    headers: createRunnerProxyHeaders({
      "content-type": "application/json; charset=utf-8",
      "x-hosted-runtime-attempt-id": "attempt_1",
      "x-hosted-runtime-lease-generation": "9",
      "x-hosted-runtime-workspace-version": input.workspaceVersion,
    }),
    method: "POST",
  });
}

function createBrowserVaultReplica(sourceBundleHash: string) {
  return {
    generatedAt: "2026-04-26T00:00:00.000Z",
    schema: "murph.browser-vault-replica",
    source: {
      dataVersion: "runner-outbound-test",
      sourceBundleHash,
    },
  };
}

function createBrowserVaultReplicaRef(sourceBundleHash: string) {
  return {
    byteLength: 256,
    dataVersion: "runner-outbound-test",
    generatedAt: "2026-04-26T00:00:00.000Z",
    keyId: "browser-key-runner-outbound",
    objectKey: "browser-vault/member-test/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:runner-outbound",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  } as const;
}

function createWorkspaceVersionAwareUserRunner(input: {
  attemptId?: string;
  leaseGeneration?: string;
  privateMediaPublishResult?: HostedPrivateMediaPublishResult;
  requireSnapshotRpcReceiver?: boolean;
  userId?: string;
} = {}) {
  let attemptId = input.attemptId ?? "attempt_1";
  let leaseGeneration = input.leaseGeneration ?? "9";
  const userId = input.userId ?? "member_123";
  let userRunnerStub: WorkerUserRunnerStubLike;
  const workspaceSnapshotUploadSessions = new Map<string, HostedWorkspaceSnapshotUploadSession>();
  const workspaceSnapshotOrphanCandidates = new Map<string, HostedWorkspaceSnapshotOrphanCandidate>();
  const browserVaultReplicaOrphanCandidates = new Map<
    string,
    HostedBrowserVaultReplicaOrphanCandidate
  >();
  let currentWorkspaceSnapshotUploadSessionId: string | null = null;
  const assertSnapshotRpcReceiver = (receiver: WorkerUserRunnerStubLike) => {
    if (
      input.requireSnapshotRpcReceiver === true
      && receiver !== userRunnerStub
    ) {
      throw new Error("Workspace snapshot Durable Object RPC receiver was detached.");
    }
  };
  const bindUser = vi.fn(async (boundUserId: string) => ({ userId: boundUserId }));
  const ownsActiveInvocationLease = vi.fn(async (lease: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }) => {
    if (
      lease.attemptId !== attemptId
      || lease.leaseGeneration !== leaseGeneration
      || lease.userId !== userId
    ) {
      return false;
    }

    return true;
  });
  const createHostedWorkspaceSnapshotUploadSession = vi.fn(async function (
    this: WorkerUserRunnerStubLike,
    session: HostedWorkspaceSnapshotUploadSession,
  ) {
    assertSnapshotRpcReceiver(this);
    if (
      session.attemptId !== attemptId
      || session.leaseGeneration !== leaseGeneration
      || session.userId !== userId
    ) {
      return null;
    }
    if (
      currentWorkspaceSnapshotUploadSessionId
      && currentWorkspaceSnapshotUploadSessionId !== session.snapshotId
    ) {
      workspaceSnapshotUploadSessions.delete(currentWorkspaceSnapshotUploadSessionId);
    }
    workspaceSnapshotUploadSessions.set(session.snapshotId, session);
    currentWorkspaceSnapshotUploadSessionId = session.snapshotId;
    return session;
  });
  const heartbeatHostedWorkspaceSnapshotUploadSession = vi.fn(async function (
    this: WorkerUserRunnerStubLike,
    request: {
      attemptId: string;
      leaseGeneration: string;
      snapshotId: string;
      userId: string;
    },
  ) {
    assertSnapshotRpcReceiver(this);
    const current = workspaceSnapshotUploadSessions.get(request.snapshotId);
    if (
      !current
      || current.attemptId !== request.attemptId
      || current.leaseGeneration !== request.leaseGeneration
      || current.userId !== request.userId
      || request.attemptId !== attemptId
      || request.leaseGeneration !== leaseGeneration
    ) {
      return false;
    }
    workspaceSnapshotUploadSessions.set(current.snapshotId, {
      ...current,
      checkpointHandoffHeartbeatAt: new Date().toISOString(),
    });
    return true;
  });
  const completeHostedWorkspaceSnapshotUploadSession = vi.fn(async function (
    this: WorkerUserRunnerStubLike,
    request: {
      attemptId: string;
      leaseGeneration: string;
      snapshotId: string;
      userId: string;
    },
  ) {
    assertSnapshotRpcReceiver(this);
    const current = workspaceSnapshotUploadSessions.get(request.snapshotId);
    if (
      !current
      || current.attemptId !== request.attemptId
      || current.leaseGeneration !== request.leaseGeneration
      || current.userId !== request.userId
      || request.attemptId !== attemptId
      || request.leaseGeneration !== leaseGeneration
    ) {
      return false;
    }
    const completedAt = new Date().toISOString();
    workspaceSnapshotUploadSessions.set(current.snapshotId, {
      ...current,
      checkpointHandoffCompletedAt: completedAt,
      checkpointHandoffHeartbeatAt: completedAt,
    });
    return true;
  });
  const rememberHostedWorkspaceSnapshotReplacedRef = vi.fn(async function (
    this: WorkerUserRunnerStubLike,
    request: {
      expectedSession: HostedWorkspaceSnapshotUploadSession;
      replacedSnapshotRef: NonNullable<HostedWorkspaceSnapshotUploadSession["replacedSnapshotRef"]>;
    },
  ) {
    assertSnapshotRpcReceiver(this);
    const current = workspaceSnapshotUploadSessions.get(request.expectedSession.snapshotId);
    if (
      !current
      || current.attemptId !== attemptId
      || current.leaseGeneration !== leaseGeneration
      || current.attemptId !== request.expectedSession.attemptId
      || current.leaseGeneration !== request.expectedSession.leaseGeneration
      || current.objectKey !== request.expectedSession.objectKey
      || current.workspaceVersion !== request.expectedSession.workspaceVersion
    ) {
      return false;
    }
    workspaceSnapshotUploadSessions.set(current.snapshotId, {
      ...current,
      replacedSnapshotRef: request.replacedSnapshotRef,
    });
    return true;
  });
  const rememberHostedWorkspaceSnapshotPresignedPut = vi.fn(async function (
    this: WorkerUserRunnerStubLike,
    request: {
      drainUntil: string;
      expectedSession: HostedWorkspaceSnapshotUploadSession;
      expiresAt: string;
    },
  ) {
    assertSnapshotRpcReceiver(this);
    const current = workspaceSnapshotUploadSessions.get(request.expectedSession.snapshotId);
    if (
      !current
      || current.attemptId !== attemptId
      || current.leaseGeneration !== leaseGeneration
      || current.attemptId !== request.expectedSession.attemptId
      || current.leaseGeneration !== request.expectedSession.leaseGeneration
      || current.objectKey !== request.expectedSession.objectKey
      || current.workspaceVersion !== request.expectedSession.workspaceVersion
    ) {
      return null;
    }
    const updatedSession = {
      ...current,
      r2PutDrainUntil: request.drainUntil,
      r2PutExpiresAt: request.expiresAt,
    };
    workspaceSnapshotUploadSessions.set(current.snapshotId, updatedSession);
    return updatedSession;
  });
  const readHostedWorkspaceSnapshotUploadSession = vi.fn(async function (
    this: WorkerUserRunnerStubLike,
    request: {
      snapshotId: string;
      userId: string;
    },
  ) {
    assertSnapshotRpcReceiver(this);
    return workspaceSnapshotUploadSessions.get(request.snapshotId) ?? null;
  });
  const deleteHostedWorkspaceSnapshotUploadSession = vi.fn(async function (
    this: WorkerUserRunnerStubLike,
    request: {
      snapshotId: string;
      userId: string;
    },
  ) {
    assertSnapshotRpcReceiver(this);
    const deleted = workspaceSnapshotUploadSessions.delete(request.snapshotId);
    if (currentWorkspaceSnapshotUploadSessionId === request.snapshotId) {
      currentWorkspaceSnapshotUploadSessionId = null;
    }
    return { deleted };
  });
  const recordHostedWorkspaceSnapshotOrphanCandidate = vi.fn(async (
    candidate: HostedWorkspaceSnapshotOrphanCandidate,
  ) => {
    workspaceSnapshotOrphanCandidates.set(candidate.snapshotId, candidate);
    return candidate;
  });
  const recordHostedBrowserVaultReplicaOrphanCandidate = vi.fn(async (
    candidate: HostedBrowserVaultReplicaOrphanCandidate,
  ) => {
    browserVaultReplicaOrphanCandidates.set(candidate.objectKey, candidate);
    return candidate;
  });
  const validateRuntimeWriteFence = vi.fn(async (fence: {
    attemptId: string;
    generation: string;
    userId: string;
  }) => {
    const owns = await ownsActiveInvocationLease({
      attemptId: fence.attemptId,
      leaseGeneration: fence.generation,
      userId: fence.userId,
    });
    return owns;
  });
  const publishHostedPrivateMedia = vi.fn(async (request: {
    attemptId: string;
    bytes: Uint8Array;
    contentType: "image/jpeg" | "image/png" | "image/webp";
    generation: string;
    userId: string;
  }): Promise<HostedPrivateMediaPublishResult> => {
    const owns = await validateRuntimeWriteFence(request);
    if (!owns) {
      return {
        ok: false,
        reason: "write-fence-rejected",
      };
    }
    return input.privateMediaPublishResult ?? {
      expiresAt: PRIVATE_MEDIA_PUBLISH_EXPIRES_AT,
      ok: true,
      url: PRIVATE_MEDIA_PUBLISH_URL,
    };
  });

  userRunnerStub = {
    bindUser,
    completeHostedWorkspaceSnapshotUploadSession,
    createHostedWorkspaceSnapshotUploadSession,
    deleteHostedWorkspaceSnapshotUploadSession,
    heartbeatHostedWorkspaceSnapshotUploadSession,
    rememberHostedWorkspaceSnapshotPresignedPut,
    rememberHostedWorkspaceSnapshotReplacedRef,
    publishHostedPrivateMedia,
    readHostedWorkspaceSnapshotUploadSession,
    recordHostedBrowserVaultReplicaOrphanCandidate,
    recordHostedWorkspaceSnapshotOrphanCandidate,
    validateRuntimeWriteFence,
  };

  return {
    bindUser,
    browserVaultReplicaOrphanCandidates,
    completeHostedWorkspaceSnapshotUploadSession,
    createHostedWorkspaceSnapshotUploadSession,
    deleteHostedWorkspaceSnapshotUploadSession,
    getByName() {
      return userRunnerStub;
    },
    heartbeatHostedWorkspaceSnapshotUploadSession,
    ownsActiveInvocationLease,
    publishHostedPrivateMedia,
    readHostedWorkspaceSnapshotUploadSession,
    recordHostedBrowserVaultReplicaOrphanCandidate,
    recordHostedWorkspaceSnapshotOrphanCandidate,
    rememberHostedWorkspaceSnapshotPresignedPut,
    rememberHostedWorkspaceSnapshotReplacedRef,
    setActiveWriteFence(input: {
      attemptId: string;
      leaseGeneration: string;
    }) {
      attemptId = input.attemptId;
      leaseGeneration = input.leaseGeneration;
    },
    validateRuntimeWriteFence,
    workspaceSnapshotOrphanCandidates,
    workspaceSnapshotUploadSessions,
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifyLocalS3SigV4QueryUrl(input: {
  accessKeyId: string;
  amzDate: string;
  bucketName: string;
  checksumMode?: typeof HOSTED_R2_CHECKSUM_MODE_ENABLED;
  endpoint: string;
  expiresSeconds: number;
  key: string;
  method: "DELETE" | "HEAD";
  secretAccessKey: string;
  url: URL;
}): void {
  const endpoint = new URL(input.endpoint);
  const canonicalUri = `/${encodeSigV4PathSegment(input.bucketName)}/${encodeSigV4ObjectKey(input.key)}`;
  const credentialScope = `${input.amzDate.slice(0, 8)}/auto/s3/aws4_request`;
  const credential = `${input.accessKeyId}/${credentialScope}`;
  const signedHeaders = [
    "host",
    ...(input.checksumMode === undefined ? [] : [HOSTED_R2_CHECKSUM_MODE_HEADER]),
  ].join(";");
  const expectedQuery = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    "X-Amz-Credential": credential,
    "X-Amz-Date": input.amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  });
  const canonicalQuery = canonicalizeSigV4SearchParams(expectedQuery);
  const canonicalHeaders = [
    `host:${input.url.host}`,
    ...(input.checksumMode === undefined
      ? []
      : [`${HOSTED_R2_CHECKSUM_MODE_HEADER}:${input.checksumMode}`]),
    "",
  ].join("\n");
  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = createHmac("sha256", deriveSigV4SigningKey({
    dateStamp: input.amzDate.slice(0, 8),
    secretAccessKey: input.secretAccessKey,
  })).update(stringToSign).digest("hex");

  expect(input.url.origin).toBe(endpoint.origin);
  expect(input.url.pathname).toBe(canonicalUri);
  expect(input.url.host).toBe(endpoint.host);
  expect(input.url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
  expect(input.url.searchParams.get("X-Amz-Content-Sha256")).toBe("UNSIGNED-PAYLOAD");
  expect(input.url.searchParams.get("X-Amz-Credential")).toBe(credential);
  expect(input.url.searchParams.get("X-Amz-Date")).toBe(input.amzDate);
  expect(input.url.searchParams.get("X-Amz-Expires")).toBe(String(input.expiresSeconds));
  expect(input.url.searchParams.get("X-Amz-SignedHeaders")).toBe(signedHeaders);
  expect(canonicalizeSigV4SearchParamsWithoutSignature(input.url.searchParams)).toBe(canonicalQuery);
  expect(input.url.searchParams.get("X-Amz-Signature")).toBe(signature);
}

function deriveSigV4SigningKey(input: {
  dateStamp: string;
  secretAccessKey: string;
}): Buffer {
  const dateKey = createHmac("sha256", `AWS4${input.secretAccessKey}`).update(input.dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update("auto").digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

function canonicalizeSigV4SearchParamsWithoutSignature(params: URLSearchParams): string {
  const unsignedParams = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (key !== "X-Amz-Signature") {
      unsignedParams.append(key, value);
    }
  }
  return canonicalizeSigV4SearchParams(unsignedParams);
}

function canonicalizeSigV4SearchParams(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${encodeSigV4PathSegment(key)}=${encodeSigV4PathSegment(value)}`)
    .join("&");
}

function encodeSigV4ObjectKey(key: string): string {
  return key.split("/").map(encodeSigV4PathSegment).join("/");
}

function encodeSigV4PathSegment(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/gu, (character) =>
      `%${character.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}`);
}

function createDiagnosticFingerprint(secret: string, value: string): string {
  return createHmac("sha256", secret)
    .update(value)
    .digest("hex")
    .slice(0, 24);
}

function requireTestObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireTestString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function createRunnerOutboundEnv(
  overrides: Partial<RunnerOutboundEnvironmentSource> = {},
): RunnerOutboundEnvironmentSource {
  const values = new Map<string, Uint8Array>();
  const defaultUserRunnerNamespace: WorkerUserRunnerNamespaceLike<WorkerBindUserRunnerStubLike> = {
    getByName() {
      return {
        async bindUser() {
          return { userId: "member_123" };
        },
        async validateRuntimeWriteFence() {
          return true;
        },
      };
    },
  };
  const userRunnerNamespace = overrides.USER_RUNNER ?? defaultUserRunnerNamespace;
  const env = {
    BUNDLES: {
      async delete(key: string) {
        values.delete(key);
      },
      async get(key: string) {
        const value = values.get(key);

        if (value === undefined) {
          return null;
        }

        return {
          async arrayBuffer() {
            return toArrayBuffer(value);
          },
          key,
          size: value.byteLength,
        };
      },
      async head(key: string) {
        const value = values.get(key);
        return value === undefined
          ? null
          : {
              key,
              size: value.byteLength,
            };
      },
      async list(input: { prefix?: string } = {}) {
        const objects = [...values.keys()]
          .filter((key) => input.prefix ? key.startsWith(input.prefix) : true)
          .sort()
          .map((key) => ({ key }));
        return {
          objects,
          truncated: false,
        };
      },
      async put(key: string, value: R2PutValueLike) {
        values.set(key, await readTestR2PutValue(value));
      },
    },
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
      TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
      TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
      TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK_JSON,
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
    HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "r2_access_fixture_test",
    HOSTED_R2_PRESIGN_ACCOUNT_ID: "r2accounttest",
    HOSTED_R2_PRESIGN_BUCKET_NAME: "bundles-test",
    HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "r2_signing_fixture_test",
    HOSTED_WEB_BASE_URL: "https://web.example.test",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"d\":\"HAPljluiFVW3g-UEmrJ9NVYTlclAhaC8N5LT0h7vitQ\",\"ext\":true,\"key_ops\":[\"sign\"]}",
    ...overrides,
  } satisfies Omit<RunnerOutboundEnvironmentSource, "USER_RUNNER">;

  return {
    ...env,
    USER_RUNNER: {
      getByName(userId: string) {
        const stub = userRunnerNamespace.getByName(userId);
        return {
          ...stub,
          async bindUser(boundUserId: string) {
            return stub.bindUser?.(boundUserId) ?? { userId: boundUserId };
          },
          async validateRuntimeWriteFence(input) {
            if (typeof stub.validateRuntimeWriteFence === "function") {
              return await stub.validateRuntimeWriteFence(input);
            }
            const legacyStub = stub as {
              ownsActiveInvocationLease?: (legacyInput: {
                attemptId: string;
                leaseGeneration: string;
                userId: string;
              }) => Promise<boolean>;
            };
            if (typeof legacyStub.ownsActiveInvocationLease === "function") {
              return await legacyStub.ownsActiveInvocationLease({
                attemptId: input.attemptId,
                leaseGeneration: input.generation,
                userId: input.userId,
              });
            }
            return true;
          },
        };
      },
    },
  };
}

function createHostedWorkspaceCheckpointResponse(
  version: string,
  snapshotRef: HostedWorkspaceSnapshotV2Ref | null = null,
) {
  return {
    checkpointed: true,
    workspace: {
      checkpointedAt: "2026-04-26T00:00:05.000Z",
      createdAt: "2026-04-26T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef,
      updatedAt: "2026-04-26T00:00:05.000Z",
      userId: "member_123",
      version,
    },
  };
}

function createHostedWorkspaceCheckpointResponseWithSnapshotRef(
  version: string,
  snapshotRef: unknown,
) {
  const response = createHostedWorkspaceCheckpointResponse(version, null);
  return {
    ...response,
    workspace: {
      ...response.workspace,
      snapshotRef,
    },
  };
}

function createHostedWorkspaceReadResponse(
  snapshotRef: NonNullable<HostedWorkspaceReadResponse["workspace"]>["snapshotRef"] = null,
  version = "4",
): HostedWorkspaceReadResponse {
  return {
    fetchedAt: "2026-04-26T00:00:05.000Z",
    workspace: {
      checkpointedAt: "2026-04-26T00:00:05.000Z",
      createdAt: "2026-04-26T00:00:00.000Z",
      inboxMediaRetentionWakeAt: null,
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef,
      updatedAt: "2026-04-26T00:00:05.000Z",
      userId: "member_123",
      version,
    },
  };
}

function createHostedWorkspaceReadFetchResponse(
  snapshotRef: NonNullable<HostedWorkspaceReadResponse["workspace"]>["snapshotRef"] = null,
  version = "4",
): Response {
  return new Response(JSON.stringify(createHostedWorkspaceReadResponse(snapshotRef, version)), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status: 200,
  });
}

function isHostedWorkspaceReadFetch(args: Parameters<typeof fetch>): boolean {
  const [request, init] = args;
  const url = request instanceof Request ? request.url : String(request);
  const method = init?.method ?? (request instanceof Request ? request.method : "GET");
  return url === `https://web.example.test${HOSTED_RUNTIME_WORKSPACE_PATH}` && method === "GET";
}

function createWorkspaceSnapshotCompleteWebFetchMock(input: {
  currentSnapshotRef?: NonNullable<HostedWorkspaceReadResponse["workspace"]>["snapshotRef"];
  currentWorkspaceVersion?: string;
  onWorkspaceRead?(): Promise<void> | void;
  onCheckpoint(args: Parameters<typeof fetch>): Promise<Response> | Response;
}): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (...args: Parameters<typeof fetch>): Promise<Response> => {
    if (isHostedWorkspaceReadFetch(args)) {
      await input.onWorkspaceRead?.();
      return createHostedWorkspaceReadFetchResponse(
        input.currentSnapshotRef ?? null,
        input.currentWorkspaceVersion ?? "4",
      );
    }
    return await input.onCheckpoint(args);
  });
}

function readTestFetchBodyObject(
  args: Parameters<typeof fetch>,
  label: string,
): Record<string, unknown> {
  const init = args[1];
  if (!init || typeof init !== "object" || !("body" in init)) {
    throw new TypeError(`${label} fetch init must include a body.`);
  }
  return requireTestObject(JSON.parse(String(init.body)), label);
}

function createDirectRunnerOutboundEnv(
  overrides: Partial<RunnerOutboundEnvironmentSource>,
): RunnerOutboundEnvironmentSource {
  return {
    ...createRunnerOutboundEnv(),
    ...overrides,
  };
}

async function createHostedRuntimeCryptoContextFixture(input: {
  authoritySignKeyVersion?: string;
  automationKeyId?: string;
  cacheMaxAgeMs?: number;
  cryptoContextVersion?: string;
  cryptoEnv?: string;
  fetchedAt?: string;
  ingressRootKeyId?: string;
  runtimeRootKeyId?: string;
  userId?: string;
} = {}): Promise<{
  context: {
    cacheMaxAgeMs?: number;
    cryptoContextVersion?: string;
    envelopes: {
      ingress: HostedDomainRootKeyEnvelopeV1;
      runtime: HostedDomainRootKeyEnvelopeV1;
    };
    fetchedAt?: string;
    schema: "murph.hosted-runtime-crypto-context.v1";
    userId: string;
  };
  env: Partial<RunnerOutboundEnvironmentSource>;
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
}> {
  const userId = input.userId ?? "member_123";
  const authoritySignKeyVersion = input.authoritySignKeyVersion
    ?? "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
  const automationKeyId = input.automationKeyId ?? "cf-key-v1";
  const cacheMaxAgeMs = input.cacheMaxAgeMs ?? 60_000;
  const cryptoContextVersion = input.cryptoContextVersion ?? "ctx-v1";
  const cryptoEnv = input.cryptoEnv ?? "test";
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const context = {
    cacheMaxAgeMs,
    cryptoContextVersion,
    envelopes: {
      ingress: await createSignedWorkerEnvelope({
        authoritySignKeyVersion,
        cryptoEnv,
        domain: "ingress",
        publicJwk: cloudflareRecipient.publicJwk,
        recipientKeyId: automationKeyId,
        rootKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
        rootKeyId: input.ingressRootKeyId,
        signer: signer.privateKey,
        userId,
      }),
      runtime: await createSignedWorkerEnvelope({
        authoritySignKeyVersion,
        cryptoEnv,
        domain: "runtime",
        publicJwk: cloudflareRecipient.publicJwk,
        recipientKeyId: automationKeyId,
        rootKey: Uint8Array.from({ length: 32 }, (_, index) => 101 + index),
        rootKeyId: input.runtimeRootKeyId,
        signer: signer.privateKey,
        userId,
      }),
    },
    fetchedAt,
    schema: "murph.hosted-runtime-crypto-context.v1" as const,
    userId,
  };
  const fetchMock = vi.fn<typeof fetch>(async (
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    const [url, init] = args;
    assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`);
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-hosted-execution-user-id"), userId);
    return new Response(JSON.stringify(context), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    });
  });

  return {
    context,
    env: {
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: authoritySignKeyVersion,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/g, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: automationKeyId,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: cryptoEnv,
    },
    fetchMock,
  };
}

async function createSignedWorkerEnvelope(input: {
  authoritySignKeyVersion?: string;
  cryptoEnv?: string;
  domain: "ingress" | "runtime";
  publicJwk: JsonWebKey;
  recipientKeyId?: string;
  rootKey: Uint8Array;
  rootKeyId?: string;
  signer: CryptoKey;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  const authoritySignKeyVersion = input.authoritySignKeyVersion
    ?? "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
  const cryptoEnv = input.cryptoEnv ?? "test";
  const recipientKeyId = input.recipientKeyId ?? "cf-key-v1";
  const rootKeyId = input.rootKeyId ?? `udrk:${input.domain}:test-root`;
  const now = "2026-05-01T00:00:00.000Z";
  const wrap = await wrapHostedDomainRootKeyWithP256Ecdh({
    encryptionContext: buildHostedDomainRootWrapContext({
      domain: input.domain,
      env: cryptoEnv,
      recipient: "cloudflare-automation-secret",
      rootKeyId,
      userId: input.userId,
    }),
    recipient: "cloudflare-automation-secret",
    recipientKeyId,
    recipientPublicJwk: input.publicJwk,
    rootKey: input.rootKey,
  });
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: now,
    domain: input.domain,
    generation: 1,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: now,
    userId: input.userId,
    wraps: [wrap],
  };
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    input.signer,
    toArrayBuffer(buildHostedDomainRootEnvelopeSigningPayload(body)),
  );
  return attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: authoritySignKeyVersion,
    signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
    signedAt: now,
  });
}

async function generateP256EcdhKeyPair(): Promise<{
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
  };
}

async function generateP256SigningKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKeyPem: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: keyPair.privateKey,
    publicKeyPem: toSpkiPem(await crypto.subtle.exportKey("spki", keyPair.publicKey)),
  };
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

async function readTestR2PutValue(value: R2PutValueLike): Promise<Uint8Array> {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ));
  }
  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }

  const chunks: Uint8Array[] = [];
  const reader = value.getReader();
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      chunks.push(result.value);
      byteLength += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function toSpkiPem(value: ArrayBuffer): string {
  const base64 = Buffer.from(new Uint8Array(value)).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}
