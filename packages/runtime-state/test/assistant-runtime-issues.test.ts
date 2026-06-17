import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  ASSISTANT_RUNTIME_ISSUE_SCHEMA,
  type AssistantRuntimeIssueRecord,
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
    const persistedValue = persisted.value as Record<string, unknown>;

    assert.equal(persisted.schema, ASSISTANT_RUNTIME_ISSUE_SCHEMA);
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(persistedValue.component, "assistant-runtime");
    assert.equal(persistedValue.errorCode, null);
    assert.equal(persistedValue.operation, null);
    assert.equal(persistedValue.surface, "dashboard");
    assert.equal(
      persistedValue.summary,
      "Ignored in favor of the canonical summary.",
    );

    const persistedDetails = persistedValue.details as Record<string, unknown>;
    assert.equal(Object.keys(persistedDetails).length, 24);
    assert.equal(persistedDetails.badString, "contains spaces");
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

test("assistant runtime issue listing rejects raw pending files unless invalid records are skipped", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-assistant-runtime-issues-"));
  const paths = resolveAssistantStatePaths(vaultRoot);
  const invalidFiles: string[] = [];
  const record = parseAssistantRuntimeIssueRecord({
    component: "assistant.runtime",
    details: {},
    environment: "local",
    errorCode: null,
    fingerprint: "abcdef1234567890abcdef12",
    issueId: "ari_4444444444444444_dddddddddddddddddddddddd",
    issueKind: "tool_error",
    occurredAt: "2026-04-20T12:00:00.000Z",
    operation: "provider.turn",
    phase: "provider_turn",
    schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
    severity: "error",
    summary: "ignored",
    surface: null,
  });

  try {
    await mkdir(paths.issuesPendingDirectory, { recursive: true });
    await writeFile(
      resolvePendingAssistantRuntimeIssuePath(paths, record.issueId),
      `${JSON.stringify(record)}\n`,
      "utf8",
    );

    assert.deepEqual(
      await listPendingAssistantRuntimeIssueRecords({
        onInvalidRecord: ({ fileName }) => {
          invalidFiles.push(fileName);
        },
        paths,
        skipInvalidRecords: true,
      }),
      [],
    );
    assert.deepEqual(invalidFiles, [`${record.issueId}.json`]);

    await assert.rejects(
      () => listPendingAssistantRuntimeIssueRecords({
        paths,
      }),
      /pending assistant runtime issue record must be a versioned murph\.assistant-runtime-issue\.v1 envelope/u,
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("assistant runtime issue listing skips forward-versioned pending files when requested", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-assistant-runtime-issues-"));
  const paths = resolveAssistantStatePaths(vaultRoot);
  const validRecord = parseAssistantRuntimeIssueRecord({
    component: "assistant.runtime",
    details: {},
    environment: "local",
    errorCode: null,
    fingerprint: "abcdef1234567890abcdef12",
    issueId: "ari_5555555555555555_eeeeeeeeeeeeeeeeeeeeeeee",
    issueKind: "tool_error",
    occurredAt: "2026-04-20T12:05:00.000Z",
    operation: "provider.turn",
    phase: "provider_turn",
    schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
    severity: "error",
    summary: "ignored",
    surface: null,
  });
  const invalidFiles: string[] = [];

  try {
    await mkdir(paths.issuesPendingDirectory, { recursive: true });
    await writePendingAssistantRuntimeIssueRecord({
      paths,
      record: validRecord,
    });
    await writeFile(
      resolvePendingAssistantRuntimeIssuePath(paths, "ari_6666666666666666_ffffffffffffffffffffffff"),
      `${JSON.stringify({
        schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
        schemaVersion: 2,
        value: {
          ...validRecord,
          issueId: "ari_6666666666666666_ffffffffffffffffffffffff",
        },
      })}\n`,
      "utf8",
    );

    assert.deepEqual(
      await listPendingAssistantRuntimeIssueRecords({
        onInvalidRecord: ({ fileName }) => {
          invalidFiles.push(fileName);
        },
        paths,
        skipInvalidRecords: true,
      }),
      [validRecord],
    );
    assert.deepEqual(invalidFiles, ["ari_6666666666666666_ffffffffffffffffffffffff.json"]);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("assistant runtime issue listing fails closed on forward-versioned pending files by default", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-assistant-runtime-issues-"));
  const paths = resolveAssistantStatePaths(vaultRoot);
  const invalidIssueId = "ari_7777777777777777_aaaaaaaaaaaaaaaaaaaaaaaa";

  try {
    await mkdir(paths.issuesPendingDirectory, { recursive: true });
    await writeFile(
      resolvePendingAssistantRuntimeIssuePath(paths, invalidIssueId),
      `${JSON.stringify({
        schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
        schemaVersion: 2,
        value: {
          component: "assistant.runtime",
          details: {},
          environment: "local",
          errorCode: null,
          fingerprint: "abcdef1234567890abcdef12",
          issueId: invalidIssueId,
          issueKind: "tool_error",
          occurredAt: "2026-04-20T12:10:00.000Z",
          operation: "provider.turn",
          phase: "provider_turn",
          schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
          severity: "error",
          summary: "ignored",
          surface: null,
        },
      })}\n`,
      "utf8",
    );

    await assert.rejects(
      () => listPendingAssistantRuntimeIssueRecords({
        paths,
      }),
      /pending assistant runtime issue record schemaVersion must be 1\./u,
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("assistant runtime issue parsing preserves summaries, redacts text, and covers canonical fallback", async () => {
  const providerSecret = ["sk", "providersecret12345"].join("-");
  const webhookSecret = ["whsec", "runtimehook12345"].join("_");
  const jwtSecret = [
    "eyJhbGciOiJIUzI1NiJ9",
    "eyJzdWIiOiJ0ZXN0In0",
    "signature12345",
  ].join(".");
  const baseRecord = {
    component: "assistant.runtime",
    details: {
      authorization: "Bearer top-secret-token",
      bareKey: `invalid key ${providerSecret} and webhook ${webhookSecret}`,
      jwt: jwtSecret,
      note: "Tool failed for foo@example.com while reading /tmp/private/log.txt.",
      url: "https://example.com/private/log",
    },
    environment: "local" as const,
    errorCode: "tool_timeout",
    fingerprint: "1234567890abcdef12345678",
    issueId: "ari_1234567890abcdef_1234567890abcdef12345678",
    occurredAt: "2026-04-20T10:00:00.000Z",
    operation: "provider.turn",
    phase: "provider_turn" as const,
    schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
    severity: "error" as const,
    summary:
      `Provider failed for foo@example.com with token=secret-value and ${providerSecret} at /tmp/private/log.txt.`,
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
  const redacted = parseAssistantRuntimeIssueRecord({
    ...baseRecord,
    issueKind: "tool_error",
  });
  assert.equal(
    redacted.summary,
    "Provider failed for [email] with token=[REDACTED] and [REDACTED] at [path]",
  );
  assert.deepEqual(redacted.details, {
    authorization: "Bearer [REDACTED]",
    bareKey: "invalid key [REDACTED] and webhook [REDACTED]",
    jwt: "[REDACTED]",
    note: "Tool failed for [email] while reading [path]",
    url: "[url]",
  });
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "dev_note_stripped",
      summary: " ",
    }).summary,
    "Assistant produced a visible developer note on a surface where developer notes are hidden.",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "schema_rejection",
      summary: "",
    }).summary,
    "Assistant runtime issue: schema rejection during provider_turn (provider.turn).",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "timeout",
      summary: null,
    }).summary,
    "Assistant runtime issue: timeout during provider_turn (provider.turn).",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "fallback_used",
      summary: "",
    }).summary,
    "Assistant runtime issue: fallback used during provider_turn (provider.turn).",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "retry_used",
      summary: "",
    }).summary,
    "Assistant runtime issue: retry used during provider_turn (provider.turn).",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "model_reported_friction",
      summary: "",
    }).summary,
    "Assistant runtime issue: model reported friction during provider_turn (provider.turn).",
  );
  assert.equal(
    parseAssistantRuntimeIssueRecord({
      ...baseRecord,
      issueKind: "tool_error",
      operation: null,
      summary: "",
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

test("assistant runtime issue path helpers reject invalid ids before touching sibling runtime files", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-assistant-runtime-issues-"));

  try {
    const paths = resolveAssistantStatePaths(vaultRoot);
    const validIssueId = "ari_3333333333333333_cccccccccccccccccccccccc";
    const validRecord: AssistantRuntimeIssueRecord = {
      component: "assistant.runtime",
      details: {},
      environment: "hosted" as const,
      errorCode: null,
      fingerprint: "abcdef1234567890abcdef12",
      issueId: validIssueId,
      issueKind: "tool_error" as const,
      occurredAt: "2026-04-20T11:00:00.000Z",
      operation: "provider.turn",
      phase: "provider_turn" as const,
      schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
      severity: "error" as const,
      summary: "ignored",
      surface: null,
    };

    await writePendingAssistantRuntimeIssueRecord({
      paths,
      record: validRecord,
    });

    await writeFile(paths.statusPath, JSON.stringify({ schema: "murph.assistant-status.v1" }), "utf8");

    assert.throws(
      () => resolvePendingAssistantRuntimeIssuePath(paths, "../../status"),
      /issueId must match the assistant runtime issue id format\./u,
    );
    await assert.rejects(
      () => deletePendingAssistantRuntimeIssueRecord({ issueId: "../../status", paths }),
      /issueId must match the assistant runtime issue id format\./u,
    );

    assert.equal(
      await readFile(paths.statusPath, "utf8"),
      JSON.stringify({ schema: "murph.assistant-status.v1" }),
    );
    assert.deepEqual(
      JSON.parse(await readFile(resolvePendingAssistantRuntimeIssuePath(paths, validIssueId), "utf8")),
      {
        schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
        schemaVersion: 1,
        value: parseAssistantRuntimeIssueRecord(validRecord),
      },
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
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
