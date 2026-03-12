import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  exampleAuditRecords,
  exampleEventRecords,
  exampleFrontmatterMarkdown,
  exampleFrontmatterObjects,
  exampleSampleRecords,
  exampleVaultMetadata,
} from "../src/examples.js";
import {
  auditRecordSchema,
  coreFrontmatterSchema,
  eventRecordSchema,
  experimentFrontmatterSchema,
  journalDayFrontmatterSchema,
  sampleRecordSchema,
  schemaCatalog,
  vaultMetadataSchema,
} from "../src/schemas.js";
import { parseFrontmatterMarkdown, validateAgainstSchema } from "../src/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = path.resolve(__dirname, "../../generated");

function assertNoErrors(label: string, schema: Record<string, unknown>, value: unknown): void {
  const errors = validateAgainstSchema(schema, value);
  if (errors.length > 0) {
    throw new Error(`${label} failed validation:\n${errors.join("\n")}`);
  }
}

for (const [name, sourceSchema] of Object.entries(schemaCatalog)) {
  const artifactPath = path.join(generatedDir, `${name}.schema.json`);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  assert.deepEqual(
    artifact,
    sourceSchema,
    `Schema artifact ${path.basename(artifactPath)} is stale or mismatched`,
  );
}

assertNoErrors("vault metadata example", vaultMetadataSchema, exampleVaultMetadata);
exampleEventRecords.forEach((record, index) => assertNoErrors(`event example ${index + 1}`, eventRecordSchema, record));
exampleSampleRecords.forEach((record, index) => assertNoErrors(`sample example ${index + 1}`, sampleRecordSchema, record));
exampleAuditRecords.forEach((record, index) => assertNoErrors(`audit example ${index + 1}`, auditRecordSchema, record));

assertNoErrors("core frontmatter object", coreFrontmatterSchema, exampleFrontmatterObjects.core);
assertNoErrors("journal day frontmatter object", journalDayFrontmatterSchema, exampleFrontmatterObjects.journalDay);
assertNoErrors("experiment frontmatter object", experimentFrontmatterSchema, exampleFrontmatterObjects.experiment);

assert.deepEqual(parseFrontmatterMarkdown(exampleFrontmatterMarkdown.core), exampleFrontmatterObjects.core);
assert.deepEqual(parseFrontmatterMarkdown(exampleFrontmatterMarkdown.journalDay), exampleFrontmatterObjects.journalDay);
assert.deepEqual(parseFrontmatterMarkdown(exampleFrontmatterMarkdown.experiment), exampleFrontmatterObjects.experiment);

console.log(
  [
    "Verified schema artifacts and examples.",
    `events=${exampleEventRecords.length}`,
    `samples=${exampleSampleRecords.length}`,
    `audits=${exampleAuditRecords.length}`,
  ].join(" "),
);
