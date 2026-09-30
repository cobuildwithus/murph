import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { initializeVault, validateVault } from "../src/index.ts";

const roots: string[] = [];
const directory = "raw/clinical/fhir/connection-1/retrieval-1";
const pagePath = "Observation/page-1.json";
const page = JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [] });
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function snapshot() {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-clinical-validation-"));
  roots.push(vaultRoot);
  await initializeVault({ vaultRoot });
  const manifest = {
    schemaVersion: "murph.clinical-raw-manifest.v2",
    kind: "clinical_fhir_retrieval", connectionId: "connection-1", retrievalJobId: "retrieval-1",
    sourceSystem: "epic-fhir", fhirBaseUrlHash: sha256("synthetic-endpoint"),
    patientIdHash: sha256("synthetic-patient"), fetchedAt: "2026-07-01T12:00:00.000Z",
    resourceFiles: [{ resourceType: "Observation", relativePath: pagePath, count: 0, sha256: sha256(page) }],
    retrievalScopes: [{ coverage: "whole-family", resourceType: "Observation", queryFingerprint: sha256("synthetic-query") }],
    completedResourceTypes: ["Observation"], requestedScopes: ["patient/*.read"], grantedScopes: ["patient/*.read"],
  };
  await mkdir(path.join(vaultRoot, directory, "Observation"), { recursive: true });
  await writeFile(path.join(vaultRoot, directory, pagePath), page);
  await writeFile(path.join(vaultRoot, directory, "manifest.json"), JSON.stringify(manifest));
  return { vaultRoot, manifest };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(vaultRoot => rm(vaultRoot, { recursive: true, force: true })));
});

it("accepts a valid clinical snapshot with nested hash-bound resource pages", async () => {
  const { vaultRoot } = await snapshot();
  const result = await validateVault({ vaultRoot });
  expect(result.issues).toEqual([]);
  expect(result.valid).toBe(true);
});

it.each(["missing", "changed", "unbound", "identity", "schema"])("rejects %s clinical evidence", async kind => {
  const { vaultRoot, manifest } = await snapshot();
  const absolutePage = path.join(vaultRoot, directory, pagePath);
  if (kind === "missing") await rm(absolutePage);
  if (kind === "changed") await writeFile(absolutePage, "{}");
  if (kind === "unbound") await writeFile(path.join(vaultRoot, directory, "Observation/page-2.json"), page);
  if (kind === "identity") manifest.connectionId = "another-connection";
  if (kind === "schema") manifest.schemaVersion = "murph.clinical-raw-manifest.unknown";
  await writeFile(path.join(vaultRoot, directory, "manifest.json"), JSON.stringify(manifest));
  const result = await validateVault({ vaultRoot });
  expect(result.valid).toBe(false);
  expect(result.issues.some(issue => issue.code === "RAW_MANIFEST_INVALID" || issue.code === "RAW_REFERENCE_MISSING")).toBe(true);
});

it.each([false, true])("checks downloaded clinical document bytes (corrupt: %s)", async corrupt => {
  const { vaultRoot, manifest } = await snapshot();
  const document = "synthetic document bytes";
  const digest = sha256(document);
  const relativePath = `attachments/${digest}.bin`;
  await mkdir(path.join(vaultRoot, directory, "attachments"));
  await writeFile(path.join(vaultRoot, directory, relativePath), corrupt ? "altered" : document);
  await writeFile(path.join(vaultRoot, directory, "manifest.json"), JSON.stringify({ ...manifest,
    documentAttachments: [{ parentPageSha256: sha256(page), resourceType: "DocumentReference", resourceId: "synthetic-document", attachmentIndex: 0,
      status: "downloaded", relativePath, mediaType: "text/plain", sha256: digest, byteLength: Buffer.byteLength(document) }],
  }));
  const result = await validateVault({ vaultRoot });
  expect(result.valid).toBe(!corrupt);
});

it.each([false, true])("validates nested v3 retrieval evidence (changed: %s)", async changed => {
  const { vaultRoot, manifest } = await snapshot();
  const { completedResourceTypes: _completed, retrievalScopes: _scopes, ...common } = manifest;
  const relativePath = "query-1/slice-1/Observation/page-1.json";
  await rm(path.join(vaultRoot, directory, pagePath));
  await mkdir(path.join(vaultRoot, directory, path.posix.dirname(relativePath)), { recursive: true });
  await writeFile(path.join(vaultRoot, directory, relativePath), changed ? "{}" : page);
  await writeFile(path.join(vaultRoot, directory, "manifest.json"), JSON.stringify({ ...common,
    schemaVersion: "murph.clinical-raw-manifest.v3",
    resourceFiles: [{ ...manifest.resourceFiles[0], relativePath, queryScopeId: "query-1", sliceId: "slice-1" }],
    retrievalSlices: [{ ...manifest.retrievalScopes[0], queryScopeId: "query-1", sliceId: "slice-1" }],
    completedRetrievalSlices: [{ queryScopeId: "query-1", sliceId: "slice-1" }],
  }));
  expect((await validateVault({ vaultRoot })).valid).toBe(!changed);
});

it.each([false, true])("checks the immutable predecessor of a clinical retrieval batch (changed: %s)", async changed => {
  const { vaultRoot, manifest } = await snapshot();
  const { completedResourceTypes: _completed, retrievalScopes: _scopes, ...common } = manifest;
  await rm(path.join(vaultRoot, directory), { recursive: true });
  const relativePath = "query-1/slice-1/Observation/page-1.json";
  let previous: { manifestPath: string; sha256: string } | undefined;
  for (const index of [0, 1]) {
    const retrievalJobId = `run-1-batch-${index}`;
    const batchDirectory = `raw/clinical/fhir/connection-1/${retrievalJobId}`;
    const manifestPath = `${batchDirectory}/manifest.json`;
    const content = JSON.stringify({ ...common, retrievalJobId,
      schemaVersion: "murph.clinical-raw-manifest.v3",
      resourceFiles: [{ ...manifest.resourceFiles[0], relativePath, queryScopeId: "query-1", sliceId: "slice-1" }],
      retrievalSlices: [{ ...manifest.retrievalScopes[0], queryScopeId: "query-1", sliceId: "slice-1" }],
      completedRetrievalSlices: [], batch: { runId: "run-1", index, ...(previous ? { previous } : {}) },
    });
    await mkdir(path.join(vaultRoot, batchDirectory, path.posix.dirname(relativePath)), { recursive: true });
    await writeFile(path.join(vaultRoot, batchDirectory, relativePath), page);
    await writeFile(path.join(vaultRoot, manifestPath), content + (changed && index === 0 ? "\n" : ""));
    previous = { manifestPath, sha256: sha256(content) };
  }
  expect((await validateVault({ vaultRoot })).valid).toBe(!changed);
});

it("treats a nested manifest-named resource page as declared evidence", async () => {
  const { vaultRoot, manifest } = await snapshot();
  const relativePath = "Observation/manifest.json";
  await rm(path.join(vaultRoot, directory, pagePath));
  await writeFile(path.join(vaultRoot, directory, relativePath), page);
  await writeFile(path.join(vaultRoot, directory, "manifest.json"), JSON.stringify({ ...manifest,
    resourceFiles: [{ ...manifest.resourceFiles[0], relativePath }],
  }));
  expect((await validateVault({ vaultRoot })).valid).toBe(true);
});
