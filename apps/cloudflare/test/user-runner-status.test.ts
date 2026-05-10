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

  it("reports mailbox lag from deferred checkpoint redacted status", async () => {
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
});

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
