import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  resolveAssistantStatePaths,
  resolveRuntimePaths,
} from "@murph/runtime-state/node";
import { reconcileHostedVerifiedEmailSelfTarget } from "../src/hosted-email-route.ts";

test("hosted email route reconciliation saves the email self-target from hosted sender env without inbox config", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-email-route-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    await mkdir(vaultRoot, { recursive: true });

    const result = await reconcileHostedVerifiedEmailSelfTarget({
      operatorHomeRoot,
      source: {
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_LOCAL_PART: "assistant",
        HOSTED_USER_VERIFIED_EMAIL: "user@example.com",
        HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT: "2026-03-27T08:30:00.000Z",
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      emailAddress: "user@example.com",
      identityId: "assistant@mail.example.test",
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
        identityId: "assistant@mail.example.test",
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

test("hosted email route reconciliation uses the hosted sender address instead of a local inbox connector identity", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-email-route-"));

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
            accountId: "local-connector@agentmail.example",
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
        HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
        HOSTED_USER_VERIFIED_EMAIL: "user@example.com",
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      emailAddress: "user@example.com",
      identityId: "assistant@mail.example.test",
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
        identityId: "assistant@mail.example.test",
        participantId: "user@example.com",
        sourceThreadId: null,
      },
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted email route reconciliation becomes a no-op when the saved target already matches", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-email-route-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    await mkdir(vaultRoot, { recursive: true });

    await reconcileHostedVerifiedEmailSelfTarget({
      operatorHomeRoot,
      source: {
        HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
        HOSTED_USER_VERIFIED_EMAIL: "user@example.com",
      },
      vaultRoot,
    });
    const result = await reconcileHostedVerifiedEmailSelfTarget({
      operatorHomeRoot,
      source: {
        HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
        HOSTED_USER_VERIFIED_EMAIL: "user@example.com",
      },
      vaultRoot,
    });

    assert.deepEqual(result, {
      emailAddress: "user@example.com",
      identityId: "assistant@mail.example.test",
      preferredChannelsUpdated: false,
      selfTargetUpdated: false,
      status: "unchanged",
    });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted email route reconciliation stays private when no hosted sender identity is configured", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-email-route-"));

  try {
    const operatorHomeRoot = path.join(workspaceRoot, "home");
    const vaultRoot = path.join(workspaceRoot, "vault");
    await mkdir(vaultRoot, { recursive: true });

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
      status: "missing-sender-identity",
    });
    await assert.rejects(readFile(path.join(operatorHomeRoot, ".murph", "config.json"), "utf8"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
