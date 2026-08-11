import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  allergyFrontmatterSchema,
  automationFrontmatterSchema,
  assessmentResponseSchema,
  auditRecordSchema,
  conditionFrontmatterSchema,
  coreFrontmatterSchema,
  CURRENT_VAULT_FORMAT_VERSION,
  type ContractSchema,
  exampleAssessmentResponses,
  exampleAuditRecords,
  exampleEventRecords,
  exampleFrontmatterMarkdown,
  exampleFrontmatterObjects,
  exampleHealthFrontmatterObjects,
  examplePreferencesDocument,
  eventRecordSchema,
  EVENT_KINDS,
  experimentFrontmatterSchema,
  familyMemberFrontmatterSchema,
  foodFrontmatterSchema,
  geneticVariantFrontmatterSchema,
  goalFrontmatterSchema,
  healthEntityDefinitionByKind,
  healthEntityDefinitions,
  isStrictIsoDate,
  isStrictIsoDateTime,
  journalDayFrontmatterSchema,
  memoryDocumentFrontmatterSchema,
  exampleSampleRecords,
  normalizeStrictIsoTimestamp,
  preferencesDocumentSchema,
  scheduledLogFrontmatterSchema,
  exampleVaultMetadata,
  providerFrontmatterSchema,
  recipeFrontmatterSchema,
  protocolFrontmatterSchema,
  regimenFrontmatterSchema,
  safeParseContract,
  sampleRecordSchema,
  VAULT_FAMILY_DESCRIPTORS,
  vaultMetadataSchema,
  workoutFormatFrontmatterSchema,
  parseFrontmatterDocument,
} from "@murphai/contracts";
import { schemaCatalog } from "@murphai/contracts/schemas";

interface PackageJsonShape {
  main?: string;
  types?: string;
  exports?: Record<
    string,
    {
      default?: string;
      types?: string;
    } | string
  >;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "../..");
const generatedDir = path.resolve(__dirname, "../../generated");
const distDir = path.join(packageDir, "dist");

function assertNoErrors(label: string, value: unknown, schema: ContractSchema): void {
  const result = safeParseContract(schema, value);
  if (!result.success) {
    throw new Error(`${label} failed validation:\n${result.errors.join("\n")}`);
  }
}

function assertHasErrors(
  label: string,
  value: unknown,
  schema: ContractSchema,
  patterns: RegExp[],
): void {
  const result = safeParseContract(schema, value);
  assert.equal(result.success, false, `${label} unexpectedly passed validation`);

  const joinedErrors = result.errors.join("\n");
  patterns.forEach((pattern) => assert.match(joinedErrors, pattern, label));
}

const packageJson = JSON.parse(
  await readFile(path.join(packageDir, "package.json"), "utf8"),
) as PackageJsonShape;

assert.equal(packageJson.main, "./dist/index.js");
assert.equal(packageJson.types, "./dist/index.d.ts");
assert.deepEqual(packageJson.exports?.["."], {
  types: "./dist/index.d.ts",
  import: "./dist/index.js",
  default: "./dist/index.js",
});
assert.deepEqual(packageJson.exports?.["./schemas"], {
  types: "./dist/schemas.d.ts",
  import: "./dist/schemas.js",
  default: "./dist/schemas.js",
});
assert.deepEqual(packageJson.exports?.["./zod-runtime"], {
  types: "./dist/zod-runtime.d.ts",
  import: "./dist/zod-runtime.js",
  default: "./dist/zod-runtime.js",
});

await assertPathExists(path.join(distDir, "index.js"));
await assertPathExists(path.join(distDir, "index.d.ts"));
await assertPathExists(path.join(distDir, "schemas.js"));
await assertPathExists(path.join(distDir, "zod.js"));
await assertPathExists(path.join(distDir, "zod-runtime.js"));
await assertPathExists(path.join(distDir, "scripts", "generate-json-schema.js"));
await assertPathExists(path.join(distDir, "scripts", "verify.js"));
await assertPathMissing(path.join(distDir, "src"));

