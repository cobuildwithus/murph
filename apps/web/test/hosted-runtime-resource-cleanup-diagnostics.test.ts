import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";

const mocks = vi.hoisted(() => ({
  control: vi.fn(), reconcile: vi.fn(), cutover: vi.fn(),
  memberLock: vi.fn(), ownerLock: vi.fn(), mediaCommand: vi.fn(),
}));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: mocks.control }));
vi.mock("@/src/lib/hosted-execution/runtime-upload-recovery", () => ({ reconcileHostedRuntimeUploads: mocks.reconcile }));
vi.mock("@/src/lib/hosted-onboarding/shared", () => ({ lockHostedMemberRow: mocks.memberLock }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({ lockHostedRuntimeOwnerRowTx: mocks.ownerLock, requireHostedRuntimeOwnerTx: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/runtime-cutover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-execution/runtime-cutover")>()),
  lockHostedRuntimeMemberCutoverTx: mocks.cutover,
}));
vi.mock("@/src/lib/hosted-execution/runtime-media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-execution/runtime-media")>()),
  executeHostedRuntimeMediaCommand: mocks.mediaCommand,
}));

import { runHostedRuntimeResourceCleanup } from "@/src/lib/hosted-execution/runtime-resource-cleanup";

const NOW = new Date("2026-01-01T00:00:00.000Z");
type OrphanRow = {
  userId: string; kind: string; resourceId: string; objectKey: string | null;
  snapshotRef: null; revision: bigint; cleanupAt: Date; retiredAt: Date | null; purgedAt: Date | null;
};
type MediaRow = {
  userId: string; mediaId: string; objectKey: string; revision: bigint;
  expiresAt: Date; updatedAt: Date; retiredAt: Date | null; purgedAt: Date | null;
};
type Diagnostic = {
  resourceKind: "snapshot" | "replica" | "legacy_snapshot" | "media" | "unknown";
  stage: "parse" | "purge" | "acknowledge";
  errorCategory: "timeout" | "abort" | "http" | "validation" | "database" | "other";
  httpStatus?: number;
};
function orphan(overrides: Partial<OrphanRow> = {}): OrphanRow {
  return { userId: "synthetic-member", kind: "snapshot", resourceId: "synthetic-orphan",
    objectKey: "synthetic/orphan", snapshotRef: null, revision: 7n, cleanupAt: NOW,
    retiredAt: null, purgedAt: null, ...overrides };
}
function media(): MediaRow {
  return { userId: "synthetic-member", mediaId: "a".repeat(64), objectKey: "synthetic/media",
    revision: 9n, expiresAt: NOW, updatedAt: NOW, retiredAt: null, purgedAt: null };
}
function response(status = 200): Response {
  return new Response(JSON.stringify(status === 200 ? { deleted: true } : {
    code: "synthetic-private-code", message: "synthetic-private-message", payload: "synthetic-private-payload",
  }), { status, headers: { "Content-Type": "application/json" } });
}

