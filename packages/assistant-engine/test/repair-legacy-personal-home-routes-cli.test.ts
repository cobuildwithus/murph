import { rm } from "node:fs/promises";

import {
  initializeVault,
  showAutomation,
  upsertAutomation,
} from "@murphai/core";
import { afterEach, describe, expect, it } from "vitest";

import { upsertAssistantInputEvent } from "../src/assistant/input-store.ts";
import {
  parseLegacyPersonalHomeRouteRepairArgs,
  repairLegacyPersonalHomeAutomationRoutesFromInputs,
} from "../src/assistant/repair-legacy-personal-home-routes-cli.ts";
import { createTempVaultContext } from "./test-helpers.ts";

const tempRoots: string[] = [];
let evidenceOrdinal = 0;

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

async function createVaultRoot(): Promise<string> {
  const context = await createTempVaultContext("murph-legacy-route-repair-cli-");
  tempRoots.push(context.parentRoot);
  await initializeVault({ vaultRoot: context.vaultRoot });
  return context.vaultRoot;
}

async function stageLinqRouteEvidence(input: {
  actorIsSelf?: boolean;
  deliveryTarget: string;
  threadIsDirect: boolean;
  vaultRoot: string;
}): Promise<string> {
  evidenceOrdinal += 1;
  const ordinal = String(evidenceOrdinal);
  const event = await upsertAssistantInputEvent({
    vault: input.vaultRoot,
    event: {
      content: { text: "Stored route authority evidence." },
      conversation: {
        accountId: "linq-account",
        actorId: "member-actor",
        actorIsSelf: input.actorIsSelf ?? false,
        source: "linq",
        threadId: `blinded-thread-${ordinal}`,
        threadIsDirect: input.threadIsDirect,
      },
      occurredAt: `2026-07-10T12:00:${ordinal.padStart(2, "0")}.000Z`,
      replyTarget: {
        channel: "linq",
        messageId: `message-${ordinal}`,
        threadId: input.deliveryTarget,
      },
      sourceMetadata: {
        kind: "linq",
        partCount: 1,
        reactionEligible: false,
        replyToMessageId: null,
        senderHandle: null,
        service: "imessage",
      },
      sourceRef: {
        dedupeKey: `route-evidence-${ordinal}`,
        eventId: `route-event-${ordinal}`,
        itemId: `route-item-${ordinal}`,
        kind: "hosted-mailbox",
        lane: "conversation",
        laneSeq: ordinal,
        payloadSchema: "hosted-mailbox-item-v1",
        payloadSource: "inline",
        source: "hosted-mailbox",
        wakeSchema: "hosted-workspace-wake-v1",
      },
    },
  });
  return event.inputId;
}

async function seedLegacyAutomation(input: {
  automationId: string;
  deliveryTarget: string;
  slug: string;
  vaultRoot: string;
}): Promise<void> {
  await upsertAutomation({
    automationId: input.automationId,
    continuityPolicy: "fresh",
    instructions: "Send the saved reminder.",
    now: new Date("2026-07-10T12:00:00.000Z"),
    route: {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: input.deliveryTarget,
      identityId: null,
      participantId: null,
      threadId: null,
    },
    schedule: { kind: "dailyLocal", localTime: "09:00" },
    slug: input.slug,
    status: "active",
    summary: null,
    tags: ["assistant", "scheduled"],
    title: input.slug,
    vaultRoot: input.vaultRoot,
  });
}

describe("parseLegacyPersonalHomeRouteRepairArgs", () => {
  it("requires explicit apply and exact input IDs", () => {
    expect(() =>
      parseLegacyPersonalHomeRouteRepairArgs([
        "--vault-root",
        "/tmp/vault",
        "--input-id",
        "input_1",
      ])
    ).toThrow("--apply is required");
    expect(() =>
      parseLegacyPersonalHomeRouteRepairArgs([
        "--vault-root",
        "/tmp/vault",
        "--apply",
      ])
    ).toThrow("at least one --input-id is required");
  });

  it("deduplicates audited input IDs without changing their order", () => {
    expect(
      parseLegacyPersonalHomeRouteRepairArgs([
        "--vault-root",
        "/tmp/vault",
        "--input-id",
        "input_1",
        "--input-id",
        "input_1",
        "--input-id",
        "input_2",
        "--apply",
      ]),
    ).toEqual({
      apply: true,
      help: false,
      inputIds: ["input_1", "input_2"],
      vaultRoot: "/tmp/vault",
    });
  });

  it("allows help without mutation arguments", () => {
    expect(parseLegacyPersonalHomeRouteRepairArgs(["--", "--help"])).toEqual({
      apply: false,
      help: true,
      inputIds: [],
      vaultRoot: "",
    });
  });
});

