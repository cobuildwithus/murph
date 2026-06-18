import assert from "node:assert/strict";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cli } from "incur";
import { test } from "vitest";

import { initializeVault, upsertEvent } from "@murphai/core";
import { createIntegratedVaultServices } from "@murphai/vault-usecases";

import { registerBloodTestCommands } from "../src/commands/health-blood-test-save.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from "./cli-test-helpers.js";

interface CommandSchemaEnvelope {
  args: {
    properties: Record<string, unknown>;
    required?: string[];
  };
  options: {
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface BloodTestSaveResult {
  vault: string;
  eventId: string;
  lookupId: string;
  ledgerFile?: string;
  created: boolean;
}

interface BloodTestScaffoldResult {
  vault: string;
  noun: "blood-test";
  payload: {
    results?: Array<{
      analyte?: string;
      value?: number;
      textValue?: string;
      referenceRange?: {
        text?: string;
      };
      flag?: string;
      unit?: string;
    }>;
  };
}

interface StoredBloodTestEvent {
  id: string;
  title: string;
  kind: string;
  occurredAt: string;
  recordedAt: string;
  source?: string;
  note?: string;
  tags?: string[];
  links?: Array<{ type: string; targetId: string }>;
  rawRefs?: string[];
  testName: string;
  resultStatus: string;
  summary?: string;
  testCategory?: string;
  specimenType?: string;
  labName?: string;
  labPanelId?: string;
  collectedAt?: string;
  reportedAt?: string;
  fastingStatus?: string;
  results?: Array<{
    analyte: string;
    slug?: string;
    value?: number;
    textValue?: string;
    comparator?: string;
    unit?: string;
    flag?: string;
    biomarkerSlug?: string;
    referenceRange?: {
      low?: number;
      high?: number;
      text?: string;
    };
    note?: string;
  }>;
}

function createBloodTestCli() {
  const cli = Cli.create("vault-cli", {
    description: "blood-test typed save test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);

  registerBloodTestCommands(cli, createIntegratedVaultServices());
  return cli;
}

async function runRawInProcessCli(
  cli: Cli.Cli,
  args: string[],
): Promise<string> {
  const output: string[] = [];
  let exitCode: number | null = null;

  await cli.serve(args, {
    env: process.env,
    exit(code) {
      exitCode = code;
    },
    stdout(chunk) {
      output.push(chunk);
    },
  });

  assert.equal(exitCode, null);
  return output.join("").trim();
}

async function readCommandSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<CommandSchemaEnvelope> {
  return JSON.parse(
    await runRawInProcessCli(cli, [...commandArgs, "--schema", "--format", "json"]),
  ) as CommandSchemaEnvelope;
}

async function readLedgerRecords(
  vaultRoot: string,
  relativePath: string,
): Promise<StoredBloodTestEvent[]> {
  const content = await readFile(path.join(vaultRoot, relativePath), "utf8");
  return content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as StoredBloodTestEvent);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      return (error as { code?: string }).code !== "ENOENT";
    }

    throw error;
  }
}

function resultArg(result: Record<string, unknown>): string {
  return JSON.stringify(result);
}

test("blood-test save schema exposes typed fields while blood-test import-json remains the JSON fallback", async () => {
  const cli = createBloodTestCli();

  const saveSchema = await readCommandSchema(cli, ["blood-test", "save"]);
  assert.deepEqual(saveSchema.args.required, ["title"]);
  assert.equal("input" in saveSchema.options.properties, false);
  assert.equal(saveSchema.options.required?.includes("input") ?? false, false);

  for (const field of [
    "id",
    "occurredAt",
    "recordedAt",
    "timeZone",
    "source",
    "note",
    "tag",
    "link",
    "rawRef",
    "testName",
    "resultStatus",
    "summary",
    "specimenType",
    "labName",
    "labPanelId",
    "collectedAt",
    "reportedAt",
    "fastingStatus",
    "result",
  ]) {
    assert.equal(field in saveSchema.options.properties, true, field);
  }
  assert.match(
    JSON.stringify(saveSchema.options.properties.result),
    /JSON object/u,
  );
  assert.doesNotMatch(
    JSON.stringify(saveSchema.options.properties.result),
    /key=value|semicolon-separated|compact/u,
  );

  const saveHelp = await runRawInProcessCli(cli, ["blood-test", "save", "--help"]);
  assert.match(
    saveHelp,
    /\{"analyte":"Apolipoprotein B","value":87,"unit":"mg\/dL"/u,
  );
  assert.match(
    saveHelp,
    /\{"analyte":"ANA","textValue":"Negative","flag":"normal","referenceRange":\{"text":"Negative"\}\}/u,
  );

  const importJsonSchema = await readCommandSchema(cli, ["blood-test", "import-json"]);
  assert.equal("input" in importJsonSchema.options.properties, true);
  assert.equal(importJsonSchema.options.required?.includes("input") ?? false, true);
  assert.deepEqual(importJsonSchema.args.required ?? [], []);
  await assert.rejects(async () => {
    await readCommandSchema(cli, ["blood-test", "upsert"]);
  });
});

test("blood-test scaffold includes numeric and text result examples", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-scaffold-",
  );

  try {
    const cli = createBloodTestCli();
    const scaffold = await runInProcessJsonCli<BloodTestScaffoldResult>(cli, [
      "blood-test",
      "scaffold",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(scaffold.exitCode, null, JSON.stringify(scaffold.envelope));
    const payload = requireData(scaffold.envelope).payload;
    assert.deepEqual(payload.results?.map((result) => result.analyte), [
      "Apolipoprotein B",
      "ANA",
    ]);
    assert.equal(payload.results?.[0]?.value, 87);
    assert.equal(payload.results?.[1]?.textValue, "Negative");
    assert.equal(payload.results?.[1]?.referenceRange?.text, "Negative");
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test save maps typed fields and can revise a saved event id", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-save-",
  );

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });

    const savedResult = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "save",
      "Functional health panel",
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--recorded-at",
      "2026-03-12T14:00:00.000Z",
      "--time-zone",
      "America/New_York",
      "--source",
      "manual",
      "--note",
      "Drawn before breakfast.",
      "--tag",
      "cardio",
      "--tag",
      "baseline",
      "--link",
      "supports_goal:goal_01JNY0B2W4VG5C2A0G9S8M7R6S",
      "--raw-ref",
      "raw/labs/panel.pdf",
      "--test-name",
      "functional_health_panel",
      "--result-status",
      "mixed",
      "--summary",
      "Two lipid markers reviewed.",
      "--specimen-type",
      "serum",
      "--lab-name",
      "Function Health",
      "--lab-panel-id",
      "panel-2026-03",
      "--collected-at",
      "2026-03-12T12:00:00.000Z",
      "--reported-at",
      "2026-03-13T12:00:00.000Z",
      "--fasting-status",
      "fasting",
      "--result",
      resultArg({
        analyte: "Apolipoprotein B",
        slug: "apob",
        value: 87,
        unit: "mg/dL",
        flag: "normal",
        biomarkerSlug: "apolipoprotein-b",
        referenceRange: {
          text: "<90",
        },
        note: "Target range",
      }),
      "--result",
      resultArg({
        analyte: "LDL Cholesterol",
        value: 134,
        comparator: ">",
        unit: "mg/dL",
        flag: "high",
        referenceRange: {
          low: 0,
          high: 99,
        },
      }),
      "--vault",
      vaultRoot,
    ]);
    assert.equal(savedResult.exitCode, null, JSON.stringify(savedResult.envelope));

    const saved = requireData(savedResult.envelope);
    assert.equal(saved.created, true);
    assert.equal(saved.lookupId, saved.eventId);
    assert.equal(saved.ledgerFile, "ledger/events/2026/2026-03.jsonl");

    const records = await readLedgerRecords(vaultRoot, saved.ledgerFile);
    const event = records[0];
    assert.equal(event?.id, saved.eventId);
    assert.equal(event?.title, "Functional health panel");
    assert.equal(event?.kind, "test");
    assert.equal(event?.source, "manual");
    assert.equal(event?.note, "Drawn before breakfast.");
    assert.deepEqual(event?.tags, ["baseline", "cardio"]);
    assert.deepEqual(event?.links, [
      {
        type: "supports_goal",
        targetId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6S",
      },
    ]);
    assert.deepEqual(event?.rawRefs, ["raw/labs/panel.pdf"]);
    assert.equal(event?.testName, "functional_health_panel");
    assert.equal(event?.resultStatus, "mixed");
    assert.equal(event?.summary, "Two lipid markers reviewed.");
    assert.equal(event?.testCategory, "blood");
    assert.equal(event?.specimenType, "serum");
    assert.equal(event?.labName, "Function Health");
    assert.equal(event?.labPanelId, "panel-2026-03");
    assert.equal(event?.collectedAt, "2026-03-12T12:00:00.000Z");
    assert.equal(event?.reportedAt, "2026-03-13T12:00:00.000Z");
    assert.equal(event?.fastingStatus, "fasting");
    assert.deepEqual(event?.results, [
      {
        analyte: "Apolipoprotein B",
        slug: "apob",
        value: 87,
        unit: "mg/dL",
        flag: "normal",
        biomarkerSlug: "apolipoprotein-b",
        referenceRange: {
          text: "<90",
        },
        note: "Target range",
      },
      {
        analyte: "LDL Cholesterol",
        value: 134,
        comparator: ">",
        unit: "mg/dL",
        flag: "high",
        referenceRange: {
          low: 0,
          high: 99,
        },
      },
    ]);

    const revisedResult = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "save",
      "Functional health panel revised",
      "--id",
      saved.eventId,
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--test-name",
      "functional_health_panel",
      "--result",
      resultArg({
        analyte: "Ferritin",
        textValue: "not tested",
        flag: "unknown",
      }),
      "--vault",
      vaultRoot,
    ]);
    assert.equal(revisedResult.exitCode, null, JSON.stringify(revisedResult.envelope));
    assert.equal(requireData(revisedResult.envelope).eventId, saved.eventId);

    const revisedRecords = await readLedgerRecords(vaultRoot, saved.ledgerFile);
    assert.equal(revisedRecords.length, 2);
    assert.equal(revisedRecords[1]?.id, saved.eventId);
    assert.equal(revisedRecords[1]?.title, "Functional health panel revised");
    assert.deepEqual(revisedRecords[1]?.results, [
      {
        analyte: "Ferritin",
        textValue: "not tested",
        flag: "unknown",
      },
    ]);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test import-json points valueText typo at textValue", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-value-text-",
  );
  const payloadPath = path.join(parentRoot, "blood-test.json");

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });
    await writeFile(
      payloadPath,
      JSON.stringify({
        occurredAt: "2026-03-12T13:00:00.000Z",
        title: "ANA panel",
        testName: "ana_panel",
        results: [
          {
            analyte: "ANA",
            valueText: "Negative",
          },
        ],
      }),
      "utf8",
    );

    const imported = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(imported.exitCode, 1);
    assert.equal(imported.envelope.ok, false);
    assert.equal(
      imported.envelope.error.message,
      "results[0].valueText is not supported. Did you mean results[0].textValue?",
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test import-json preserves core-normalized nullable fields, tags, and result slugs", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-import-normalize-",
  );
  const payloadPath = path.join(parentRoot, "blood-test.json");

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });
    await writeFile(
      payloadPath,
      JSON.stringify({
        occurredAt: "2026-03-12T13:00:00-05:00",
        title: "Functional health panel",
        testName: "functional_health_panel",
        labName: null,
        collectedAt: "2026-03-12T08:30:00-05:00",
        tags: ["Lab Export"],
        results: [
          {
            analyte: "Apolipoprotein B",
            slug: "Apo B",
            biomarkerSlug: "Cardio Apo B",
            value: null,
            textValue: "not tested",
            unit: "mg/dL",
          },
        ],
      }),
      "utf8",
    );

    const imported = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(imported.exitCode, null, JSON.stringify(imported.envelope));
    const saved = requireData(imported.envelope);
    assert.equal(saved.ledgerFile, "ledger/events/2026/2026-03.jsonl");

    const [event] = await readLedgerRecords(vaultRoot, saved.ledgerFile);
    assert.equal(event?.occurredAt, "2026-03-12T18:00:00.000Z");
    assert.equal(event?.collectedAt, "2026-03-12T13:30:00.000Z");
    assert.deepEqual(event?.tags, ["lab-export"]);
    assert.equal(event?.labName, undefined);
    assert.equal(event?.results?.[0]?.value, undefined);
    assert.equal(event?.results?.[0]?.textValue, "not tested");
    assert.equal(event?.results?.[0]?.slug, "apo-b");
    assert.equal(event?.results?.[0]?.biomarkerSlug, "cardio-apo-b");
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test import-json accepts legacy date-only timestamps", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-import-date-only-",
  );
  const payloadPath = path.join(parentRoot, "blood-test.json");

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });
    await writeFile(
      payloadPath,
      JSON.stringify({
        occurredAt: "2026-03-12",
        title: "Functional health panel",
        testName: "functional_health_panel",
      }),
      "utf8",
    );

    const imported = await runInProcessJsonCli(cli, [
      "blood-test",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(imported.exitCode, null, JSON.stringify(imported.envelope));
    assert.equal(imported.envelope.ok, true);
    const saved = requireData(imported.envelope);
    assert.equal(saved.created, true);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test import-json accepts pending payloads without results", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-import-pending-",
  );
  const payloadPath = path.join(parentRoot, "blood-test.json");

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });
    await writeFile(
      payloadPath,
      JSON.stringify({
        occurredAt: "2026-03-12T13:00:00.000Z",
        title: "Pending functional health panel",
        testName: "functional_health_panel",
        resultStatus: "pending",
      }),
      "utf8",
    );

    const imported = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "import-json",
      "--input",
      `@${payloadPath}`,
      "--vault",
      vaultRoot,
    ]);

    assert.equal(imported.exitCode, null, JSON.stringify(imported.envelope));
    const saved = requireData(imported.envelope);
    assert.equal(saved.ledgerFile, "ledger/events/2026/2026-03.jsonl");

    const [event] = await readLedgerRecords(vaultRoot, saved.ledgerFile);
    assert.equal(event?.resultStatus, "pending");
    assert.equal(event?.results, undefined);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test save points valueText typo at textValue", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-save-value-text-",
  );

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });

    const saved = await runInProcessJsonCli(cli, [
      "blood-test",
      "save",
      "ANA panel",
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--test-name",
      "ana_panel",
      "--result",
      JSON.stringify({
        analyte: "ANA",
        valueText: "Negative",
      }),
      "--vault",
      vaultRoot,
    ]);

    assert.equal(saved.exitCode, 1);
    assert.equal(saved.envelope.ok, false);
    assert.equal(
      saved.envelope.error.message,
      "--result.valueText is not supported. Did you mean --result.textValue?",
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test save accepts JSON result objects with semicolons in reference text", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-save-json-result-",
  );

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });

    const savedResult = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "save",
      "Structured panel",
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--test-name",
      "structured_panel",
      "--result",
      JSON.stringify({
        analyte: "Glucose",
        value: 92,
        unit: "mg/dL",
        flag: "normal",
        referenceRange: {
          text: "70-99 fasting; <140 non-fasting",
        },
        note: "Morning draw; no symptoms noted",
      }),
      "--vault",
      vaultRoot,
    ]);

    assert.equal(savedResult.exitCode, null, JSON.stringify(savedResult.envelope));
    const saved = requireData(savedResult.envelope);
    const records = await readLedgerRecords(vaultRoot, saved.ledgerFile ?? "");
    assert.deepEqual(records[0]?.results, [
      {
        analyte: "Glucose",
        value: 92,
        unit: "mg/dL",
        flag: "normal",
        referenceRange: {
          text: "70-99 fasting; <140 non-fasting",
        },
        note: "Morning draw; no symptoms noted",
      },
    ]);
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test save rejects rewriting a non-blood-test event id", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-save-wrong-kind-",
  );

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });
    const note = await upsertEvent({
      vaultRoot,
      payload: {
        id: "evt_01JNYB6M9A6W4K2N8P3Q7R5T1A",
        kind: "note",
        title: "Non-test note",
        occurredAt: "2026-03-12T13:00:00.000Z",
        note: "Original note.",
      },
    });

    const result = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "save",
      "Functional health panel",
      "--id",
      note.eventId,
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--test-name",
      "functional_health_panel",
      "--result",
      resultArg({
        analyte: "Ferritin",
        textValue: "not tested",
      }),
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, "invalid_input");
    }
    const records = await readLedgerRecords(vaultRoot, "ledger/events/2026/2026-03.jsonl");
    assert.equal(records.length, 1);
    assert.equal(records[0]?.kind, "note");
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test save rejects malformed JSON result without echoing payload text", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-save-invalid-json-result-",
  );

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "save",
      "Malformed JSON panel",
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--test-name",
      "malformed_json_panel",
      "--result",
      '{"analyte":"Glucose","value":92,"referenceRange":{"text":"fasting; non-fasting"}',
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    assert.equal(result.envelope.error.code, "invalid_option");
    assert.match(result.envelope.error.message ?? "", /valid JSON/u);
    assert.doesNotMatch(result.envelope.error.message ?? "", /fasting/u);
    assert.equal(
      await pathExists(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl")),
      false,
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test save rejects JSON objects that are not analyte records without writing an event", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-save-invalid-json-object-result-",
  );

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "save",
      "Invalid analyte panel",
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--test-name",
      "invalid_analyte_panel",
      "--result",
      JSON.stringify({
        note: "Ferritin; private marker",
      }),
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    assert.equal(result.envelope.error.code, "invalid_option");
    assert.match(result.envelope.error.message ?? "", /analyte payload/u);
    assert.doesNotMatch(result.envelope.error.message ?? "", /Ferritin|private marker/u);
    assert.equal(
      await pathExists(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl")),
      false,
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test save rejects JSON result arrays with repeat-result guidance", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-save-json-result-array-",
  );

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "save",
      "Array JSON panel",
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--test-name",
      "array_json_panel",
      "--result",
      JSON.stringify([{ analyte: "Glucose", value: 92 }]),
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    assert.equal(result.envelope.error.code, "invalid_option");
    assert.match(result.envelope.error.message ?? "", /one object per analyte/u);
    assert.match(result.envelope.error.message ?? "", /Repeat --result/u);
    assert.match(result.envelope.error.message ?? "", /blood-test import-json/u);
    assert.equal(
      await pathExists(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl")),
      false,
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test save rejects old compact result syntax without writing an event", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-save-compact-result-",
  );

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "save",
      "Malformed panel",
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--test-name",
      "malformed_panel",
      "--result",
      "analyte=Ferritin;value=45;unit=ng/mL",
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    assert.equal(result.envelope.error.code, "invalid_option");
    assert.match(result.envelope.error.message ?? "", /JSON object/u);
    assert.match(result.envelope.error.message ?? "", /blood-test import-json/u);
    assert.doesNotMatch(result.envelope.error.message ?? "", /Ferritin/u);
    assert.equal(
      await pathExists(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl")),
      false,
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test save rejects non-vault raw refs before writing an event", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-save-invalid-raw-ref-",
  );

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "save",
      "Panel with invalid raw ref",
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--test-name",
      "invalid_raw_ref_panel",
      "--raw-ref",
      "/tmp/lab.pdf",
      "--result",
      resultArg({
        analyte: "Ferritin",
        value: 45,
        unit: "ng/mL",
      }),
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    assert.equal(result.envelope.error.code, "VALIDATION_ERROR");
    assert.match(result.envelope.error.message ?? "", /raw/i);
    assert.equal(
      await pathExists(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl")),
      false,
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blood-test save rejects raw refs with traversal segments before writing an event", async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    "murph-cli-blood-test-save-traversal-raw-ref-",
  );

  try {
    const cli = createBloodTestCli();
    await initializeVault({ vaultRoot });

    const result = await runInProcessJsonCli<BloodTestSaveResult>(cli, [
      "blood-test",
      "save",
      "Panel with traversal raw ref",
      "--occurred-at",
      "2026-03-12T13:00:00.000Z",
      "--test-name",
      "traversal_raw_ref_panel",
      "--raw-ref",
      "raw/../lab.pdf",
      "--result",
      resultArg({
        analyte: "Ferritin",
        value: 45,
        unit: "ng/mL",
      }),
      "--vault",
      vaultRoot,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    assert.equal(result.envelope.error.code, "VALIDATION_ERROR");
    assert.match(result.envelope.error.message ?? "", /raw/i);
    assert.equal(
      await pathExists(path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl")),
      false,
    );
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    });
  }
});
