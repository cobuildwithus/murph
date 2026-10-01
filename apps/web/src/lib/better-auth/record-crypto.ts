import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import type { HostedAuthRecord, Prisma, PrismaClient } from "@prisma/client";
import { decryptHostedWebNullableString, encryptHostedWebNullableString } from "../hosted-web/encryption";
import { authRecordOwner, deserializeAuthRecord, parseAuthRecord, requireAuthModel, type AuthModel, type AuthRecord } from "./record";

type Client = PrismaClient | Prisma.TransactionClient;
type Columns = Omit<HostedAuthRecord, "payloadEncrypted">;

function storageKey(purpose: string): Buffer {
  const encoded = process.env.HOSTED_AUTH_STORAGE_KEY ?? "";
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded) {
    throw new TypeError("HOSTED_AUTH_STORAGE_KEY must be a canonical 32-byte base64url key.");
  }
  try { return Buffer.from(hkdfSync("sha256", key, "murph.auth.v1", purpose, 32)); }
  finally { key.fill(0); }
}

export function authLookupKey(model: AuthModel, field: string, value: string): string {
  const key = storageKey("lookup");
  try { return createHmac("sha256", key).update(JSON.stringify([model, field, value])).digest("hex"); }
  finally { key.fill(0); }
}

function columnsFor(model: AuthModel, record: AuthRecord): Columns {
  const lookupField = { user: "email", session: "token", account: "accountId", verification: "identifier" }[model];
  const lookup = record[lookupField];
  if (typeof lookup !== "string") throw new TypeError("Authentication selector is missing.");
  return {
    model, id: record.id, memberId: authRecordOwner(model, record),
    lookupKey: authLookupKey(model, lookupField, lookup),
    secondaryLookupKey: model === "user" && typeof record.phoneNumber === "string"
      ? authLookupKey(model, "phoneNumber", record.phoneNumber) : null,
    expiresAt: record.expiresAt instanceof Date ? record.expiresAt : null,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}

function fieldFor(model: AuthModel, id: string): string {
  return `hosted-auth.v1:${model}:${id}`;
}

function sealVerification(plaintext: string, columns: Columns): string {
  const key = storageKey("verification");
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(columns)));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  } finally { key.fill(0); }
}

function openVerification(encrypted: string, columns: Columns): string {
  const parts = encrypted.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new TypeError("Invalid verification envelope.");
  const key = storageKey("verification");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAAD(Buffer.from(JSON.stringify(columns)));
    decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8");
  } finally { key.fill(0); }
}

export async function sealAuthRecord(model: AuthModel, value: unknown, prisma: Client): Promise<HostedAuthRecord> {
  const record = parseAuthRecord(model, value);
  const columns = columnsFor(model, record);
  const plaintext = JSON.stringify(record);
  const payloadEncrypted = columns.memberId
    ? await encryptHostedWebNullableString({
      field: fieldFor(model, record.id), memberId: columns.memberId, prisma, value: plaintext,
    })
    : sealVerification(plaintext, columns);
  if (!payloadEncrypted) throw new Error("Authentication record could not be encrypted.");
  return { ...columns, payloadEncrypted };
}

// Every operation opens the complete row, including select/count/delete paths.
// Recompute all routing columns before a caller can trust or reseal the record.
export async function openAuthRecord(row: HostedAuthRecord, prisma: Client): Promise<AuthRecord> {
  const model = requireAuthModel(row.model);
  if ((model === "verification") !== (row.memberId === null)
    || (model === "user" && row.memberId !== row.id)) {
    throw new TypeError("Authentication record owner mismatch.");
  }
  const columns: Columns = {
    model, id: row.id, memberId: row.memberId, lookupKey: row.lookupKey,
    secondaryLookupKey: row.secondaryLookupKey, expiresAt: row.expiresAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
  const plaintext = row.memberId
    ? await decryptHostedWebNullableString({
      field: fieldFor(model, row.id), memberId: row.memberId, prisma, value: row.payloadEncrypted,
    })
    : openVerification(row.payloadEncrypted, columns);
  if (!plaintext) throw new Error("Authentication record could not be authenticated.");
  const record = deserializeAuthRecord(model, plaintext);
  if (JSON.stringify(columnsFor(model, record)) !== JSON.stringify(columns)) {
    throw new Error("Authentication record integrity mismatch.");
  }
  return record;
}
