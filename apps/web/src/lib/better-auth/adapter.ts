import "server-only";
import type { HostedAuthRecord, Prisma, PrismaClient } from "@prisma/client";
import type { BetterAuthOptions } from "better-auth";
import { createAdapterFactory, type CleanedWhere, type CustomAdapter, type DBAdapter } from "better-auth/adapters";
import { runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { authRecordOwner, requireAuthModel, type AuthRecord, type AuthModel } from "./record";
import { openAuthRecord, sealAuthRecord } from "./record-crypto";
import { AUTH_RECORD_LIMIT, authRecordSelector, matchesAuthRecord } from "./record-query";

type Client = PrismaClient | Prisma.TransactionClient;
type OpenRecord = { row: HostedAuthRecord; record: AuthRecord };

export class AuthRecordChangedError extends Error {
  constructor() { super("Authentication state changed. Retry the operation."); this.name = "AuthRecordChangedError"; }
}

// The callback receives this same protected adapter over the transaction client.
// Request owners prewarm exact member roots before entering a transaction. A
// library change that needs another root fails before making a provider call.
export function hostedAuthAdapter(prisma: PrismaClient): (options: BetterAuthOptions) => DBAdapter {
  return (options) => buildAdapter(prisma, prisma, options, false);
}

export function hostedAuthTransactionAdapter(prisma: PrismaClient, tx: Prisma.TransactionClient, options: BetterAuthOptions): DBAdapter {
  return buildAdapter(prisma, tx, options, true);
}

function buildAdapter(root: PrismaClient, client: Client, options: BetterAuthOptions, inTransaction: boolean): DBAdapter {
  return createAdapterFactory({
    config: {
      adapterId: "murph-encrypted-auth", supportsDates: true, supportsBooleans: true,
      supportsNumericIds: false, debugLogs: false,
      transaction: async (callback) => inTransaction
        ? callback(buildAdapter(root, client, options, true))
        : root.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(
          () => callback(buildAdapter(root, tx, options, true)),
        ), { maxWait: 5_000, timeout: 10_000 }),
    },
    adapter: () => makeOperations(root, client, inTransaction),
  })(options);
}

async function readRecords(client: Client, model: AuthModel, where: CleanedWhere[]): Promise<OpenRecord[]> {
  const rows = await client.hostedAuthRecord.findMany({
    where: authRecordSelector(model, where), take: AUTH_RECORD_LIMIT + 1, orderBy: { id: "asc" },
  });
  if (rows.length > AUTH_RECORD_LIMIT) throw new Error("Authentication collection limit exceeded.");
  const opened: OpenRecord[] = [];
  for (const row of rows) {
    const record = await openAuthRecord(row, client);
    if (matchesAuthRecord(record, where)) opened.push({ row, record });
  }
  return opened;
}

