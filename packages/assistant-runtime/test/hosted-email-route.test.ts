import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  resolveAssistantStatePaths,
  resolveRuntimePaths,
} from "@murph/runtime-state";
import { reconcileHostedVerifiedEmailSelfTarget } from "../src/hosted-email-route.ts";

test("hosted email route reconciliation saves the email self-target and prefers the AgentMail connector", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-email-route-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    const runtimePaths = resolveRuntimePaths(vaultRoot);
    await mkdir(path.dirname(runtimePaths.inboxConfigPath), { recursive: true });
    await writeFile(
      runtimePaths.inboxConfigPath,
      `${JSON.stringify({
        version: 1,
        connectors: [
          {
            accountId: "fallback@agentmail.to",
            enabled: true,
            id: "email:secondary",
            options: {},
            source: "email",
          },
          {
            accountId: "murph@agentmail.to",
            enabled: true,
            id: "email:agentmail",
            options: {},
            source: "email",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await reconcileHostedVerifiedEmailSelfTarget({
      operatorHomeRoot,
      source: {
        HOSTED_USER_VERIFIED_EMAIL: "user@example.com",
        HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT: "2026-03-27T08:30:00.000Z",
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      emailAddress: "user@example.com",
      identityId: "murph@agentmail.to",
      preferredChannelsUpdated: true,
      selfTargetUpdated: true,
      status: "saved",
    });
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(operatorHomeRoot, ".murph", "config.json"), "utf8"),
      ).assistant.selfDeliveryTargets.email,
      {
        channel: "email",
        deliveryTarget: "user@example.com",
        identityId: "murph@agentmail.to",
        participantId: "user@example.com",
        sourceThreadId: null,
      },
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(resolveAssistantStatePaths(vaultRoot).automationPath, "utf8"),
      ).preferredChannels,
      ["email"],
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted email route reconciliation becomes a no-op when the saved target already matches", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-email-route-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    const runtimePaths = resolveRuntimePaths(vaultRoot);
    await mkdir(path.dirname(runtimePaths.inboxConfigPath), { recursive: true });
    await writeFile(
      runtimePaths.inboxConfigPath,
      `${JSON.stringify({
        version: 1,
        connectors: [
          {
            accountId: "murph@agentmail.to",
            enabled: true,
            id: "email:agentmail",
            options: {},
            source: "email",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    await reconcileHostedVerifiedEmailSelfTarget({
      operatorHomeRoot,
      source: {
        HOSTED_USER_VERIFIED_EMAIL: "user@example.com",
      },
      vaultRoot,
    });
    const result = await reconcileHostedVerifiedEmailSelfTarget({
      operatorHomeRoot,
      source: {
        HOSTED_USER_VERIFIED_EMAIL: "user@example.com",
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      emailAddress: "user@example.com",
      identityId: "murph@agentmail.to",
      preferredChannelsUpdated: false,
      selfTargetUpdated: false,
      status: "unchanged",
    });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted email route reconciliation stays private when no usable email connector exists", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-email-route-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    const runtimePaths = resolveRuntimePaths(vaultRoot);
    await mkdir(path.dirname(runtimePaths.inboxConfigPath), { recursive: true });
    await writeFile(
      runtimePaths.inboxConfigPath,
      `${JSON.stringify({
        version: 1,
        connectors: [
          {
            accountId: "self",
            enabled: true,
            id: "telegram:bob",
            options: {},
            source: "telegram",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await reconcileHostedVerifiedEmailSelfTarget({
      operatorHomeRoot,
      source: {
        HOSTED_USER_VERIFIED_EMAIL: "user@example.com",
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      emailAddress: "user@example.com",
      identityId: null,
      preferredChannelsUpdated: false,
      selfTargetUpdated: false,
      status: "missing-email-connector",
    });
    await assert.rejects(readFile(path.join(operatorHomeRoot, ".murph", "config.json"), "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted email route reconciliation stays private when multiple enabled email connectors exist without the hosted preferred id", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-email-route-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    const runtimePaths = resolveRuntimePaths(vaultRoot);
    await mkdir(path.dirname(runtimePaths.inboxConfigPath), { recursive: true });
    await writeFile(
      runtimePaths.inboxConfigPath,
      `${JSON.stringify({
        version: 1,
        connectors: [
          {
            accountId: "first@example.test",
            enabled: true,
            id: "email:first",
            options: {},
            source: "email",
          },
          {
            accountId: "second@example.test",
            enabled: true,
            id: "email:second",
            options: {},
            source: "email",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await reconcileHostedVerifiedEmailSelfTarget({
      operatorHomeRoot,
      source: {
        HOSTED_USER_VERIFIED_EMAIL: "user@example.com",
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      emailAddress: "user@example.com",
      identityId: null,
      preferredChannelsUpdated: false,
      selfTargetUpdated: false,
      status: "ambiguous-email-connectors",
    });
    await assert.rejects(readFile(path.join(operatorHomeRoot, ".murph", "config.json"), "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
