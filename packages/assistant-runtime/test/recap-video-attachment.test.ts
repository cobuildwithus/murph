import { createHash } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostedRecapVideoAttachment } from "../src/hosted-runtime/recap-video-attachment.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const bytes = Buffer.from("synthetic accepted mp4 bytes");
const identity = { generationId: "a".repeat(32), hash: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };

async function setup(input: { form?: "attachment" | "line"; attachmentId?: string; file?: Buffer | null; current?: boolean | Error; upload?: string | Error }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "recap-video-attachment-"));
  roots.push(root);
  const file = path.join(root, "accepted.mp4");
  if (input.file !== null) await writeFile(file, input.file ?? bytes);
  const persist = vi.fn(async () => {});
  const isCurrent = vi.fn(async () => {
    if (input.current instanceof Error) throw input.current;
    return input.current ?? true;
  });
  const upload = vi.fn(async (uploaded: Uint8Array) => {
    expect(Buffer.from(uploaded).equals(bytes)).toBe(true);
    if (input.upload instanceof Error) throw input.upload;
    return input.upload ?? "synthetic-attachment";
  });
  const video = { ...identity, file, ...(input.form ? { form: input.form } : {}), ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}) };
  const result = resolveHostedRecapVideoAttachment({ recapVideo: { video, persist }, isCurrent, upload });
  return { result, persist, isCurrent, upload, file };
}

describe("a recap message's video before its first send", () => {
  it("is checked with Web, uploaded once and saved as the attachment before the message request", async () => {
    const { result, persist, isCurrent, upload, file } = await setup({});
    await expect(result).resolves.toBe("synthetic-attachment");
    expect(isCurrent).toHaveBeenCalledWith({ generationId: identity.generationId, hash: identity.hash, byteLength: identity.byteLength });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledExactlyOnceWith({ ...identity, form: "attachment", attachmentId: "synthetic-attachment" });
    await expect(access(file)).rejects.toThrow();
  });

  it.each([
    ["the file is gone (a restarted runner)", { file: null }, false],
    ["Web no longer allows it", { current: false }, false],
    ["Web cannot be asked", { current: new Error("Synthetic Web outage") }, false],
    ["the file is not the accepted bytes", { file: Buffer.from("other bytes, same idea") }, false],
    ["Linq refuses the upload", { upload: new Error("Synthetic Linq failure") }, true],
  ] as const)("chooses the line alone, for good, when %s", async (_name, input, uploaded) => {
    const { result, persist, upload, file } = await setup(input);
    await expect(result).resolves.toBeNull();
    expect(upload).toHaveBeenCalledTimes(uploaded ? 1 : 0);
    expect(persist).toHaveBeenCalledExactlyOnceWith({ ...identity, form: "line" });
    await expect(access(file)).rejects.toThrow();
  });
});

describe("a recap message's video on a later attempt", () => {
  it("replays the saved attachment, never uploading again, while Web still allows it", async () => {
    const { result, persist, isCurrent, upload } = await setup({ form: "attachment", attachmentId: "saved-attachment", file: null });
    await expect(result).resolves.toBe("saved-attachment");
    expect(isCurrent).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("drops the video for good once Web no longer allows it, and the line still goes", async () => {
    const { result, persist, upload } = await setup({ form: "attachment", attachmentId: "saved-attachment", current: false, file: null });
    await expect(result).resolves.toBeNull();
    expect(upload).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledExactlyOnceWith({ ...identity, form: "line" });
  });

  it("fails the attempt before any request, without changing the decision, when Web cannot be asked", async () => {
    const { result, persist } = await setup({ form: "attachment", attachmentId: "saved-attachment", current: new Error("Synthetic Web outage"), file: null });
    await expect(result).rejects.toThrow("Synthetic Web outage");
    expect(persist).not.toHaveBeenCalled();
  });

  it("sends the line alone once that was decided, asking nothing", async () => {
    const { result, persist, isCurrent, upload, file } = await setup({ form: "line" });
    await expect(result).resolves.toBeNull();
    expect(isCurrent).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    await expect(access(file)).rejects.toThrow();
  });

  it("leaves a message without a video exactly as it was", async () => {
    await expect(resolveHostedRecapVideoAttachment({ recapVideo: undefined, isCurrent: vi.fn(), upload: vi.fn() })).resolves.toBeNull();
  });
});
