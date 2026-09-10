import * as z from "@murphai/contracts/zod-runtime";

const text = z.string().min(1).max(2048);
const dates = { createdAt: z.date(), updatedAt: z.date() };
const schemas = {
  user: z.object({
    id: text, email: z.string().email().max(320), emailVerified: z.boolean(),
    name: z.string().max(200), image: z.null().optional(),
    credentialsChangedAt: z.date().nullable().default(null),
    phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/u).nullable().optional(),
    phoneNumberVerified: z.boolean().optional(), ...dates,
  }).strict(),
  session: z.object({
    id: text, userId: text, token: z.string().min(32).max(256), expiresAt: z.date(),
    primaryAuthenticatedAt: z.date().nullable().default(null),
    ipAddress: z.null().optional(), userAgent: z.null().optional(), ...dates,
  }).strict(),
  account: z.object({
    id: text, userId: text, accountId: z.string().regex(/^[1-9]\d{0,19}$/u),
    providerId: z.literal("telegram"), ...dates,
  }).strict(),
  verification: z.object({
    id: text, identifier: text, value: z.string().min(1).max(8192), expiresAt: z.date(), ...dates,
  }).strict(),
};

export type AuthModel = keyof typeof schemas;
export type AuthRecord = Record<string, string | boolean | Date | null | undefined> & {
  id: string; createdAt: Date; updatedAt: Date;
};

export function requireAuthModel(model: string): AuthModel {
  if (!Object.hasOwn(schemas, model)) throw new TypeError("Unsupported authentication model.");
  return model as AuthModel;
}

export function parseAuthRecord(model: AuthModel, value: unknown): AuthRecord {
  return schemas[model].parse(value);
}

export function deserializeAuthRecord(model: AuthModel, plaintext: string): AuthRecord {
  if (plaintext.length > 16_384) throw new TypeError("Authentication record is too large.");
  const value: unknown = JSON.parse(plaintext);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid authentication record.");
  }
  const record: Record<string, unknown> = { ...value };
  for (const field of ["createdAt", "updatedAt", "expiresAt", "credentialsChangedAt", "primaryAuthenticatedAt"]) {
    if (typeof record[field] === "string") record[field] = new Date(record[field]);
  }
  return parseAuthRecord(model, record);
}

export function authRecordOwner(model: AuthModel, record: AuthRecord): string | null {
  if (model === "verification") return null;
  const id = model === "user" ? record.id : record.userId;
  if (typeof id !== "string" || !id) throw new TypeError("Authentication owner is missing.");
  return id;
}