function exactRow(row: HostedAuthRecord): Prisma.HostedAuthRecordWhereInput {
  return {
    model: row.model, id: row.id, memberId: row.memberId,
    payloadEncrypted: row.payloadEncrypted, lookupKey: row.lookupKey,
    secondaryLookupKey: row.secondaryLookupKey, expiresAt: row.expiresAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function replaceRecord(client: Client, opened: OpenRecord, update: unknown): Promise<AuthRecord> {
  if (!update || typeof update !== "object" || Array.isArray(update)) throw new TypeError("Invalid authentication update.");
  const record = { ...opened.record, ...update };
  const model = requireAuthModel(opened.row.model);
  if (record.id !== opened.record.id || authRecordOwner(model, record) !== opened.row.memberId) {
    throw new TypeError("Authentication records cannot change identity.");
  }
  const next = await sealAuthRecord(model, record, client);
  const result = await client.hostedAuthRecord.updateMany({ where: exactRow(opened.row), data: next });
  if (result.count !== 1) throw new AuthRecordChangedError();
  return record;
}

async function deleteRecord(client: Client, opened: OpenRecord): Promise<void> {
  const result = await client.hostedAuthRecord.deleteMany({ where: exactRow(opened.row) });
  if (result.count !== 1) throw new AuthRecordChangedError();
}

function sortRecords(records: OpenRecord[], sortBy?: { field: string; direction: "asc" | "desc" }): OpenRecord[] {
  if (!sortBy) return records;
  if (!["id", "createdAt", "updatedAt", "expiresAt"].includes(sortBy.field)) {
    throw new TypeError("Unsupported authentication sort field.");
  }
  return records.sort((a, b) => {
    const left = a.record[sortBy.field]; const right = b.record[sortBy.field];
    const order = left instanceof Date && right instanceof Date
      ? left.getTime() - right.getTime() : String(left).localeCompare(String(right));
    return sortBy.direction === "asc" ? order : -order;
  });
}

// Better Auth supplies generic result T after its schema/field transformations.
// The factory applies select to these fully authenticated closed-schema records.
function makeOperations(root: PrismaClient, client: Client, inTransaction: boolean): CustomAdapter {
  const commit = <T>(run: (tx: Client) => Promise<T>): Promise<T> => inTransaction
    ? run(client)
    : root.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(() => run(tx)), { maxWait: 5_000, timeout: 10_000 });
  return {
    create: async ({ model, data }) => {
      const row = await sealAuthRecord(requireAuthModel(model), data, client);
      await client.hostedAuthRecord.create({ data: row });
      return data;
    },
    findOne: async <T>({ model, where, join }: Parameters<CustomAdapter["findOne"]>[0]) => {
      if (join) throw new TypeError("Authentication joins are disabled.");
      return (await readRecords(client, requireAuthModel(model), where))[0]?.record as T ?? null;
    },
    findMany: async <T>({ model, where = [], limit, offset = 0, sortBy, join }: Parameters<CustomAdapter["findMany"]>[0]) => {
      if (join || !Number.isSafeInteger(limit) || limit < 1 || limit > AUTH_RECORD_LIMIT
        || !Number.isSafeInteger(offset) || offset < 0 || offset > AUTH_RECORD_LIMIT) {
        throw new TypeError("Unsupported authentication collection query.");
      }
      const records = sortRecords(await readRecords(client, requireAuthModel(model), where), sortBy);
      return records.slice(offset, offset + limit).map(({ record }) => record as T);
    },
    update: async <T>({ model, where, update }: Parameters<CustomAdapter["update"]>[0]) => {
      const records = await readRecords(client, requireAuthModel(model), where);
      if (records.length > 1) throw new TypeError("Authentication update requires a single record.");
      return records[0] ? await replaceRecord(client, records[0], update) as T : null;
    },
    updateMany: async ({ model, where, update }) => {
      const records = await readRecords(client, requireAuthModel(model), where);
      const prepared: Array<{ opened: OpenRecord; next: HostedAuthRecord }> = [];
      for (const opened of records) {
        const next = { ...opened.record, ...update };
        if (next.id !== opened.record.id || authRecordOwner(requireAuthModel(model), next) !== opened.row.memberId) {
          throw new TypeError("Authentication records cannot change identity.");
        }
        prepared.push({ opened, next: await sealAuthRecord(requireAuthModel(model), next, client) });
      }
      return commit(async (tx) => {
        for (const { opened, next } of prepared) {
          const changed = await tx.hostedAuthRecord.updateMany({ where: exactRow(opened.row), data: next });
          if (changed.count !== 1) throw new AuthRecordChangedError();
        }
        return records.length;
      });
    },
    delete: async ({ model, where }) => {
      const records = await readRecords(client, requireAuthModel(model), where);
      if (records.length > 1) throw new TypeError("Authentication delete requires a single record.");
      if (records[0]) await deleteRecord(client, records[0]);
    },
    deleteMany: async ({ model, where }) => {
      const records = await readRecords(client, requireAuthModel(model), where);
      return commit(async (tx) => {
        for (const record of records) await deleteRecord(tx, record);
        return records.length;
      });
    },
    consumeOne: async <T>({ model, where }: Parameters<NonNullable<CustomAdapter["consumeOne"]>>[0]) => {
      const records = await readRecords(client, requireAuthModel(model), where);
      if (records.length > 1) throw new TypeError("Authentication consume requires a single record.");
      if (!records[0]) return null;
      const result = await client.hostedAuthRecord.deleteMany({ where: exactRow(records[0].row) });
      return result.count === 1 ? records[0].record as T : null;
    },
    // Enabled models contain no numeric counters. Never let the factory's
    // fallback turn a newly enabled plugin into an unreviewed authority writer.
    incrementOne: async () => { throw new TypeError("Authentication numeric increments are not enabled."); },
    count: async ({ model, where = [] }) => (await readRecords(client, requireAuthModel(model), where)).length,
  };
}
