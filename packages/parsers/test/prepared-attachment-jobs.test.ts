import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { initializeVault } from "@murphai/core";
import { createInboxPipeline, openInboxRuntime } from "@murphai/inboxd";
import {
  createInboxParserService,
  createParserRegistry,
  type PreparedAttachmentParseJob,
  type ParserProvider,
} from "../src/index.js";

test("prepared audio jobs overlap external work but publish only when completed, exactly once", async () => {
  const started = [deferred(), deferred()];
  const release = [deferred(), deferred()];
  const calls: string[] = [];
  const fixture = await createFixture(async (request) => {
    const index = request.artifact.fileName === "voice-1.wav" ? 0 : 1;
    calls.push(request.artifact.attachmentId);
    started[index]!.resolve();
    await release[index]!.promise;
    return { text: `Synthetic prepared transcript ${index + 1}.` };
  });
  try {
    const first = fixture.prepare(0);
    const second = fixture.prepare(1);
    await observeBarrier(Promise.all(started.map((item) => item.promise)));
    release[1]!.resolve();
    await second.ready;
    assert.ok(fixture.runtime.listAttachmentParseJobs({}).every((job) => job.state === "running"));
    assert.ok(fixture.runtime.getCapture(fixture.captures[1]!.captureId)?.attachments.every(
      (attachment) => !attachment.derivedPath && !attachment.transcriptText,
    ));
    release[0]!.resolve();
    assert.equal((await first.complete())?.status, "succeeded");
    assert.equal(fixture.runtime.listAttachmentParseJobs({ captureId: fixture.captures[1]!.captureId })[0]?.state, "running");
    const completed = await second.complete();
    assert.equal(completed?.status, "succeeded");
    assert.deepEqual(await second.complete(), completed);
    assert.equal(calls.length, 2);
    assert.ok(fixture.runtime.listAttachmentParseJobs({}).every((job) => job.attempts === 1));
    for (const [index, capture] of fixture.captures.entries()) {
      const attachment = fixture.runtime.getCapture(capture.captureId)?.attachments[0];
      assert.equal(attachment?.transcriptText, `Synthetic prepared transcript ${index + 1}.`);
      assert.ok(attachment?.storedPath);
      assert.match(await readFile(path.join(fixture.vaultRoot, attachment.storedPath), "utf8"), /synthetic/u);
    }
  } finally {
    for (const gate of release) gate.resolve();
    await fixture.close();
  }
});

test("failed preparation is observed without rejection and terminalizes only through the original attempt owner", async () => {
  let calls = 0;
  const fixture = await createFixture(async () => {
    calls += 1;
    throw new Error("Synthetic transcription failed.");
  });
  try {
    const prepared = fixture.prepare(0);
    await prepared.ready; // already catches failure even before any completion is awaited
    assert.equal(fixture.runtime.listAttachmentParseJobs({ captureId: fixture.captures[0]!.captureId })[0]?.state, "running");
    const result = await prepared.complete();
    assert.equal(result?.status, "failed");
    assert.deepEqual(await prepared.complete(), result);
    assert.equal(calls, 1);
    assert.equal(fixture.service.prepareOnce({ captureId: fixture.captures[0]!.captureId }), null);
  } finally {
    await fixture.close();
  }
});

