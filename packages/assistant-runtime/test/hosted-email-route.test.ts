import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";

import {
  resolveRuntimePaths,
} from "@murphai/runtime-state/node";
import { reconcileHostedVerifiedEmailSelfTarget } from "../src/hosted-email-route.ts";
import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

test("hosted email route reconciliation saves the email self-target from hosted sender env without inbox config", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace(
    "hosted-runner-email-route-",
  );

  try {
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
    await cleanup();
  }
});

test("hosted email route reconciliation uses the hosted sender address instead of a local inbox connector identity", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace(
    "hosted-runner-email-route-",
  );

  try {
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
    await cleanup();
  }
});

test("hosted email route reconciliation becomes a no-op when the saved target already matches", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace(
    "hosted-runner-email-route-",
  );

  try {
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
      selfTargetUpdated: false,
      status: "unchanged",
    });
  } finally {
    await cleanup();
  }
});

test("hosted email route reconciliation stays private when no hosted sender identity is configured", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace(
    "hosted-runner-email-route-",
  );

  try {
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
      selfTargetUpdated: false,
      status: "missing-sender-identity",
    });
    await assert.rejects(readFile(path.join(operatorHomeRoot, ".murph", "config.json"), "utf8"));
  } finally {
    await cleanup();
  }
});
