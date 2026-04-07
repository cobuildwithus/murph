import type { ParserArtifactRef } from "../contracts/artifact.js";
import type { ParserRuntimeStore } from "../contracts/runtime.js";
import { resolveVaultRelativePath } from "../shared.js";

export async function resolveAttachmentArtifact(input: {
  vaultRoot: string;
  runtime: ParserRuntimeStore;
  captureId: string;
  attachmentId: string;
}): Promise<ParserArtifactRef> {
  const capture = input.runtime.getCapture(input.captureId);
  if (!capture) {
    throw new TypeError(`Unknown inbox capture: ${input.captureId}`);
  }

  const attachment = capture.attachments.find((item) => item.attachmentId === input.attachmentId);
  if (!attachment) {
    throw new TypeError(`Unknown inbox attachment: ${input.attachmentId}`);
  }

  if (!attachment.storedPath) {
    throw new TypeError(`Inbox attachment ${input.attachmentId} does not have a stored path.`);
  }

  return {
    captureId: capture.captureId,
    attachmentId: attachment.attachmentId,
    kind: attachment.kind,
    mime: attachment.mime ?? null,
    fileName: attachment.fileName ?? null,
    storedPath: attachment.storedPath,
    absolutePath: await resolveVaultRelativePath(input.vaultRoot, attachment.storedPath),
    byteSize: attachment.byteSize ?? null,
    sha256: attachment.sha256 ?? null,
  };
}