for (const [name, sourceSchema] of Object.entries(schemaCatalog)) {
  const artifactPath = path.join(generatedDir, `${name}.schema.json`);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  assert.deepEqual(
    artifact,
    sourceSchema,
    `Schema artifact ${path.basename(artifactPath)} is stale or mismatched`,
  );
}

assert.deepEqual(Object.keys(schemaCatalog).sort(), [
  "assessment-response",
  "assistant-preference-mutations",
  "audit-record",
  "blood-test-import-payload",
  "condition-import-payload",
  "event-record",
  "frontmatter-allergy",
  "frontmatter-automation",
  "frontmatter-condition",
  "frontmatter-core",
  "frontmatter-experiment",
  "frontmatter-family-member",
  "frontmatter-food",
  "frontmatter-genetic-variant",
  "frontmatter-goal",
  "frontmatter-habitat",
  "frontmatter-journal-day",
  "frontmatter-protocol",
  "frontmatter-memory",
  "frontmatter-provider",
  "frontmatter-regimen",
  "frontmatter-recipe",
  "frontmatter-scheduled-log",
  "frontmatter-workout-format",
  "inbox-attachment-retention-record",
  "inbox-capture-record",
  "integration-ingest-record",
  "metric-sample-record",
  "preferences-document",
  "sample-record",
  "vault-metadata",
  "workout-import-payload",
].sort());
const schemaCatalogIds = new Set(
  Object.values(schemaCatalog)
    .map((schema) => (schema as { $id?: unknown }).$id)
    .filter((value): value is string => typeof value === "string"),
);
for (const family of VAULT_FAMILY_DESCRIPTORS) {
  if (!("validation" in family) || !family.validation) {
    continue;
  }

  const metadata = family.validation.schema.meta();
  if (!metadata) {
    throw new Error(`Validated vault family "${family.id}" is missing schema metadata.`);
  }

  assert.equal(
    typeof metadata.$id,
    "string",
    `Validated vault family "${family.id}" is missing schema $id metadata.`,
  );
  assert.equal(
    typeof metadata.title,
    "string",
    `Validated vault family "${family.id}" is missing schema title metadata.`,
  );
  assert.equal(
    schemaCatalogIds.has(metadata.$id as string),
    true,
    `Validated vault family "${family.id}" is missing from schemaCatalog.`,
  );
}
assert.equal((schemaCatalog["event-record"] as { oneOf?: unknown[] }).oneOf?.length, EVENT_KINDS.length);
assert.equal((schemaCatalog["sample-record"] as { oneOf?: unknown[] }).oneOf?.length, 8);
assert.equal(
  healthEntityDefinitions.map((definition) => String(definition.kind)).includes("history"),
  false,
);
assert.equal(healthEntityDefinitionByKind.has("blood_test"), true);
assert.equal(healthEntityDefinitionByKind.has("immunization"), true);
assert.equal(
  (schemaCatalog["frontmatter-core"] as { additionalProperties?: unknown }).additionalProperties,
  false,
);
assert.equal(
  (
    (schemaCatalog["frontmatter-goal"] as { properties?: Record<string, { type?: unknown }> }).properties
      ?.priority
  )?.type,
  "integer",
);
assert.equal(
  (
    (schemaCatalog["frontmatter-family-member"] as { properties?: Record<string, { maxLength?: unknown }> }).properties
      ?.title
  )?.maxLength,
  160,
);
assert.equal(
  (
    (schemaCatalog["frontmatter-genetic-variant"] as { properties?: Record<string, { maxLength?: unknown }> }).properties
      ?.gene
  )?.maxLength,
  40,
);
assert.equal(
  (
    (schemaCatalog["vault-metadata"] as { properties?: Record<string, { const?: unknown }> }).properties
      ?.formatVersion
  )?.const,
  CURRENT_VAULT_FORMAT_VERSION,
);
assert.equal(isStrictIsoDate("2024-02-29"), true);
assert.equal(isStrictIsoDate("2024-02-31"), false);
assert.equal(isStrictIsoDateTime("2024-04-30T12:00:00Z"), true);
assert.equal(isStrictIsoDateTime("2024-04-31T12:00:00Z"), false);
assert.equal(
  normalizeStrictIsoTimestamp("2026-03-11T14:00:00-05:00"),
  "2026-03-11T19:00:00.000Z",
);
assert.equal(normalizeStrictIsoTimestamp("2024-02-31"), null);

