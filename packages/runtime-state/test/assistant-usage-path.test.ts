import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  deletePendingAssistantUsageRecord,
  listPendingAssistantUsageRecords,
  resolvePendingAssistantUsagePath,
  writePendingAssistantUsageRecord,
  type AssistantUsageRecord,
} from "../src/assistant-usage.js";
import { resolveAssistantStatePaths } from "../src/assistant-state.js";

function createUsageRecord(usageId: string): AssistantUsageRecord {
  return {
    apiKeyEnv: "OPENAI_API_KEY",
    attemptCount: 1,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: null,
    gatewayTags: [],
    inputTokens: 10,
    memberId: "member-usage-path",
    occurredAt: "2026-04-21T00:00:00.000Z",
    outputTokens: 20,
    provider: "openai-compatible",
    providerName: "OpenAI",
    reasoningTokens: null,
    reportingUserId: null,
    requestedModel: "gpt-test",
    routeId: null,
    schema: "murph.assistant-usage.v1",
    servedModel: "gpt-test",
    sessionId: "session-usage-path",
    stripeMeterSource: "murph",
    surface: null,
    totalTokens: 30,
    triggerKind: null,
    turnId: "turn/with/slash",
    usageId,
  };
}

describe("pending assistant usage paths", () => {
  it("encodes usage ids so pending usage files cannot escape the usage directory", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-usage-path-"));
    const paths = resolveAssistantStatePaths(vaultRoot);
    const usagePendingDirectory = paths.usagePendingDirectory;
    const usageId = "turn/with/slash.attempt-1";
    const resolvedPath = resolvePendingAssistantUsagePath(paths, usageId);

    expect(path.dirname(resolvedPath)).toBe(usagePendingDirectory);
    expect(path.basename(resolvedPath)).not.toContain("/");
    expect(path.basename(resolvedPath)).not.toContain("\\");

    await writePendingAssistantUsageRecord({
      paths,
      record: createUsageRecord(usageId),
    });
    expect((await stat(resolvedPath)).isFile()).toBe(true);
    await expect(listPendingAssistantUsageRecords({ paths })).resolves.toEqual([
      createUsageRecord(usageId),
    ]);

    await deletePendingAssistantUsageRecord({
      paths,
      usageId,
    });
    await expect(listPendingAssistantUsageRecords({ paths })).resolves.toEqual([]);
  });

  it("removes a legacy safe pending-usage filename when writing and deleting the encoded file", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-usage-path-"));
    const paths = resolveAssistantStatePaths(vaultRoot);
    const usageId = "turn-safe.attempt-1";
    const encodedPath = resolvePendingAssistantUsagePath(paths, usageId);
    const legacyPath = path.join(paths.usagePendingDirectory, `${usageId}.json`);

    await mkdir(paths.usagePendingDirectory, { recursive: true });
    await writeFile(legacyPath, "{\"legacy\":true}\n", "utf8");

    await writePendingAssistantUsageRecord({
      paths,
      record: createUsageRecord(usageId),
    });

    expect((await stat(encodedPath)).isFile()).toBe(true);
    await expect(stat(legacyPath)).rejects.toMatchObject({
      code: "ENOENT",
    });

    await deletePendingAssistantUsageRecord({
      paths,
      usageId,
    });

    await expect(stat(encodedPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