describe("repairLegacyPersonalHomeAutomationRoutesFromInputs", () => {
  it("repairs only the route proven by an exact retained direct-Linq input", async () => {
    const vaultRoot = await createVaultRoot();
    await seedLegacyAutomation({
      automationId: "automation_01KZ0000000000000000000101",
      deliveryTarget: "legacy-home-chat",
      slug: "proven-route",
      vaultRoot,
    });
    await seedLegacyAutomation({
      automationId: "automation_01KZ0000000000000000000102",
      deliveryTarget: "other-home-chat",
      slug: "unproven-route",
      vaultRoot,
    });
    const inputId = await stageLinqRouteEvidence({
      deliveryTarget: "legacy-home-chat",
      threadIsDirect: true,
      vaultRoot,
    });

    await expect(repairLegacyPersonalHomeAutomationRoutesFromInputs({
      inputIds: [inputId],
      now: new Date("2026-07-10T12:05:00.000Z"),
      vaultRoot,
    })).resolves.toBe(1);

    await expect(showAutomation({
      automationId: "automation_01KZ0000000000000000000101",
      vaultRoot,
    })).resolves.toMatchObject({
      route: { currentRouteSnapshot: true, threadIsDirect: true },
    });
    const unproven = await showAutomation({
      automationId: "automation_01KZ0000000000000000000102",
      vaultRoot,
    });
    expect(unproven?.route).not.toHaveProperty("currentRouteSnapshot");
    expect(unproven?.route).not.toHaveProperty("threadIsDirect");
  });

  it("rejects the whole request before mutation when any input is not direct", async () => {
    const vaultRoot = await createVaultRoot();
    await seedLegacyAutomation({
      automationId: "automation_01KZ0000000000000000000103",
      deliveryTarget: "legacy-home-chat",
      slug: "atomic-evidence-route",
      vaultRoot,
    });
    const directInputId = await stageLinqRouteEvidence({
      deliveryTarget: "legacy-home-chat",
      threadIsDirect: true,
      vaultRoot,
    });
    const groupInputId = await stageLinqRouteEvidence({
      deliveryTarget: "group-chat",
      threadIsDirect: false,
      vaultRoot,
    });

    await expect(repairLegacyPersonalHomeAutomationRoutesFromInputs({
      inputIds: [directInputId, groupInputId],
      vaultRoot,
    })).rejects.toThrow(
      "Every supplied input must be retained direct-Linq route evidence.",
    );
    const record = await showAutomation({
      automationId: "automation_01KZ0000000000000000000103",
      vaultRoot,
    });
    expect(record?.route).not.toHaveProperty("currentRouteSnapshot");
    expect(record?.route).not.toHaveProperty("threadIsDirect");
  });

  it("rejects self-authored Linq evidence before mutation", async () => {
    const vaultRoot = await createVaultRoot();
    await seedLegacyAutomation({
      automationId: "automation_01KZ0000000000000000000104",
      deliveryTarget: "legacy-home-chat",
      slug: "self-authored-evidence-route",
      vaultRoot,
    });
    const selfAuthoredInputId = await stageLinqRouteEvidence({
      actorIsSelf: true,
      deliveryTarget: "legacy-home-chat",
      threadIsDirect: true,
      vaultRoot,
    });

    await expect(repairLegacyPersonalHomeAutomationRoutesFromInputs({
      inputIds: [selfAuthoredInputId],
      vaultRoot,
    })).rejects.toThrow(
      "Every supplied input must be retained direct-Linq route evidence.",
    );
    const record = await showAutomation({
      automationId: "automation_01KZ0000000000000000000104",
      vaultRoot,
    });
    expect(record?.route).not.toHaveProperty("currentRouteSnapshot");
    expect(record?.route).not.toHaveProperty("threadIsDirect");
  });
});
