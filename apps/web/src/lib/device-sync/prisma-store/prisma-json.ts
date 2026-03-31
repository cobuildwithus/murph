import { Prisma } from "@prisma/client";

import { toJsonRecord } from "../shared";

export function toPrismaJsonObject(value: unknown): Prisma.InputJsonObject {
  return toJsonRecord(value) as Prisma.InputJsonObject;
}

export function toNullablePrismaJsonValue(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value ? toPrismaJsonObject(value) : Prisma.DbNull;
}
