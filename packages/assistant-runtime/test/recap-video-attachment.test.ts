import { createHash } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { guardHostedRecapVideoFetch, RECAP_VIDEO_LINQ_ATTACHMENT, resolveHostedRecapVideoAttachment } from "../src/hosted-runtime/recap-video-attachment.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const bytes = Buffer.from("synthetic accepted mp4 bytes");
const identity = { generationId: "a".repeat(32), hash: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };

async function setup(input: { form?: "attachment" | "line"; attachmentId?: string; file?: Buffer | null; current?: boolean | Error | boolean[]; upload?: string | Error }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "recap-video-attachment-"));
  roots.push(root);
  const file = path.join(root, "accepted.mp4");
  if (input.file !== null) await writeFile(file, input.file ?? bytes);
  const persist = vi.fn(async (_next: unknown) => {});
  const answers = Array.isArray(input.current) ? [...input.current] : null;
  const isCurrent = vi.fn(async (_identity: unknown): Promise<boolean> => {
    if (input.current instanceof Error) throw input.current;
    if (answers) return answers.shift() ?? false;
    return input.current === false ? false : true;
  });
  const upload = vi.fn(async (uploaded: Uint8Array) => {
    expect(Buffer.from(uploaded).equals(bytes)).toBe(true);
    if (input.upload instanceof Error) throw input.upload;
    return input.upload ?? "synthetic-attachment";
  });
  const video = { ...identity, ...(input.form ? { form: input.form } : {}), ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}) };
  // The file is always the host's own path for the identity, never one an intent names.
  const fileFor = vi.fn(async () => file);
  const result = resolveHostedRecapVideoAttachment({ recapVideo: { video, persist }, fileFor, isCurrent, upload });
  return { result, persist, isCurrent, upload, file };
}

describe("a recap message's video before its first send", () => {
  it("is checked with Web, uploaded once and saved as the attachment before the message request", async () => {
    const { result, persist, isCurrent, upload, file } = await setup({});
    await expect(result).resolves.toBe("synthetic-attachment");
    expect(isCurrent).toHaveBeenCalledWith({ generationId: identity.generationId, hash: identity.hash, byteLength: identity.byteLength });
    // Asked before the upload and again after it.
    expect(isCurrent).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledExactlyOnceWith({ ...identity, form: "attachment", attachmentId: "synthetic-attachment" });
    await expect(access(file)).rejects.toThrow();
  });

  it("drops a video Web stopped allowing while it uploaded, and the line goes alone", async () => {
    const { result, persist, upload } = await setup({ current: [true, false] });
    await expect(result).resolves.toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls.map(([next]) => next)).toEqual([{ ...identity, form: "attachment", attachmentId: "synthetic-attachment" }, { ...identity, form: "line" }]);
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

  it("sends the line alone once that was decided, asking and touching nothing", async () => {
    const { result, persist, isCurrent, upload } = await setup({ form: "line" });
    await expect(result).resolves.toBeNull();
    expect(isCurrent).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("leaves a message without a video exactly as it was", async () => {
    await expect(resolveHostedRecapVideoAttachment({ recapVideo: undefined, fileFor: vi.fn(), isCurrent: vi.fn(), upload: vi.fn() })).resolves.toBeNull();
  });
});

describe("each request that carries the recap attachment", () => {
  const ok = () => new Response(JSON.stringify({ message: { id: "m" } }), { status: 200 });
  const guard = (input: { current?: boolean; status?: number; ids?: string[] }) => {
    const fetchImplementation = vi.fn(async () => input.status ? new Response("{}", { status: input.status }) : ok());
    const chooseLine = vi.fn(async () => {});
    const fetch = guardHostedRecapVideoFetch({ fetchImplementation: fetchImplementation as unknown as typeof globalThis.fetch,
      attachmentIds: input.ids ?? ["att-1"], isCurrent: async () => input.current ?? true, chooseLine,
      markPreProvider: error => Object.assign(error as object, { deliveryMayHaveSucceeded: false }) });
    return { fetch, fetchImplementation, chooseLine };
  };
  const withVideo = { method: "POST", body: JSON.stringify({ message: { parts: [{ type: "text" }, { type: "media", attachment_id: "att-1" }] } }) };

  it("asks Web first and does not leave when the video may no longer go", async () => {
    const { fetch, fetchImplementation } = guard({ current: false });
    await expect(fetch("https://api.linq.test/chats/c/messages", withVideo)).rejects.toMatchObject({ code: "ASSISTANT_RECAP_VIDEO_NOT_CURRENT", deliveryMayHaveSucceeded: false });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("chooses the line alone when Linq refuses the message outright, so the line and link still go", async () => {
    const { fetch, chooseLine } = guard({ status: 415 });
    await expect(fetch("https://api.linq.test/chats/c/messages", withVideo)).rejects.toMatchObject({ code: "ASSISTANT_RECAP_VIDEO_ATTACHMENT_REJECTED", deliveryMayHaveSucceeded: false });
    expect(chooseLine).toHaveBeenCalledTimes(1);
  });

  it("lets the link and every other request through untouched", async () => {
    const { fetch, fetchImplementation, chooseLine } = guard({ current: false });
    await expect(fetch("https://api.linq.test/chats/c/messages", { method: "POST", body: JSON.stringify({ message: { parts: [{ type: "link" }] } }) })).resolves.toBeInstanceOf(Response);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(chooseLine).not.toHaveBeenCalled();
    const plain = guard({ ids: [] });
    expect(plain.fetch).toBe(plain.fetchImplementation);
  });
});

describe("the recap video's Linq label", () => {
  it("is a QuickTime movie, which Messages passes through instead of shrinking", () => {
    expect(RECAP_VIDEO_LINQ_ATTACHMENT).toEqual({ contentType: "video/quicktime", filename: "recap.mov" });
  });
});