test("prepared completion preserves attempt fencing and removes only stale attempt publication", async () => {
  const entered = [deferred(), deferred()];
  const release = [deferred(), deferred()];
  let calls = 0;
  const fixture = await createFixture(async () => {
    const index = calls++;
    entered[index]!.resolve();
    await release[index]!.promise;
    return { text: index === 0 ? "Synthetic stale result." : "Synthetic current result." };
  });
  try {
    const first = fixture.prepare(0);
    await observeBarrier(entered[0]!.promise);
    assert.equal(fixture.service.requeue({ captureId: fixture.captures[0]!.captureId, state: "running" }), 1);
    const replacement = fixture.prepare(0);
    await observeBarrier(entered[1]!.promise);
    release[1]!.resolve();
    const current = await replacement.complete();
    assert.equal(current?.status, "succeeded");
    release[0]!.resolve();
    assert.equal(await first.complete(), null);
    const capture = fixture.runtime.getCapture(fixture.captures[0]!.captureId);
    assert.equal(capture?.attachments[0]?.transcriptText, "Synthetic current result.");
    const job = fixture.runtime.listAttachmentParseJobs({ captureId: fixture.captures[0]!.captureId })[0];
    assert.equal(job?.attempts, 2);
    assert.equal(job?.state, "succeeded");
    assert.equal(calls, 2);
    assert.ok(current?.resultPath);
    await readFile(path.join(fixture.vaultRoot, current.resultPath));
    await assert.rejects(readFile(path.join(fixture.vaultRoot, current.resultPath.replace("/0002/", "/0001/"))));
  } finally {
    for (const gate of release) gate.resolve();
    await fixture.close();
  }
});

test("prepareOnce forwards exact capture and attachment filters without a second claim on completion", async () => {
  const fixture = await createFixture(async () => ({ text: "Synthetic filtered result." }));
  try {
    const captureId = fixture.captures[1]!.captureId;
    const attachmentId = fixture.runtime.getCapture(captureId)?.attachments[0]?.attachmentId;
    assert.ok(attachmentId);
    const prepared = fixture.service.prepareOnce({ captureId, attachmentId });
    assert.ok(prepared);
    fixture.handles.push(prepared);
    await prepared.complete();
    assert.equal(fixture.runtime.listAttachmentParseJobs({ captureId })[0]?.state, "succeeded");
    assert.equal(fixture.runtime.listAttachmentParseJobs({ captureId: fixture.captures[0]!.captureId })[0]?.state, "pending");
  } finally {
    await fixture.close();
  }
});

async function createFixture(run: ParserProvider["run"]) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-prepared-audio-"));
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ runtime, vaultRoot });
  const captures: Array<Awaited<ReturnType<typeof pipeline.processCapture>>> = [];
  for (const ordinal of [1, 2]) {
    captures.push(await pipeline.processCapture({
      source: "linq", externalId: `synthetic-audio-${ordinal}`, accountId: "synthetic-account",
      thread: { id: "synthetic-thread", isDirect: true }, actor: { id: "synthetic-sender", isSelf: false },
      occurredAt: "2026-06-01T00:00:00.000Z", text: null, raw: {},
      attachments: [{
        kind: "audio", mime: "audio/wav", fileName: `voice-${ordinal}.wav`,
        data: new Uint8Array(Buffer.from("RIFF----WAVEsynthetic audio")),
      }],
    }));
  }
  const service = createInboxParserService({
    runtime, vaultRoot, ffmpeg: { allowSystemLookup: false, commandCandidates: [] },
    registry: createParserRegistry([{
      id: "synthetic-preparation", priority: 1, locality: "local", openness: "open_source", runtime: "node",
      async discover() { return { available: true, reason: "Synthetic fixture." }; },
      supports(request) { return request.artifact.kind === "audio"; },
      run,
    }]),
  });
  const handles: PreparedAttachmentParseJob[] = [];
  return {
    vaultRoot, runtime, service, captures, handles,
    prepare(index: number) {
      const capture = captures[index];
      assert.ok(capture);
      const handle = service.prepareOnce({ captureId: capture.captureId });
      assert.ok(handle);
      handles.push(handle);
      return handle;
    },
    async close() {
      // No owned promise survives runtime closure, including failed assertions.
      for (const handle of handles) await handle.complete().catch(() => undefined);
      pipeline.close();
      await rm(vaultRoot, { recursive: true, force: true });
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function observeBarrier<T>(promise: Promise<T>): Promise<T> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new Error("Synthetic parser barrier did not open.")), 15_000);
      }),
    ]);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
}
