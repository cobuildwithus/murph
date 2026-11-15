import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";

import type { AssistantLinqRecapVideo } from "@murphai/assistant-engine/assistant-channel-runtime";

/**
 * The attachment a recap message's first send carries, or null for the line alone.
 *
 * The decision is made once, before the first message request, and saved before that request
 * through `recapVideo.persist`: check that Web still allows this video, check the handed-over
 * file is the accepted bytes, upload it to Linq, save the attachment. A missing or changed file,
 * a video Web no longer allows, or any failure on the way saves "line" instead. Every later
 * attempt replays the saved attachment, after asking Web again; a video Web no longer allows is
 * dropped for good ("line"), because no message Linq accepted can change and a new one must not
 * carry it. The file is removed once a decision is saved.
 */
export async function resolveHostedRecapVideoAttachment(input: {
  recapVideo: AssistantLinqRecapVideo | undefined;
  /** Web's answer for this message's video, from the authority-only egress check. */
  isCurrent(identity: { generationId: string; hash: string }): Promise<boolean>;
  upload(bytes: Uint8Array): Promise<string>;
  signal?: AbortSignal | null;
}): Promise<string | null> {
  const recap = input.recapVideo;
  if (!recap) return null;
  const { file, form, attachmentId: _attachmentId, ...identity } = recap.video;
  const decide = async (next: Pick<typeof recap.video, "form" | "attachmentId">): Promise<void> => {
    await recap.persist({ ...identity, ...next });
    if (file) await rm(file, { force: true });
  };
  if (form === "line") {
    if (file) await rm(file, { force: true });
    return null;
  }
  if (form === "attachment") {
    // A transient failure here fails this attempt before any request, as a failed claim does.
    if (await input.isCurrent(identity)) return recap.video.attachmentId!;
    await decide({ form: "line" });
    return null;
  }
  let attachmentId: string | null = null;
  try {
    if (file && await input.isCurrent(identity)) {
      const bytes = await readFile(file);
      if (bytes.length === identity.byteLength && createHash("sha256").update(bytes).digest("hex") === identity.hash) {
        attachmentId = await input.upload(bytes);
      }
    }
  } catch (error) {
    if (input.signal?.aborted) throw error;
    attachmentId = null;
  }
  await decide(attachmentId ? { form: "attachment", attachmentId } : { form: "line" });
  return attachmentId;
}
