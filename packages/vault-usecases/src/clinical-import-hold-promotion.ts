import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import {
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES,
  clinicalFhirManifestPathSchema,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  type ClinicalRawManifest,
} from "@murphai/clinical-records";
import type { EventRecord } from "@murphai/contracts";
import { resolveVaultPathOnDisk } from "@murphai/core";

// Only mapping limitations can be reconsidered. Source withdrawals, invalid
// clinical semantics and retractions of previously accepted facts stay fenced.
const PROMOTABLE_OBSERVATION_HOLDS = new Set([
  "observation code is not importable",
  "vital component code is not importable",
  "vital quantity unit is not importable",
]);

export function createClinicalImportHoldVerifier(input: {
  manifest: ClinicalRawManifest;
  pages: readonly { rawPath: string; content: string }[];
  vaultRoot: string;
  signal?: AbortSignal | null;
}) {
  const currentPages = new Map(input.pages.map((page) => [page.rawPath, page.content]));
  const retainedFiles = new Map<string, Promise<string>>();
  const verifiedPages = new Map<string, Promise<string | null>>();
  const fingerprints = new Map<string, Map<string, string | null>>();
  let retainedBytes = 0;

  async function readRetainedFile(rawRef: string): Promise<string> {
    const cached = retainedFiles.get(rawRef);
    if (cached) return cached;
    const pending = (async () => {
      input.signal?.throwIfAborted();
      const resolved = await resolveVaultPathOnDisk(input.vaultRoot, clinicalRawPathSchema.parse(rawRef));
      const metadata = await stat(resolved.absolutePath);
      retainedBytes += metadata.size;
      if (metadata.size > CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES
        || retainedBytes > CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES) {
        throw new RangeError("Retained clinical evidence exceeds import verification bounds.");
      }
      const content = await readFile(resolved.absolutePath, "utf8");
      if (Buffer.byteLength(content, "utf8") !== metadata.size) {
        throw new Error("Retained clinical evidence changed during verification.");
      }
      return content;
    })();
    retainedFiles.set(rawRef, pending);
    return pending;
  }

  function readVerifiedPage(rawRef: string): Promise<string | null> {
    const cached = verifiedPages.get(rawRef);
    if (cached) return cached;
    const pending = (async () => {
      const parts = clinicalRawPathSchema.parse(rawRef).split("/");
      const manifestPath = clinicalFhirManifestPathSchema.parse(
        [...parts.slice(0, 5), "manifest.json"].join("/"),
      );
      const manifest = clinicalRawManifestSchema.parse(JSON.parse(await readRetainedFile(manifestPath)));
      if (manifest.sourceSystem !== input.manifest.sourceSystem
        || manifest.fhirBaseUrlHash !== input.manifest.fhirBaseUrlHash
        || manifest.patientIdHash !== input.manifest.patientIdHash) return null;
      const file = manifest.resourceFiles.find((entry) => entry.relativePath === parts.slice(5).join("/"));
      if (!file || file.resourceType !== "Observation") return null;
      const retainedContent = await readRetainedFile(rawRef);
      return createHash("sha256").update(retainedContent, "utf8").digest("hex") === file.sha256
        ? retainedContent : null;
    })();
    verifiedPages.set(rawRef, pending);
    return pending;
  }

  return async ({ marker, incoming }: {
    marker: Readonly<EventRecord>;
    incoming: Readonly<EventRecord>;
  }): Promise<boolean> => {
    const evidence = promotionEvidence(marker, incoming);
    if (!evidence) return false;
    const { oldEvidence, newEvidence } = evidence;
    const currentContent = currentPages.get(newEvidence.rawRef);
    if (!currentContent) return false;
    try {
      const retainedContent = await readVerifiedPage(oldEvidence.rawRef);
      if (retainedContent === null) return false;
      const source = resourceFingerprint(retainedContent, oldEvidence.sourceLabel, fingerprints);
      return source !== null && source === resourceFingerprint(currentContent, newEvidence.sourceLabel, fingerprints);
    } catch {
      input.signal?.throwIfAborted();
      return false;
    }
  };
}

function isPromotableObservationHold(marker: Readonly<EventRecord>): boolean {
  return marker.kind === "note"
    && PROMOTABLE_OBSERVATION_HOLDS.has(marker.note ?? "")
    && marker.externalRef?.resourceType === "observation"
    && marker.evidence?.length === 1;
}

function promotionEvidence(marker: Readonly<EventRecord>, incoming: Readonly<EventRecord>) {
  if (!isPromotableObservationHold(marker) || incoming.evidence?.length !== 1) return null;
  const oldEvidence = marker.evidence?.[0];
  const newEvidence = incoming.evidence[0];
  if (!oldEvidence?.rawRef || !newEvidence?.rawRef
    || oldEvidence.sourceLabel !== newEvidence.sourceLabel) return null;
  return {
    oldEvidence: { rawRef: oldEvidence.rawRef, sourceLabel: oldEvidence.sourceLabel },
    newEvidence: { rawRef: newEvidence.rawRef, sourceLabel: newEvidence.sourceLabel },
  };
}

function resourceFingerprint(
  content: string,
  sourceLabel: string | undefined,
  cache: Map<string, Map<string, string | null>>,
): string | null {
  if (!sourceLabel) return null;
  const cached = cache.get(content);
  if (cached) return cached.get(sourceLabel) ?? null;
  const page: unknown = JSON.parse(content);
  const resources = Array.isArray(page) ? page
    : isObject(page) && page.resourceType === "Bundle" && Array.isArray(page.entry)
      ? page.entry.map((entry: unknown) => isObject(entry) ? entry.resource : null)
      : [page];
  const index = new Map<string, string | null>();
  for (const resource of resources) {
    if (!isObject(resource)) continue;
    const label = `${resource.resourceType}/${resource.id}`;
    index.set(label, index.has(label) ? null : JSON.stringify(sortJson(resource)));
  }
  cache.set(content, index);
  return index.get(sourceLabel) ?? null;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
