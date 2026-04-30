import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import { describe, it } from "vitest";

import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";
import {
  prepareHostedSystemMailboxItemForCheckpoint,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const FIXED_NOW = "2026-04-21T00:00:00.000Z";

type HostedSystemMailboxRuntimeForTest =
  Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0]["runtime"];

describe("hosted system mailbox checkpoint records", () => {
  it("fails closed when old serialized share-import pending records are restored", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");

    try {
      const statePath = path.join(
        resolveAssistantStatePaths(workspace.vaultRoot).assistantStateRoot,
        "hosted-system-mailbox.json",
      );
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify({
        schema: "murph.hosted-system-mailbox-state.v1",
        schemaVersion: 1,
        value: {
          pending: [{
            attemptCount: 0,
            itemId: "mailbox_item_legacy_share",
            lastAttemptAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            mailboxDedupeKey: "event_share_accepted_123",
            nextAttemptAt: null,
            occurredAt: FIXED_NOW,
            postCheckpointRecord: {
              kind: "share-import",
              request: {
                eventId: "event_share_accepted_123",
                importedAt: FIXED_NOW,
                ownerUserId: "member_sender",
                shareId: "share_123",
                status: "quarantined",
              },
            },
            requestId: null,
            routeAction: "import-vault-share",
            status: "recording",
            wake: {
              eventId: "event_share_accepted_123",
              kind: "vault.share.accepted",
              occurredAt: FIXED_NOW,
              share: {
                ownerUserId: "member_sender",
                shareId: "share_123",
              },
              userId: "member_123",
            },
          }],
        },
      }), "utf8");

      await assert.rejects(
        prepareHostedSystemMailboxItemForCheckpoint({
          now: () => FIXED_NOW,
          runtime: createRuntime({}),
          runtimeEnv: {},
          vaultRoot: workspace.vaultRoot,
        }),
        /legacy share-import pending state is unsupported/u,
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("fails closed when old serialized vault-sync pending records are restored", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");

    try {
      const statePath = path.join(
        resolveAssistantStatePaths(workspace.vaultRoot).assistantStateRoot,
        "hosted-system-mailbox.json",
      );
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify({
        schema: "murph.hosted-system-mailbox-state.v1",
        schemaVersion: 1,
        value: {
          pending: [{
            attemptCount: 0,
            itemId: "mailbox_item_legacy_import",
            lastAttemptAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            mailboxDedupeKey: "vault-sync-session-123",
            nextAttemptAt: null,
            occurredAt: FIXED_NOW,
            postCheckpointRecord: null,
            requestId: null,
            routeAction: "import-vault-sync",
            status: "pending",
            wake: {
              eventId: "event_member_channels_123",
              kind: "member.channels.updated",
              memberChannels: {
                email: true,
                linq: false,
                telegram: true,
              },
              occurredAt: FIXED_NOW,
              userId: "member_123",
            },
          }],
        },
      }), "utf8");

      await assert.rejects(
        prepareHostedSystemMailboxItemForCheckpoint({
          now: () => FIXED_NOW,
          runtime: createRuntime({}),
          runtimeEnv: {},
          vaultRoot: workspace.vaultRoot,
        }),
        /routeAction is invalid/u,
      );
    } finally {
      await workspace.cleanup();
    }
  });

});

function createRuntime(
  platformOverrides: Partial<HostedRuntimePlatform>,
): HostedSystemMailboxRuntimeForTest {
  const platform: HostedRuntimePlatform = {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {},
    },
    ...platformOverrides,
  };

  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform,
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}
