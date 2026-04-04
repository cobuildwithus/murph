import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, test, vi } from "vitest";

import {
  listAssistantOutboxIntents,
  queueAssistantFirstContactWelcome,
  sendAssistantFirstContactWelcome,
} from "../src/index.js";
import { ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE } from "../src/assistant/first-contact-welcome.js";
import {
  listAssistantTranscriptEntries,
  resolveAssistantStatePaths,
} from "../src/assistant/store.js";
import { readAssistantTurnReceipt } from "../src/assistant/turns.js";

const envSnapshot = {
  HOME: process.env.HOME,
  LINQ_API_TOKEN: process.env.LINQ_API_TOKEN,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (envSnapshot.HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = envSnapshot.HOME;
  }

  if (envSnapshot.LINQ_API_TOKEN === undefined) {
    delete process.env.LINQ_API_TOKEN;
  } else {
    process.env.LINQ_API_TOKEN = envSnapshot.LINQ_API_TOKEN;
  }

  vi.unstubAllGlobals();
});

test("sends the first-contact welcome once and persists it as a real assistant turn", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-first-contact-"));
  const vaultRoot = path.join(workspaceRoot, "vault");
  process.env.HOME = workspaceRoot;
  process.env.LINQ_API_TOKEN = "linq-token";

  try {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) as { message?: { text?: string; idempotency_key?: string } } : null;
      return new Response(JSON.stringify({
        message: {
          id: "msg_123",
          text: payload?.message?.text ?? null,
        },
      }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const first = await sendAssistantFirstContactWelcome({
      channel: "linq",
      identityId: "hbidx:phone:v1:test",
      threadId: "chat_123",
      threadIsDirect: true,
      vault: vaultRoot,
    });
    const second = await sendAssistantFirstContactWelcome({
      channel: "linq",
      identityId: "hbidx:phone:v1:test",
      threadId: "chat_123",
      threadIsDirect: true,
      vault: vaultRoot,
    });

    assert.equal(first.reason, "sent");
    assert.equal(second.reason, "already-seen");
    assert.equal(fetchMock.mock.calls.length, 1);

    const transcripts = await listAssistantTranscriptEntries(vaultRoot, first.session.sessionId);
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0]?.kind, "assistant");
    assert.equal(transcripts[0]?.text, ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE);

    const session = JSON.parse(
      await readFile(
        path.join(resolveAssistantStatePaths(vaultRoot).sessionsDirectory, `${first.session.sessionId}.json`),
        "utf8",
      ),
    ) as { turnCount: number };
    assert.equal(session.turnCount, 1);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("queues the first-contact welcome without sending and persists deferred turn state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-first-contact-queued-"));
  const vaultRoot = path.join(workspaceRoot, "vault");
  process.env.HOME = workspaceRoot;

  try {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await queueAssistantFirstContactWelcome({
      channel: "linq",
      identityId: "hbidx:phone:v1:test",
      threadId: "chat_123",
      threadIsDirect: true,
      vault: vaultRoot,
    });

    assert.equal(result.reason, "queued");
    assert.equal(fetchMock.mock.calls.length, 0);

    const transcripts = await listAssistantTranscriptEntries(vaultRoot, result.session.sessionId);
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0]?.kind, "assistant");
    assert.equal(transcripts[0]?.text, ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE);

    const intents = await listAssistantOutboxIntents(vaultRoot);
    assert.equal(intents.length, 1);
    assert.equal(intents[0]?.sessionId, result.session.sessionId);
    assert.equal(intents[0]?.status, "pending");
    assert.equal(intents[0]?.message, ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE);

    const session = JSON.parse(
      await readFile(
        path.join(resolveAssistantStatePaths(vaultRoot).sessionsDirectory, `${result.session.sessionId}.json`),
        "utf8",
      ),
    ) as { lastTurnAt: string | null; turnCount: number; updatedAt: string };
    assert.equal(session.turnCount, 1);
    assert.equal(session.lastTurnAt, session.updatedAt);

    const receipt = await readAssistantTurnReceipt(vaultRoot, result.turnId ?? "");
    assert.equal(receipt?.status, "deferred");
    assert.equal(receipt?.deliveryDisposition, "queued");
    assert.equal(receipt?.deliveryIntentId, intents[0]?.intentId ?? null);
    const expectedResponsePreview =
      ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE.length <= 320
        ? ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE
        : `${ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE.slice(0, 319).trimEnd()}…`;
    assert.equal(receipt?.responsePreview, expectedResponsePreview);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
