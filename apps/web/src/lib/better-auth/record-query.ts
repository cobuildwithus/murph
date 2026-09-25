import type { Prisma } from "@prisma/client";
import type { CleanedWhere } from "better-auth/adapters";
import { authLookupKey } from "./record-crypto";
import type { AuthModel, AuthRecord } from "./record";

const LOOKUP_FIELDS: Record<AuthModel, readonly string[]> = {
  user: ["email", "phoneNumber"], session: ["token"],
  account: ["accountId"], verification: ["identifier"],
};
export const AUTH_RECORD_LIMIT = 100;

// Every query must have an indexed, bounded identity selector. Additional guards
// are checked against authenticated plaintext, never against unauthenticated DB
// flags. Unsupported library operations fail closed as a contract change.
export function authRecordSelector(model: AuthModel, where: CleanedWhere[]): Prisma.HostedAuthRecordWhereInput {
  if (!where.length || where.some((clause) => clause.connector === "OR")) {
    throw new TypeError("Authentication queries require a bounded AND selector.");
  }
  for (const clause of where) {
    const selector = indexedSelector(model, clause);
    if (selector) return { model, ...selector };
  }
  throw new TypeError("Authentication query has no supported identity selector.");
}

function indexedSelector(model: AuthModel, clause: CleanedWhere): Prisma.HostedAuthRecordWhereInput | null {
  if (clause.field === "id" && clause.operator === "in" && Array.isArray(clause.value)
    && clause.value.length <= AUTH_RECORD_LIMIT && clause.value.every((value) => typeof value === "string")) {
    return { id: { in: clause.value } };
  }
  if (clause.operator !== "eq" || typeof clause.value !== "string") return null;
  if (clause.field === "id") return { id: clause.value };
  if (clause.field === "userId" && (model === "session" || model === "account")) return { memberId: clause.value };
  if (!LOOKUP_FIELDS[model].includes(clause.field)) return null;
  const key = authLookupKey(model, clause.field, clause.value);
  return clause.field === "phoneNumber" ? { secondaryLookupKey: key } : { lookupKey: key };
}

export function matchesAuthRecord(record: AuthRecord, where: CleanedWhere[]): boolean {
  return where.every((clause) => matchesClause(record, clause));
}

function matchesClause(record: AuthRecord, clause: CleanedWhere): boolean {
  if (!Object.hasOwn(record, clause.field)) throw new TypeError("Unsupported authentication query field.");
  if (clause.mode === "insensitive") throw new TypeError("Authentication selectors must be normalized before lookup.");
  const actual = comparable(record[clause.field]);
  const expected = comparable(clause.value);
  switch (clause.operator) {
    case "eq": return actual === expected;
    case "ne": return actual !== expected;
    case "in":
    case "not_in": {
      if (!Array.isArray(clause.value)) throw new TypeError("Invalid authentication set selector.");
      const included = clause.value.some((value) => comparable(value) === actual);
      return clause.operator === "in" ? included : !included;
    }
    case "lt": case "lte": case "gt": case "gte":
      return compareOrder(actual, expected, clause.operator);
    default: throw new TypeError("Unsupported authentication query operator.");
  }
}

function comparable(value: unknown): unknown { return value instanceof Date ? value.getTime() : value; }
function compareOrder(actual: unknown, expected: unknown, operator: string): boolean {
  if (typeof actual !== "number" || typeof expected !== "number") {
    throw new TypeError("Only authentication dates support ordered guards.");
  }
  switch (operator) {
    case "lt": return actual < expected;
    case "lte": return actual <= expected;
    case "gt": return actual > expected;
    case "gte": return actual >= expected;
    default: throw new TypeError("Unsupported authentication comparison.");
  }
}
