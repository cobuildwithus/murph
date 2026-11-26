import "server-only";
import { invalidGameRequest } from "../game/http/errors";
import { openHealthTexts, sealHealthTexts } from "./crypto";

export interface HealthPagePosition { id: string; createdAt: Date }

function target(memberId: string, collection: string) {
  return { memberId, table: "health_post" as const, rowId: collection, field: "page_cursor" };
}

export async function openHealthCursor(memberId: string, collection: string, cursor?: string | null) {
  if (cursor === undefined || cursor === null) return undefined;
  try {
    const envelope = Buffer.from(cursor, "base64url");
    if (!envelope.length || envelope.toString("base64url") !== cursor) throw invalidGameRequest("Invalid page cursor.");
    const [value] = await openHealthTexts([{ ...target(memberId, collection), value: envelope.toString("utf8") }]);
    if (!value.startsWith(collection + "|")) throw invalidGameRequest("Invalid page cursor.");
    const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/u.exec(value.slice(collection.length + 1));
    if (parts) {
      const createdAt = new Date(parts[1]);
      if (Number.isFinite(createdAt.valueOf()) && createdAt.toISOString() === parts[1]) return { createdAt, id: parts[2] };
    }
  } catch {
    // A client-supplied token is never authority; do not disclose envelope or key details.
  }
  throw invalidGameRequest("Invalid page cursor.");
}

/** The final scanned row can be withdrawn during opening, so its identity must stay opaque. */
export async function sealHealthCursor(memberId: string, collection: string, lastScanned: HealthPagePosition | undefined) {
  if (!lastScanned) return null;
  const [encrypted] = await sealHealthTexts([{ ...target(memberId, collection),
    value: `${collection}|${lastScanned.createdAt.toISOString()}|${lastScanned.id}` }]);
  return Buffer.from(encrypted).toString("base64url");
}
