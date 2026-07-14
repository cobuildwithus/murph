import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  createAssistantInputAttachmentEvidenceFromInboxCapture,
  readAssistantInputEvent,
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import { initializeVault } from "@murphai/core";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import {
  createInboxPipeline,
  openInboxRuntime,
} from "@murphai/inboxd";
import {
  createParserRegistry,
  type ParserProvider,
} from "@murphai/parsers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyHostedAssistantInputMediaSemanticState,
} from "../src/hosted-runtime/media-parser-evidence.ts";
import {
  readHostedConversationParserContinuationWakeAt,
  runHostedConversationParserMaintenance,
} from "../src/hosted-runtime/parser-maintenance.ts";
import {
  enqueueHostedPendingAssistantInputId,
} from "../src/hosted-runtime/pending-input-index.ts";

const mocks = vi.hoisted(() => ({
  createConfiguredParserRegistry: vi.fn(),
}));

vi.mock("@murphai/parsers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/parsers")>();

  return {
    ...actual,
    createConfiguredParserRegistry: mocks.createConfiguredParserRegistry,
  };
});

const tempRoots: string[] = [];

beforeEach(() => {
  mocks.createConfiguredParserRegistry.mockReset();
});

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 50,
      })
    ),
  );
});

describe("hosted conversation parser maintenance", () => {
  it("drains at most one durable media job, refreshes its exact indexed event, and requests an immediate continuation", async () => {
    const context = await createTestContext("bounded-drain");
    let providerRuns = 0;
    configureParser({
      fakeFfmpeg: context.fakeFfmpeg,
      provider: createAudioProvider(async () => {
        providerRuns += 1;
        return `Transcript ${providerRuns}`;
      }),
    });
    const first = await createPendingAudioInput({
      index: 1,
      vaultRoot: context.vaultRoot,
      workspaceRoot: context.workspaceRoot,
    });
    const second = await createPendingAudioInput({
      index: 2,
      vaultRoot: context.vaultRoot,
      workspaceRoot: context.workspaceRoot,
    });

    const startedAt = Date.now();
    const result = await runHostedConversationParserMaintenance({
      memberId: "member_parser_maintenance",
      parserToolchain: null,
      vaultRoot: context.vaultRoot,
    });
    const finishedAt = Date.now();

    expect(result).toMatchObject({
      evidenceUpdated: 1,
      parserProcessed: 1,
      progressed: true,
    });
    expectImmediateWake(result.nextWakeAt, { finishedAt, startedAt });
    expect(providerRuns).toBe(1);

    const firstEvent = await readAssistantInputEvent({
      inputId: first.inputId,
      vault: context.vaultRoot,
    });
    const secondEvent = await readAssistantInputEvent({
      inputId: second.inputId,
      vault: context.vaultRoot,
    });
    expect(firstEvent).not.toBeNull();
    expect(secondEvent).not.toBeNull();
    expect(classifyHostedAssistantInputMediaSemanticState(firstEvent!)).toBe("ready");
    expect(
      firstEvent?.attachmentEvidence.attachments.flatMap((attachment) =>
        attachment.inlineFragments.map((fragment) => fragment.text)
      ),
    ).toContain("Transcript 1");
    expect(classifyHostedAssistantInputMediaSemanticState(secondEvent!)).toBe("pending");

    const runtime = await openInboxRuntime({ vaultRoot: context.vaultRoot });
    try {
      expect(runtime.listAttachmentParseJobs({ state: "succeeded" })).toHaveLength(1);
      expect(runtime.listAttachmentParseJobs({ state: "pending" })).toHaveLength(1);
      expect(
        runtime.listAttachmentParseJobs({
          captureId: first.captureId,
          state: "succeeded",
        }),
      ).toHaveLength(1);
      expect(
        runtime.listAttachmentParseJobs({
          captureId: second.captureId,
          state: "pending",
        }),
      ).toHaveLength(1);
    } finally {
      runtime.close();
    }
  });

  it("requeues an orphaned running job when a later continuation opens the durable inbox", async () => {
    const context = await createTestContext("running-requeue");
    const fixture = await createPendingAudioInput({
      index: 1,
      vaultRoot: context.vaultRoot,
      workspaceRoot: context.workspaceRoot,
    });
    const firstRuntime = await openInboxRuntime({ vaultRoot: context.vaultRoot });
    try {
      const claimed = firstRuntime.claimNextAttachmentParseJob({
        captureId: fixture.captureId,
      });
      expect(claimed).not.toBeNull();
      expect(claimed?.state).toBe("running");
    } finally {
      firstRuntime.close();
    }

    const startedAt = Date.now();
    const nextWakeAt = await readHostedConversationParserContinuationWakeAt({
      memberId: "member_parser_maintenance",
      vaultRoot: context.vaultRoot,
    });
    const finishedAt = Date.now();

    expectImmediateWake(nextWakeAt, { finishedAt, startedAt });
    const resumedRuntime = await openInboxRuntime({ vaultRoot: context.vaultRoot });
    try {
      expect(
        resumedRuntime.listAttachmentParseJobs({
          captureId: fixture.captureId,
          state: "running",
        }),
      ).toHaveLength(0);
      expect(
        resumedRuntime.listAttachmentParseJobs({
          captureId: fixture.captureId,
          state: "pending",
        }),
      ).toHaveLength(1);
      expect(
        resumedRuntime.getCapture(fixture.captureId)?.attachments[0]?.parseState,
      ).toBe("pending");
    } finally {
      resumedRuntime.close();
    }
  });

  it("terminalizes indexed pending media whose durable parser job is missing instead of looping", async () => {
    const context = await createTestContext("missing-job");
    const fixture = await createPendingAudioInput({
      index: 1,
      vaultRoot: context.vaultRoot,
      workspaceRoot: context.workspaceRoot,
    });
    const runtime = await openInboxRuntime({ vaultRoot: context.vaultRoot });
    const databasePath = runtime.databasePath;
    runtime.close();
    const database = new DatabaseSync(databasePath);
    try {
      const deleted = database
        .prepare("delete from attachment_parse_job where capture_id = ?")
        .run(fixture.captureId);
      expect(Number(deleted.changes)).toBe(1);
    } finally {
      database.close();
    }

    const startedAt = Date.now();
    const first = await runHostedConversationParserMaintenance({
      memberId: "member_parser_maintenance",
      parserToolchain: null,
      vaultRoot: context.vaultRoot,
    });
    const finishedAt = Date.now();

    expect(first).toMatchObject({
      evidenceUpdated: 1,
      parserProcessed: 0,
      progressed: true,
    });
    expectImmediateWake(first.nextWakeAt, { finishedAt, startedAt });
    const terminalEvent = await readAssistantInputEvent({
      inputId: fixture.inputId,
      vault: context.vaultRoot,
    });
    expect(terminalEvent?.attachmentEvidence).toMatchObject({
      reasonCode: "attachment.parser_job_missing",
      status: "failed",
    });
    expect(
      terminalEvent?.attachmentEvidence.attachments[0]?.parseState,
    ).toBe("unsupported");
    expect(classifyHostedAssistantInputMediaSemanticState(terminalEvent!)).toBe("failed");

    await expect(
      runHostedConversationParserMaintenance({
        memberId: "member_parser_maintenance",
        parserToolchain: null,
        vaultRoot: context.vaultRoot,
      }),
    ).resolves.toEqual({
      evidenceUpdated: 0,
      nextWakeAt: null,
      parserProcessed: 0,
      progressed: false,
    });
  });

  it("keeps the durable job pending and schedules a bounded retry when parser setup fails", async () => {
    const context = await createTestContext("setup-retry");
    const fixture = await createPendingAudioInput({
      index: 1,
      vaultRoot: context.vaultRoot,
      workspaceRoot: context.workspaceRoot,
    });
    mocks.createConfiguredParserRegistry.mockRejectedValueOnce(
      new Error("synthetic parser discovery failure"),
    );

    const startedAt = Date.now();
    const result = await runHostedConversationParserMaintenance({
      memberId: "member_parser_maintenance",
      parserToolchain: null,
      vaultRoot: context.vaultRoot,
    });
    const finishedAt = Date.now();

    expect(result).toMatchObject({
      evidenceUpdated: 0,
      parserProcessed: 0,
      progressed: false,
    });
    expectDelayedRetry(result.nextWakeAt, { finishedAt, startedAt });
    const resumedRuntime = await openInboxRuntime({ vaultRoot: context.vaultRoot });
    try {
      expect(
        resumedRuntime.listAttachmentParseJobs({
          captureId: fixture.captureId,
          state: "pending",
        }),
      ).toHaveLength(1);
    } finally {
      resumedRuntime.close();
    }
  });
});