assertNoErrors("vault metadata example", exampleVaultMetadata, vaultMetadataSchema);
exampleAssessmentResponses.forEach((record, index) =>
  assertNoErrors(`assessment response example ${index + 1}`, record, assessmentResponseSchema),
);
exampleEventRecords.forEach((record, index) => assertNoErrors(`event example ${index + 1}`, record, eventRecordSchema));
exampleSampleRecords.forEach((record, index) => assertNoErrors(`sample example ${index + 1}`, record, sampleRecordSchema));
exampleAuditRecords.forEach((record, index) => assertNoErrors(`audit example ${index + 1}`, record, auditRecordSchema));
assertNoErrors("preferences document example", examplePreferencesDocument, preferencesDocumentSchema);

assertNoErrors("automation frontmatter object", exampleFrontmatterObjects.automation, automationFrontmatterSchema);
assertNoErrors("core frontmatter object", exampleFrontmatterObjects.core, coreFrontmatterSchema);
assertNoErrors("journal day frontmatter object", exampleFrontmatterObjects.journalDay, journalDayFrontmatterSchema);
assertNoErrors("memory frontmatter object", exampleFrontmatterObjects.memory, memoryDocumentFrontmatterSchema);
assertNoErrors("experiment frontmatter object", exampleFrontmatterObjects.experiment, experimentFrontmatterSchema);
assertNoErrors("food frontmatter object", exampleFrontmatterObjects.food, foodFrontmatterSchema);
assertNoErrors("provider frontmatter object", exampleFrontmatterObjects.provider, providerFrontmatterSchema);
assertNoErrors("recipe frontmatter object", exampleFrontmatterObjects.recipe, recipeFrontmatterSchema);
assertNoErrors("scheduled-log frontmatter object", exampleFrontmatterObjects.scheduledLog, scheduledLogFrontmatterSchema);
assertNoErrors(
  "workout-format frontmatter object",
  exampleFrontmatterObjects.workoutFormat,
  workoutFormatFrontmatterSchema,
);
assertNoErrors("goal frontmatter object", exampleHealthFrontmatterObjects.goal, goalFrontmatterSchema);
assertNoErrors("condition frontmatter object", exampleHealthFrontmatterObjects.condition, conditionFrontmatterSchema);
assertNoErrors("allergy frontmatter object", exampleHealthFrontmatterObjects.allergy, allergyFrontmatterSchema);
assertNoErrors("protocol frontmatter object", exampleHealthFrontmatterObjects.protocol, protocolFrontmatterSchema);
assertNoErrors(
  "regimen frontmatter object",
  exampleHealthFrontmatterObjects.regimen,
  regimenFrontmatterSchema,
);
assertNoErrors("family-member frontmatter object", exampleHealthFrontmatterObjects.familyMember, familyMemberFrontmatterSchema);
assertNoErrors("genetic-variant frontmatter object", exampleHealthFrontmatterObjects.geneticVariant, geneticVariantFrontmatterSchema);
assertHasErrors(
  "sample record rejects overflow recordedAt",
  {
    ...exampleSampleRecords[0],
    recordedAt: "2024-02-31T12:00:00Z",
  },
  sampleRecordSchema,
  [/recordedAt/u, /Invalid ISO date-time string/u],
);
assertHasErrors(
  "experiment frontmatter rejects overflow startedOn",
  {
    ...exampleFrontmatterObjects.experiment,
    startedOn: "2024-02-31",
  },
  experimentFrontmatterSchema,
  [/startedOn/u, /Invalid ISO date string/u],
);

