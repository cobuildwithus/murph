import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  ASSISTANT_RUNTIME_ISSUE_SCHEMA,
  createAssistantRuntimeIssueFingerprint,
  createAssistantRuntimeIssueId,
  deletePendingAssistantRuntimeIssueRecord,
  listPendingAssistantRuntimeIssueRecords,
  parseAssistantRuntimeIssueRecord,
  resolvePendingAssistantRuntimeIssuePath,
  writePendingAssistantRuntimeIssueRecord,
} from "../src/assistant-runtime-issues.ts";
import { resolveAssistantStatePaths } from "../src/assistant-state.ts";

test("assistant runtime issue helpers sanitize, persist, sort, and delete pending records", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-assistant-runtime-issues-"));

  try {
    assert.deepEqual(await listPendingAssistantRuntimeIssueRecords({ vault: vaultRoot }), []);

    const fingerprint = createAssistantRuntimeIssueFingerprint({
      component: "provider-runtime",
      errorCode: "timeout",
      issueKind: "fallback_used",
      operation: "tool-call",
      phase: "tool_call",
      summary: "Fallback used while parsing a tool response.",
    });
    const generatedIssueId = createAssistantRuntimeIssueId({
      fingerprint,
      occurredAt: "2026-04-20T09:00:00.000Z",
    });

    assert.match(generatedIssueId, /^ari_[0-9a-f]{16}_[0-9a-f]{24}$/u);
    assert.match(fingerprint, /^[0-9a-f]{24}$/u);

    const firstIssueId = "ari_1111111111111111_aaaaaaaaaaaaaaaaaaaaaaaa";
    const secondIssueId = "ari_2222222222222222_bbbbbbbbbbbbbbbbbbbbbbbb";

    await writePendingAssistantRuntimeIssueRecord({
      vault: vaultRoot,
      record: {
        component: "contains spaces",
        details: createUnsanitizedDetails(),
        environment: "hosted",
        errorCode: "bad code",
        fingerprint,
        issueId: firstIssueId,
        issueKind: "fallback_used",
        occurredAt: "2026-04-20T09:00:00.000Z",
        operation: " tool call ",
        phase: "tool_call",
        schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
        severity: "warning",
        summary: "Ignored in favor of the canonical summary.",
        surface: " dashboard ",
      },
    });
    await writePendingAssistantRuntimeIssueRecord({
      paths: resolveAssistantStatePaths(vaultRoot),
      record: {
        component: "model.runtime",
        details: {},
        environment: "local",
        errorCode: null,
        fingerprint: createAssistantRuntimeIssueFingerprint({
          component: "model.runtime",
          issueKind: "timeout",
          phase: "provider_turn",
          summary: "Timeout during provider turn.",
        }),
        issueId: secondIssueId,
        issueKind: "timeout",
        occurredAt: "2026-04-20T08:00:00.000Z",
        operation: "provider.turn",
        phase: "provider_turn",
        schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
        severity: "error",
        summary: "Ignored in favor of the canonical summary.",
        surface: null,
      },
    });

    const paths = resolveAssistantStatePaths(vaultRoot);
    const persisted = JSON.parse(
      await readFile(resolvePendingAssistantRuntimeIssuePath(paths, firstIssueId), "utf8"),
    ) as Record<string, unknown>;

    assert.equal(persisted.component, "assistant-runtime");
    assert.equal(persisted.errorCode, null);
    assert.equal(persisted.operation, null);
    assert.equal(persisted.surface, "dashboard");
    assert.equal(
      persisted.summary,
      "Assistant runtime issue: fallback used during tool_call.",
    );

    const persistedDetails = persisted.details as Record<string, unknown>;
    assert.equal(Object.keys(persistedDetails).length, 24);
    assert.deepEqual(persistedDetails.array, [
      "item0",
      "item1",
      "item2",
      "item3",
      "item4",
      "item5",
      "item6",
      "item7",
      "item8",
      "item9",
      "item10",
      "item11",
    ]);
    assert.deepEqual(persistedDetails.nested, {
      flag: true,
      metric: "steady_state",
      unstable: null,
    });
    assert.equal("bad key" in persistedDetails, false);
    assert.equal("dropMe" in persistedDetails, false);

    const listed = await listPendingAssistantRuntimeIssueRecords({ vault: vaultRoot });
    assert.deepEqual(listed.map((record) => record.issueId), [secondIssueId, firstIssueId]);

    await deletePendingAssistantRuntimeIssueRecord({ issueId: secondIssueId, paths });
    assert.deepEqual(
      (await listPendingAssistantRuntimeIssueRecords({ paths })).map((record) => record.issueId),
      [firstIssueId],
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("assistant runtime issue parsing covers canonical summaries and fail-closed validation", async () => {
  const baseRecord = {
    component: "assistant.runtime",
    details: {},
    environment: "local" as const,
    errorCode: "tool_timeout",
    fingerprint: "1234567890abcdef12345678",
    issueId: "ari_1234567890abcdef_1234567890abcdef12345678",
    occurredAt: "2026-04-20T10:00:00.000Z",
    operation: "provider.turn",
    phase: "provider_turn" as const,
    schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
    severity: "error" as const,
    summary: "not used",
    surface: "console",
  };

  assert.deepEqual(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      details: null,
      issueKind: "tool_error",
    }).details,
    {},
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "dev_note_stripped",
    }).summary,
    "Assistant produced a visible developer note on a surface where developer notes are hidden.",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "schema_rejection",
    }).summary,
    "Assistant runtime issue: schema rejection during provider_turn (provider.turn).",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "timeout",
    }).summary,
    "Assistant runtime issue: timeout during provider_turn (provider.turn).",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "fallback_used",
    }).summary,
    "Assistant runtime issue: fallback used during provider_turn (provider.turn).",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "retry_used",
    }).summary,
    "Assistant runtime issue: retry used during provider_turn (provider.turn).",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "model_reported_friction",
    }).summary,
    "Assistant runtime issue: model reported friction during provider_turn (provider.turn).",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "tool_error",
      operation: null,
    }).summary,
    "Assistant runtime issue: tool error during provider_turn.",
  );

  assert.throws(
    () => parseAssistantRuntimeIssueRecord({ ...baseRecord, details: [], issueKind: "tool_error" }),
    /details must be a JSON object\./u,
  );
  assert.throws(
    () => parseAssistantRuntimeIssueRecord({ ...baseRecord, schema: "wrong", issueKind: "tool_error" }),
    /assistant runtime issue record schema must be murph\.assistant-runtime-issue\.v1\./u,
  );
  assert.throws(
    () => parseAssistantRuntimeIssueRecord({ ...baseRecord, fingerprint: "short", issueKind: "tool_error" }),
    /fingerprint must be a 24-character hexadecimal string\./u,
  );
  assert.throws(
    () => parseAssistantRuntimeIssueRecord({ ...baseRecord, issueId: "bad", issueKind: "tool_error" }),
    /issueId must match the assistant runtime issue id format\./u,
  );
  assert.throws(
    () => parseAssistantRuntimeIssueRecord({ ...baseRecord, environment: "remote", issueKind: "tool_error" }),
    /environment must be 'hosted' or 'local'\./u,
  );
  assert.throws(
    () => parseAssistantRuntimeIssueRecord({ ...baseRecord, phase: "bootstrap", issueKind: "tool_error" }),
    /phase is not a supported assistant runtime issue phase\./u,
  );
  assert.throws(
    () => parseAssistantRuntimeIssueRecord({ ...baseRecord, severity: "fatal", issueKind: "tool_error" }),
    /severity must be 'info', 'warning', or 'error'\./u,
  );
  assert.throws(
    () => parseAssistantRuntimeIssueRecord({ ...baseRecord, issueKind: "other" }),
    /issueKind is not a supported assistant runtime issue kind\./u,
  );
  assert.throws(
    () => parseAssistantRuntimeIssueRecord({ ...baseRecord, occurredAt: "not-a-date", issueKind: "tool_error" }),
    /occurredAt must be an ISO timestamp\./u,
  );
  assert.throws(
    () => parseAssistantRuntimeIssueRecord({ ...baseRecord, surface: 5, issueKind: "tool_error" }),
    /surface must be a string when provided\./u,
  );
  await assert.rejects(
    () => listPendingAssistantRuntimeIssueRecords({}),
    /vault or paths is required when resolving assistant runtime issue state\./u,
  );
});

function createUnsanitizedDetails(): Record<string, unknown> {
  const details: Record<string, unknown> = {
    array: Array.from({ length: 14 }, (_, index) => `item${index}`),
    badString: "contains spaces",
    finiteNumber: 42,
    flag: false,
    nested: {
      "bad key": "omit",
      flag: true,
      metric: "steady_state",
      unstable: Number.NaN,
    },
    nullish: null,
  };

  for (let index = 0; index < 25; index += 1) {
    details[`key${String(index).padStart(2, "0")}`] = `value_${index}`;
  }

  details["bad key"] = "drop";
  details.dropMe = Symbol("secret");

  return details;
}