async function createTestContext(label: string): Promise<{
  fakeFfmpeg: string;
  vaultRoot: string;
  workspaceRoot: string;
}> {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), `murph-hosted-parser-maintenance-${label}-`),
  );
  tempRoots.push(workspaceRoot);
  const vaultRoot = path.join(workspaceRoot, "vault");
  const fakeFfmpeg = path.join(workspaceRoot, "fake-ffmpeg");
  await initializeVault({
    createdAt: "2026-04-29T00:00:00.000Z",
    vaultRoot,
  });
  await createIntegratedInboxServices().init({
    requestId: null,
    vault: vaultRoot,
  });
  await writeExecutableNodeScript(
    fakeFfmpeg,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const outputPath = process.argv.at(-1);",
      "fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
      "fs.writeFileSync(outputPath, 'normalized wav bytes');",
    ].join("\n"),
  );
  return {
    fakeFfmpeg,
    vaultRoot,
    workspaceRoot,
  };
}

async function createPendingAudioInput(input: {
  index: number;
  vaultRoot: string;
  workspaceRoot: string;
}): Promise<{
  captureId: string;
  inputId: string;
}> {
  const fileName = `voice-note-${input.index}.m4a`;
  const sourcePath = path.join(input.workspaceRoot, fileName);
  await writeFile(sourcePath, `audio bytes ${input.index}`, "utf8");
  const runtime = await openInboxRuntime({ vaultRoot: input.vaultRoot });
  const pipeline = await createInboxPipeline({
    runtime,
    vaultRoot: input.vaultRoot,
  });
  const persisted = await pipeline.processCapture({
    actor: {
      isSelf: false,
    },
    attachments: [{
      fileName,
      kind: "audio",
      mime: "audio/mp4",
      originalPath: sourcePath,
    }],
    externalId: `linq-parser-maintenance-${input.index}`,
    occurredAt: `2026-04-29T17:22:${String(input.index).padStart(2, "0")}.000Z`,
    raw: {},
    source: "linq",
    text: null,
    thread: {
      id: "chat_parser_maintenance",
    },
  });
  pipeline.close();

  const projectionRuntime = await openInboxRuntime({ vaultRoot: input.vaultRoot });
  let capture: NonNullable<ReturnType<typeof projectionRuntime.getCapture>>;
  try {
    const storedCapture = projectionRuntime.getCapture(persisted.captureId);
    if (!storedCapture) {
      throw new Error("Expected the parser-maintenance capture to exist.");
    }
    capture = storedCapture;
  } finally {
    projectionRuntime.close();
  }
  const attachmentId = `descriptor_audio_${input.index}`;
  const event = await upsertAssistantInputEvent({
    event: {
      content: {
        attachmentDescriptors: [{
          attachmentId,
          contentType: "audio/mp4",
          fileName,
          kind: "audio",
          sizeBytes: capture.attachments[0]?.byteSize ?? null,
        }],
        userMessageContent: [],
      },
      conversation: {
        accountId: "acct_parser_maintenance",
        actorId: "actor_parser_maintenance",
        actorIsSelf: false,
        source: "linq",
        threadId: "chat_parser_maintenance",
        threadIsDirect: true,
      },
      occurredAt: `2026-04-29T17:22:${String(input.index).padStart(2, "0")}.000Z`,
      receivedAt: `2026-04-29T17:23:${String(input.index).padStart(2, "0")}.000Z`,
      replyTarget: {
        channel: "linq",
        messageId: `message_parser_maintenance_${input.index}`,
        threadId: "chat_parser_maintenance",
      },
      sourceRef: {
        dedupeKey: `dedupe_parser_maintenance_${input.index}`,
        eventId: `event_parser_maintenance_${input.index}`,
        itemId: `item_parser_maintenance_${input.index}`,
        kind: "hosted-mailbox" as const,
        lane: "conversation" as const,
        laneSeq: String(input.index),
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        payloadSource: "inline" as const,
        source: "hosted-mailbox" as const,
        wakeSchema: "murph.hosted-execution-wake.v1",
      },
    },
    vault: input.vaultRoot,
  });
  await updateAssistantInputProjection({
    inputId: event.inputId,
    projection: {
      captureId: persisted.captureId,
      status: "succeeded",
    },
    vault: input.vaultRoot,
  });
  await updateAssistantInputAttachmentEvidence({
    attachmentEvidence: createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        attachments: capture.attachments,
        captureId: persisted.captureId,
      },
      descriptorAttachmentIdForAttachment: () => attachmentId,
      source: "local-inbox-import",
    }),
    inputId: event.inputId,
    vault: input.vaultRoot,
  });
  await enqueueHostedPendingAssistantInputId({
    inputId: event.inputId,
    vaultRoot: input.vaultRoot,
  });
  return {
    captureId: persisted.captureId,
    inputId: event.inputId,
  };
}

