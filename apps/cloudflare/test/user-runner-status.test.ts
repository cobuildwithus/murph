import { afterEach, describe, expect, it, vi } from "vitest";

import { HOSTED_RUNTIME_STATUS_PATH } from "@murphai/hosted-execution/routes";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import { HostedUserRunner } from "../src/user-runner.ts";
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
    vi.clearAllMocks();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  it("reports mailbox lag with deferred checkpoint overlay", async () => {
    const { runner, sql } = createRunnerStatusHarness();
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
    sql.exec(
      `UPDATE runner_meta
       SET deferred_checkpoint_required = 1,
           deferred_checkpoint_mailbox_status_json = ?
       WHERE user_id = ?`,
      JSON.stringify({
        importedConversationSeq: "999",
        hostedMailboxConversationImportedSeq: "0",
        hostedMailboxSystemImportedSeq: "2",
        systemImportedSeq: "999",
      }),
      "member_123",
    );

    await expect(runner.runnerStatus()).resolves.toMatchObject({
      mailboxLag: [
        {
          importedSeq: "2",
          lag: "0",
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

  it("reports workspace mailbox status with deferred checkpoint overlay", async () => {
    const { runner, sql } = createRunnerStatusHarness();
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
    sql.exec(
      `UPDATE runner_meta
       SET deferred_checkpoint_required = 1,
           deferred_checkpoint_mailbox_status_json = ?
       WHERE user_id = ?`,
      JSON.stringify({
        hostedMailboxConversationImportedSeq: "586",
        hostedMailboxSystemImportedSeq: "0",
      }),
      "member_123",
    );

    await expect(runner.runnerStatus()).resolves.toMatchObject({
      mailboxLag: [
        {
          importedSeq: "1",
          lag: "0",
          lane: "system",
          maxSeq: "1",
        },
        {
          importedSeq: "586",
          lag: "0",
          lane: "conversation",
          maxSeq: "586",
        },
      ],
      userId: "member_123",
      workspace: {
        redactedStatus: {
          hostedMailboxConversationImportedSeq: "586",
          hostedMailboxSystemImportedSeq: "1",
          hostedRuntimeOtherStatus: "preserved",
        },
      },
    });
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
    { storage },
    readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    })),
    new MemoryEncryptedR2Bucket(),
  );

  return {
    runner,
    sql,
  };
}
