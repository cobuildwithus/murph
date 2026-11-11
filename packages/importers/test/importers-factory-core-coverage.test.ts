import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createImporters,
  prepareAssessmentResponseImport,
} from "../src/index.ts";
import { createTempFile } from "./test-helpers.ts";

test("createImporters builds default registries when options are omitted", () => {
  const importers = createImporters();

  assert.ok(importers.deviceProviderRegistry.list().length > 0);
});

test("prepareAssessmentResponseImport defaults the title from the file basename", async () => {
  const filePath = await createTempFile(
    "sleep-survey.json",
    "{\"ok\":true}",
    "murph-importers-coverage-",
  );

  const payload = await prepareAssessmentResponseImport({
    filePath: `  ${filePath}  `,
    vaultRoot: "  canonical-vault  ",
    source: "  manual  ",
    extra: "kept for passthrough parsing",
  });

  assert.deepEqual(payload, {
    vaultRoot: "canonical-vault",
    sourcePath: filePath,
    title: "sleep-survey.json",
    source: "manual",
  });
});
