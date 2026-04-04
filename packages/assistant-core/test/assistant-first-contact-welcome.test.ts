import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, test, vi } from "vitest";

import { sendAssistantFirstContactWelcome } from "../src/index.js";
import { ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE } from "../src/assistant/first-contact-welcome.js";
import {
  listAssistantTranscriptEntries,
  resolveAssistantStatePaths,
} from "../src/assistant/store.js";

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
