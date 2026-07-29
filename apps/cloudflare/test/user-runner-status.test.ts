import { afterEach, describe, expect, it, vi } from "vitest";

import { HOSTED_RUNTIME_STATUS_PATH } from "@murphai/hosted-execution/routes";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
import {
  RunnerStateStore,
  type RunnerWriteFenceToken,
} from "../src/user-runner/runner-state-store.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createTestSqlStorage } from "./sql-storage.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

const mocks = vi.hoisted(() => ({
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
}));

vi.mock("../src/web-control-plane.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/web-control-plane.ts")>(
    "../src/web-control-plane.ts",
  );

  return {
    ...actual,
    fetchHostedExecutionWebControlPlaneResponse:
      mocks.fetchHostedExecutionWebControlPlaneResponse,
  };
});

describe("HostedUserRunner status", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  it("reports mailbox lag from the hosted runtime status", async () => {
    const { runner } = createRunnerStatusHarness();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(async (input: {
      boundUserId?: string;
      path: string;
    }) => {
      expect(input.path).toBe(HOSTED_RUNTIME_STATUS_PATH);
      expect(input.boundUserId).toBe("member_123");
      return Response.json({
        mailboxLag: [
          {
            importedSeq: "0",
            lag: "2",
            lane: "system",
            maxSeq: "2",
          },
          {
            importedSeq: "0",
            lag: "0",
            lane: "conversation",
            maxSeq: "0",
          },
        ],
        userId: "member_123",
        workspace: null,
      });
    });
    await runner.bindUser("member_123");

    await expect(runner.runnerStatus()).resolves.toMatchObject({
      mailboxLag: [
        {
          importedSeq: "0",
          lag: "2",
          lane: "system",
          maxSeq: "2",
        },
        {
          importedSeq: "0",
          lag: "0",
          lane: "conversation",
          maxSeq: "0",
        },
      ],
      userId: "member_123",
      workspace: null,
    });
  });

  it("forwards an explicit zero diagnostic limit to the web status route", async () => {
    const { runner } = createRunnerStatusHarness();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(async (input: {
      search?: string | null;
    }) => {
      expect(input.search).toBe("?logLimit=0");
      return Response.json({
        mailboxLag: [],
        recentLogs: [],
        userId: "member_123",
        workspace: null,
      });
    });
    await runner.bindUser("member_123");

    await expect(runner.runnerStatus({ logLimit: 0 })).resolves.toMatchObject({
      mailboxLag: [],
      userId: "member_123",
      workspace: null,
    });
  });

  it("reports workspace mailbox status from the hosted runtime status", async () => {
    const { runner } = createRunnerStatusHarness();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(async (input: {
      boundUserId?: string;
      path: string;
    }) => {
      expect(input.path).toBe(HOSTED_RUNTIME_STATUS_PATH);
      expect(input.boundUserId).toBe("member_123");
      return Response.json({
        mailboxLag: [
          {
            importedSeq: "1",
            lag: "0",
            lane: "system",
            maxSeq: "1",
          },
          {
            importedSeq: "585",
            lag: "1",
            lane: "conversation",
            maxSeq: "586",
          },
        ],
        userId: "member_123",
        workspace: createWorkspace({
          redactedStatus: {
            hostedMailboxConversationImportedSeq: "585",
            hostedMailboxSystemImportedSeq: "1",
            hostedRuntimeOtherStatus: "preserved",
          },
        }),
      });
    });
    await runner.bindUser("member_123");

    await expect(runner.runnerStatus()).resolves.toMatchObject({
      mailboxLag: [
        {
          importedSeq: "1",
          lag: "0",
          lane: "system",
          maxSeq: "1",
        },
        {
          importedSeq: "585",
          lag: "1",
          lane: "conversation",
          maxSeq: "586",
        },
      ],
      userId: "member_123",
      workspace: {
        redactedStatus: {
          hostedMailboxConversationImportedSeq: "585",
          hostedMailboxSystemImportedSeq: "1",
          hostedRuntimeOtherStatus: "preserved",
        },
      },
    });
  });

  it("derives the public status contract from the current write fence and diagnostics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
    const { runner, stateStore } = createRunnerStatusHarness();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(async () =>
      Response.json({
        mailboxLag: [],
        userId: "member_123",
        workspace: null,
      })
    );
    const token = await stateStore.beginWriteFence({
      runnerContainerName: "member_123",
      userId: "member_123",
    });

    const activeStatus = await runner.runnerStatus() as Awaited<
      ReturnType<HostedUserRunner["runnerStatus"]>
    > & {
      activeWriteFence: RunnerWriteFenceToken | null;
    };
    expect(activeStatus).toMatchObject({
      activeWriteFence: {
        attemptId: token.attemptId,
        expiresAt: null,
        generation: token.generation,
        userId: "member_123",
      },
      inFlight: true,
      mailboxLag: [],
      nextAlarmAt: null,
      userId: "member_123",
      workspace: null,
    });

    await stateStore.clearWriteFenceAfterTransportFailure({
      error: new Error("runner transport failed"),
      finishedAt: "2026-04-27T00:00:05.000Z",
      token,
    });
    await expect(runner.runnerStatus()).resolves.toMatchObject({
      inFlight: false,
      lastErrorAt: "2026-04-27T00:00:05.000Z",
      lastErrorCode: expect.any(String),
      nextAlarmAt: null,
    });

    const replacement = await stateStore.beginWriteFence({
      runnerContainerName: "member_123",
      userId: "member_123",
    });
    await stateStore.clearWriteFenceAfterCompletion({
      finishedAt: "2026-04-27T00:00:10.000Z",
      token: replacement,
    });
    const completedStatus = await runner.runnerStatus();
    expect(completedStatus).toMatchObject({
      inFlight: false,
      lastInvocationAt: "2026-04-27T00:00:10.000Z",
      nextAlarmAt: null,
    });
    expect(completedStatus).not.toHaveProperty("lastErrorAt");
    expect(completedStatus).not.toHaveProperty("lastErrorCode");
  });
});

function createWorkspace(input: {
  redactedStatus: Record<string, unknown> | null;
}) {
  return {
    createdAt: "2026-04-27T00:00:00.000Z",
    redactedStatus: input.redactedStatus,
    snapshotRef: null,
    updatedAt: "2026-04-27T00:00:00.000Z",
    userId: "member_123",
    version: "1876",
  };
}

function createRunnerStatusHarness() {
  const sql = createTestSqlStorage();
  const values = new Map<string, unknown>();
  const storage = {
    async delete(key: string) {
      return values.delete(key);
    },
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async getAlarm() {
      return null;
    },
    async put<T>(key: string, value: T) {
      values.set(key, value);
    },
    async setAlarm() {},
    sql,
  };
  const runner = new HostedUserRunner(
    { storage, waitUntil() {} },
    readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    })),
    new MemoryEncryptedR2Bucket(),
  );

  return {
    runner,
    sql,
    stateStore: new RunnerStateStore({ storage, waitUntil() {} }),
  };
}
