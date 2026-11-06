import { HostedRuntimeMediaWriteError, type HostedRuntimeMediaDescriptor, type HostedRuntimeMediaStore } from "../src/hosted-runtime/platform.ts";

export type MediaOperation = "record" | "put" | "delete";
export function mediaFailure(message = "HTTP 409: media operation rejected") {
  return new HostedRuntimeMediaWriteError({ cause: new Error(message), retryable: true });
}
// Mirrors Web register/admit/retire and the Worker's absent-retire 409. Retired
// metadata remains terminal, including after bytes have been purged.
export function createMealMediaStore() {
  const rows = new Map<string, HostedRuntimeMediaDescriptor & { expiresAt: string | null; retired: boolean }>();
  const bytes = new Map<string, Uint8Array>();
  const calls: Array<{ operation: MediaOperation; mediaId: string; expiresAt?: string | null }> = [];
  const hooks: { before?: (op: MediaOperation, id: string) => Promise<void>; after?: (op: MediaOperation, id: string) => Promise<void> } = {};
  const mediaStore: HostedRuntimeMediaStore = {
    async record(descriptor) {
      calls.push({ operation: "record", mediaId: descriptor.mediaId, expiresAt: descriptor.expiresAt });
      await hooks.before?.("record", descriptor.mediaId);
      const old = rows.get(descriptor.mediaId);
      if (old?.retired) throw mediaFailure();
      const candidate = descriptor.expiresAt ?? null;
      const expiresAt = candidate === null ? null : old?.expiresAt && old.expiresAt < candidate ? old.expiresAt : candidate;
      rows.set(descriptor.mediaId, { ...descriptor, expiresAt, retired: false });
      await hooks.after?.("record", descriptor.mediaId);
    },
    async put(descriptor) {
      calls.push({ operation: "put", mediaId: descriptor.mediaId, expiresAt: descriptor.expiresAt });
      await hooks.before?.("put", descriptor.mediaId);
      if (rows.get(descriptor.mediaId)?.retired) throw mediaFailure();
      if (!rows.has(descriptor.mediaId)) rows.set(descriptor.mediaId, { ...descriptor, expiresAt: new Date(Date.now() + 65 * 60_000).toISOString(), retired: false });
      bytes.set(descriptor.mediaId, descriptor.bytes);
      // Actual PUT registers before returning; a lost response follows BOTH.
      const old = rows.get(descriptor.mediaId)!;
      if (old.retired) throw mediaFailure();
      const expiry = descriptor.expiresAt ?? null;
      old.expiresAt = expiry === null ? null : old.expiresAt && old.expiresAt < expiry ? old.expiresAt : expiry;
      await hooks.after?.("put", descriptor.mediaId);
    },
    async delete({ mediaId }) {
      calls.push({ operation: "delete", mediaId });
      await hooks.before?.("delete", mediaId);
      const row = rows.get(mediaId);
      if (!row) throw mediaFailure();
      row.retired = true;
      row.expiresAt = row.expiresAt && Date.parse(row.expiresAt) < Date.now() ? row.expiresAt : new Date().toISOString();
      bytes.delete(mediaId);
      await hooks.after?.("delete", mediaId);
    },
    get: async ({ mediaId }) => bytes.get(mediaId) ?? null,
  };
  return { mediaStore, rows, bytes, calls, hooks,
    sweep(now: number) {
      for (const [id, row] of rows) if (row.expiresAt !== null && Date.parse(row.expiresAt) <= now) {
        row.retired = true; bytes.delete(id);
      }
    },
    activeUnlimited: () => [...rows.values()].filter(row => !row.retired && row.expiresAt === null).length,
  };
}
