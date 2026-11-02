import { createHash } from "node:crypto";

export function createHostedMediaReferenceId(input: {
  byteSize: number;
  mediaKind: string;
  relativePath: string;
  sha256: string;
}): string {
  return createHash("sha256")
    .update("murph.hosted-media-ref.v1")
    .update("\0")
    .update(input.mediaKind)
    .update("\0")
    .update(input.relativePath)
    .update("\0")
    .update(input.sha256)
    .update("\0")
    .update(String(input.byteSize))
    .digest("hex");
}

