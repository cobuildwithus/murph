import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";

import {
  afterEach,
  test,
} from "vitest";

import {
  initializeVault,
  parseFrontmatterDocument,
} from "../src/index.ts";
import {
  readRegimen,
  regimenRecordToUpsertPayload,
  upsertRegimen,
} from "../src/bank/index.ts";

const tempRoots: string[] = [];

async function makeVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-core-regimens-note-"));
  tempRoots.push(vaultRoot);
  return vaultRoot;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

test("regimen note round-trips through core frontmatter, body, read parse, and upsert payload", async () => {
  const vaultRoot = await makeVaultRoot();
  await initializeVault({ vaultRoot });

  const note = "Copied from imported record; exact indication uncertain.";
  const created = await upsertRegimen({
    vaultRoot,
    title: "Antibiotic course",
    kind: "medication",
    status: "completed",
    startedOn: "2019-04-10",
    stoppedOn: "2019-04-20",
    substance: "amoxicillin",
    dose: 875,
    unit: "mg",
    schedule: "twice daily",
    group: "medication/history",
    note,
  });

  const storedMarkdown = await readFile(
    path.join(vaultRoot, created.record.document.relativePath),
    "utf8",
  );
  const storedDocument = parseFrontmatterDocument(storedMarkdown);
  const read = await readRegimen({
    vaultRoot,
    regimenId: created.record.entity.regimenId,
  });
  const payload = regimenRecordToUpsertPayload(read.entity);
  const refreshed = await upsertRegimen({
    vaultRoot,
    regimenId: created.record.entity.regimenId,
  });

  assert.equal(storedDocument.attributes.note, note);
  assert.match(storedDocument.body, /## Notes\n\nCopied from imported record; exact indication uncertain\./u);
  assert.equal(read.entity.note, note);
  assert.match(read.document.markdown, /## Notes\n\nCopied from imported record; exact indication uncertain\./u);
  assert.equal(payload.note, note);
  assert.equal(payload.group, "medication/history");
  assert.equal(refreshed.record.entity.note, note);
});