// The actual claim owner, parsers, receipt and orphan acknowledgement run here.
// This fake supplies rows, not SQL/guard/publication-race implementations.
function fixture(orphanRows: OrphanRow[] = [orphan()], mediaRows: MediaRow[] = []) {
  type OrphanWhere = { userId_kind_resourceId: { resourceId: string } };
  type MediaWhere = { userId_mediaId: { mediaId: string } };
  const findOrphan = (where: OrphanWhere) => orphanRows.find(row => row.resourceId === where.userId_kind_resourceId.resourceId);
  const findMedia = (where: MediaWhere) => mediaRows.find(row => row.mediaId === where.userId_mediaId.mediaId);
  const orphanTable = {
    findUnique: vi.fn(async ({ where }: { where: OrphanWhere }) => findOrphan(where) ?? null),
    update: vi.fn(async ({ where, data }: { where: OrphanWhere; data: Partial<OrphanRow> }) => {
      const row = findOrphan(where);
      if (!row) throw new Error("Missing synthetic orphan.");
      return { ...row, ...data };
    }),
    updateMany: vi.fn<(input: object) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 }),
  };
  const mediaTable = {
    findUnique: vi.fn(async ({ where }: { where: MediaWhere }) => findMedia(where) ?? null),
    update: vi.fn(async ({ where, data }: { where: MediaWhere; data: Partial<MediaRow> }) => {
      const row = findMedia(where);
      if (!row) throw new Error("Missing synthetic media.");
      return { ...row, ...data };
    }),
  };
  const tx = {
    $queryRaw: vi.fn(async () => []), hostedRuntimeOrphan: orphanTable, hostedRuntimeMedia: mediaTable,
    hostedWorkspace: { findUnique: vi.fn(async () => null) },
    hostedRuntimePutDrain: { findFirst: vi.fn(async () => null) },
  };
  let transactionDepth = 0;
  const prisma = {
    hostedRuntimeOrphan: orphanTable,
    $queryRaw: vi.fn<(...args: unknown[]) => Promise<unknown[]>>()
      .mockResolvedValueOnce(orphanRows.map(({ userId, kind, resourceId }) => ({ userId, kind, resourceId })))
      .mockResolvedValueOnce(mediaRows.map(({ userId, mediaId }) => ({ userId, mediaId }))),
    $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => {
      transactionDepth += 1;
      try { return await work(tx); } finally { transactionDepth -= 1; }
    }),
  };
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response());
  const client = createCloudflareHostedControlClient({
    baseUrl: "https://control.example.invalid", getBearerToken: async () => "synthetic-token",
    fetchImpl, timeoutMs: 5_000,
  });
  let purging = false;
  const purge = vi.fn(async (request: Parameters<typeof client.purgeRuntimeResource>[0]) => {
    expect(transactionDepth).toBe(0);
    expect(purging).toBe(false);
    purging = true;
    try { await Promise.resolve(); return await client.purgeRuntimeResource(request); }
    finally { purging = false; }
  });
  mocks.control.mockReturnValue({ purgeRuntimeResource: purge });
  return { prisma, orphanTable, mediaTable, fetchImpl, client, purge,
    run: () => runHostedRuntimeResourceCleanup({ prisma: prisma as never, now: NOW }) };
}
function requeue(row: OrphanRow) {
  const { userId, kind, resourceId, revision } = row;
  return { where: { userId, kind, resourceId, revision, purgedAt: null },
    data: { cleanupAt: new Date(NOW.getTime() + 60_000) } };
}
function acknowledge(row: OrphanRow) {
  const { userId, kind, resourceId, revision } = row;
  return { where: { userId, kind, resourceId, revision, retiredAt: { not: null }, purgedAt: null },
    data: { purgedAt: NOW } };
}
function expectDiagnostic(diagnostic: Diagnostic) {
  expect(vi.mocked(console.warn).mock.calls).toEqual([["Hosted runtime resource cleanup failed.", diagnostic]]);
}
async function controlHttpError(): Promise<Error> {
  const client = createCloudflareHostedControlClient({
    baseUrl: "https://control.example.invalid", getBearerToken: async () => "synthetic-token",
    fetchImpl: async () => response(403), timeoutMs: 5_000,
  });
  try {
    await client.purgeRuntimeResource({ userId: "synthetic-member", resource: { kind: "snapshot", objectKey: "synthetic/orphan" } });
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected a synthetic HTTP rejection.");
}

describe("runtime resource cleanup diagnostics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.reconcile.mockResolvedValue(undefined);
    mocks.cutover.mockResolvedValue("postgres");
    mocks.mediaCommand.mockResolvedValue({ cutover: "postgres", applied: true, reason: null, purge: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["snapshot", "snapshot"], ["replica", "replica"], ["legacy_snapshot", "legacy_snapshot"],
    ["media", "media"], ["synthetic-private-kind", "unknown"], ["multipart", "unknown"],
  ] as const)("reports invalid %s without a provider effect", async (kind, resourceKind) => {
    const row = orphan({ kind, objectKey: null });
    const f = fixture([row]);
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 1 });
    expectDiagnostic({ resourceKind, stage: "parse", errorCategory: "validation" });
    expect(f.purge).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[requeue(row)]]);
  });

  it.each([403, 500])("recognizes real control HTTP %s without its private code/body", async status => {
    const row = orphan();
    const f = fixture([row]);
    f.fetchImpl.mockImplementationOnce(async () => response(status));
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 1 });
    expectDiagnostic({ resourceKind: "snapshot", stage: "purge", errorCategory: "http", httpStatus: status });
    expect(f.purge.mock.calls).toEqual([[{ userId: row.userId, resource: { kind: "snapshot", objectKey: row.objectKey } }]]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[requeue(row)]]);
  });

  it.each([
    ["TimeoutError", "timeout"], ["AbortError", "abort"], ["synthetic-private-name", "other"], ["TypeError", "other"],
  ] as const)("classifies fetch rejection %s without changing retries", async (name, errorCategory) => {
    const f = fixture();
    f.fetchImpl.mockRejectedValueOnce(Object.assign(new Error("synthetic-private-message"), { name }));
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 1 });
    expectDiagnostic({ resourceKind: "snapshot", stage: "purge", errorCategory });
    expect(f.purge).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[requeue(orphan())]]);
  });

  it.each([["AbortError", "abort"], ["TimeoutError", "timeout"]] as const)("handles native %s without input getters", async (name, errorCategory) => {
    const f = fixture();
    const error = new DOMException("synthetic-private-message", name);
    const getter = vi.fn(() => { throw new Error("Synthetic hostile accessor."); });
    for (const key of ["name", "code", "status", "message", "stack", "cause"]) Object.defineProperty(error, key, { get: getter });
    f.purge.mockRejectedValueOnce(error);
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 1 });
    expectDiagnostic({ resourceKind: "snapshot", stage: "purge", errorCategory });
    expect(getter).not.toHaveBeenCalled();
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[requeue(orphan())]]);
  });

  it("distinguishes an acknowledgement exception after a successful purge and preserves both fences", async () => {
    const row = orphan({ revision: 123n });
    const f = fixture([row]);
    f.orphanTable.updateMany.mockRejectedValueOnce(Object.assign(new Error("synthetic-private-message"), {
      name: "PrismaClientKnownRequestError", code: "synthetic-private-code",
    }));
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 1 });
    expectDiagnostic({ resourceKind: "snapshot", stage: "acknowledge", errorCategory: "database" });
    expect(f.purge).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[acknowledge(row)], [requeue(row)]]);
    expect(f.orphanTable.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(f.fetchImpl.mock.invocationCallOrder[0]);
  });

  it("still rethrows the exact reschedule failure even when the logger throws", async () => {
    const row = orphan({ objectKey: null });
    const f = fixture([row]);
    const failure = new Error("Synthetic reschedule failure.");
    f.orphanTable.updateMany.mockRejectedValueOnce(failure);
    vi.mocked(console.warn).mockImplementation(() => { throw new Error("Synthetic logger failure."); });
    await expect(f.run()).rejects.toBe(failure);
    expectDiagnostic({ resourceKind: "snapshot", stage: "parse", errorCategory: "validation" });
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[requeue(row)]]);
    expect(f.purge).not.toHaveBeenCalled();
  });

  it.each(["purge", "acknowledge"] as const)("reports the media %s boundary without an orphan requeue", async stage => {
    const row = media();
    const f = fixture([], [row]);
    if (stage === "purge") f.fetchImpl.mockImplementationOnce(async () => response(500));
    else mocks.mediaCommand.mockRejectedValueOnce(Object.assign(new Error("synthetic-private-message"), { name: "PrismaClientUnknownRequestError" }));
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 1 });
    expectDiagnostic({ resourceKind: "media", stage, errorCategory: stage === "purge" ? "http" : "database", ...(stage === "purge" ? { httpStatus: 500 } : {}) });
    expect(f.purge.mock.calls).toEqual([[{ userId: row.userId, resource: { kind: "media", objectKey: row.objectKey } }]]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.orphanTable.updateMany).not.toHaveBeenCalled();
    expect(f.mediaTable.update.mock.calls).toEqual([[{ where: { userId_mediaId: { userId: row.userId, mediaId: row.mediaId } }, data: { retiredAt: NOW, updatedAt: NOW } }]]);
    if (stage === "purge") expect(mocks.mediaCommand).not.toHaveBeenCalled();
    else expect(mocks.mediaCommand.mock.calls).toEqual([[{ prisma: f.prisma, now: NOW, userId: row.userId,
      command: { operation: "acknowledge_purge", purge: { userId: row.userId, mediaId: row.mediaId, objectKey: row.objectKey, revision: "9" } } }]]);
  });

  it("keeps successful claims and sequential provider work quiet and bounded", async () => {
    const rows = [orphan(), orphan({ kind: "replica", resourceId: "synthetic-second", objectKey: "synthetic/second" })];
    const mediaRow = media();
    const f = fixture(rows, [mediaRow]);
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 3, failed: 0 });
    expect(console.warn).not.toHaveBeenCalled();
    expect(mocks.control.mock.calls).toEqual([[5_000]]);
    expect(mocks.reconcile.mock.calls).toEqual([[{ prisma: f.prisma, now: NOW, deadlineAtMs: NOW.getTime() + 25_000 }]]);
    expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(2);
    for (const call of f.prisma.$queryRaw.mock.calls) expect(call.at(-1)).toBe(50);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(f.prisma.$queryRaw.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.reconcile.mock.invocationCallOrder[0]);
    expect(f.purge.mock.invocationCallOrder[0]).toBeGreaterThan(f.prisma.$transaction.mock.invocationCallOrder[2]);
    expect(mocks.memberLock.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.cutover.mock.invocationCallOrder[0]);
    expect(mocks.ownerLock.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.memberLock.mock.invocationCallOrder[0]);
    expect(f.orphanTable.update.mock.calls).toEqual(rows.map(row => [{ where: { userId_kind_resourceId: {
      userId: row.userId, kind: row.kind, resourceId: row.resourceId,
    } }, data: { retiredAt: NOW } }]));
    expect(f.purge.mock.calls).toEqual([
      ...rows.map(row => [{ userId: row.userId, resource: { kind: row.kind, objectKey: row.objectKey } }]),
      [{ userId: mediaRow.userId, resource: { kind: "media", objectKey: mediaRow.objectKey } }],
    ]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
    expect(f.orphanTable.updateMany.mock.calls).toEqual(rows.map(row => [acknowledge(row)]));
  });

  it("does not count or warn for an unapplied acknowledgement", async () => {
    const f = fixture([orphan()], [media()]);
    f.orphanTable.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.mediaCommand.mockResolvedValueOnce({ cutover: "postgres", applied: false, reason: null, purge: null });
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 0 });
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[acknowledge(orphan())]]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("keeps disabled cleanup quiet without claims or effects", async () => {
    const f = fixture();
    mocks.control.mockReturnValue(null);
    await expect(f.run()).resolves.toEqual({ configured: false, deleted: 0, failed: 0 });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.purge).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("keeps expired-deadline claims quiet", async () => {
    const f = fixture([orphan()], [media()]);
    mocks.reconcile.mockImplementationOnce(async () => { vi.mocked(Date.now).mockReturnValue(NOW.getTime() + 25_000); });
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 0 });
    expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.purge).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("finishes the current acknowledgement but quietly skips remaining claimed work at the deadline", async () => {
    const f = fixture([orphan(), orphan({ resourceId: "synthetic-second" })], [media()]);
    f.fetchImpl.mockImplementationOnce(async () => {
      vi.mocked(Date.now).mockReturnValue(NOW.getTime() + 25_000);
      return response();
    });
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 1, failed: 0 });
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(f.purge).toHaveBeenCalledTimes(1);
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[acknowledge(orphan())]]);
    expect(mocks.mediaCommand).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(["private", "accessors", "get-trap", "prototype-trap", "revoked", "symbol", "null"] as const)("bounds %s errors even with a throwing logger", async kind => {
    const f = fixture();
    const getter = vi.fn(() => { throw new Error("Synthetic hostile access."); });
    let error: unknown;
    switch (kind) {
      case "private": error = { name: "synthetic-private-name", message: "synthetic-private-message", stack: "synthetic-private-stack",
        code: "synthetic-private-code", cause: "synthetic-private-cause", status: 403 }; break;
      case "accessors": {
        const value: object = Object.create(null);
        for (const key of ["name", "status", "code", "message", "stack", "cause", "toString"]) Object.defineProperty(value, key, { get: getter });
        error = value;
        break;
      }
      case "get-trap": error = new Proxy(new Error("synthetic-private-message"), { get: getter }); break;
      // The HTTP predicate's prototype walk, rather than property reading, throws.
      case "prototype-trap": error = Object.create(new Proxy({}, { getPrototypeOf: () => { throw new Error("Synthetic reflection failure."); } })); break;
      case "revoked": { const value = Proxy.revocable({}, {}); value.revoke(); error = value.proxy; break; }
      case "symbol": error = Symbol("synthetic-private-symbol"); break;
      case "null": error = null; break;
    }
    f.purge.mockRejectedValueOnce(error);
    vi.mocked(console.warn).mockImplementation(() => { throw new Error("Synthetic logger failure."); });
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 1 });
    expectDiagnostic({ resourceKind: "snapshot", stage: "purge", errorCategory: "other" });
    expect(getter).not.toHaveBeenCalled();
    expect(f.purge).toHaveBeenCalledTimes(1);
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[requeue(orphan())]]);
  });

  it("recognizes a real HTTP error without invoking its private accessors", async () => {
    const f = fixture();
    const error = await controlHttpError();
    const getter = vi.fn(() => { throw new Error("Synthetic hostile HTTP accessor."); });
    // Replace stack before name/message to avoid V8's lazy stack formatting.
    for (const key of ["stack", "name", "message", "code", "status", "cause"]) Object.defineProperty(error, key, { get: getter });
    f.purge.mockRejectedValueOnce(error);
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 1 });
    expectDiagnostic({ resourceKind: "snapshot", stage: "purge", errorCategory: "http" });
    expect(getter).not.toHaveBeenCalled();
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[requeue(orphan())]]);
  });

  it.each([99, 600, 403.5, NaN, Infinity, "403"])("omits invalid HTTP status %s without coercion", async status => {
    const f = fixture();
    const error = await controlHttpError();
    Object.defineProperty(error, "status", { value: status });
    f.purge.mockRejectedValueOnce(error);
    await expect(f.run()).resolves.toEqual({ configured: true, deleted: 0, failed: 1 });
    expectDiagnostic({ resourceKind: "snapshot", stage: "purge", errorCategory: "http" });
    expect(f.orphanTable.updateMany.mock.calls).toEqual([[requeue(orphan())]]);
  });
});
