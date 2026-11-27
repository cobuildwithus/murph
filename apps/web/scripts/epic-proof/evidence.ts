import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readCanonicalEntityFamilySource } from "@murphai/query";
import { clinicalRawManifestSchema } from "@murphai/clinical-records";
import { readClinicalAttachmentText, type buildClinicalImportPlanFromSnapshot } from "@murphai/importers/clinical-records";
import { check, families } from "./policy";

const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
type Snapshot = Parameters<typeof buildClinicalImportPlanFromSnapshot>[0];

// Fixture distribution is unresolved. Retain only resource shapes, pseudonymous IDs and finite status values.
// In particular Bundle links, free text, arbitrary extensions and HTTP envelopes cannot enter these files.
export function fixtureResource(resource: Record<string, unknown>) {
  check(typeof resource.resourceType === "string" && families.includes(resource.resourceType));
  const statuses = ["active", "inactive", "completed", "final", "corrected", "entered-in-error", "resolved", "finished", "unknown"];
  return { resourceType: resource.resourceType, ...(typeof resource.id === "string" && { id: hash(resource.id) }),
    ...(typeof resource.status === "string" && statuses.includes(resource.status) && { status: resource.status }) };
}

export function observeSnapshot(input: Snapshot, counts: Record<string, number>, documents: Map<string, number>) {
  const manifest = clinicalRawManifestSchema.parse(input.manifest);
  for (const file of manifest.resourceFiles) counts[file.resourceType]! += file.count;
  const downloaded = (manifest.documentAttachments ?? []).filter(d => d.status === "downloaded");
  if (downloaded.length) documents.set(input.manifestPath, downloaded.length);
  for (const doc of downloaded) {
    const file = input.attachments?.find(f => f.relativePath === doc.relativePath);
    check(file);
    counts.downloaded!++;
    if (file.extractedText || readClinicalAttachmentText(Buffer.from(file.contentBase64, "base64"), doc.mediaType)) counts.parsed!++;
  }
  return manifest.resourceFiles.reduce((total, file) => total + file.count, 0);
}

export async function verifyDocuments(vaultRoot: string, documents: Map<string, number>, counts: Record<string, number>) {
  for (const [path, count] of documents) {
    const id = hash(await readFile(join(vaultRoot, path)));
    const pending = JSON.parse(await readFile(join(vaultRoot, ".runtime/operations/clinical-records/enrichment/pending.json"), "utf8"));
    check(pending.pending.includes(id));
    counts.queued! += count;
  }
  check(counts.downloaded === counts.queued && counts.downloaded === counts.parsed);
}

export async function retainFixtures(dir: string, vault: string, runId: string, connection: string) {
  const { readdir } = await import("node:fs/promises");
  const raw = join(vault, "raw/clinical/fhir", connection);
  const destination = join(dirname(dir), "fixtures", hash(runId));
  await mkdir(destination, { recursive: true, mode: 0o700 });
  let index = 0;
  for (const batch of await readdir(raw)) {
    if (!batch.startsWith(runId + "-batch-")) continue;
    const root = join(raw, batch);
    const manifest = clinicalRawManifestSchema.parse(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")));
    for (const file of manifest.resourceFiles) {
      const page = JSON.parse(await readFile(join(root, file.relativePath), "utf8"));
      const fixture = page.resourceType === "Bundle" ? { resourceType: "Bundle", type: "searchset",
        entry: (page.entry ?? []).filter((e: { resource?: { resourceType?: string } }) => families.includes(e.resource?.resourceType ?? ""))
          .map((e: { resource: Record<string, unknown> }) => ({ resource: fixtureResource(e.resource) })) } : fixtureResource(page);
      await writeFile(join(destination, String(index++) + ".json"), JSON.stringify(fixture), { mode: 0o600, flag: "wx" });
    }
  }
  check(index);
}

// Read current canonical events through the vault owner and compare stable identities across imports.
export async function activeIdentities(vaultRoot: string) {
  const active = new Map<string, string>();
  for (const event of await readCanonicalEntityFamilySource(vaultRoot, "event")) {
    const ref = event.attributes.externalRef;
    if (!ref || typeof ref !== "object" || !("system" in ref) || !("resourceType" in ref) || !("resourceId" in ref)) continue;
    const identity = JSON.stringify([ref.system, ref.resourceType, ref.resourceId, "facet" in ref ? ref.facet : null]);
    check(!active.has(identity));
    active.set(identity, event.entityId);
  }
  check(active.size > 0);
  return hash(JSON.stringify([...active].sort()));
}
