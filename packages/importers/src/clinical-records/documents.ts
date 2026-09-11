import {
  CLINICAL_DOCUMENTS_MAX_TOTAL_BYTES,
  clinicalDocumentAttachmentKey,
  decodeClinicalDocumentBase64,
  hashClinicalDocumentBytes,
  listClinicalFhirAttachments,
  type ClinicalDocumentAttachment,
  type ClinicalRawManifest,
} from "@murphai/clinical-records";

export interface ClinicalImportSnapshotAttachment {
  relativePath: string;
  contentBase64: string;
  /** Text extracted by the runtime's document parser from these exact bytes. */
  extractedText?: string;
}

type DocumentBytes = { bytes: Uint8Array; extractedText?: string };
export interface ClinicalDocumentContext {
  metadata: readonly ClinicalDocumentAttachment[];
  files: ReadonlyMap<string, DocumentBytes>;
}

export function validateClinicalDocumentSnapshot(input: {
  manifest: ClinicalRawManifest;
  attachments: readonly ClinicalImportSnapshotAttachment[];
  parents: readonly { sha256: string; resource: { resourceType: string; id?: string } }[];
}): ClinicalDocumentContext {
  const metadata = input.manifest.documentAttachments ?? [];
  const expectedFiles = new Map<string, Extract<ClinicalDocumentAttachment, { status: "downloaded" }>>();
  for (const attachment of metadata) {
    if (attachment.status === "downloaded") expectedFiles.set(attachment.relativePath, attachment);
  }
  const files = readClinicalDocumentFiles(input.attachments, expectedFiles);
  if (files.size !== expectedFiles.size) throw new Error("Clinical document evidence is missing.");
  validateClinicalDocumentParents(metadata, input.parents, files);
  return { metadata, files };
}

function readClinicalDocumentFiles(attachments: readonly ClinicalImportSnapshotAttachment[], expected: ReadonlyMap<string, Extract<ClinicalDocumentAttachment, { status: "downloaded" }>>): Map<string, DocumentBytes> {
  const files = new Map<string, DocumentBytes>();
  let totalBytes = 0;
  for (const file of attachments) {
    const admission = expected.get(file.relativePath);
    if (!admission || files.has(file.relativePath)) throw new Error("Unexpected or duplicate clinical document evidence.");
    const bytes = decodeClinicalDocumentBase64(file.contentBase64);
    if (!bytes || bytes.length !== admission.byteLength || hashClinicalDocumentBytes(bytes) !== admission.sha256) throw new Error("Clinical document evidence integrity mismatch.");
    totalBytes += bytes.length;
    if (totalBytes > CLINICAL_DOCUMENTS_MAX_TOTAL_BYTES) throw new Error("Clinical documents exceed the byte budget.");
    files.set(file.relativePath, { bytes, ...(file.extractedText !== undefined ? { extractedText: file.extractedText } : {}) });
  }
  return files;
}

function validateClinicalDocumentParents(metadata: readonly ClinicalDocumentAttachment[], parents: readonly { sha256: string; resource: { resourceType: string; id?: string } }[], files: ReadonlyMap<string, DocumentBytes>): void {
  for (const attachment of metadata) {
    const matches = parents.filter((parent) => parent.sha256 === attachment.parentPageSha256
      && parent.resource.resourceType === attachment.resourceType && parent.resource.id === attachment.resourceId);
    if (matches.length !== 1) throw new Error("Clinical document parent identity is missing or ambiguous.");
    const source = listClinicalFhirAttachments(matches[0]?.resource)[attachment.attachmentIndex];
    if (!source || (attachment.status === "downloaded" && !source.data && !source.url)) throw new Error("Clinical document attachment does not match its parent.");
    if (attachment.status !== "downloaded") continue;
    const file = files.get(attachment.relativePath);
    if (!file || file.bytes.length !== attachment.byteLength || hashClinicalDocumentBytes(file.bytes) !== attachment.sha256) throw new Error("Clinical document evidence integrity mismatch.");
    if (source.data) {
      const embedded = decodeClinicalDocumentBase64(source.data);
      if (!embedded || hashClinicalDocumentBytes(embedded) !== attachment.sha256) throw new Error("Clinical document differs from its embedded parent evidence.");
    }
  }
}

