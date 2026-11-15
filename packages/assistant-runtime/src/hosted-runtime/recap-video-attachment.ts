import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";

import type { AssistantLinqRecapVideo } from "@murphai/assistant-engine/assistant-channel-runtime";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

type Identity = { generationId: string; hash: string; byteLength: number };

/**
 * How the recap video is labeled for Linq. Messages re-encodes any MP4 attachment to fit 960
 * points (an 804 x 1748 recap arrived as 440 x 960 HEVC), but passes a QuickTime movie through
 * byte for byte, at any size. Measured through Linq on 2026-11-15: the same accepted bytes,
 * labeled `video/quicktime` and named `.mov`, arrived unchanged. The bytes stay the accepted MP4.
 */
export const RECAP_VIDEO_LINQ_ATTACHMENT = { contentType: "video/quicktime", filename: "recap.mov" } as const;

/**
 * The attachment a recap message's first send carries, or null for the line alone.
 *
 * The decision is made once, before the first message request, and saved before that request
 * through `recapVideo.persist`: check that Web still allows this video, check the host's file is
 * the accepted bytes, upload it to Linq, save the attachment, and ask Web once more now the upload
 * is done. A missing or changed file, a video Web no longer allows, or any failure on the way
 * saves "line" instead. Every later attempt replays the saved attachment after asking Web again; a
 * video Web no longer allows is dropped for good ("line"), because no message Linq accepted can
 * change and a new one must not carry it.
 *
 * The file is never named by the intent, which the model's shell can edit: `fileFor` derives it
 * from the identity inside the host's own directory, and only that path is read or removed.
 */
export async function resolveHostedRecapVideoAttachment(input: {
  recapVideo: AssistantLinqRecapVideo | undefined;
  fileFor(identity: Identity): Promise<string | null>;
  /** Web's answer for this message's video, from the authority-only egress check. */
  isCurrent(identity: Identity): Promise<boolean>;
  upload(bytes: Uint8Array): Promise<string>;
  signal?: AbortSignal | null;
}): Promise<string | null> {
  const recap = input.recapVideo;
  if (!recap) return null;
  const { form, attachmentId: saved, generationId, hash, byteLength } = recap.video;
  const identity = { generationId, hash, byteLength };
  const file = await input.fileFor(identity);
  const decide = async (next: { form: "attachment"; attachmentId: string } | { form: "line" }): Promise<void> => {
    await recap.persist({ ...identity, ...next });
    if (file) await rm(file, { force: true });
  };
  if (form === "line") return null;
  if (form === "attachment") {
    // A transient failure here fails this attempt before any request, as a failed claim does.
    if (await input.isCurrent(identity)) return saved!;
    await decide({ form: "line" });
    return null;
  }
  let attachmentId: string | null = null;
  try {
    if (file && await input.isCurrent(identity)) {
      const bytes = await readFile(file);
      if (bytes.length === byteLength && createHash("sha256").update(bytes).digest("hex") === hash) {
        attachmentId = await input.upload(bytes);
      }
    }
  } catch (error) {
    if (input.signal?.aborted) throw error;
    attachmentId = null;
  }
  if (!attachmentId) {
    await decide({ form: "line" });
    return null;
  }
  await decide({ form: "attachment", attachmentId });
  // The upload took time: a photo removed meanwhile must not ride the message.
  if (await input.isCurrent(identity).catch(() => false)) return attachmentId;
  await recap.persist({ ...identity, form: "line" });
  return null;
}

/**
 * The message fetch for a send that carries the recap attachment. Each request whose body carries
 * it (the SDK's own retries included) asks Web first and does not leave when the video may no
 * longer go; the outbox's next attempt then sends the line alone. A request Linq refuses outright
 * saves the line alone and fails the attempt as retryable, so the line and link still go once.
 */
export function guardHostedRecapVideoFetch(input: {
  fetchImplementation: typeof fetch;
  attachmentIds: readonly string[];
  isCurrent(): Promise<boolean>;
  chooseLine(): Promise<void>;
  markPreProvider(error: unknown): unknown;
}): typeof fetch {
  if (input.attachmentIds.length === 0) return input.fetchImplementation;
  const carries = (init?: RequestInit) => typeof init?.body === "string" && input.attachmentIds.some(id => (init.body as string).includes(id));
  return (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (!carries(init)) return input.fetchImplementation(url, init);
    if (!await input.isCurrent().catch(() => false)) {
      throw input.markPreProvider(new VaultCliError("ASSISTANT_RECAP_VIDEO_NOT_CURRENT",
        "The recap video may no longer be sent with this message.", { retryable: true }));
    }
    const response = await input.fetchImplementation(url, init);
    if ([400, 413, 415, 422].includes(response.status)) {
      await input.chooseLine();
      throw input.markPreProvider(new VaultCliError("ASSISTANT_RECAP_VIDEO_ATTACHMENT_REJECTED",
        "Linq refused the recap message with its video; it goes as its line alone.", { retryable: true, status: response.status }));
    }
    return response;
  }) as typeof fetch;
}