function configureParser(input: {
  fakeFfmpeg: string;
  provider: ParserProvider;
}): void {
  mocks.createConfiguredParserRegistry.mockResolvedValue({
    ffmpeg: {
      allowSystemLookup: false,
      commandCandidates: [input.fakeFfmpeg],
    },
    registry: createParserRegistry([input.provider]),
  });
}

function createAudioProvider(
  transcript: () => Promise<string>,
): ParserProvider {
  return {
    id: "fake-hosted-parser-maintenance-audio",
    locality: "local",
    openness: "open_source",
    priority: 500,
    runtime: "node",
    async discover() {
      return {
        available: true,
        reason: "available for hosted parser maintenance test",
      };
    },
    supports(request) {
      return (request.preparedKind ?? request.artifact.kind) === "audio";
    },
    async run() {
      return {
        text: await transcript(),
      };
    },
  };
}

function expectImmediateWake(
  nextWakeAt: string | null,
  input: { finishedAt: number; startedAt: number },
): void {
  expect(nextWakeAt).not.toBeNull();
  const wakeMs = Date.parse(nextWakeAt!);
  expect(wakeMs).toBeGreaterThanOrEqual(input.startedAt);
  expect(wakeMs).toBeLessThanOrEqual(input.finishedAt + 100);
}

function expectDelayedRetry(
  nextWakeAt: string | null,
  input: { finishedAt: number; startedAt: number },
): void {
  expect(nextWakeAt).not.toBeNull();
  const wakeMs = Date.parse(nextWakeAt!);
  expect(wakeMs).toBeGreaterThanOrEqual(input.startedAt + 59_000);
  expect(wakeMs).toBeLessThanOrEqual(input.finishedAt + 61_000);
}

async function writeExecutableNodeScript(
  filePath: string,
  body: string,
): Promise<void> {
  await writeFile(filePath, `#!/usr/bin/env node\n${body}\n`, "utf8");
  await chmod(filePath, 0o755);
}
