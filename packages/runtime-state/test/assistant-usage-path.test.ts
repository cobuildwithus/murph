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
  const match = usageId.match(
    /^(?<turnId>.+?)(?:\.request-(?<providerRequestOrdinal>\d+))?\.attempt-(?<attemptCount>\d+)$/u,
  );

  if (!match?.groups) {
    throw new Error(`Test usage id ${usageId} must be canonical.`);
  }

  return {
    apiKeyEnv: "VERCEL_AI_API_KEY",
    attemptCount: Number(match.groups.attemptCount),
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
    provider: "codex-cli",
    providerName: "Vercel AI Gateway",
    ...(match.groups.providerRequestOrdinal === undefined
      ? {}
      : { providerRequestOrdinal: Number(match.groups.providerRequestOrdinal) }),
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
    turnId: match.groups.turnId,
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
    const expectedFileName = `${Buffer.from(usageId, "utf8").toString("base64url")}.json`;

    expect(path.dirname(resolvedPath)).toBe(usagePendingDirectory);
    expect(path.basename(resolvedPath)).toBe(expectedFileName);
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

  it("ignores a leftover legacy pending-usage filename and deletes only the canonical encoded file", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-usage-path-"));
    const paths = resolveAssistantStatePaths(vaultRoot);
    const usageId = "turn-safe.attempt-1";
    const encodedPath = resolvePendingAssistantUsagePath(paths, usageId);
    const legacyPath = path.join(paths.usagePendingDirectory, `${usageId}.json`);
    const record = createUsageRecord(usageId);

    await mkdir(paths.usagePendingDirectory, { recursive: true });
    await writeFile(legacyPath, `${JSON.stringify(record)}\n`, "utf8");

    await writePendingAssistantUsageRecord({
      paths,
      record,
    });

    expect((await stat(encodedPath)).isFile()).toBe(true);
    expect((await stat(legacyPath)).isFile()).toBe(true);
    await expect(listPendingAssistantUsageRecords({ paths })).resolves.toEqual([record]);

    await deletePendingAssistantUsageRecord({
      paths,
      usageId,
    });

    await expect(listPendingAssistantUsageRecords({ paths })).resolves.toEqual([]);
    await expect(stat(encodedPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await stat(legacyPath)).isFile()).toBe(true);
  });
});
