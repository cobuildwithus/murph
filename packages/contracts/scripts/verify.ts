import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  allergyFrontmatterSchema,
  assessmentResponseSchema,
  auditRecordSchema,
  conditionFrontmatterSchema,
  coreFrontmatterSchema,
  type ContractSchema,
  exampleAssessmentResponses,
  exampleAuditRecords,
  exampleEventRecords,
  exampleFrontmatterMarkdown,
  exampleFrontmatterObjects,
  exampleHealthFrontmatterObjects,
  eventRecordSchema,
  experimentFrontmatterSchema,
  familyMemberFrontmatterSchema,
  geneticVariantFrontmatterSchema,
  goalFrontmatterSchema,
  journalDayFrontmatterSchema,
  exampleProfileSnapshots,
  exampleSampleRecords,
  exampleVaultMetadata,
  profileCurrentFrontmatterSchema,
  profileSnapshotSchema,
  providerFrontmatterSchema,
  regimenFrontmatterSchema,
  safeParseContract,
  sampleRecordSchema,
  vaultMetadataSchema,
  parseFrontmatterMarkdown,
  parseFrontmatterDocument,
} from "@healthybob/contracts";
import { schemaCatalog } from "@healthybob/contracts/schemas";

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

await assertPathExists(path.join(distDir, "index.js"));
await assertPathExists(path.join(distDir, "index.d.ts"));
await assertPathExists(path.join(distDir, "schemas.js"));
await assertPathExists(path.join(distDir, "zod.js"));
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
  "audit-record",
  "event-record",
  "frontmatter-allergy",
  "frontmatter-condition",
  "frontmatter-core",
  "frontmatter-experiment",
  "frontmatter-family-member",
  "frontmatter-genetic-variant",
  "frontmatter-goal",
  "frontmatter-journal-day",
  "frontmatter-profile-current",
  "frontmatter-provider",
  "frontmatter-regimen",
  "profile-snapshot",
  "sample-record",
  "vault-metadata",
]);
assert.equal((schemaCatalog["event-record"] as { oneOf?: unknown[] }).oneOf?.length, 15);
assert.equal((schemaCatalog["sample-record"] as { oneOf?: unknown[] }).oneOf?.length, 7);
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
    (schemaCatalog["frontmatter-profile-current"] as { properties?: Record<string, { format?: unknown }> }).properties
      ?.updatedAt
  )?.format,
  "date-time",
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

assertNoErrors("vault metadata example", exampleVaultMetadata, vaultMetadataSchema);
exampleAssessmentResponses.forEach((record, index) =>
  assertNoErrors(`assessment response example ${index + 1}`, record, assessmentResponseSchema),
);
exampleEventRecords.forEach((record, index) => assertNoErrors(`event example ${index + 1}`, record, eventRecordSchema));
exampleProfileSnapshots.forEach((record, index) =>
  assertNoErrors(`profile snapshot example ${index + 1}`, record, profileSnapshotSchema),
);
exampleSampleRecords.forEach((record, index) => assertNoErrors(`sample example ${index + 1}`, record, sampleRecordSchema));
exampleAuditRecords.forEach((record, index) => assertNoErrors(`audit example ${index + 1}`, record, auditRecordSchema));

assertNoErrors("core frontmatter object", exampleFrontmatterObjects.core, coreFrontmatterSchema);
assertNoErrors("journal day frontmatter object", exampleFrontmatterObjects.journalDay, journalDayFrontmatterSchema);
assertNoErrors("experiment frontmatter object", exampleFrontmatterObjects.experiment, experimentFrontmatterSchema);
assertNoErrors("provider frontmatter object", exampleFrontmatterObjects.provider, providerFrontmatterSchema);
assertNoErrors("profile current frontmatter object", exampleHealthFrontmatterObjects.profileCurrent, profileCurrentFrontmatterSchema);
assertNoErrors("goal frontmatter object", exampleHealthFrontmatterObjects.goal, goalFrontmatterSchema);
assertNoErrors("condition frontmatter object", exampleHealthFrontmatterObjects.condition, conditionFrontmatterSchema);
assertNoErrors("allergy frontmatter object", exampleHealthFrontmatterObjects.allergy, allergyFrontmatterSchema);
assertNoErrors("regimen frontmatter object", exampleHealthFrontmatterObjects.regimen, regimenFrontmatterSchema);
assertNoErrors("family-member frontmatter object", exampleHealthFrontmatterObjects.familyMember, familyMemberFrontmatterSchema);
assertNoErrors("genetic-variant frontmatter object", exampleHealthFrontmatterObjects.geneticVariant, geneticVariantFrontmatterSchema);

assert.deepEqual(parseFrontmatterMarkdown(exampleFrontmatterMarkdown.core), exampleFrontmatterObjects.core);
assert.deepEqual(parseFrontmatterMarkdown(exampleFrontmatterMarkdown.journalDay), exampleFrontmatterObjects.journalDay);
assert.deepEqual(parseFrontmatterMarkdown(exampleFrontmatterMarkdown.experiment), exampleFrontmatterObjects.experiment);
assert.deepEqual(parseFrontmatterMarkdown(exampleFrontmatterMarkdown.provider), exampleFrontmatterObjects.provider);
assert.deepEqual(
  parseFrontmatterMarkdown(`---
flag: true
count: 42
tags:
  - true
  - 42
---
`),
  {
    flag: "true",
    count: "42",
    tags: ["true", "42"],
  },
);
assert.throws(
  () =>
    parseFrontmatterMarkdown(`---
details:
  nested: true
---
`),
  /Unsupported frontmatter line:   nested: true/,
);
assert.throws(
  () =>
    parseFrontmatterMarkdown(`---
schema-version: hb.frontmatter.core.v1
---
`),
  /Unsupported frontmatter line: schema-version: hb\.frontmatter\.core\.v1/,
);
assert.throws(
  () =>
    parseFrontmatterMarkdown(`---
title: Example
`),
  /Frontmatter terminator --- not found/,
);
assert.throws(
  () => parseFrontmatterMarkdown("title: Example"),
  /Frontmatter must start with ---/,
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
    `profileSnapshots=${exampleProfileSnapshots.length}`,
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