export function readClinicalDocumentText(input: {
  documents: ClinicalDocumentContext;
  parentPageSha256: string;
  resource: { resourceType: "DocumentReference" | "DiagnosticReport"; id?: string };
}): { status: "available"; text: string } | { status: "unavailable" } {
  // DiagnosticReport media are supporting images, not alternative report bodies.
  // Preserve those originals without making OCR part of the versioned source note.
  const attachments = listClinicalFhirAttachments(input.resource).filter((attachment) => !attachment.isMedia);
  if (attachments.length === 0) return { status: "unavailable" };
  const parts: string[] = [];
  for (const attachment of attachments) {
    const key = clinicalDocumentAttachmentKey({
      parentPageSha256: input.parentPageSha256,
      resourceType: input.resource.resourceType,
      resourceId: input.resource.id ?? "",
      attachmentIndex: attachment.attachmentIndex,
    });
    const evidence = input.documents.metadata.find((candidate) => clinicalDocumentAttachmentKey(candidate) === key);
    const file = evidence?.status === "downloaded" ? input.documents.files.get(evidence.relativePath) : undefined;
    const bytes = file?.bytes ?? (attachment.data ? decodeClinicalDocumentBase64(attachment.data) : null);
    if (!bytes) return { status: "unavailable" };
    const mediaType = evidence?.status === "downloaded" ? evidence.mediaType : attachment.contentType ?? "";
    const text = readClinicalAttachmentText(bytes, mediaType) ?? file?.extractedText?.trim();
    if (!text) return { status: "unavailable" };
    parts.push(attachments.length === 1 ? text : `Attachment ${attachment.attachmentIndex + 1}${attachment.title ? `: ${attachment.title}` : ""}\n\n${text}`);
  }
  return { status: "available", text: parts.join("\n\n") };
}

/** Decode source prose only; never resolve XML entities or execute embedded markup. */
export function readClinicalAttachmentText(bytes: Uint8Array, mediaType: string): string | undefined {
  const type = mediaType.split(";", 1)[0]?.trim().toLowerCase();
  if (!isSupportedClinicalTextType(type)) return undefined;
  const text = decodeClinicalText(bytes, mediaType, type);
  return text === undefined ? undefined : type === "text/plain" ? text.trim() || undefined : stripClinicalMarkup(text);
}

function isSupportedClinicalTextType(type: string | undefined): type is string {
  return type === "text/plain" || type === "text/html" || type === "application/xhtml+xml" || type === "application/xml" || type === "text/xml" || Boolean(type?.endsWith("+xml"));
}

function decodeClinicalText(bytes: Uint8Array, mediaType: string, type: string): string | undefined {
  try {
    const encodings = readClinicalTextEncodings(bytes, mediaType, type);
    if (!encodings) return undefined;
    const decoder = new TextDecoder(encodings.declared ?? encodings.bom ?? encodings.xml ?? "utf-8", { fatal: true });
    if ([encodings.declared, encodings.bom, encodings.xml].some((encoding) => encoding && new TextDecoder(encoding).encoding !== decoder.encoding)) return undefined;
    return decoder.decode(bytes);
  } catch { return undefined; }
}

function readClinicalTextEncodings(bytes: Uint8Array, mediaType: string, type: string): { declared?: string; bom?: string; xml?: string } | undefined {
  const declarations = [...mediaType.matchAll(/;\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/giu)];
  if (declarations.length > 1 || (declarations.length === 0 && /;\s*charset\s*=/iu.test(mediaType))) return undefined;
  return {
    declared: declarations[0]?.[1] ?? declarations[0]?.[2] ?? declarations[0]?.[3],
    bom: bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "utf-8" : undefined,
    xml: type !== "text/plain" && type !== "text/html" ? /^\s*<\?xml\b[^>]*\bencoding\s*=\s*["']([^"']+)["']/iu.exec(Buffer.from(bytes.subarray(0, 256)).toString("ascii"))?.[1] : undefined,
  };
}

function stripClinicalMarkup(text: string): string {
  return text.replace(/<!--[^]*?-->/gu, " ").replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/giu, " ").replace(/<[^>]*>/gu, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (entity, code: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (!code.startsWith("#")) return named[code.toLowerCase()] ?? entity;
      const value = code.toLowerCase().startsWith("#x") ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : entity;
    }).replace(/\s+/gu, " ").trim() || "";
}