assert.deepEqual(
  parseFrontmatterDocument(exampleFrontmatterMarkdown.automation).attributes,
  exampleFrontmatterObjects.automation,
);
assert.deepEqual(
  parseFrontmatterDocument(exampleFrontmatterMarkdown.core).attributes,
  exampleFrontmatterObjects.core,
);
assert.deepEqual(
  parseFrontmatterDocument(exampleFrontmatterMarkdown.journalDay).attributes,
  exampleFrontmatterObjects.journalDay,
);
assert.deepEqual(
  parseFrontmatterDocument(exampleFrontmatterMarkdown.memory).attributes,
  exampleFrontmatterObjects.memory,
);
assert.deepEqual(
  parseFrontmatterDocument(exampleFrontmatterMarkdown.experiment).attributes,
  exampleFrontmatterObjects.experiment,
);
assert.deepEqual(
  parseFrontmatterDocument(exampleFrontmatterMarkdown.food).attributes,
  exampleFrontmatterObjects.food,
);
assert.deepEqual(
  parseFrontmatterDocument(exampleFrontmatterMarkdown.provider).attributes,
  exampleFrontmatterObjects.provider,
);
assert.deepEqual(
  parseFrontmatterDocument(exampleFrontmatterMarkdown.recipe).attributes,
  exampleFrontmatterObjects.recipe,
);
assert.deepEqual(
  parseFrontmatterDocument(exampleFrontmatterMarkdown.scheduledLog).attributes,
  exampleFrontmatterObjects.scheduledLog,
);
assert.deepEqual(
  parseFrontmatterDocument(exampleFrontmatterMarkdown.workoutFormat).attributes,
  exampleFrontmatterObjects.workoutFormat,
);
assert.deepEqual(
  parseFrontmatterDocument(`---
title: Example
details:
  nested: true
---

Body line
`),
  {
    attributes: {
      title: "Example",
      details: {
        nested: true,
      },
    },
    body: "\nBody line\n",
    rawFrontmatter: "title: Example\ndetails:\n  nested: true",
  },
);
assert.deepEqual(
  parseFrontmatterDocument(`---
title broken
---

Body line
`, {
    mode: "tolerant",
    bodyNormalization: "trim",
  }),
  {
    attributes: {},
    body: "---\ntitle broken\n---\n\nBody line",
    rawFrontmatter: null,
  },
);
assert.throws(
  () =>
    parseFrontmatterDocument(`---
title broken
---
`),
  /Expected a "key: value" frontmatter line\./,
);

assertHasErrors(
  "core frontmatter rejects unexpected keys",
  {
    ...exampleFrontmatterObjects.core,
    unexpected: true,
  },
  coreFrontmatterSchema,
  [/^\$: Unrecognized key/i],
);
assertHasErrors(
  "event validation keeps field paths for discriminated unions",
  {
    ...exampleEventRecords[0],
    kind: "note",
    note: undefined,
  },
  eventRecordSchema,
  [/^\$\.note:/m],
);
assertHasErrors(
  "event validation rejects duplicate tag arrays",
  {
    ...exampleEventRecords[0],
    kind: "encounter",
    encounterType: "follow_up",
    tags: ["repeat", "repeat"],
  },
  eventRecordSchema,
  [/unique array items/i],
);

console.log(
  [
    "Verified schema artifacts and examples.",
    `assessments=${exampleAssessmentResponses.length}`,
    `events=${exampleEventRecords.length}`,
    `samples=${exampleSampleRecords.length}`,
    `audits=${exampleAuditRecords.length}`,
  ].join(" "),
);

async function assertPathExists(filePath: string): Promise<void> {
  await access(filePath);
}

async function assertPathMissing(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    return;
  }

  throw new Error(`Unexpected build artifact path present: ${path.relative(packageDir, filePath)}`);
}
